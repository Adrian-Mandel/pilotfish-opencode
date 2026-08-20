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

// `all` must every one be present, and at least one of `any` must appear NEAR
// one of them. `any` carries the discrimination -- see the marker rule enforced
// in cases.mjs.
//
// Proximity is not fussiness. Document-wide matching credited five real runs
// (2026-08-15, qwen3.6-27b) with finding a defect they never found: the verdict
// listed a passing test whose *name* contains the adjacent function, or noted
// that the commit touched it, while a discriminator word appeared elsewhere in
// the verdict about the claimed function entirely. Hand-labelling all 40 runs
// of that case put the false-credit rate at 5 of 14. Requiring the
// discriminator within a window of an anchor grades all 40 correctly, and grades
// the other class B case -- where document-wide matching happened to be right on
// all 40 -- identically.
// Two things were wrong, and the marker list was the larger of them.
//
// Document-wide matching credited five runs (2026-08-15, qwen3.6-27b) with a
// finding they never made: the verdict listed passing tests -- `parsePort
// rejects zero and negative ports` on one bullet, `parseTimeout reads a numeric
// string` on the next -- so "negative" was present, and the adjacent function
// was named, and neither had anything to do with the other. The discriminator
// was vocabulary the *claimed* function's own behaviour uses, which makes it no
// discriminator at all. An adjacent-defect case needs words unique to the
// defect, which for that case is how the models actually described it: `&&`
// where `||` was meant.
//
// Proximity is the second half, and it is deliberately generous. Scoping to the
// line grades the adjacent-defect cases perfectly and then breaks the class A
// control -- 30 of 40, because a verdict discussing one function across several
// sentences naturally separates the name from the detail. All 120 runs grade
// correctly at a 200-character window and identically at 400, so this rests on
// a plateau rather than on a fitted constant.
const DEFAULT_WINDOW = 200;

export function mentionsDefect(text, markers) {
  if (typeof text !== "string" || !markers) return false;
  const haystack = text.toLowerCase();
  const has = (marker) => haystack.includes(marker.toLowerCase());
  if (!markers.all.every(has)) return false;

  const window = markers.window ?? DEFAULT_WINDOW;
  const anyMarkers = markers.any.map((marker) => marker.toLowerCase());
  // Anchor on every occurrence of every all-marker: the mention that carries the
  // finding is not always the first one, and a verdict may name the function in
  // a test list before discussing it properly further down.
  for (const anchor of markers.all.map((marker) => marker.toLowerCase())) {
    let at = haystack.indexOf(anchor);
    while (at !== -1) {
      const segment = haystack.slice(Math.max(0, at - window), at + anchor.length + window);
      if (anyMarkers.some((marker) => segment.includes(marker))) return true;
      at = haystack.indexOf(anchor, at + 1);
    }
  }
  return false;
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

// Fisher's exact test on a 2x2, two-tailed. The seat comparison is a
// small-sample count of a rare event -- 0 of 60 against 11 of 51 is the shape
// this has to grade -- and a chi-square approximation is not valid on a cell of
// zero. Exact is cheap at these n and needs no assumption.
//
// Two-tailed by summing every table at most as probable as the observed one,
// which is the conventional definition and the conservative one; the one-tailed
// variant would report a smaller p for the direction we happen to be hoping
// for, which is exactly the thing to avoid here.
const LOG_FACTORIAL = [0, 0];
function logFactorial(n) {
  for (let i = LOG_FACTORIAL.length; i <= n; i += 1) {
    LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
  }
  return LOG_FACTORIAL[n];
}

function logHypergeometric(a, b, c, d) {
  return (
    logFactorial(a + b) + logFactorial(c + d) + logFactorial(a + c) + logFactorial(b + d) -
    logFactorial(a) - logFactorial(b) - logFactorial(c) - logFactorial(d) -
    logFactorial(a + b + c + d)
  );
}

export function fisherExact(a, b, c, d) {
  const total = a + b + c + d;
  if (total === 0) return null;
  const observed = logHypergeometric(a, b, c, d);
  const row1 = a + b;
  const col1 = a + c;
  const low = Math.max(0, col1 - (c + d));
  const high = Math.min(row1, col1);
  let p = 0;
  for (let x = low; x <= high; x += 1) {
    const lp = logHypergeometric(x, row1 - x, col1 - x, total - row1 - col1 + x);
    // 1e-9 of slack: tables that are equally probable in exact arithmetic can
    // differ in the last bits of a float, and dropping one of them would
    // understate p.
    if (lp <= observed + 1e-9) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

// Two seats compared on one outcome, with the raw table kept: a p-value with no
// counts beside it is not readable, and the counts are what a reader checks.
export function compareProportions(left, right) {
  if (!left || !right || left.total === 0 || right.total === 0) return null;
  return {
    left: { successes: left.successes, total: left.total, rate: left.rate, ci95: left.ci95 },
    right: { successes: right.successes, total: right.total, rate: right.rate, ci95: right.ci95 },
    difference: left.rate - right.rate,
    p: fisherExact(
      left.successes,
      left.total - left.successes,
      right.successes,
      right.total - right.successes,
    ),
  };
}
