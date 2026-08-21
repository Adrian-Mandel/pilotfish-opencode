# Runbook: the class-B2 suite

B2 is the experiment [issue #15 comment 5361704033](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361704033)
proposed, and it is the one that decides whether any class-B number so far means
what it appears to mean. Everything measured to date is **adjacent-hunk
detection on a two-hunk diff**, and that comment's own taxonomy puts the seeded
shape at about 5% of real defects. B2 seeds the identical mutations, with
identical markers, into commits that also carry legitimate changes.

> *"If detection stays near 100%, the calibration worry is answered and every
> existing class B result stands as-is. If it collapses, the 0/60 measured
> diff-reading and we know it before it reaches the README."*

This document is the runbook. Everything in it that can be done offline **has
been done**; what remains needs a provider.

---

## Status

| | |
|---|---|
| Cases built and validated | ✅ all six |
| Diff shape verified against design intent | ✅ |
| Fixture suites green with the defect present | ✅ |
| Markers aligned with class B | ✅ |
| **Captured briefs** | ❌ **none — this is the blocker** |

---

## The blocker, and why B's briefs cannot be reused

Replay needs a captured brief per case, and B2 has none for any of the six.
Until 2026-08-21 `plan` did not say so — it printed brief counts for the whole
store, so six zeroes hid behind nine unrelated positive numbers, and a 60-run
suite planned cleanly that would have thrown on run 1. That now fails up front
with the missing cases named.

**B's briefs are not substitutes.** The B2 claim is deliberately longer, because
it has to describe the legitimate changes as well:

> b-timeout-guard-adjacent — *"parsePort in src/config.mjs now rejects
> out-of-range input… test/config.test.mjs covers the new rejections and
> passes."*
>
> b2-timeout-guard-adjacent — *"…**The same commit extracts a shared asNumber
> helper so the numeric coercion is stated once, accepts yes and no in
> parseBoolean, renames the destructured bindings in describeConfig, and updates
> the README table.** test/config.test.mjs covers the new rejections **and the
> added boolean words**, and the suite passes."*

Replaying a B brief against a B2 repository would describe a commit that is not
the one on disk, and the verifier would refute on the mismatch. That is not the
measurement.

So B2 needs its own briefs, which means in-situ runs, which is the only step
here that costs orchestrated-session quota.

---

## Step 1 — capture briefs (required once)

Six in-situ runs, one per case. The primary writes a brief for each; that brief
is what every later replay run reuses.

```bash
node tests/bench/verifier-correctness.mjs plan --classes B2 --variants current --repeats 1
```

```bash
node tests/bench/verifier-correctness.mjs run --confirm --classes B2 --variants current --repeats 1 --out tests/bench/results/b2-insitu-briefs.json
```

**~1.0h, range 0.5–2.0h**, against the live subscription. The estimate is the
harness's in-situ fallback — one measured run from 2026-08-10 — so treat the
range as real.

```bash
node tests/bench/verifier-correctness.mjs capture-briefs tests/bench/results/b2-insitu-briefs.json
```

Then confirm coverage is real before spending anything on step 2:

```bash
node tests/bench/verifier-correctness.mjs plan --replay --model openai/gpt-5.6-sol --classes B2 --variants current --repeats 10
```

The `briefs` line must show six non-zero counts. One brief per case is enough to
run, but it is thin: with a single brief every repeat of that case replays
identical input, so the cell measures one phrasing rather than the primary's
variance. Two or three per case is better if the quota is there — `--repeats 2`
in step 1 roughly doubles the cost and gives up to twelve briefs.

## Step 2 — the two-seat B2 suite

```bash
node tests/bench/verifier-correctness.mjs run --confirm --replay \
  --model bambi/qwen3.8-27b-mtp-pure,openai/gpt-5.6-sol \
  --classes B2 --variants current --repeats 10 \
  --out tests/bench/results/b2-seat-comparison.json
```

120 runs, 60 per seat. From the measured per-seat figures: bambi 2.9 min/run =
**2.9h**, gpt-5.6 0.7 min/run = **0.7h** — about **3.6h sequential**, or ~2.9h
if split into concurrent halves by seat the way the last comparison ran.

Splitting is sound *only* because the endpoints are independent (a LAN server
and a hosted subscription). If you split, note in the write-up that the seats
were not temporally interleaved — the last suite was, and the audit had to
correct the claim that it was.

```bash
node tests/bench/verifier-correctness.mjs report tests/bench/results/b2-seat-comparison.json
```

## Step 3 — the comparison that answers the question

The B2 result is only meaningful **against the B result on the same seats**, and
that already exists in `seat-comparison-final.json` — same six defects, same
seats, same variant, 10 repeats. Compare detection, not just false `CONFIRMED`:

| | B (measured) | B2 (to measure) |
|---|---|---|
| gpt-5.6-sol false `CONFIRMED` | 5/60 = 8.3% | ? |
| bambi false `CONFIRMED` | 0/44 = 0.0% | ? |
| gpt-5.6-sol detected (`caught` + `observed`) | 55/60 | ? |
| bambi detected | 44/44 | ? |

**Detection is the number that answers the calibration question**, not the false
`CONFIRMED` rate. The worry is that near-total detection on B was diff-reading;
if detection holds on B2, it was not.

Decision rule, stated before the data exists:

- **Detection holds within a few points on both seats** — the calibration worry
  is answered, and every existing class-B result stands as written.
- **Detection collapses on both seats** — class B measured diff-reading, and
  every "the verifier finds adjacent defects" claim in `docs/` and #15 narrows
  to "on a two-hunk diff". This is the outcome that must not reach the README.
- **Detection collapses on one seat only** — the most informative result and the
  least anticipated. It would mean the seats differ in a way class B could not
  see, and the seat comparison would need rerunning on B2 as the primary tier.

---

## Verified offline, so you do not have to

Done on 2026-08-21, no provider touched:

- **All six B2 cases build** into their two-commit repositories, and both prompt
  variants resolve. `validate` is green.
- **The diff shape is the intended one.** Class B is 2 files and 3–6 hunks; B2
  is 3 files and 7–13. The defect really is one hunk among several rather than
  one of two, which is the whole design.

  | | files | hunks | | | files | hunks |
  |---|---:|---:|---|---|---:|---:|
  | `b-cap-boundary-strict` | 2 | 4 | | `b2-cap-boundary-strict` | 3 | 13 |
  | `b-config-read-adjacent` | 2 | 5 | | `b2-config-read-adjacent` | 3 | 9 |
  | `b-containment-inverted` | 2 | 6 | | `b2-containment-inverted` | 3 | 7 |
  | `b-shared-default-mutation` | 2 | 6 | | `b2-shared-default-mutation` | 3 | 9 |
  | `b-tail-off-by-one` | 2 | 4 | | `b2-tail-off-by-one` | 3 | 13 |
  | `b-timeout-guard-adjacent` | 2 | 3 | | `b2-timeout-guard-adjacent` | 3 | 10 |

- **Every fixture's own test suite passes with the defect present**, on all
  twelve. That is what makes the seeded defect survive `node --test` the way a
  real one does; a red suite would let a verifier refute without finding
  anything.
- **Markers match class B exactly**, including the `"c\nd"` value discriminator
  added to both tail cases on 2026-08-21.

One caveat if you repeat the green-suite check off-POSIX: `b-containment-inverted`
and `b2-containment-inverted` go red on win32, because `node:path.normalize`
returns backslashes there and `joinUnderRoot`'s `startsWith(`${root}/`)` guard
then rejects a contained path. It is an artifact of the checking environment,
not of the fixture — every recorded suite ran on macOS, where both are green.
The bench assumes POSIX throughout.

---

## Before quoting anything from the result

The list in [`tests/bench/README.md`](../tests/bench/README.md#before-you-trust-a-number-from-a-new-model)
is now five items long because each one changed an answer here. The three that
have bitten a B2-shaped suite specifically:

1. **Run the anchor test on every `missed` run** before believing the rate.
   Anchor absent → real. Anchor present → the vocabulary or the window failed.
   It sorted 7 artifacts from 10 real misses in one pass.
2. **Check `validRuns` against `repeats × cells`.** A truncated suite still
   writes a complete-looking summary; the 21.6% came from one that was 37% done.
3. **Never ship a correction that fixes one seat's failure mode and not the
   other's.** Doing exactly that moved a p-value from 0.14 to 0.0195 — into
   significance, in the flattering direction — on the asymmetry alone.

B2 also introduces a marker risk class B does not have. The legitimate changes
are real changes, so a verdict can discuss `splitLines` or `asNumber` at length
without touching the seeded defect. `markers.all` still anchors on the defective
function, so that is handled — but if a B2 cell reports detection well above its
B twin, read the verdicts before believing it. Detection going *up* when the
defect is better hidden is the shape a false credit takes.
