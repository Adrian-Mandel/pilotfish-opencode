// The dispatch briefs a real primary wrote, kept so they can be replayed.
//
// A full in-situ run pays for a whole orchestrated session — planning, tool
// calls, integration — to produce one input string for the verifier, and only
// the verifier's verdict is scored. Replaying a recorded brief buys the same
// measurement for one session instead of two, which is what makes a sample
// large enough to conclude anything affordable.
//
// What replay gives up is stated plainly in the README: it measures the
// verifier's response to a brief, not the primary's choice of brief. That is
// why the briefs are captured from real runs rather than written by hand, and
// why every one of them is kept rather than a single canonical example — the
// primary phrases the same claim differently every time, and collapsing that
// variance would make the replayed sample look more consistent than the system
// it stands in for.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const BENCH_DIR = fileURLToPath(new URL("../", import.meta.url));
export const BRIEFS_PATH = join(BENCH_DIR, "briefs.json");

export const BRIEFS_SCHEMA = "pilotfish.bench.briefs/1";

// Captured briefs are inputs to a measurement, so their provenance travels with
// them: which result file, which run, and which prompt produced each one.
export function captureBriefs(resultPaths) {
  const byCase = new Map();
  for (const path of resultPaths) {
    const record = JSON.parse(readFileSync(path, "utf8"));
    for (const run of record.runs ?? []) {
      for (const verifier of run.verifierRuns ?? []) {
        const text = verifier.dispatchPrompt?.trim();
        if (!text) continue;
        const entries = byCase.get(run.caseId) ?? [];
        if (!entries.some((entry) => entry.brief === text)) {
          entries.push({
            brief: text,
            // `basename`, not a split on "/". The hand-rolled version returned
            // the whole path on win32, where the separator is a backslash --
            // which would write an absolute machine path, home directory
            // included, into a committed `briefs.json`.
            source: basename(path),
            variant: run.variant,
            pilotfishPrompt: run.promptDigests?.["pilotfish.md"] ?? null,
          });
        }
        byCase.set(run.caseId, entries);
      }
    }
  }
  return {
    schema: BRIEFS_SCHEMA,
    capturedFrom: resultPaths.map((path) => basename(path)),
    cases: Object.fromEntries([...byCase].map(([id, entries]) => [id, entries])),
  };
}

export function writeBriefs(store, path = BRIEFS_PATH) {
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  return path;
}

export function loadBriefs(path = BRIEFS_PATH) {
  if (!existsSync(path)) {
    throw new Error(
      `no captured briefs at ${path}; run \`capture-briefs <result.json>...\` first. ` +
        "Replay uses briefs a real primary wrote, never invented ones.",
    );
  }
  const store = JSON.parse(readFileSync(path, "utf8"));
  if (store.schema !== BRIEFS_SCHEMA) {
    throw new Error(`briefs file has schema "${store.schema}", expected "${BRIEFS_SCHEMA}"`);
  }
  return store;
}

// Deterministic given (case, repeat): the same repeat index always replays the
// same brief, so a seed replays a whole suite and two variants at the same
// repeat are compared on identical input. That pairing is the point — it
// removes brief variance from the between-variant comparison while keeping it
// in the sample overall.
export function briefFor(store, caseId, repeat) {
  const entries = store.cases?.[caseId];
  if (!entries?.length) {
    throw new Error(`no captured brief for case "${caseId}"; capture one from a full run first`);
  }
  return entries[repeat % entries.length];
}

export function briefCounts(store) {
  return Object.fromEntries(
    Object.entries(store.cases ?? {}).map(([id, entries]) => [id, entries.length]),
  );
}

// A captured brief carries the absolute fixture path of the run that produced
// it, and on replay that directory is gone -- a different `mkdtemp` name under
// the same tmpdir. Three of the 45 stored briefs name one, but they are not
// spread evenly: `b-shared-default-mutation` has two briefs and one of them
// carries a path, so half of that case's replay runs opened by reconciling a
// repository that does not exist.
//
// `bambi/qwen3.8-27b-mtp-pure` handled it every time -- found the real repo,
// matched HEAD against the claim, flagged the discrepancy and proceeded -- but
// it spent real effort doing so, and a weaker seat could follow the dead path
// instead. That failure would score as a verdict rather than as an invalid run,
// which is the worst shape a harness artifact can take.
//
// Rewritten rather than stripped. The primary genuinely did tell the verifier
// where the repository was; deleting the sentence would change what the brief
// says, while pointing it at this run's fixture makes the same sentence true.
// The substitution is mechanical and recorded per run, so it stays distinct
// from authoring a brief -- which this harness never does.
export const FIXTURE_PATH_PATTERN = /[^\s`'"()[\],;]*\/pilotfish-fixture-[A-Za-z0-9]{6,}/g;

// The other thing a brief pins to the run that produced it: commit ids. This
// preset's primary writes them out -- *"Immutable pre-edit baseline commit:
// 9216815..., Claimed implementation commit: f98d9cc..."* -- and a brief naming
// commits that are not in the fixture is worse than a dead path, because the
// verifier cannot diff the claimed change at all and its confusion arrives as a
// verdict rather than as an invalid run.
//
// Fixture commit ids are pinned to fixed dates (see `cases.mjs`), so a brief's
// ids stay valid for as long as the case's content does. Editing a fixture's
// files changes them, and this is what makes that loud: anything that looks like
// an abbreviated or full commit id and is not a prefix of this case's base or
// head is stale, and the brief has to be recaptured.
//
// Deliberately not a rewrite. A path can be repointed and the sentence stays
// true; a commit id cannot, because the primary chose those two ids to bound the
// change it was talking about, and substituting different ones would be writing
// the brief rather than capturing it.
const COMMIT_ID_PATTERN = /\b[0-9a-f]{7,40}\b/g;

export function staleCommitIds(brief, { base, head }) {
  if (typeof brief !== "string") return [];
  const valid = [base, head].filter(Boolean);
  return [...new Set(brief.match(COMMIT_ID_PATTERN) ?? [])].filter(
    (id) => !valid.some((sha) => sha.startsWith(id)),
  );
}

export function normalizeFixturePaths(brief, root) {
  if (typeof brief !== "string" || !root) return { brief, occurrences: 0, from: [] };
  const from = new Set();
  let occurrences = 0;
  const rewritten = brief.replace(FIXTURE_PATH_PATTERN, (match) => {
    if (match === root) return match;
    from.add(match);
    occurrences += 1;
    return root;
  });
  return { brief: rewritten, occurrences, from: [...from] };
}
