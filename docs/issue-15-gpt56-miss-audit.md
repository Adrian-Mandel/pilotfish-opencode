# Hand-audit of the `missed` runs in the gpt-5.6 class-B replay suite

Audits every run scored `missed` in `tests/bench/results/replay-gpt56-sol-classB-r20.json`
— the suite behind the **11/51 = 21.6%** false-`CONFIRMED` figure in
[issue #15 comment 5361389362](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361389362),
the number that inverted #32's founding assumption by putting the free local
seat ahead of the paid frontier one.

Offline throughout. No provider, no quota, no model seat. No result file or
`case.json` was modified; the marker tests below import
`tests/bench/lib/scoring.mjs` unmodified and re-grade stored verdicts read-only.

---

## Finding

**The 21.6% is not real.** Six of the eleven `missed` runs in that cell are
marker-vocabulary artifacts — the verifier found the seeded defect, named the
function, quoted the exact wrong output, and flagged it as outside the claim.
The corrected rate for the same cell is **5/51 = 9.8%** (Wilson 4.3–21.0%),
which is consistent with the ~7% the controlled re-run is tracking.

Two independent defects inflated it, and they compound:

| | Effect on the headline |
|---|---|
| **Marker artifact** on `b-tail-off-by-one` — 6 of 11 current-cell misses | 21.6% → 9.8% |
| **The suite is 37% complete** — 88 valid runs of 240 planned | no directional number should be quoted from it at all |

The second is the README's *"Do not report a direction from a partial suite…
This was done twice and was wrong both times."* This is the third time.

---

## Provenance

| | |
|---|---|
| File | `tests/bench/results/replay-gpt56-sol-classB-r20.json` |
| Started | 2026-08-17T23:55:40Z. **Never rescored** (`rescoredAt` absent) |
| Seat | `openai/gpt-5.6-sol` (no `@high`), replay mode, preset `chatgpt` |
| Environment | node v22.22.3, OpenCode 1.18.16, `gitHead` `2a8e5fe8`, `AGENTS.md` `7f7344c8` |
| Planned | 240 runs — 6 class-B cases × 2 variants × 20 repeats |
| Actual | **95 attempted, 88 valid, 7 invalid (all `timeout`)** |

`2a8e5fe8` is a descendant of `054a27e`, so the corrected marker lists were in
force. This is not the pre-fix scoring.

### The suite never finished, and it stopped unevenly

From the run log: the suite reached run 88 of 240, then crashed —

```
Error: ENOENT: no such file or directory, open '--timeout'
    at main (…/tests/bench/verifier-correctness.mjs:719:45)
```

— a CLI argument-parsing bug. It was resumed, but **the resume passed a 4-minute
per-run timeout where the original ran with 20 minutes**, and the resumed
portion immediately produced six consecutive `INVALID: timeout` results before
the log ends mid-run. Every one of the 7 invalid runs is a timeout, and all fall
in the resumed segment.

Cell occupancy against the 20 planned:

| Case | current | pre-scope |
|---|---:|---:|
| `b-cap-boundary-strict` | 8 | 6 |
| `b-config-read-adjacent` | 9 | 10 |
| `b-containment-inverted` | 8 | 7 |
| `b-shared-default-mutation` | 11 | 4 |
| `b-tail-off-by-one` | **6** | **4** |
| `b-timeout-guard-adjacent` | 9 | 6 |
| **total** | **51** | **37** |

Occupancy runs from 4 to 11. Because the queue is randomized, this is a biased
sample rather than a small one, and the two cases contributing every artifact
(`b-tail-off-by-one`) and every real miss (`b-timeout-guard-adjacent`) are among
the least-filled. The 51 in "11/51" is a class-B **current** pool, not a
completed cell.

---

## Per-run ruling — all 17 valid misses

**7 artifacts · 10 real · 0 ambiguous.**

Detection requires `markers.all` first (`tests/bench/lib/scoring.mjs:91`), which
returns `false` immediately if the anchor is absent, so `markers.any` is never
consulted. That single fact splits the 17 cleanly:

| Case | Anchor | Anchor present in the missed verdicts? | Ruling |
|---|---|---|---|
| `b-tail-off-by-one` | `tailLines` | **7 of 7 — yes** | `markers.any` is binding → **artifacts** |
| `b-timeout-guard-adjacent` | `parseTimeout` | 0 of 9 | fails at the anchor → **real** |
| `b-shared-default-mutation` | `defaultOptions` | 0 of 1 | fails at the anchor → **real** |

### The 7 artifacts — `b-tail-off-by-one`

Each names the function, states the exact before/after values, and reports it as
an out-of-claim observation. This is textbook `observed`, the behaviour #16's
scope change intends.

| # | Variant | Rep | The sentence that decides it |
|---:|---|---:|---|
| 1 | current | 0 | "The commit also changes `tailLines` and removes its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` instead of `"c\nd"`." |
| 2 | current | 3 | "The same commit changes `tailLines` and removes its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` rather than the prior `"c\nd"`. This is outside the stated `headLines` claim." |
| 3 | current | 6 | "The commit also changes `tailLines`; `tailLines(..., 2)` now returns `"d"` instead of `"c\nd"`, and its prior test was removed." |
| 4 | current | 7 | "The commit also changes `tailLines` and removes its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` rather than the prior `"c\nd"`." |
| 5 | current | 11 | "The commit also changed `tailLines` and removed its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` instead of `"c\nd"`; the direct check exited with status 1." |
| 6 | current | 16 | "The commit also changes `tailLines`, causing `tailLines("a\nb\nc\nd", 2)` to return `"d"` instead of `"c\nd"`, and removes its test." |
| 7 | pre-scope | 14 | "the commit also **incorrectly** changes `tailLines(..., 2)` from `"c\nd"` to `"d"` and removes its test." |

**Verified against ground truth, not taken on faith.** This is the direction that
deserves the most suspicion, since every one of these flips the number the
flattering way. The check is that the quoted values are correct:

```js
// base/src/log.mjs                    // change/src/log.mjs
lines.slice(lines.length - n)          lines.slice(lines.length - n + 1)
```

For `"a\nb\nc\nd"` with `n=2`: base slices from index 2 → `"c\nd"`; change slices
from index 3 → `"d"`. Every verdict's before/after pair is exactly right, and
`base/test/log.test.mjs` does cover `tailLines` while `change/test/log.test.mjs`
does not — so "removes its test" is correct too. Run 5 reports the probe exiting
non-zero, i.e. it executed the code rather than reading the diff. These are
semantic detections checked against the fixture source, not word matches.

### The 10 real misses

None of these mention the seeded defect's function in any form.

| # | Case | Variant | Rep | Ruling | Closing line — the slot where an observation would sit |
|---:|---|---|---:|---|---|
| 8 | `b-shared-default-mutation` | pre-scope | 9 | **real** | "A direct assertion confirmed `withOverrides({ retries: 5 })` returns `{ retries: 5, tags: ["core"] }`. `git diff HEAD~1 HEAD --check` also passed." |
| 9 | `b-timeout-guard-adjacent` | current | 3 | **real** | "Independently checked boundary and invalid values; 1 and 65535 succeeded, while 0, 65536, negatives, fractions, infinities, and garbage threw `RangeError`." |
| 10 | `b-timeout-guard-adjacent` | current | 5 | **real** | "`node --test test/config.test.mjs` passed all 5 tests." |
| 11 | `b-timeout-guard-adjacent` | current | 7 | **real** | "Independently probed boundaries `1` and `65535`, plus invalid values … all behaved as claimed." |
| 12 | `b-timeout-guard-adjacent` | current | 11 | **real** | "Additional boundary checks confirmed `1` and `65535` pass, while zero, negatives, `65536`, fractions, empty/garbage strings, `NaN`, and `Infinity` throw `RangeError`." |
| 13 | `b-timeout-guard-adjacent` | current | 18 | **real** | "Additional boundary probes confirmed `1` and `65535` are accepted, while `0`, `65536`, negatives, fractions, nonnumeric strings, `NaN`, and infinities throw `RangeError`." |
| 14 | `b-timeout-guard-adjacent` | pre-scope | 2 | **real** | "`node --test test/config.test.mjs` also passed all 5 tests." |
| 15 | `b-timeout-guard-adjacent` | pre-scope | 5 | **real** | "Independent boundary checks confirmed `1` and `65535` are accepted; `0`, `-1`, `65536`, fractions, `NaN`, infinity, empty/nullish, and garbage values throw `RangeError`." |
| 16 | `b-timeout-guard-adjacent` | pre-scope | 9 | **real** | "`test/config.test.mjs` covers zero, negatives, values above 65535, floats, garbage, and a valid numeric string." |
| 17 | `b-timeout-guard-adjacent` | pre-scope | 12 | **real** | "`node --test`: 5/5 tests passed." |

Row 8 is the run flagged in the audit brief as already hand-checked and real.
This audit reaches the same conclusion independently: it verifies the
`withOverrides` tags merge properly and never inspects `defaultOptions`.

All 17 carry empty `healthReasons` and empty `warnings`.

---

## Why the `b-tail-off-by-one` markers fail

The shipped `markers.any` is twelve entries long — `off-by-one`, `off by one`,
`one fewer`, `n-1`, `n - 1`, `drops one`, `short by one`, `only n-1`,
`misses one`, `fewer lines`, `one too few`, `regress`. Length is not coverage.

Measured against all 10 valid runs of that case, using the real scorer's
200-character window:

| Marker set | Runs credited |
|---|---|
| All 12 shipped markers together | **2 / 10** |
| …and both credits come from | the bare word "regress" |

The two credited runs matched on **incidental** vocabulary — "an unrelated
**regression**" and "removes its **regression** test" — not on any description of
the off-by-one. The other ten markers fire on nothing at all.

The reason is a vocabulary mismatch the list does not anticipate. Every marker
names the *bug class*; `gpt-5.6` describes this defect **demonstratively**, by
showing an input/output pair. "now returns `"d"` instead of `"c\nd"`" contains
none of the twelve phrases while being a more precise diagnosis than any of them.

**All 10 valid runs of this case detect the defect. The markers credit 2.**

### An eighth artifact, in a different outcome

`pre-scope` rep13 is scored `refuted-other` and should be `caught`:

> "Counterexample: `tailLines("a\nb\nc\nd", 2)` should return `"c\nd"` but returns
> `"d"` due to `lines.length - n + 1`." — it even quotes the defective expression

It refuted **on the seeded defect** and was graded as refuting on something else.
The marker `n - 1` does not match the code's actual `- n + 1`. This does not
affect the false-`CONFIRMED` numerator, but it means the case's
`refutedOnDefect` figure is wrong too, and in the same direction.

---

## Corrected rates

| Cell | n (valid) | As-scored | Corrected | Wilson 95% (corrected) |
|---|---:|---:|---:|---|
| **B / current** | 51 | 11 = **21.6%** | **5 = 9.8%** | 4.3 – 21.0% |
| B / pre-scope | 37 | 6 = 16.2% | 5 = 13.5% | 5.9 – 28.0% |
| Whole suite | 88 | 17 = 19.3% | 10 = 11.4% | — |

Corrected per case, false `CONFIRMED`:

| Case | current | pre-scope |
|---|---|---|
| `b-cap-boundary-strict` | 0/8 | 0/6 |
| `b-config-read-adjacent` | 0/9 | 0/10 |
| `b-containment-inverted` | 0/8 | 0/7 |
| `b-shared-default-mutation` | 0/11 | 1/4 |
| `b-tail-off-by-one` | **0/6** (was 6/6) | **0/4** (was 1/4) |
| `b-timeout-guard-adjacent` | 5/9 | 4/6 |

After correction the false-`CONFIRMED` rate is **entirely** concentrated in
`b-timeout-guard-adjacent`, plus one `b-shared-default-mutation` run. Five of the
six cases contribute nothing to it.

**None of these numbers should be reported as a seat result.** The suite is 37%
complete with cells between 4 and 11 of 20. The corrected 9.8% is the right
correction to a figure that should not have been quoted in the first place.

---

## Recommendation on `markers.any`

| Case | Recommendation |
|---|---|
| `b-tail-off-by-one` | **Broaden — but validate first.** See below. |
| `b-timeout-guard-adjacent` | **No change.** Misses fail at the `parseTimeout` anchor; `markers.any` is never reached. A ceiling test on the sibling suite confirms no broadening flips anything. |
| `b-shared-default-mutation` | **No change.** Its one miss fails at the `defaultOptions` anchor. |
| `b-cap-boundary-strict`, `b-containment-inverted`, `b-config-read-adjacent` | **No change.** Zero misses between them across 48 runs. |

### The broadening, and why it is offered with a caveat

A set reaching 10/10 on this corpus is
`["now returns", "instead of", "should return", "removes its test"]` added to the
existing twelve.

**Do not adopt it on this evidence alone.** It is fitted to ten positives with
**zero negatives available to test against** — every valid run of this case
detected the defect, so this corpus cannot demonstrate that the set fails to
credit a non-detecting verdict. Three of the four entries are generic
connectives, and a plausible non-diagnosing sentence such as *"the test now
covers `headLines` instead of `tailLines`"* would be credited by two of them.
`removes its test` is worse in kind: test removal is a real observation but it is
not the off-by-one, and crediting it repeats precisely the error `054a27e`
corrected — grading on shared words rather than on the defect.

Before adoption, the set must be checked against a corpus containing verdicts
that mention `tailLines` **without** diagnosing it. The local-seat suites are the
obvious source.

### The better fix is to the fixture, not the vocabulary

The natural discriminator for a demonstrative diagnosis is the concrete wrong
output. It is unusable here for an avoidable reason: the correct value `c\nd` is
a **substring of the input literal** `a\nb\nc\nd`, so any verdict that merely
quotes the call — diagnosis or not — would match it.

Changing the fixture's sample text so the input and the expected output share no
substring (for example lines `alpha / beta / gamma / delta`, expected
`"gamma\ndelta"`) makes the expected output an unambiguous discriminator. That is
a more robust fix than a vocabulary list, it needs no new judgement about which
words count as a diagnosis, and it leaves the seeded defect and the scoring
semantics untouched. It does invalidate the existing `b-tail-off-by-one`
transcripts for re-scoring, so it should land with a re-run rather than a
`rescore`.

---

## Three further defects found while reading

**1. Replayed briefs carry a stale absolute fixture path, and this seat does not
recover.** Issue comment 5361294562 recorded that the local seat handled the
dead path every time. `gpt-5.6` does not. Two runs refuted purely because they
could not find the repository:

> "REFUTED — specified repository does not exist. Both `git -C
> "…/pilotfish-fixture-m1mzl6/project" status` and the `/var/…` equivalent failed
> with `No such file or directory`, so the diff and tests could not be verified."
> — `b-shared-default-mutation` pre-scope rep4; current rep16 is the same failure

These are scored `refuted-other` and counted as valid data. They are not data —
they are the harness pointing the verifier at a directory that does not exist,
and they should be marked invalid the way throttling is. They do not affect the
false-`CONFIRMED` numerator, but they inflate `refuted-other` and shrink the
usable `b-shared-default-mutation` pre-scope cell from 4 to 3.

**2. A timed-out run stores its dispatch prompt as its verdict text.**
`b-tail-off-by-one` pre-scope rep7 is `INVALID: timeout`, and its
`verifierRuns[0].verdictText` is the verbatim verifier prompt, not a verdict. It
is correctly excluded, so nothing here is wrong — but the prompt contains the
words `CONFIRMED` and `REFUTED`, so if such a run were ever scored it would parse
a verdict out of its own instructions. Worth a guard.

**3. The resume changed the per-run timeout from 20 minutes to 4.** Any
comparison between the pre-crash and post-crash segments of this suite is
confounded by that, on top of the incompleteness.

---

## Cross-check: the sibling suite, where the same hypothesis fails

`tests/bench/results/replay-gpt56-sol-classAB-r20.json` (2026-08-16,
`gpt-5.6-sol@high`, `gitHead` `054a27e`) was audited the same way. It contains 19
`missed` runs, 18 valid, **all** in `b-timeout-guard-adjacent`.

**All 18 are real. Zero artifacts.** Not one mentions `parseTimeout`, contains
`timeout` in any form, contains `&&` or `||`, or refers to a second or adjacent
function. A ceiling test — setting `any=["timeout"]`, a substring of the anchor
itself and therefore the permissive limit of *any* broadening — **flips nothing**.

Checked in the other direction too, per the README. Dropping the anchor entirely
flips three runs and all three are false credits: one on "outside the claim" from
a README note about `node --test test/` under Node 22, and two on `-5` matching
inside `65535` — the exact false credit `054a27e` removed. All 12 `observed` runs
in that cell were also read; none is over-counted.

Its rates are therefore unchanged by audit: **B/current 5/40 = 12.5%** (Wilson
5.5–26.1%), B/pre-scope 13/40 = 32.5%, class A 40/40 clean under both prompts.

The contrast is the useful part. Two suites, same seat, same case
`b-timeout-guard-adjacent` in both — real misses in both. The artifact appears
only where the verifier *named the function* and the discriminator list missed
its phrasing. **Anchor absent → real; anchor present → check the vocabulary.**
That is the whole test, and it is one command.

---

## What this establishes

**The 21.6% was not real**, and the local-vs-frontier inversion it supported does
not survive it. The corrected 9.8% sits comfortably inside the ~7% the controlled
re-run is reporting, so the re-run is not contradicting the old suite so much as
correcting it.

**But 9.8% should not be quoted either.** It comes from a suite that is 37%
complete with unevenly filled cells, and the README's rule against reporting a
direction from a partial suite applies to the corrected figure exactly as it
applied to the original. The controlled re-run remains the number to wait for.

**The local seat's 0/60 is untouched by this** and remains separately caveated:
different harness commit, different day, 6% upper bound, and its own
`observed`-cell hand-read.

Per issue #15 comment 5361704033, every conclusion here is scoped to
**adjacent-hunk detection**, not to verification quality in general.

---

## Reproducing

**The audited result file is not in the repository.**
`tests/bench/results/.gitignore` ignores `*`, so `replay-gpt56-sol-classB-r20.json`
exists only where it was produced; it was supplied out-of-band for this audit and
could not be written into the working tree from the session that performed it.
Since it is the evidence behind a decision, the `.gitignore` rule's own exception
applies and it should be committed:

```bash
git add -f tests/bench/results/replay-gpt56-sol-classB-r20.json
```

Without it, nothing below can be re-run, and the same gap that delayed this audit
recurs for the next reader.

```bash
node --test tests/bench/scoring.test.mjs
```

60/61 on the machine this ran on. The one failure,
`capture keeps provenance and drops duplicates`
(`tests/bench/scoring.test.mjs:479`), asserts a brief's `source` equals
`result.json` and receives an absolute Windows temp path instead — a
path-basename assumption that does not hold on `win32`. Pre-existing, unrelated,
and in brief capture rather than the scorer. Every `mentionsDefect` /
`scoreVerdict` test passes.

The anchor test that settles most of this is one pass over the stored verdicts:
for each `missed` run, ask whether the text contains the case's `markers.all`
anchor. Absent → real miss, no marker change can help. Present → read the
200-character window and judge the phrasing. Any proposed discriminator must then
be checked against verdicts that mention the anchor **without** diagnosing the
defect, or it will over-credit the way `regress` and `-5` already have.
