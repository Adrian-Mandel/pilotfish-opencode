// Deterministic scoring of a verifier verdict against a case's ground truth.
//
// No LLM judge anywhere: the seeded defect is known, the verdict vocabulary is
// fixed, and detection is substring matching against markers declared in the
// case. Everything here is pure and unit-tested offline, because a scorer that
// silently mis-grades produces exactly the finding that would revert #16.

// Markdown noise around a one-word verdict is normal model output, not a
// different answer. `## **REFUTED**` and `Verdict: REFUTED` both lead with the
// verdict. The #16 evidence used a bare begins-with test; this is a strict
// superset of it, chosen so fewer runs land in `unparseable` -- and an
// unparseable run is excluded from the rates, so being generous here is the
// conservative direction.
function normalizeLine(line) {
  return line
    .replace(/^[\s>#*_`~\-+•]+/, "")
    .replace(/^(?:final\s+)?verdict\s*[:\-—]\s*/i, "")
    .replace(/^[\s*_`]+/, "")
    .trim()
    .toUpperCase();
}

export function parseVerdict(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  for (const line of text.split("\n")) {
    const normalized = normalizeLine(line);
    if (normalized.startsWith("CONFIRMED")) return "CONFIRMED";
    if (normalized.startsWith("REFUTED")) return "REFUTED";
  }

  // Fall back to whichever word appears first anywhere. This catches a verdict
  // buried mid-sentence and mis-reads a verifier that quotes its own brief
  // before answering; `verdictSource` records which path produced the answer so
  // a suspicious cell can be re-read by hand.
  const upper = text.toUpperCase();
  const confirmed = upper.indexOf("CONFIRMED");
  const refuted = upper.indexOf("REFUTED");
  if (confirmed < 0 && refuted < 0) return null;
  if (confirmed < 0) return "REFUTED";
  if (refuted < 0) return "CONFIRMED";
  return confirmed < refuted ? "CONFIRMED" : "REFUTED";
}

export function verdictSource(text) {
  if (typeof text !== "string" || !text.trim()) return "none";
  for (const line of text.split("\n")) {
    const normalized = normalizeLine(line);
    if (normalized.startsWith("CONFIRMED") || normalized.startsWith("REFUTED")) return "leading-line";
  }
  return parseVerdict(text) ? "anywhere" : "none";
}

// `all` must every one be present and at least one of `any` must be. `any`
// carries the discrimination -- see the marker rule enforced in cases.mjs.
export function mentionsDefect(text, markers) {
  if (typeof text !== "string" || !markers) return false;
  const haystack = text.toLowerCase();
  const has = (marker) => haystack.includes(marker.toLowerCase());
  return markers.all.every(has) && markers.any.some(has);
}

// The four outcomes for a seeded-defect case are not two. #16's change does not
// tell the verifier to ignore an adjacent defect; it tells it to report one
// below the verdict instead of refuting on it. Collapsing CONFIRMED-with-
// observation into "missed" would score the design's intended behaviour as the
// failure it was built to avoid, and collapsing it into "caught" would hide a
// gate that no longer stops anything. Both are counted, separately.
export const OUTCOMES = {
  CAUGHT: "caught", //             REFUTED, and the defect is named
  OBSERVED: "observed", //         CONFIRMED, but the defect is named alongside
  MISSED: "missed", //             CONFIRMED, defect never mentioned -- false CONFIRMED
  REFUTED_OTHER: "refuted-other", // REFUTED for something that is not the seeded defect
  CLEAN_CONFIRMED: "clean-confirmed", // class D, correctly CONFIRMED
  FALSE_REFUTED: "false-refuted", //   class D, refused a clean change
  NO_VERDICT: "no-verdict", //     text present but no parseable verdict
  NOT_DISPATCHED: "not-dispatched", // the gate never fired
};

export function scoreVerdict(caseDef, verdictText) {
  const verdict = parseVerdict(verdictText);
  if (!verdict) {
    return { verdict: null, mentioned: false, outcome: OUTCOMES.NO_VERDICT };
  }
  if (caseDef.defectClass === "D") {
    return {
      verdict,
      mentioned: false,
      outcome: verdict === "CONFIRMED" ? OUTCOMES.CLEAN_CONFIRMED : OUTCOMES.FALSE_REFUTED,
    };
  }
  const mentioned = mentionsDefect(verdictText, caseDef.defect.markers);
  let outcome;
  if (verdict === "REFUTED") outcome = mentioned ? OUTCOMES.CAUGHT : OUTCOMES.REFUTED_OTHER;
  else outcome = mentioned ? OUTCOMES.OBSERVED : OUTCOMES.MISSED;
  return { verdict, mentioned, outcome };
}

// Wilson score interval. At the 5 repeats per cell the issue sets as the floor,
// a normal-approximation interval on a proportion of 0 has zero width and would
// report certainty the data does not contain. Wilson does not.
export function wilson(successes, total, z = 1.96) {
  if (total === 0) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const half =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function proportion(successes, total) {
  if (total === 0) return { successes, total, rate: null, sd: null, ci95: null };
  const rate = successes / total;
  return {
    successes,
    total,
    rate,
    sd: Math.sqrt((rate * (1 - rate)) / total),
    ci95: wilson(successes, total),
  };
}

function tally(runs) {
  const counts = Object.fromEntries(Object.values(OUTCOMES).map((name) => [name, 0]));
  for (const run of runs) counts[run.outcome] += 1;
  return counts;
}

// Denominators are stated rather than assumed. Invalid runs (throttling, quota,
// abort, timeout) are already excluded upstream; here, a run where the gate
// never fired or the verdict did not parse is excluded from the rates and
// reported on its own, because it is not evidence either way about detection.
export function summarizeCell(runs) {
  const counts = tally(runs);
  const scored = runs.filter(
    (run) => run.outcome !== OUTCOMES.NO_VERDICT && run.outcome !== OUTCOMES.NOT_DISPATCHED,
  );
  const n = scored.length;
  const clean = runs.length > 0 && runs[0].defectClass === "D";

  return {
    runs: runs.length,
    scored: n,
    counts,
    ...(clean
      ? { falseRefuted: proportion(counts[OUTCOMES.FALSE_REFUTED], n) }
      : {
          // The primary metric of the slice.
          falseConfirmed: proportion(counts[OUTCOMES.MISSED], n),
          // Named at all, whether or not the verdict turned on it.
          detected: proportion(counts[OUTCOMES.CAUGHT] + counts[OUTCOMES.OBSERVED], n),
          // Turned the verdict, i.e. actually stopped the change.
          refutedOnDefect: proportion(counts[OUTCOMES.CAUGHT], n),
        }),
  };
}
