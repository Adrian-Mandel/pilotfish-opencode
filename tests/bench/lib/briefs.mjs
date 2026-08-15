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
import { join } from "node:path";
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
            source: path.split("/").pop(),
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
    capturedFrom: resultPaths.map((path) => path.split("/").pop()),
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
