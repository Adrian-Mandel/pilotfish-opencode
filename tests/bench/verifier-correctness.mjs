#!/usr/bin/env node
// Issue #15, first slice: does the verifier still catch defects it should?
//
// Runs `pilotfish` end-to-end against seeded-defect repositories inside the
// existing integration fixture and scores the verdict its own verifier returned
// against known ground truth. In situ by construction -- no bench mode, no
// per-profile shim, no change to production routing, permissions, or the
// authorization protocol. The verifier is measured exactly as the primary
// dispatches it, scope instruction and all, which is the thing #16 changed.
//
//   node tests/bench/verifier-correctness.mjs plan
//   node tests/bench/verifier-correctness.mjs run --confirm
//   node tests/bench/verifier-correctness.mjs report tests/bench/results/<file>.json
//   node tests/bench/verifier-correctness.mjs validate      # offline, no provider
//
// `plan` is not optional politeness: a full default suite is 40 orchestrated
// runs against a live subscription. Read what it prints before running.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFixture, destroyFixture, runOpencode } from "../integration/fixture.mjs";
import { CLASSES, briefFor, loadCases, materializeCase } from "./lib/cases.mjs";
import { DEFAULT_VARIANTS, VARIANTS, applyVariant, resolveVariant } from "./lib/variants.mjs";
import { classifyRunHealth, readRunTelemetry } from "./lib/telemetry.mjs";
import { OUTCOMES, scoreVerdict, summarizeCell, verdictSource } from "./lib/scoring.mjs";

const BENCH_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = join(BENCH_DIR, "results");
const SCHEMA = "pilotfish.bench.verifier-correctness/1";

// One measured run, not a distribution: a single `chatgpt` class-D run on
// 2026-08-10 took 9.5 minutes and 18.3k input / 1.2k output tokens in the
// verifier alone. The range is guesswork around it, widened downward because a
// clean case is the cheapest one and upward because a REFUTED verdict starts a
// re-verification round. Stated rather than omitted because the issue requires
// documented cost and runtime before a user starts a suite; replace both from
// the first completed suite.
const ESTIMATE = {
  source: "one measured run (2026-08-10, class D, chatgpt); the range around it is an assumption",
  minutesPerRun: 10,
  minutesPerRunRange: [5, 20],
};

function parseArgs(argv) {
  const options = {
    repeats: 5,
    variants: DEFAULT_VARIANTS,
    cases: null,
    classes: null,
    preset: "chatgpt",
    timeoutMinutes: 20,
    seed: null,
    out: null,
    confirm: false,
    keepFixtures: false,
    retryInvalid: 2,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    const next = () => argv[(i += 1)];
    switch (argument) {
      case "--repeats": options.repeats = Number(next()); break;
      case "--variants": options.variants = next().split(","); break;
      case "--cases": options.cases = next().split(","); break;
      case "--classes": options.classes = next().split(","); break;
      case "--preset": options.preset = next(); break;
      case "--timeout": options.timeoutMinutes = Number(next()); break;
      case "--seed": options.seed = Number(next()); break;
      case "--out": options.out = next(); break;
      case "--retry-invalid": options.retryInvalid = Number(next()); break;
      case "--confirm": options.confirm = true; break;
      case "--keep-fixtures": options.keepFixtures = true; break;
      default:
        if (argument.startsWith("--")) throw new Error(`unknown option: ${argument}`);
        positional.push(argument);
    }
  }
  for (const name of options.variants) {
    if (!VARIANTS[name]) throw new Error(`unknown variant: ${name}`);
  }
  for (const name of options.classes ?? []) {
    if (!CLASSES.includes(name)) throw new Error(`unknown class: ${name}`);
  }
  if (!Number.isInteger(options.repeats) || options.repeats < 1) {
    throw new Error("--repeats must be a positive integer");
  }
  return { command: positional[0] ?? "plan", positional: positional.slice(1), options };
}

// Deterministic shuffle so a suite can be replayed in the same order from its
// recorded seed. Order is randomized because the suite burns the same
// subscription quota it measures: run every `current` cell first and throttling
// lands entirely on `pre-scope`, manufacturing the asymmetry we are testing for.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQueue(cases, variants, repeats, seed) {
  const queue = [];
  for (const item of cases) {
    for (const variant of variants) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        queue.push({ caseId: item.id, variant, repeat });
      }
    }
  }
  return shuffled(queue, seed);
}

function environmentRecord() {
  const read = (command, args) => {
    try {
      return execFileSync(command, args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  // inheritGlobal copies the user's real global config into every fixture,
  // AGENTS.md included -- 2,053 words injected into all nine agents (#16 P6).
  // That is in-situ fidelity, not a leak, but it is also user configuration
  // that changes without notice, so results record what it was.
  const agentsPath = join(homedir(), ".config/opencode/AGENTS.md");
  return {
    node: process.version,
    opencode: read("opencode", ["--version"]),
    gitHead: read("git", ["rev-parse", "HEAD"]),
    gitDirty: read("git", ["status", "--porcelain"]) !== "",
    agentsMdSha256: existsSync(agentsPath)
      ? createHash("sha256").update(readFileSync(agentsPath)).digest("hex").slice(0, 16)
      : null,
  };
}

async function executeRun(entry, caseDef, resolvedVariant, options, attempt) {
  const startedAt = new Date().toISOString();
  const fixture = createFixture({ preset: options.preset, auth: true, inheritGlobal: true });
  try {
    const digests = applyVariant(fixture, resolvedVariant);
    const { head } = materializeCase(caseDef, fixture.project);
    const brief = briefFor(caseDef);

    const started = Date.now();
    const result = await runOpencode(fixture, ["run", brief, "--agent", "pilotfish"], {
      timeoutMs: options.timeoutMinutes * 60_000,
      stdoutFile: join(fixture.root, "run-stdout.txt"),
    });
    const durationMs = Date.now() - started;

    const telemetry = readRunTelemetry(fixture, { outside: REPO_ROOT.replace(/\/$/, "") });
    const health = classifyRunHealth({
      telemetry,
      stderr: result.stderr,
      stdout: result.stdout,
      timedOut: result.timedOut,
      exitCode: result.code ?? 0,
    });

    // The gate's first firing on the claim is the measurement. Later verifier
    // sessions are re-verification rounds after a REFUTED; they are recorded
    // in full (chain depth is #16's live metric) but do not vote.
    const first = telemetry.verifierRuns[0] ?? null;
    const scored = first
      ? scoreVerdict(caseDef, first.verdictText)
      : { verdict: null, mentioned: false, outcome: OUTCOMES.NOT_DISPATCHED };

    return {
      ...entry,
      attempt,
      startedAt,
      durationMs,
      defectClass: caseDef.defectClass,
      valid: health.valid,
      healthReasons: health.reasons,
      warnings: health.warnings,
      exitCode: result.code,
      timedOut: result.timedOut,
      commit: head,
      promptDigests: digests,
      ...scored,
      verdictSource: verdictSource(first?.verdictText ?? ""),
      verifierChainDepth: telemetry.verifierRuns.length,
      verifierRuns: telemetry.verifierRuns.map((run) => ({
        sessionId: run.sessionId,
        agent: run.agent,
        cost: run.cost,
        tokensInput: run.tokensInput,
        tokensOutput: run.tokensOutput,
        tokensReasoning: run.tokensReasoning,
        dispatchPrompt: run.dispatch?.prompt ?? null,
        // Retained in full and deliberately: CONFIRMED-with-observation is the
        // one outcome substring matching can plausibly mis-grade, and it cannot
        // be re-read later if only the label was kept.
        verdictText: run.verdictText,
      })),
      errors: telemetry.errors,
      stderrTail: result.stderr.slice(-2000),
    };
  } finally {
    if (!options.keepFixtures) destroyFixture(fixture);
    else process.stdout.write(`  fixture kept at ${fixture.root}\n`);
  }
}

function summarize(runs, cases) {
  const valid = runs.filter((run) => run.valid);
  const byCase = new Map(cases.map((item) => [item.id, item]));
  const cells = {};
  for (const run of valid) {
    const key = `${run.caseId}::${run.variant}`;
    (cells[key] ??= []).push(run);
  }

  const perCell = Object.fromEntries(
    Object.entries(cells).map(([key, cellRuns]) => [key, summarizeCell(cellRuns)]),
  );

  // Pooled per (class, variant). This is the comparison the prediction is
  // about: A and D hold while B degrades. Pooling across the cases within a
  // class is the point -- a single fixture measures a fixture.
  const perClass = {};
  for (const run of valid) {
    const key = `${run.defectClass}::${run.variant}`;
    (perClass[key] ??= []).push(run);
  }

  return {
    totalRuns: runs.length,
    validRuns: valid.length,
    invalidRuns: runs.length - valid.length,
    invalidReasons: runs
      .filter((run) => !run.valid)
      .reduce((counts, run) => {
        for (const reason of run.healthReasons) counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {}),
    notDispatched: valid.filter((run) => run.outcome === OUTCOMES.NOT_DISPATCHED).length,
    warned: valid
      .filter((run) => run.warnings?.length)
      .reduce((counts, run) => {
        for (const warning of run.warnings) counts[warning] = (counts[warning] ?? 0) + 1;
        return counts;
      }, {}),
    chainDepth: {
      max: Math.max(0, ...valid.map((run) => run.verifierChainDepth)),
      mean: valid.length
        ? valid.reduce((sum, run) => sum + run.verifierChainDepth, 0) / valid.length
        : null,
    },
    perCell,
    perClass: Object.fromEntries(
      Object.entries(perClass).map(([key, classRuns]) => [key, summarizeCell(classRuns)]),
    ),
    cases: Object.fromEntries(
      [...byCase.values()].map((item) => [item.id, { class: item.defectClass, title: item.title }]),
    ),
  };
}

function percent(measure) {
  if (!measure || measure.rate === null) return "n/a";
  const [low, high] = measure.ci95;
  return `${(measure.rate * 100).toFixed(0)}% (${measure.successes}/${measure.total}, 95% CI ${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%)`;
}

function renderReport(record) {
  const lines = [];
  const { summary, options } = record;
  lines.push(`# Verifier correctness — ${record.startedAt}`);
  lines.push("");
  lines.push(
    `${summary.validRuns} valid runs of ${summary.totalRuns}` +
      (summary.invalidRuns ? ` (excluded: ${JSON.stringify(summary.invalidReasons)})` : "") +
      `; seed ${record.seed}; preset ${options.preset}.`,
  );
  if (summary.notDispatched) {
    lines.push("");
    lines.push(
      `**${summary.notDispatched} valid runs never dispatched a verifier.** Those are excluded ` +
        "from every rate below: the gate not firing is a finding about the primary, not evidence " +
        "about the verifier.",
    );
  }
  lines.push("");
  lines.push("## By defect class (the prediction under test)");
  lines.push("");
  lines.push("| class | variant | n | false CONFIRMED | detected at all | refuted on the defect |");
  lines.push("|---|---|---|---|---|---|");
  for (const key of Object.keys(summary.perClass).sort()) {
    const [defectClass, variant] = key.split("::");
    const cell = summary.perClass[key];
    if (defectClass === "D") {
      lines.push(
        `| D | ${variant} | ${cell.scored} | — | — | false REFUTED: ${percent(cell.falseRefuted)} |`,
      );
      continue;
    }
    lines.push(
      `| ${defectClass} | ${variant} | ${cell.scored} | ${percent(cell.falseConfirmed)} | ${percent(cell.detected)} | ${percent(cell.refutedOnDefect)} |`,
    );
  }
  lines.push("");
  lines.push("## By case");
  lines.push("");
  lines.push(
    "| case | class | variant | n | caught | observed | missed | refuted-other | clean ✓ | false REFUTED | no verdict |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const key of Object.keys(summary.perCell).sort()) {
    const [caseId, variant] = key.split("::");
    const cell = summary.perCell[key];
    const c = cell.counts;
    lines.push(
      `| ${caseId} | ${summary.cases[caseId].class} | ${variant} | ${cell.scored} | ${c.caught} | ${c.observed} | ${c.missed} | ${c["refuted-other"]} | ${c["clean-confirmed"]} | ${c["false-refuted"]} | ${c["no-verdict"]} |`,
    );
  }
  lines.push("");
  lines.push(
    `Verifier chain depth: max ${summary.chainDepth?.max ?? "n/a"}, mean ` +
      `${summary.chainDepth?.mean == null ? "n/a" : summary.chainDepth.mean.toFixed(1)} ` +
      "(recorded because #16's revised criteria are stated against chain depth; only the first " +
      "verdict in each chain is scored above).",
  );
  if (Object.keys(summary.warned ?? {}).length > 0) {
    lines.push("");
    lines.push(
      `Flagged for audit, not excluded: ${JSON.stringify(summary.warned)}. \`host-cwd-reset\` means ` +
        "OpenCode's persistent shell reset its working directory mid-run; the verdict may rest on " +
        "commands run outside the fixture project. Read those runs' transcripts before trusting them.",
    );
  }
  lines.push("");
  lines.push(
    "`observed` is CONFIRMED with the defect named alongside the verdict — the channel #16's " +
      "scope change intends. It is neither a catch nor a miss and is reported on its own; the " +
      "gate did not stop the change, but the finding did reach the primary.",
  );
  return lines.join("\n");
}

function planText(cases, variants, options) {
  const cells = cases.length * variants.length;
  const runs = cells * options.repeats;
  const [low, high] = ESTIMATE.minutesPerRunRange;
  const lines = [
    "Suite plan",
    "",
    `  cases     ${cases.length}  (${cases.map((c) => `${c.id} [${c.defectClass}]`).join(", ")})`,
    `  variants  ${variants.length}  (${variants.join(", ")})`,
    `  repeats   ${options.repeats} per cell`,
    `  cells     ${cells}`,
    `  runs      ${runs}  full orchestrated pilotfish runs`,
    "",
    "Cost and runtime",
    "",
    `  Each run is one complete pilotfish session -- planning, at least one verifier`,
    `  dispatch, and whatever else the primary decides it needs -- against the live`,
    `  ${options.preset} subscription. It consumes the same quota it is measuring.`,
    "",
    `  Estimate: ~${ESTIMATE.minutesPerRun} min/run, so ~${((runs * ESTIMATE.minutesPerRun) / 60).toFixed(1)}h`,
    `  (range ${((runs * low) / 60).toFixed(1)}–${((runs * high) / 60).toFixed(1)}h at ${low}–${high} min/run).`,
    `  Source: ${ESTIMATE.source}. Replace these figures from a completed suite.`,
    "",
    `  Runs are sequential. Per-run timeout is ${options.timeoutMinutes} min; up to`,
    `  ${options.retryInvalid} retries per invalid run are appended to the queue.`,
    "",
    "Statistical power",
    "",
    `  Class B pools ${cases.filter((c) => c.defectClass === "B").length * options.repeats} runs per variant here (${cases.filter((c) => c.defectClass === "B").length} case(s) × ${options.repeats} repeats).`,
    "  Five repeats is the floor this issue sets, not a comfortable sample: at n=5 a",
    "  0/5 result has a 95% upper bound near 45%, so 'B held' is not concludable from",
    "  one cell. Use --repeats 10 or more before acting on a null result. A large",
    "  degradation is visible at 5; an absence of one is not.",
    "",
    "Nothing outside the fixture root is written, and the real",
    "~/.local/share/opencode/opencode.db is never read or pooled with these results.",
    "",
    "Re-run with --confirm to start.",
  ];
  return lines.join("\n");
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  if (command === "report") {
    const path = positional[0];
    if (!path) throw new Error("report needs a results file");
    process.stdout.write(`${renderReport(JSON.parse(readFileSync(path, "utf8")))}\n`);
    return;
  }

  const cases = loadCases({ ids: options.cases, classes: options.classes });
  if (cases.length === 0) throw new Error("no cases selected");

  if (command === "validate") {
    // Offline: proves every case builds into a two-commit repository and that
    // its ground truth is well-formed, without touching a provider.
    const scratch = join(RESULTS_DIR, ".validate");
    for (const item of cases) {
      const { head } = materializeCase(item, join(scratch, item.id));
      process.stdout.write(`ok  ${item.id} [${item.defectClass}] ${head.slice(0, 8)}\n`);
    }
    for (const name of options.variants) {
      const resolved = resolveVariant(name);
      const files = Object.keys(resolved.overrides).join(", ") || "(working tree)";
      process.stdout.write(`ok  variant ${name}: ${files}\n`);
    }
    process.stdout.write(`\nScratch repositories left in ${scratch} for inspection.\n`);
    return;
  }

  if (command !== "run") {
    process.stdout.write(`${planText(cases, options.variants, options)}\n`);
    return;
  }
  if (!options.confirm) {
    process.stdout.write(`${planText(cases, options.variants, options)}\n`);
    process.exitCode = 2;
    return;
  }

  const seed = options.seed ?? (Date.now() & 0x7fffffff);
  const resolvedVariants = Object.fromEntries(
    options.variants.map((name) => [name, resolveVariant(name)]),
  );
  const byId = new Map(cases.map((item) => [item.id, item]));
  const queue = buildQueue(cases, options.variants, options.repeats, seed);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const outPath =
    options.out ?? join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}-verifier-correctness.json`);

  const record = {
    schema: SCHEMA,
    startedAt,
    seed,
    options: { ...options, out: outPath },
    variants: Object.fromEntries(
      Object.entries(resolvedVariants).map(([name, variant]) => [
        name,
        { description: variant.description, prompts: variant.prompts, confounded: !!variant.confounded },
      ]),
    ),
    environment: environmentRecord(),
    runs: [],
    summary: null,
  };
  const flush = () => {
    record.summary = summarize(record.runs, cases);
    writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  };
  flush();

  process.stdout.write(`${planText(cases, options.variants, options)}\n\n`);
  process.stdout.write(`Writing to ${outPath}\n\n`);

  const pending = queue.map((entry) => ({ entry, attempt: 1 }));
  let completed = 0;
  while (pending.length > 0) {
    const { entry, attempt } = pending.shift();
    completed += 1;
    const label = `${entry.caseId} / ${entry.variant} / r${entry.repeat}${attempt > 1 ? ` (retry ${attempt - 1})` : ""}`;
    process.stdout.write(`[${completed}/${completed + pending.length}] ${label} ... `);

    // A suite is hours long. One unexpected throw -- a fixture that cannot be
    // built, a provider plugin that fails to load -- must cost that run, not
    // every run still queued behind it.
    let run;
    try {
      run = await executeRun(
        entry,
        byId.get(entry.caseId),
        resolvedVariants[entry.variant],
        options,
        attempt,
      );
    } catch (error) {
      run = {
        ...entry,
        attempt,
        defectClass: byId.get(entry.caseId).defectClass,
        valid: false,
        healthReasons: ["harness-error"],
        warnings: [],
        outcome: OUTCOMES.NO_VERDICT,
        error: `${error?.stack ?? error}`.slice(0, 4000),
      };
    }
    record.runs.push(run);
    flush();

    process.stdout.write(
      run.valid
        ? `${run.outcome} (${(run.durationMs / 60000).toFixed(1)}m, chain ${run.verifierChainDepth})\n`
        : `INVALID: ${run.healthReasons.join(",")} — re-runnable\n`,
    );
    if (!run.valid && attempt <= options.retryInvalid) {
      pending.push({ entry, attempt: attempt + 1 });
    }
  }

  flush();
  process.stdout.write(`\n${renderReport(record)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
