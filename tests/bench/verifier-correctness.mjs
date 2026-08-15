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

import { createFixture, destroyFixture, parsePrimary, runOpencode } from "../integration/fixture.mjs";
import { CLASSES, briefFor, loadCases, materializeCase } from "./lib/cases.mjs";
import {
  BRIEFS_PATH,
  briefCounts,
  briefFor as briefFromStore,
  captureBriefs,
  loadBriefs,
  writeBriefs,
} from "./lib/briefs.mjs";
import { resolvePrimary } from "./lib/routing.mjs";
import { DEFAULT_VARIANTS, VARIANTS, applyVariant, resolveVariant } from "./lib/variants.mjs";
import { classifyRunHealth, isStandingFailure, readRunTelemetry } from "./lib/telemetry.mjs";
import { OUTCOMES, scoreVerdict, summarizeCell, verdictSource } from "./lib/scoring.mjs";

const BENCH_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = join(BENCH_DIR, "results");
const SCHEMA = "pilotfish.bench.verifier-correctness/1";

// Three, not one: a single quota or permission error can be transient, and the
// retry path exists for exactly that. Three consecutive is a wall.
const STANDING_FAILURE_LIMIT = 3;

// Single measured runs, not distributions. Stated rather than omitted because
// the issue requires documented cost and runtime before a user starts a suite;
// replace each from the first completed suite on that routing.
//
// Runtime is a property of the routing, not of the harness: the same class of
// case took 9.5 minutes on gpt-5.6 and 0.5 minutes on Gemini 3.1 Pro, a 19x
// spread. Keying the estimate by profile is the only way `plan` can quote a
// figure that means anything, and an unmeasured routing must say so rather than
// borrow another one's number.
const ESTIMATE_FALLBACK = {
  source: "one measured run (2026-08-10, class D, chatgpt); the range around it is an assumption",
  minutesPerRun: 10,
  minutesPerRunRange: [5, 20],
  measuredOn: "chatgpt / openai/gpt-5.6-sol",
};

const ESTIMATES = {
  // 9.5 min, 18.3k input / 1.2k output tokens in the verifier alone.
  "openai/gpt-5.6-sol": ESTIMATE_FALLBACK,
  // 31s wall clock, 21.6k input / 283 output / 798 reasoning tokens in the
  // verifier. Class B, `current`, CONFIRMED-with-observation, chain depth 1.
  // The upper bound stays well above it because a REFUTED verdict starts a
  // re-verification round and this run never did.
  "google/antigravity-gemini-3.1-pro": {
    source:
      "one measured run (2026-08-14, class B, antigravity gemini-3.1-pro); the range around it is an assumption",
    minutesPerRun: 0.5,
    minutesPerRunRange: [0.4, 3],
    measuredOn: "antigravity / google/antigravity-gemini-3.1-pro",
  },
  // 15.6s, $0.017013, 24.0k input / 443 output. One verifier session with no
  // primary around it -- which is the whole reason replay exists: the same
  // measurement at a price that makes n=20 per cell unremarkable.
  "replay:openrouter/qwen/qwen3.6-27b": {
    source: "one measured run (2026-08-15, class B, replay on qwen3.6-27b); the range around it is an assumption",
    minutesPerRun: 0.3,
    minutesPerRunRange: [0.2, 1],
    usdPerRun: 0.017,
    measuredOn: "replay / openrouter/qwen/qwen3.6-27b",
  },
};

function estimateFor(options) {
  const key = options.replay
    ? `replay:${options.replayModel.model}`
    : (options.resolvedPrimary?.profile ?? (options.preset === "chatgpt" ? "openai/gpt-5.6-sol" : null));
  const measured = key ? ESTIMATES[key] : null;
  return { ...(measured ?? ESTIMATE_FALLBACK), measured: !!measured };
}

function parseArgs(argv) {
  const options = {
    repeats: 5,
    variants: DEFAULT_VARIANTS,
    cases: null,
    classes: null,
    preset: "chatgpt",
    primary: null,
    replay: false,
    model: null,
    briefsPath: BRIEFS_PATH,
    resume: null,
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
      case "--primary": options.primary = next(); break;
      case "--replay": options.replay = true; break;
      case "--model": options.model = next(); break;
      case "--briefs": options.briefsPath = next(); break;
      case "--resume": options.resume = next(); break;
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
  options.resolvedPrimary = resolvePrimary(options.primary, options.preset);
  if (options.replay) {
    if (!options.model) {
      throw new Error("--replay needs --model <provider/model[@variant]>: replay binds the verifier directly");
    }
    if (options.primary) {
      throw new Error("--replay and --primary are exclusive: replay runs no primary at all");
    }
    options.replayModel = parsePrimary(options.model);
    options.replayBriefs = loadBriefs(options.briefsPath);
  } else if (options.model) {
    throw new Error("--model applies to --replay only; use --primary to pick an in-situ profile");
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

// A cell is identified by what it measures, not by when it ran.
export function cellKey(entry) {
  return `${entry.caseId}::${entry.variant}::${entry.repeat}`;
}

// Resume must not silently pool runs that measure different things. Anything
// that changes what a run *is* has to match; anything that only changes how
// many are left does not.
const RESUME_INVARIANTS = ["replay", "model", "preset", "primary", "repeats"];

export function assertResumable(prior, options) {
  const before = prior.options ?? {};
  for (const key of RESUME_INVARIANTS) {
    const was = before[key] ?? null;
    const now = options[key] ?? null;
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      throw new Error(
        `cannot resume: --${key} was ${JSON.stringify(was)}, now ${JSON.stringify(now)}. ` +
          "Resuming would pool runs that measure different things.",
      );
    }
  }
  for (const key of ["variants", "cases", "classes"]) {
    const was = JSON.stringify(before[key] ?? null);
    const now = JSON.stringify(options[key] ?? null);
    if (was !== now) {
      throw new Error(`cannot resume: --${key} was ${was}, now ${now}.`);
    }
  }
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
  const replay = options.replayBriefs
    ? briefFromStore(options.replayBriefs, caseDef.id, entry.repeat)
    : null;
  const fixture = createFixture({
    preset: options.preset,
    primary: replay ? null : options.resolvedPrimary,
    // Replay runs the verifier alone against a recorded brief: one session
    // instead of an orchestration, which is the whole cost saving.
    soloAgent: replay ? "verifier" : null,
    soloModel: replay ? options.replayModel : null,
    auth: true,
    inheritGlobal: true,
  });
  try {
    const digests = applyVariant(fixture, resolvedVariant);
    const { head } = materializeCase(caseDef, fixture.project);
    const brief = replay ? replay.brief : briefFor(caseDef);

    const started = Date.now();
    const result = await runOpencode(
      fixture,
      ["run", brief, "--agent", replay ? "verifier" : "pilotfish"],
      {
        timeoutMs: options.timeoutMinutes * 60_000,
        stdoutFile: join(fixture.root, "run-stdout.txt"),
      },
    );
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
      mode: replay ? "replay" : "in-situ",
      replayedBrief: replay ? { source: replay.source, variant: replay.variant } : null,
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
  if (options.replay) {
    lines.push("");
    lines.push(
      `**Replay mode**, verifier \`${options.replayModel.model}\`` +
        `${options.replayModel.variant ? ` (${options.replayModel.variant})` : ""}. Each run is that ` +
        "model answering a brief a real primary wrote, with no primary in the loop. It measures the " +
        "prompt and the model in the verifier seat; it does not measure dispatch, and a difference " +
        "here is not automatically a difference in situ.",
    );
  }
  if (options.resolvedPrimary) {
    lines.push("");
    lines.push(
      `Profile \`${options.resolvedPrimary.profile}\`: primary ` +
        `\`${options.resolvedPrimary.model}\`, verifier ` +
        `\`${options.resolvedPrimary.verifier.model}\`. **Every rate below is scoped to that ` +
        "verifier model.** The prompt change under test is shared, but a verdict is the model's.",
    );
  }
  if (record.stoppedEarly) {
    lines.push("");
    lines.push(
      `**Suite stopped early after ${record.stoppedEarly.after} runs**, with ` +
        `${record.stoppedEarly.remaining} still queued: ` +
        `${record.stoppedEarly.reasons.join(", ")}. The runs that did complete are a truncated ` +
        "prefix of a randomized queue, so cells are unbalanced and every rate below rests on a " +
        "smaller n than the plan bought. Replay the same order with `--seed` once the account can run.",
    );
  }
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

function routingText(options) {
  const primary = options.resolvedPrimary;
  if (options.replay) {
    const model = options.replayModel;
    return [
      "  mode      replay (no primary; one verifier session per run)",
      `  verifier  ${model.model}${model.variant ? ` (${model.variant})` : ""}   <- the seat under test`,
      `  briefs    ${JSON.stringify(briefCounts(options.replayBriefs))}`,
      "",
      "  Each run replays a brief a real primary wrote, so this measures the",
      "  verifier's response to a fixed instruction -- not the primary's choice of",
      "  brief, and not the dispatch. Two variants at the same repeat index get the",
      "  identical brief, which is what makes the comparison paired.",
    ];
  }
  if (!primary) {
    return [
      `  preset    ${options.preset} (default primary)`,
      "",
      "  The verifier seat follows the preset's default profile. Pass --primary to",
      "  measure a different one; a result is only about the model that held that seat.",
    ];
  }
  const verifier = primary.verifier;
  return [
    `  preset    ${options.preset}`,
    `  profile   ${primary.profile}`,
    `  primary   ${primary.model}${primary.variant ? ` (${primary.variant})` : ""}`,
    `  verifier  ${verifier.model}${verifier.variant ? ` (${verifier.variant})` : ""}   <- the seat under test`,
    "",
    "  A result is about the model in the verifier seat, not about the prompt in",
    "  the abstract. Report it as scoped to this profile.",
  ];
}

function planText(cases, variants, options) {
  const cells = cases.length * variants.length;
  const runs = cells * options.repeats;
  const estimate = estimateFor(options);
  const [low, high] = estimate.minutesPerRunRange;
  const lines = [
    "Suite plan",
    "",
    `  cases     ${cases.length}  (${cases.map((c) => `${c.id} [${c.defectClass}]`).join(", ")})`,
    `  variants  ${variants.length}  (${variants.join(", ")})`,
    `  repeats   ${options.repeats} per cell`,
    `  cells     ${cells}`,
    `  runs      ${runs}  ${options.replay ? "single verifier sessions" : "full orchestrated pilotfish runs"}`,
    "",
    "Routing",
    "",
    ...routingText(options),
    "",
    "Cost and runtime",
    "",
    ...(options.replay
      ? [
          "  Each run is one verifier session against a recorded brief. No primary, no",
          "  planning, no dispatch -- roughly half the sessions and a small fraction of",
          `  the tokens of an in-situ run, billed to ${options.replayModel.model.split("/")[0]}.`,
        ]
      : [
          `  Each run is one complete pilotfish session -- planning, at least one verifier`,
          `  dispatch, and whatever else the primary decides it needs -- against the live`,
          `  ${options.preset} subscription. It consumes the same quota it is measuring.`,
        ]),
    "",
    `  Estimate: ~${estimate.minutesPerRun} min/run, so ~${((runs * estimate.minutesPerRun) / 60).toFixed(1)}h`,
    `  (range ${((runs * low) / 60).toFixed(1)}–${((runs * high) / 60).toFixed(1)}h at ${low}–${high} min/run).`,
    ...(estimate.usdPerRun
      ? [`  Metered API cost: ~$${(runs * estimate.usdPerRun).toFixed(2)} for the suite, at $${estimate.usdPerRun}/run.`]
      : []),
    `  Source: ${estimate.source}. Replace these figures from a completed suite.`,
    ...(estimate.measured
      ? []
      : [
          `  No run has been measured on this routing; the figure above is a`,
          `  ${estimate.measuredOn} measurement and is not evidence about it. Runtime`,
          "  varies about 19x across the profiles measured so far.",
        ]),
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

  if (command === "capture-briefs") {
    // Replay inputs come from runs that actually happened. Writing a brief by
    // hand would make the measurement a test of my prose rather than of the
    // primary's.
    if (positional.length === 0) throw new Error("capture-briefs needs one or more result files");
    const store = captureBriefs(positional);
    const path = writeBriefs(store, options.briefsPath);
    const counts = briefCounts(store);
    for (const [id, count] of Object.entries(counts)) {
      process.stdout.write(`ok  ${id}: ${count} distinct brief(s)\n`);
    }
    const missing = cases.filter((item) => !counts[item.id]);
    for (const item of missing) {
      process.stdout.write(`--  ${item.id}: none captured; replay cannot cover this case yet\n`);
    }
    process.stdout.write(`\nWrote ${path}\n`);
    return;
  }

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

  // A suite is long enough that a laptop lid, a dropped network, or a provider
  // wall will end one partway. Resuming reads back what already completed and
  // runs only the remainder, which matters most for the runs that cost money:
  // re-running a finished cell buys nothing but spend.
  const prior = options.resume ? JSON.parse(readFileSync(options.resume, "utf8")) : null;
  if (prior) assertResumable(prior, options);

  const seed = prior?.seed ?? options.seed ?? (Date.now() & 0x7fffffff);
  const resolvedVariants = Object.fromEntries(
    options.variants.map((name) => [name, resolveVariant(name)]),
  );
  const byId = new Map(cases.map((item) => [item.id, item]));
  const fullQueue = buildQueue(cases, options.variants, options.repeats, seed);

  // Only successful runs are treated as done. An invalid one is re-queued the
  // same way a fresh suite would re-queue it -- it produced no measurement.
  const done = new Set(
    (prior?.runs ?? []).filter((run) => run.valid).map((run) => cellKey(run)),
  );
  const queue = fullQueue.filter((entry) => !done.has(cellKey(entry)));
  // Count against the queue, not against the prior file: a resumed run whose
  // cell is not in this queue is carried in the record but is not progress
  // toward it, and reporting it as such would overstate how much is done.
  const alreadyDone = fullQueue.length - queue.length;

  mkdirSync(RESULTS_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const outPath =
    options.out ?? prior?.options?.out ??
    join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}-verifier-correctness.json`);

  const record = {
    schema: SCHEMA,
    startedAt: prior?.startedAt ?? startedAt,
    seed,
    options: { ...options, out: outPath },
    variants: Object.fromEntries(
      Object.entries(resolvedVariants).map(([name, variant]) => [
        name,
        { description: variant.description, prompts: variant.prompts, confounded: !!variant.confounded },
      ]),
    ),
    environment: environmentRecord(),
    runs: [...(prior?.runs ?? [])],
    summary: null,
  };
  if (prior) {
    // Environments can differ between the two halves -- a different machine, a
    // changed AGENTS.md. Recorded rather than rejected, because the alternative
    // is discarding runs that already cost real money.
    record.resumedFrom = {
      path: options.resume,
      priorRuns: prior.runs?.length ?? 0,
      priorValid: alreadyDone,
      priorEnvironment: prior.environment ?? null,
      resumedAt: startedAt,
    };
  }
  const flush = () => {
    record.summary = summarize(record.runs, cases);
    writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  };
  flush();

  process.stdout.write(`${planText(cases, options.variants, options)}\n\n`);
  if (prior) {
    process.stdout.write(
      `Resuming ${options.resume}: ${alreadyDone} of ${fullQueue.length} cells already measured, ` +
        `${queue.length} to run. Seed ${seed} carried over, so the remaining order is the ` +
        "one the original suite would have used.\n",
    );
  }
  process.stdout.write(`Writing to ${outPath}\n\n`);
  if (queue.length === 0) {
    flush();
    process.stdout.write(`Nothing left to run.\n\n${renderReport(record)}\n`);
    return;
  }

  const pending = queue.map((entry) => ({ entry, attempt: 1 }));
  let completed = 0;
  let standingFailures = 0;
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

    // A quota wall or an entitlement refusal is a property of the account, not
    // of the run, so the queue behind it cannot succeed either. Retrying into
    // one produces nothing but a longer transcript of the same error.
    standingFailures = run.valid || !isStandingFailure(run.healthReasons) ? 0 : standingFailures + 1;
    if (standingFailures >= STANDING_FAILURE_LIMIT) {
      record.stoppedEarly = {
        after: completed,
        remaining: pending.length,
        reasons: run.healthReasons,
        detail: (run.stderrTail ?? "").slice(-600),
      };
      process.stdout.write(
        `\nStopped after ${STANDING_FAILURE_LIMIT} consecutive ${run.healthReasons.join(",")} ` +
          `failures: the account cannot run right now, so the ${pending.length} queued runs would ` +
          "fail the same way. Resume with --seed to replay this order once it can.\n",
      );
      break;
    }

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
