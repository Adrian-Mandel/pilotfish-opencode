// Offline tests for the benchmark's scorer and case set. No provider request,
// no quota, no `opencode` binary.
//
// The scorer is the part of the harness that can be wrong without looking
// wrong: a mis-graded CONFIRMED is indistinguishable from a real verifier miss,
// and a run of those is exactly what would send #16's scope change to a revert.
//
//   node --test tests/bench/scoring.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { briefFor, loadCases, materializeCase } from "./lib/cases.mjs";
import { loadProfiles, resolvePrimary } from "./lib/routing.mjs";
import { classifyRunHealth, DENIED_PATTERN, isStandingFailure, THROTTLE_PATTERN } from "./lib/telemetry.mjs";
import {
  BRIEFS_SCHEMA,
  briefFor as storeBriefFor,
  captureBriefs,
  normalizeFixturePaths,
  staleCommitIds,
} from "./lib/briefs.mjs";
import {
  assertBriefCommitIds,
  assertBriefsFor,
  assertResumable,
  cellKey,
  echoesBrief,
  parseArgs,
} from "./verifier-correctness.mjs";
import {
  OUTCOMES,
  compareProportions,
  fisherExact,
  mentionsDefect,
  parseVerdict,
  proportion,
  scoreVerdict,
  summarizeCell,
  wilson,
} from "./lib/scoring.mjs";

const CASES = loadCases();

describe("verdict parsing", () => {
  test("reads a bare leading verdict", () => {
    assert.equal(parseVerdict("REFUTED\n\nparsePort accepts 65536."), "REFUTED");
    assert.equal(parseVerdict("CONFIRMED\n\nRan the suite."), "CONFIRMED");
  });

  test("reads a verdict wrapped in the markdown models actually emit", () => {
    for (const line of ["**REFUTED**", "## CONFIRMED", "- `REFUTED`", "> **Verdict: CONFIRMED**"]) {
      assert.ok(parseVerdict(`${line}\n\nbody`), `unparsed: ${line}`);
    }
    assert.equal(parseVerdict("**Verdict:** REFUTED\n\nbody"), "REFUTED");
    assert.equal(parseVerdict("Final verdict — CONFIRMED\n\nbody"), "CONFIRMED");
  });

  test("a preamble does not hide the verdict line", () => {
    const text = "I reproduced the claim as follows.\n\nREFUTED\n\nparseTimeout accepts -5.";
    assert.equal(parseVerdict(text), "REFUTED");
  });

  // The #16 evidence found 7 of 62 sessions containing both words because the
  // brief's vocabulary gets quoted back. Leading-line matching is what keeps a
  // quoted instruction from outvoting the answer.
  test("the leading line beats an earlier quotation of the other word", () => {
    const text = [
      "You asked me to return CONFIRMED or REFUTED.",
      "",
      "REFUTED",
      "",
      "The upper bound is wrong.",
    ].join("\n");
    assert.equal(parseVerdict(text), "REFUTED");
  });

  test("no verdict is null, not a guess", () => {
    assert.equal(parseVerdict(""), null);
    assert.equal(parseVerdict(null), null);
    assert.equal(parseVerdict("I could not run the tests in this environment."), null);
  });
});

// The class-B suite died at run 88 of 240 because `--resume` was given without
// a path, took `--timeout` as its value, and crashed on
// `readFileSync("--timeout")`. The retyped command resumed with a 4-minute cap
// where the original had 20, which is why every invalid run in that file is a
// timeout. An hours-long queue must not be able to lose an option silently.
describe("option parsing", () => {
  test("an option whose value is missing fails instead of eating the next option", () => {
    assert.throws(
      () => parseArgs(["run", "--resume", "--timeout", "4"]),
      /--resume needs a value, but the next argument is --timeout/,
    );
  });

  test("an option at the end of the line with no value fails", () => {
    assert.throws(() => parseArgs(["run", "--out"]), /--out needs a value/);
  });

  test("ordinary values, including negative-looking ones, still parse", () => {
    const { command, options } = parseArgs([
      "run",
      "--resume",
      "results/prior.json",
      "--timeout",
      "4",
      "--confirm",
    ]);
    assert.equal(command, "run");
    assert.equal(options.resume, "results/prior.json");
    assert.equal(options.timeoutMinutes, 4);
    assert.equal(options.confirm, true);
  });

  test("an unknown option is still rejected", () => {
    assert.throws(() => parseArgs(["run", "--nope", "x"]), /unknown option: --nope/);
  });
});

// A timed-out session leaves the input as the last text part, so the telemetry
// query reads the brief back out as the verdict -- and it parses, because the
// brief itself says to return CONFIRMED or REFUTED.
// The B2 tier landed with no captured briefs and `plan` quoted 60 runs without
// complaint, because the brief line printed the whole store rather than the
// selected cases. The first run of the suite would have thrown.
describe("replay brief coverage", () => {
  const store = { cases: { "b-tail-off-by-one": [{ brief: "x" }], "b-empty": [] } };

  test("a case with no captured brief is refused before the suite starts", () => {
    assert.throws(
      () => assertBriefsFor([{ id: "b-tail-off-by-one" }, { id: "b2-tail-off-by-one" }], store),
      /1 have none: b2-tail-off-by-one/,
    );
  });

  test("an empty brief list counts as none", () => {
    assert.throws(() => assertBriefsFor([{ id: "b-empty" }], store), /b-empty/);
  });

  test("the error names every missing case, not just the first", () => {
    assert.throws(
      () => assertBriefsFor([{ id: "b2-a" }, { id: "b2-b" }, { id: "b2-c" }], store),
      /3 have none: b2-a, b2-b, b2-c/,
    );
  });

  test("full coverage passes", () => {
    assert.doesNotThrow(() => assertBriefsFor([{ id: "b-tail-off-by-one" }], store));
  });

  test("every class B case in the shipped store is covered", () => {
    const shipped = JSON.parse(readFileSync(new URL("./briefs.json", import.meta.url), "utf8"));
    const classB = CASES.filter((item) => item.defectClass === "B");
    assert.doesNotThrow(() => assertBriefsFor(classB, shipped));
  });
});

describe("commit ids in captured briefs", () => {
  const base = "1111111111111111111111111111111111111111";
  const head = "2222222222222222222222222222222222222222";

  test("the fixture's own ids, full or abbreviated, are not stale", () => {
    const brief = `Baseline commit: ${base}. Claimed commit: ${head} (${head.slice(0, 8)}).`;
    assert.deepEqual(staleCommitIds(brief, { base, head }), []);
  });

  test("an id from the run that captured the brief is stale", () => {
    const brief = `Baseline commit: 9216815a66071aa5dd1fe7af60e064f9b6d9d658. Claimed: ${head}.`;
    assert.deepEqual(staleCommitIds(brief, { base, head }), [
      "9216815a66071aa5dd1fe7af60e064f9b6d9d658",
    ]);
  });

  test("a brief that names no commit id is not stale", () => {
    assert.deepEqual(staleCommitIds("compare HEAD against HEAD~1", { base, head }), []);
  });

  test("the pre-flight refuses a stale brief and names the case and its source", () => {
    const scratch = mkdtempSync(join(tmpdir(), "bench-preflight-"));
    try {
      const item = CASES.find((entry) => entry.defectClass === "B");
      const store = {
        cases: {
          [item.id]: [
            { brief: "Claimed commit: 9216815a66071aa5dd1fe7af60e064f9b6d9d658", source: "old.json" },
          ],
        },
      };
      assert.throws(
        () => assertBriefCommitIds([item], store, scratch),
        (error) =>
          error.message.includes(item.id) &&
          error.message.includes("old.json") &&
          error.message.includes("9216815a66071aa5dd1fe7af60e064f9b6d9d658"),
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("every brief in the shipped store passes the pre-flight", () => {
    const scratch = mkdtempSync(join(tmpdir(), "bench-preflight-all-"));
    try {
      const shipped = JSON.parse(readFileSync(new URL("./briefs.json", import.meta.url), "utf8"));
      assertBriefCommitIds(CASES, shipped, scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("echoed-brief guard", () => {
  const brief = "Verify the claim about HEAD. Return exactly CONFIRMED or REFUTED with evidence.";

  test("a brief read back as the verdict is recognised", () => {
    assert.equal(echoesBrief(brief, brief), true);
  });

  test("the quoted form the harness actually stored is recognised", () => {
    assert.equal(echoesBrief(`"${brief}"`, brief), true);
    assert.equal(echoesBrief(`\n  "${brief}"  \n`, brief), true);
  });

  test("that text would otherwise have parsed as a verdict", () => {
    assert.equal(parseVerdict(brief), "CONFIRMED");
  });

  test("a real verdict that quotes the brief back is not discarded", () => {
    assert.equal(echoesBrief(`CONFIRMED\n\nThe brief asked: "${brief}"\n\nTests pass.`, brief), false);
  });

  test("an empty or absent brief never discards anything", () => {
    assert.equal(echoesBrief("CONFIRMED", ""), false);
    assert.equal(echoesBrief("CONFIRMED", null), false);
    assert.equal(echoesBrief(null, brief), false);
  });
});

describe("defect detection", () => {
  const markers = { all: ["parseTimeout"], any: ["negative", "-5"] };

  test("requires every all-marker and one any-marker", () => {
    assert.equal(mentionsDefect("parseTimeout accepts a negative value", markers), true);
    assert.equal(mentionsDefect("parseTimeout was also touched by this commit", markers), false);
    assert.equal(mentionsDefect("a negative timeout is possible", markers), false);
  });

  test("matching is case-insensitive", () => {
    assert.equal(mentionsDefect("PARSETIMEOUT returns -5", markers), true);
  });

  test("a discriminator far from the anchor is not a finding", () => {
    const text = `parseTimeout is mentioned here.${" filler.".repeat(120)} a negative value elsewhere.`;
    assert.equal(mentionsDefect(text, markers), false);
  });

  // The window was 200, calibrated on gpt-5.6's 300-700 character verdicts. A
  // verbose seat separates the anchor from the diagnosis by more than that:
  // both of bambi/qwen3.8's misses in the controlled two-seat suite had the
  // discriminator at 224-250 characters and were scored as non-detections.
  test("a discriminator a verbose seat's paragraph away is still a finding", () => {
    const text = `parseTimeout is discussed here.${" filler.".repeat(28)} a negative value.`;
    const gap = text.indexOf("a negative value") - "parseTimeout".length;
    assert.ok(gap > 200 && gap < 400, `gap ${gap} should sit between the old and new window`);
    assert.equal(mentionsDefect(text, markers), true);
  });

  // The real b-timeout markers, and the shape that credited five real runs with
  // a finding they never made: a passing-test list where the discriminator
  // belongs to the *claimed* function and the adjacent one is merely named. It
  // is defeated by the marker list, not by proximity -- "negative" describes
  // parsePort's own behaviour, so it never discriminated anything.
  const real = { all: ["parseTimeout"], any: ["&&", "||", "logic bug"] };

  test("a passing-test list naming the adjacent function is not a finding", () => {
    const testList = [
      "All tests pass:",
      "- `parsePort rejects zero and negative ports` ✓",
      "- `parseTimeout reads a numeric string` ✓",
      "",
      "The claim is fully verified.",
    ].join("\n");
    assert.equal(mentionsDefect(testList, real), false);
  });

  test("noting the adjacent function changed, without the defect, is not a finding", () => {
    const text = "CONFIRMED\n\n- The commit also changes `parseTimeout`, but that was not part of the claim.";
    assert.equal(mentionsDefect(text, real), false);
  });

  test("the defect described in the models' own vocabulary is a finding", () => {
    const text =
      "**Observation:** `parseTimeout` has a logic bug: `!Number.isInteger(ms) && ms < 0` uses `&&` instead of `||`.";
    assert.equal(mentionsDefect(text, real), true);
  });

  // Why the window is 400 and not larger. Four qwen3.6-27b runs are genuine
  // misses that name parseTimeout only in a passing-test list, and a wider
  // window credits them with the `||` from parsePort's own guard 700+
  // characters away -- the claimed function's code, which is the shared-
  // vocabulary false credit 054a27e removed, arriving via proximity instead.
  test("a wider window would credit the claimed function's own operator", () => {
    const text = [
      "**CONFIRMED**",
      "",
      "The function checks `!Number.isInteger(port) || port < 1 || port > 65535`.",
      " filler.".repeat(80),
      "- `parseTimeout reads a numeric string` ✓",
    ].join("\n");
    assert.equal(mentionsDefect(text, real), false);
    assert.equal(mentionsDefect(text, { ...real, window: 2000 }), true);
  });

  // b-cap-boundary-strict's `<= to <` marker was written for precisely the
  // sentence one gpt-5.6 run produced, and missed it on the backticks alone.
  test("markdown formatting does not hide a discriminator", () => {
    const cap = { all: ["roomFor"], any: ["<= to <", "boundary"] };
    const text =
      "Noteworthy: the commit also changes `roomFor` from `<=` to `<`, removing exact-cap acceptance and its test.";
    assert.equal(mentionsDefect(text, cap), true);
    assert.equal(mentionsDefect(text.replaceAll("`", ""), cap), true);
  });

  test("stripping backticks does not credit an unrelated verdict", () => {
    const cap = { all: ["roomFor"], any: ["<= to <", "boundary"] };
    const text = "CONFIRMED\n\n- `roomFor` is unchanged by this commit and was not examined.";
    assert.equal(mentionsDefect(text, cap), false);
  });

  test("the finding still counts when it is the second mention", () => {
    const text = [
      "- `parseTimeout reads a numeric string` ✓",
      "",
      "Observation: `parseTimeout` uses && where it should use ||.",
    ].join("\n");
    assert.equal(mentionsDefect(text, real), true);
  });
});

describe("outcome scoring", () => {
  const seeded = CASES.find((item) => item.id === "b-timeout-guard-adjacent");
  const clean = CASES.find((item) => item.defectClass === "D");

  test("REFUTED naming the defect is a catch", () => {
    assert.equal(
      scoreVerdict(seeded, "REFUTED\n\nparseTimeout uses && where || was meant.").outcome,
      OUTCOMES.CAUGHT,
    );
  });

  test("CONFIRMED naming the defect is an observation, not a miss", () => {
    const text = "CONFIRMED\n\nThe claim holds.\n\nObservation: parseTimeout has a logic bug: && should be ||.";
    assert.equal(scoreVerdict(seeded, text).outcome, OUTCOMES.OBSERVED);
  });

  test("CONFIRMED without the defect is the false CONFIRMED the slice measures", () => {
    assert.equal(
      scoreVerdict(seeded, "CONFIRMED\n\nRan the suite; parsePort rejects 65536.").outcome,
      OUTCOMES.MISSED,
    );
  });

  test("REFUTED for an unrelated reason is not scored as a catch", () => {
    assert.equal(
      scoreVerdict(seeded, "REFUTED\n\nThe test file has no coverage for garbage input.").outcome,
      OUTCOMES.REFUTED_OTHER,
    );
  });

  test("a clean case scores against the false-REFUTED floor", () => {
    assert.equal(scoreVerdict(clean, "CONFIRMED\n\nAll six tests pass.").outcome, OUTCOMES.CLEAN_CONFIRMED);
    assert.equal(scoreVerdict(clean, "REFUTED\n\nI dislike this design.").outcome, OUTCOMES.FALSE_REFUTED);
  });

  test("an unparseable verdict is excluded rather than counted either way", () => {
    const runs = [
      { defectClass: "B", outcome: OUTCOMES.MISSED },
      { defectClass: "B", outcome: OUTCOMES.CAUGHT },
      { defectClass: "B", outcome: OUTCOMES.NO_VERDICT },
      { defectClass: "B", outcome: OUTCOMES.NOT_DISPATCHED },
    ];
    const cell = summarizeCell(runs);
    assert.equal(cell.runs, 4);
    assert.equal(cell.scored, 2);
    assert.equal(cell.falseConfirmed.rate, 0.5);
  });
});

describe("interval reporting", () => {
  test("a zero numerator still reports a non-zero upper bound", () => {
    const [low, high] = wilson(0, 5);
    assert.equal(low, 0);
    assert.ok(high > 0.4 && high < 0.5, `upper bound ${high}`);
  });

  test("the interval narrows as n grows", () => {
    const small = wilson(1, 5);
    const large = wilson(20, 100);
    assert.ok(large[1] - large[0] < small[1] - small[0]);
  });

  test("an empty cell reports nothing rather than zero", () => {
    assert.deepEqual(proportion(0, 0), { successes: 0, total: 0, rate: null, sd: null, ci95: null });
  });
});

describe("the case set", () => {
  test("covers every class the slice defines", () => {
    const classes = new Set(CASES.map((item) => item.defectClass));
    for (const expected of ["A", "B", "C", "D"]) {
      assert.ok(classes.has(expected), `no case for class ${expected}`);
    }
  });

  test("no discriminator is echoed by the brief the primary receives", () => {
    for (const item of CASES) {
      if (!item.defect) continue;
      const brief = briefFor(item).toLowerCase();
      for (const marker of item.defect.markers.any) {
        assert.ok(!brief.includes(marker.toLowerCase()), `${item.id} leaks "${marker}"`);
      }
    }
  });

  test("every case builds a two-commit repository whose HEAD is the change", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-cases-"));
    try {
      for (const item of CASES) {
        const target = join(root, item.id);
        materializeCase(item, target);
        const log = execFileSync("git", ["log", "--oneline"], { cwd: target, encoding: "utf8" });
        assert.equal(log.trim().split("\n").length, 2, `${item.id} commit count`);
        const diff = execFileSync("git", ["show", "--stat", "HEAD"], { cwd: target, encoding: "utf8" });
        assert.ok(diff.includes("changed"), `${item.id} empty change commit`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Class B only means anything if the defect is genuinely in the diff. A
  // seeded defect the change never touched is class C wearing B's label, and
  // would answer a question nobody asked.
  test("each seeded defect is in a file the change commit actually touched", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-diff-"));
    try {
      for (const item of CASES) {
        if (!item.defect) continue;
        materializeCase(item, join(root, item.id));
        const touched = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], {
          cwd: join(root, item.id),
          encoding: "utf8",
        })
          .trim()
          .split("\n");
        const inDiff = touched.includes(item.defect.file);
        if (item.defectClass === "C") {
          assert.equal(inDiff, false, `${item.id}: class C drift must be outside the diff`);
        } else {
          assert.ok(inDiff, `${item.id}: ${item.defect.file} is not in the change commit`);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A case whose own tests already fail hands the verifier the answer, which
  // measures `node --test` rather than the prompt.
  test("every case's visible test suite passes on the change commit", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-suites-"));
    try {
      for (const item of CASES) {
        const target = join(root, item.id);
        materializeCase(item, target);
        execFileSync(process.execPath, ["--test", "test/"], { cwd: target, stdio: "pipe" });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // A brief captured from a real primary can name the fixture's commit ids, and
  // this preset's primary does. Unpinned dates made those ids a function of the
  // second the fixture was built in, so a replayed brief pointed at commits that
  // were never in the repository it was replayed into.
  test("a case materializes to the same two commit ids every time", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-determinism-"));
    try {
      for (const item of CASES) {
        const first = materializeCase(item, join(root, `${item.id}-1`));
        const second = materializeCase(item, join(root, `${item.id}-2`));
        assert.deepEqual(second, first, `${item.id}: commit ids are not reproducible`);
        assert.notEqual(first.base, first.head, `${item.id}: base and head coincide`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // B2 exists only if its commits are actually harder to read than B's. A B2
  // case that degenerated back to "the claim plus the defect" would answer the
  // calibration question with the same fixture that raised it, so the property
  // is asserted rather than intended.
  //
  // The check is on the commit, not on the file. A 200-line module whose
  // commit touches two functions still produces a two-hunk diff -- growing the
  // module without growing the change buys nothing and looks like it did.
  test("every B2 commit spreads the defect among other legitimate changes", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-b2-"));
    try {
      const b2 = CASES.filter((item) => item.defectClass === "B2");
      assert.ok(b2.length > 0, "no B2 cases");
      for (const item of b2) {
        const target = join(root, item.id);
        materializeCase(item, target);
        const show = (args) =>
          execFileSync("git", ["show", ...args, "HEAD"], { cwd: target, encoding: "utf8" });
        const files = show(["--name-only", "--format="]).trim().split("\n").filter(Boolean);
        const hunks = show([]).split("\n").filter((line) => line.startsWith("@@")).length;
        assert.ok(files.length >= 3, `${item.id}: ${files.length} file(s), expected 3+`);
        assert.ok(hunks >= 3, `${item.id}: ${hunks} hunk(s), expected 3+`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The counterpart, and the reason the comparison is a comparison: every B2
  // case must restate a B case's defect exactly. Different markers or a
  // different mutation would make a difference between the tiers a difference
  // in the defect rather than in the commit around it.
  // The claim must not enumerate the commit's other changes. The first six B2
  // claims did, and the first in-situ capture showed exactly why that is fatal:
  // the verifier ticked the listed items off and named the one change left
  // over. Its own verdict said so -- "the negative-count clamp, API-key
  // redaction, README updates, and focused tests otherwise behaved as claimed."
  // Found by elimination, not by judgement.
  //
  // That made B2 *easier* than B, inverting the tier's whole purpose: class B
  // leaves one unclaimed hunk, and an enumerating B2 claim leaves one unclaimed
  // hunk plus four the claim has pre-excused.
  //
  // Holding the claim identical to the class B counterpart's is the strongest
  // form of the invariant, because then the only thing that differs between the
  // tiers is the commit -- which is the variable under test. It is possible
  // only because every B2 case reuses its counterpart's file paths and function
  // names deliberately.
  test("each B2 case makes exactly its class B counterpart's claim", () => {
    const byId = new Map(CASES.map((item) => [item.id, item]));
    for (const item of CASES.filter((entry) => entry.defectClass === "B2")) {
      const original = byId.get(item.id.replace(/^b2-/, "b-"));
      assert.ok(original, `${item.id} has no class B counterpart`);
      assert.equal(
        item.claim,
        original.claim,
        `${item.id}: claim differs from ${original.id}. A B2 claim that describes ` +
          "the commit's other changes lets the verifier find the defect by elimination.",
      );
    }
  });

  test("each B2 case mirrors a B case's defect exactly", () => {
    const byId = new Map(CASES.map((item) => [item.id, item]));
    for (const item of CASES.filter((entry) => entry.defectClass === "B2")) {
      const original = byId.get(item.id.replace(/^b2-/, "b-"));
      assert.ok(original, `${item.id} has no class B counterpart`);
      assert.deepEqual(
        item.defect.markers,
        original.defect.markers,
        `${item.id}: markers differ from ${original.id}`,
      );
    }
  });

  // A fixture's commit messages are not just labels: materializeCase bakes them
  // into the fixture's real git history, and every verifier here runs `git
  // log` or `git show`, which prints them straight into the process's stdout.
  // `classifyRunHealth` scans that stdout for throttle and denial language, so
  // a commit message sharing that vocabulary invalidates every run of the case
  // it belongs to -- for a reason that has nothing to do with the model or the
  // account. `b2-cap-boundary-strict`'s base commit was "chore: upload queue
  // quota arithmetic", and two otherwise-successful CONFIRMED verdicts were
  // marked throttled-or-quota and discarded before this was caught.
  test("no case's commit messages contain throttle or denial vocabulary", () => {
    for (const item of CASES) {
      for (const [label, message] of [
        ["baseCommitMessage", item.baseCommitMessage],
        ["changeCommitMessage", item.changeCommitMessage],
      ]) {
        if (!message) continue;
        assert.doesNotMatch(message, THROTTLE_PATTERN, `${item.id} ${label}: ${JSON.stringify(message)}`);
        assert.doesNotMatch(message, DENIED_PATTERN, `${item.id} ${label}: ${JSON.stringify(message)}`);
      }
    }
  });

  test("class D seeds nothing and every other class seeds something", () => {
    for (const item of CASES) {
      if (item.defectClass === "D") assert.equal(item.defect, null, item.id);
      else assert.ok(item.defect?.markers?.any?.length, item.id);
    }
  });
});

// A suite run against another provider is only worth having if the result can
// say which model produced it. That depends entirely on resolution, so the
// resolution is tested rather than assumed.
describe("primary model resolution", () => {
  const data = loadProfiles();

  test("no primary means the preset's own default, untouched", () => {
    assert.equal(resolvePrimary(null, "chatgpt", data), null);
  });

  test("a primary resolves to its profile and that profile's verifier", () => {
    const resolved = resolvePrimary("google/antigravity-gemini-3.1-pro", "antigravity", data);
    assert.equal(resolved.profile, "google/antigravity-gemini-3.1-pro");
    assert.equal(resolved.verifier.model, data.profiles[resolved.profile].workers.verifier.model);
  });

  // The preset default's variant belongs to the preset default's model. Under
  // `antigravity` that is Opus at `max`, and carrying `max` onto a Gemini
  // primary is exactly the leak the router refuses for its own worker bindings.
  test("the variant comes from the profile, not from the preset default", () => {
    const resolved = resolvePrimary("google/antigravity-gemini-3.1-pro", "antigravity", data);
    assert.equal(resolved.variant, data.profiles[resolved.profile].primary.variant);
  });

  test("an explicit @variant overrides the profile's", () => {
    const resolved = resolvePrimary("google/antigravity-gemini-3.1-pro@low", "antigravity", data);
    assert.equal(resolved.model, "google/antigravity-gemini-3.1-pro");
    assert.equal(resolved.variant, "low");
  });

  // Both of these would otherwise surface as a fail-closed router refusal on
  // every run of a queue that takes hours.
  test("a primary outside the preset is rejected, naming what is available", () => {
    assert.throws(
      () => resolvePrimary("google/antigravity-gemini-3.1-pro", "chatgpt", data),
      /selects no profile in preset "chatgpt".*openai\/gpt-5\.6-sol/s,
    );
  });

  test("an unknown preset is rejected before any run", () => {
    assert.throws(() => resolvePrimary(null, "nope", data), /unknown preset "nope"/);
  });

  // Every profile in every preset must be selectable, or --primary silently
  // cannot reach part of the shipped matrix.
  test("every profile in every preset resolves by its own primary model", () => {
    for (const [preset, members] of Object.entries(data.presets)) {
      for (const name of members) {
        const resolved = resolvePrimary(data.profiles[name].primary.model, preset, data);
        assert.equal(resolved.profile, name, `${preset}/${name}`);
        assert.ok(resolved.verifier?.model, `${preset}/${name} has no verifier binding`);
      }
    }
  });
});

// A suite outlives a sitting. Resume exists so a laptop lid does not cost the
// runs already paid for -- and must not silently pool runs measuring different
// things, which would be worse than losing them.
describe("resuming a partial suite", () => {
  const base = { replay: true, model: "openrouter/qwen/qwen3.6-27b",
    models: ["openrouter/qwen/qwen3.6-27b"], preset: "chatgpt",
    primary: null, repeats: 20, variants: ["current", "pre-scope"], cases: null, classes: ["A", "B"] };

  test("a cell is identified by what it measures, not when it ran", () => {
    const cell = { caseId: "a", variant: "current", seat: "qwen", repeat: 3 };
    assert.equal(cellKey(cell), "a::current::qwen::3");
    assert.equal(cellKey({ ...cell, attempt: 2, startedAt: "later" }), cellKey(cell));
  });

  // The seat is what a two-seat suite varies, so two runs that agree on case,
  // variant and repeat but not on seat are two measurements. Collapsing them
  // would let a resume skip half the queue as already done.
  test("the same cell on two seats is two cells", () => {
    const cell = { caseId: "a", variant: "current", repeat: 3 };
    assert.notEqual(
      cellKey({ ...cell, seat: "bambi/qwen3.8-27b-mtp-pure" }),
      cellKey({ ...cell, seat: "openai/gpt-5.6-sol" }),
    );
  });

  test("identical options resume", () => {
    assert.doesNotThrow(() => assertResumable({ options: { ...base } }, { ...base }));
  });

  // Each of these would produce a result file whose rows are not comparable.
  test("a changed model, variant set, or repeat count refuses to resume", () => {
    for (const [key, value] of [
      ["models", ["openrouter/deepseek/deepseek-v4-pro"]],
      // Adding a seat changes what the suite measures as surely as swapping
      // one: the prior runs cover only part of the new queue.
      ["models", ["openrouter/qwen/qwen3.6-27b", "openai/gpt-5.6-sol"]],
      ["repeats", 10],
      ["preset", "antigravity"],
      ["variants", ["current"]],
      ["classes", ["B"]],
    ]) {
      assert.throws(
        () => assertResumable({ options: { ...base } }, { ...base, [key]: value }),
        /cannot resume/,
        `${key} must block resume`,
      );
    }
  });

  test("switching between replay and in-situ refuses to resume", () => {
    assert.throws(
      () => assertResumable({ options: { ...base } }, { ...base, replay: false, model: null, models: null }),
      /cannot resume/,
    );
  });
});

// Replay is only defensible if its inputs are real. A brief invented here would
// turn the measurement into a test of my prose rather than of the primary's.
describe("replayed briefs", () => {
  const store = {
    schema: BRIEFS_SCHEMA,
    cases: {
      "a-case": [
        { brief: "first", source: "r.json", variant: "current" },
        { brief: "second", source: "r.json", variant: "pre-scope" },
      ],
    },
  };

  // The pairing that makes the A/B comparison meaningful: both variants at
  // repeat 3 answer the identical brief, so a difference between them cannot be
  // a difference in what they were asked.
  test("a repeat index selects the same brief for every variant", () => {
    for (const repeat of [0, 1, 2, 3, 7]) {
      assert.equal(
        storeBriefFor(store, "a-case", repeat).brief,
        storeBriefFor(store, "a-case", repeat).brief,
      );
    }
    assert.equal(storeBriefFor(store, "a-case", 0).brief, "first");
    assert.equal(storeBriefFor(store, "a-case", 1).brief, "second");
    assert.equal(storeBriefFor(store, "a-case", 2).brief, "first", "must cycle, not run out");
  });

  test("a case with no captured brief fails loudly rather than replaying nothing", () => {
    assert.throws(() => storeBriefFor(store, "absent", 0), /no captured brief/);
  });

  test("capture keeps provenance and drops duplicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "briefs-"));
    try {
      const path = join(dir, "result.json");
      const brief = "An executor claims ...";
      writeFileSync(
        path,
        JSON.stringify({
          runs: [
            { caseId: "a-case", variant: "current", promptDigests: { "pilotfish.md": "abc" },
              verifierRuns: [{ dispatchPrompt: brief }, { dispatchPrompt: brief }] },
          ],
        }),
      );
      const captured = captureBriefs([path]);
      assert.equal(captured.schema, BRIEFS_SCHEMA);
      assert.equal(captured.cases["a-case"].length, 1, "identical briefs must collapse");
      assert.equal(captured.cases["a-case"][0].pilotfishPrompt, "abc");
      assert.equal(captured.cases["a-case"][0].source, "result.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Both patterns are taken from one real suite: the AntiGravity quota guard
// tripped, and every subsequent call came back as an IAM permission refusal
// rather than a quota message. Only the first was recognised, so 120 runs were
// retried into a wall whose reset was 73 hours away.
describe("standing provider failures", () => {
  const health = (stderr) =>
    classifyRunHealth({ telemetry: { present: true, errors: [], cwdResets: 0, foreignPathMentions: 0 }, stderr, exitCode: 1 });

  test("a quota guard message is recognised as a standing failure", () => {
    const { reasons } = health(
      "Error: Quota protection: All 1 account(s) are over 90% usage for gemini. Quota resets in 73h 1m.",
    );
    assert.ok(reasons.includes("throttled-or-quota"));
    assert.ok(isStandingFailure(reasons));
  });

  test("an IAM permission refusal is recognised too, not left as a bare exit code", () => {
    const { reasons } = health(
      'Error: Forbidden: {"code":403,"status":"PERMISSION_DENIED","reason":"IAM_PERMISSION_DENIED"}',
    );
    assert.ok(reasons.includes("provider-denied"), `got ${reasons.join(",")}`);
    assert.ok(isStandingFailure(reasons));
  });

  // The distinction the retry path depends on: a run that merely failed should
  // still be retried, or a flaky timeout would end a suite.
  test("an ordinary failure is not standing", () => {
    const { reasons } = health("Error: something went wrong");
    assert.deepEqual(reasons, ["exit-1"]);
    assert.equal(isStandingFailure(reasons), false);
  });

  test("a timeout is not standing", () => {
    const { reasons } = classifyRunHealth({
      telemetry: { present: true, errors: [], cwdResets: 0, foreignPathMentions: 0 },
      timedOut: true,
    });
    assert.equal(isStandingFailure(reasons), false);
  });
});

describe("the harness cannot reach the real installation", () => {
  const source = readFileSync(new URL("./verifier-correctness.mjs", import.meta.url), "utf8");
  const libNames = ["cases", "variants", "telemetry", "scoring", "routing"];
  const libs = libNames.map((name) =>
    readFileSync(new URL(`./lib/${name}.mjs`, import.meta.url), "utf8"),
  );

  // The #16 measurement sample lives in the real database. Pooling benchmark
  // runs into it destroys the sample, so the harness must have no way to reach
  // it: every path it opens is derived from the fixture root.
  test("the telemetry reader can only open a fixture database", () => {
    const telemetry = libs[libNames.indexOf("telemetry")];
    assert.ok(telemetry.includes("join(fixture.dataHome"), "db path is not fixture-derived");
    assert.ok(!/\bhomedir\b/.test(telemetry), "telemetry reaches into the home directory");
  });

  test("no library module resolves anything from the home directory", () => {
    for (const [index, text] of libs.entries()) {
      assert.ok(!/\bhomedir\b/.test(text), `lib/${libNames[index]}.mjs uses homedir()`);
    }
  });

  // The runner's one home-directory read is the AGENTS.md digest, which records
  // what the fixture inherited. Any other use is a leak out of the fixture.
  test("the runner touches the home directory only to digest AGENTS.md", () => {
    const uses = source.split("\n").filter((line) => /\bhomedir\(\)/.test(line));
    assert.equal(uses.length, 1, `unexpected homedir() uses: ${uses.join(" | ")}`);
    assert.ok(uses[0].includes(".config/opencode/AGENTS.md"), uses[0]);
  });

  test("prompt variants are written into the fixture, never the config dir", () => {
    const variants = readFileSync(new URL("./lib/variants.mjs", import.meta.url), "utf8").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    assert.ok(variants.includes("fixture.configDir"));
    assert.ok(!variants.includes(".config/opencode"));
  });
});

// A brief that names a directory which no longer exists sends the verifier
// looking for a repository that is not there. The strong seat reconciled it
// every time; a weaker one could follow the dead path and return a verdict,
// which scores as data rather than as an invalid run.
describe("replayed fixture paths", () => {
  const ROOT = "/private/var/folders/s8/xxxx/T/pilotfish-fixture-AAAAAA";
  const CAPTURED = "/private/var/folders/s8/xxxx/T/pilotfish-fixture-m1mzl6";

  test("the captured fixture path is repointed at this run's fixture", () => {
    const result = normalizeFixturePaths(
      `Verify the repository at ${CAPTURED}/project against its HEAD.`,
      ROOT,
    );
    assert.equal(result.brief, `Verify the repository at ${ROOT}/project against its HEAD.`);
    assert.equal(result.occurrences, 1);
    assert.deepEqual(result.from, [CAPTURED]);
  });

  // Rewritten, not stripped: everything the primary wrote around the path has
  // to survive, or the replayed brief is no longer the brief that was captured.
  test("only the path changes", () => {
    const before = `the repo is \`${CAPTURED}/project\`. Run \`git show HEAD\` there.`;
    const after = normalizeFixturePaths(before, ROOT).brief;
    assert.equal(after, `the repo is \`${ROOT}/project\`. Run \`git show HEAD\` there.`);
    assert.equal(after.replace(ROOT, CAPTURED), before);
  });

  test("a brief that names no fixture is returned untouched and counted as such", () => {
    const brief = "Verify this bounded claim about `headLines` in `src/log.mjs`.";
    const result = normalizeFixturePaths(brief, ROOT);
    assert.equal(result.brief, brief);
    assert.equal(result.occurrences, 0);
  });

  test("a brief already naming this fixture is not counted as a rewrite", () => {
    const result = normalizeFixturePaths(`repo at ${ROOT}/project`, ROOT);
    assert.equal(result.occurrences, 0);
  });

  // The regression this exists for: every stored brief must replay clean.
  test("no stored brief still names a foreign fixture after normalization", () => {
    const store = JSON.parse(
      readFileSync(new URL("./briefs.json", import.meta.url), "utf8"),
    );
    for (const [caseId, entries] of Object.entries(store.cases)) {
      for (const [index, entry] of entries.entries()) {
        const { brief } = normalizeFixturePaths(entry.brief, ROOT);
        const stray = brief.match(/pilotfish-fixture-[A-Za-z0-9]{6,}/g) ?? [];
        for (const match of stray) {
          assert.ok(
            ROOT.endsWith(match),
            `${caseId} #${index} still names a foreign fixture: ${match}`,
          );
        }
      }
    }
  });
});

// The seat comparison rests on this, and 0 of 60 against 11 of 51 is a table
// no normal approximation grades correctly.
describe("comparing two seats", () => {
  test("a clear separation is significant and a null one is not", () => {
    // 0/60 vs 11/51 -- the uncontrolled result this suite was built to re-test.
    assert.ok(fisherExact(0, 60, 11, 40) < 0.001);
    // Identical rates cannot be distinguished at any n.
    assert.equal(fisherExact(5, 55, 5, 55).toFixed(2), "1.00");
  });

  // Textbook values, so the implementation is checked against something other
  // than its own output.
  test("known tables grade to their published p-values", () => {
    // Fisher's own tea-tasting table.
    assert.equal(fisherExact(3, 1, 1, 3).toFixed(4), "0.4857");
    // Cross-checked against an exact rational computation, not against this
    // implementation's own output.
    assert.equal(fisherExact(1, 9, 11, 3).toFixed(5), "0.00276");
  });

  test("a seat difference is reported with the counts that produced it", () => {
    const comparison = compareProportions(proportion(0, 60), proportion(11, 51));
    assert.equal(comparison.left.successes, 0);
    assert.equal(comparison.right.total, 51);
    assert.ok(comparison.difference < 0);
    assert.ok(comparison.p < 0.001);
  });

  test("an empty cell yields no comparison rather than a spurious one", () => {
    assert.equal(compareProportions(proportion(0, 0), proportion(11, 51)), null);
  });
});
