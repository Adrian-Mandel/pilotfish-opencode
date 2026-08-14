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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { briefFor, loadCases, materializeCase } from "./lib/cases.mjs";
import { loadProfiles, resolvePrimary } from "./lib/routing.mjs";
import { classifyRunHealth, isStandingFailure } from "./lib/telemetry.mjs";
import {
  OUTCOMES,
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
});

describe("outcome scoring", () => {
  const seeded = CASES.find((item) => item.id === "b-timeout-guard-adjacent");
  const clean = CASES.find((item) => item.defectClass === "D");

  test("REFUTED naming the defect is a catch", () => {
    assert.equal(
      scoreVerdict(seeded, "REFUTED\n\nparseTimeout accepts a negative value.").outcome,
      OUTCOMES.CAUGHT,
    );
  });

  test("CONFIRMED naming the defect is an observation, not a miss", () => {
    const text = "CONFIRMED\n\nThe claim holds.\n\nObservation: parseTimeout accepts a negative value.";
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
