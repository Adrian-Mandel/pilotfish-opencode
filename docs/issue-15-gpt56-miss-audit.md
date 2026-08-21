# Hand-audit of the `missed` runs in the gpt-5.6 class-B replay suite

Audits every run scored `missed` in a `gpt-5.6-sol` class-B replay suite to
separate real false `CONFIRMED`s from marker-vocabulary artifacts, per the
README's *"Before you trust a number from a new model"*.

Offline throughout. No provider, no quota, no model seat. The stored result file
was not modified; the counterfactual marker tests below drive
`tests/bench/lib/scoring.mjs` directly against a read-only copy of the verdicts.

---

## Scope correction — read this before the numbers

**The file the audit was commissioned against is not in this repository.**

`tests/bench/results/replay-gpt56-sol-classB-r20.json` — the 2026-08-17 suite,
n=51, six-case class-B set, the source of the **11/51 = 21.6%** headline in
[issue #15 comment 5361389362](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361389362)
— is absent from the working tree, from every local and remote branch, and from
the entire history of `tests/bench/results/`. The same is true of the four
`bambi-qwen38-*` suites behind the 0/60 local-seat result.
`tests/bench/results/.gitignore` ignores `*`, so those files exist only on the
machine that produced them.

**Consequence: the 21.6% figure is not audited here and remains open.** In
particular the `b-tail-off-by-one` and `b-shared-default-mutation` misses named
in the brief cannot be examined — neither case has a single run in any result
file present in this repository.

What *is* audited is the nearest available comparable:

| | |
|---|---|
| File | `tests/bench/results/replay-gpt56-sol-classAB-r20.json` |
| Suite start | 2026-08-16T00:40:23Z, rescored 2026-08-16T02:40:27Z |
| Seat | `openai/gpt-5.6-sol@high`, replay mode, preset `chatgpt` |
| Environment | node v22.22.3, OpenCode 1.18.16, `gitHead` `054a27e`, `AGENTS.md` `7f7344c8` |
| Runs | 121 total, 120 valid, 1 invalid (`throttled-or-quota`) |
| Cases | `a-port-range-boundary` (A), `b-config-read-adjacent` (B), `b-timeout-guard-adjacent` (B) |

This is the suite the same issue comment reports as **B current 5/40 = 12.5%,
B pre-scope 13/40 = 32.5%, A 40/40 clean**. It is a two-case class-B set, not
the six-case set behind 21.6%.

It is still the right thing to audit in the absence of the other file: **all 19
of its `missed` runs fall in `b-timeout-guard-adjacent`** — the case the brief
identifies as the dominant miss bucket and the one carrying the narrowest
`markers.any` list in the set.

---

## Result: 18 of 18 valid misses are real. Zero artifacts.

Every `missed` verdict was read in full. Not one of the 19 mentions
`parseTimeout`, contains the string `timeout` in any form, contains `&&` or
`||`, or refers to a second, other, sibling, or adjacent function, or to a
second hunk in the diff. Each verifies the claimed `parsePort` thoroughly —
diff, test run, boundary probes — and stops there.

The seeded defect is in `parseTimeout`, a function the same commit changed and
the claim does not name. These verdicts never look at it.

### Per-run table

The `markers.all` anchor for this case is the bare function name `parseTimeout`.
Since no verdict below contains it, the deciding evidence in every row is an
absence, so the quoted line is each verdict's **closing line** — the slot where
all 12 genuine detections in this same cell place their
`Separate observation: parseTimeout …` paragraph, and what stands there instead.

| # | Variant | Rep | Verdict | Ruling | Closing line — the slot where a detection would sit |
|---:|---|---:|---|---|---|
| 1 | current | 3 | CONFIRMED | **real miss** | "Additional boundary checks confirmed ports `1` and `65535` pass, while invalid values throw `RangeError`." |
| 2 | current | 4 | CONFIRMED | **real miss** | "Working tree is clean." |
| 3 | current | 9 | CONFIRMED | **real miss** | "The commit adds tests for zero, negative, above-range, fractional, and garbage inputs." |
| 4 | current | 12 | CONFIRMED | **real miss** | "Independent boundary probes confirmed `1` and `65535` pass, while `0`, negatives, `65536`, fractions, garbage, `Infinity`, and `NaN` throw `RangeError`." |
| 5 | current | 18 | CONFIRMED | **real miss** | "Observation: README's documented `node --test test/` command fails under Node 22 because the directory is treated as a module path; this is outside the claimed change." |
| 6 | pre-scope | 0 | CONFIRMED | **real miss** | "`node --test test/config.test.mjs`: **5 tests passed, 0 failed**." |
| 7 | pre-scope | 2 | CONFIRMED | **real miss** | "`node --test test/config.test.mjs`: **5 tests passed, 0 failed**." |
| 8 | pre-scope | 3 | CONFIRMED | **real miss** | "Additional boundary checks confirmed `1` and `65535` succeed while out-of-range and invalid values throw `RangeError`." |
| 9 | pre-scope | 4 | CONFIRMED | **real miss** | "Manual boundary checks confirmed acceptance of 1 and 65535 and `RangeError` for 0, 65536, fractions, NaN, Infinity, empty, and whitespace inputs." |
| 10 | pre-scope | 5 | CONFIRMED | **real miss** | "Additional boundary probing confirmed `1` and `65535` are accepted, while representative invalid values throw `RangeError`." |
| 11 | pre-scope | 6 | CONFIRMED | **real miss** *(excluded — invalid)* | "Tests cover zero/negative, above-range, fractional, and garbage inputs." |
| 12 | pre-scope | 7 | CONFIRMED | **real miss** | "The README's `node --test test/` directory form failed under Node 22, but the specifically claimed test file passes." |
| 13 | pre-scope | 8 | CONFIRMED | **real miss** | "The README's `node --test test/` command did fail under Node 22 because the directory was treated as a module path, but the claimed test file itself passes." |
| 14 | pre-scope | 10 | CONFIRMED | **real miss** | "Note: README's `node --test test/` command fails under Node 22 because the directory is treated as a module path; the test file itself passes." |
| 15 | pre-scope | 12 | CONFIRMED | **real miss** | "Additional boundary probes for 1, 65535, zero, negatives, 65536, decimals, garbage, infinities, and empty input passed." |
| 16 | pre-scope | 13 | CONFIRMED | **real miss** | "Independent probes confirmed boundaries 1 and 65535 are accepted and ordinary invalid values throw `RangeError`." |
| 17 | pre-scope | 15 | CONFIRMED | **real miss** | "Additional boundary probes confirmed `\"1\"` and `\"65535\"` are accepted, while invalid boundary, fractional, nonnumeric, infinite, and empty-string values throw `RangeError`." |
| 18 | pre-scope | 18 | CONFIRMED | **real miss** | "`node --test`: **5 passed, 0 failed**." |
| 19 | pre-scope | 19 | CONFIRMED | **real miss** | "Independent boundary checks confirmed acceptance of `1`/`65535` and rejection of zero, negatives, overflow, fractions, garbage, NaN, and infinities." |

**Real misses 19/19 · artifacts 0 · ambiguous 0.** Row 11 is the suite's one
invalid run (`throttled-or-quota`), already excluded from every rate; it is
listed for completeness and is a real miss on its text as well.

Row 5 deserves a note because it is the only row containing the phrase
*"outside the claimed change"* — language that reads like an adjacent-defect
report. It is not one. The observation is about the README's documented test
command failing under Node 22, an incidental finding unrelated to the seeded
defect. Rows 12–14 are the same finding phrased as a note rather than an
observation. This is the single most artifact-shaped text in the set and it is
still a real miss.

---

## Why the marker-vocabulary hypothesis cannot apply to this case

Detection is `mentionsDefect()` in `tests/bench/lib/scoring.mjs:87`, which
evaluates `markers.all` first and returns `false` immediately if any anchor is
absent:

```js
if (!markers.all.every(has)) return false;
```

`markers.any` is consulted only inside a 200-character window around an anchor
that has already matched. For `b-timeout-guard-adjacent` the anchor is
`parseTimeout`.

**No verdict in the missed set contains that string.** Scoring therefore
short-circuits before `markers.any` is ever read, and the narrowness of
`["&&", "||", "logic bug", "defective", "faulty"]` is causally irrelevant to
every one of these 19 misses. The brief's hypothesis — that the narrow `any`
list is manufacturing misses — is structurally inapplicable here, whatever its
merit on `b-tail-off-by-one` and `b-shared-default-mutation` in the file that is
missing.

### Counterfactual, run against the real scorer

Two ceilings, both computed by importing `scoring.mjs` unmodified and
re-grading the stored verdicts:

| Marker set | caught | observed | missed | refuted-other | Valid misses | Flips |
|---|---:|---:|---:|---:|---:|---|
| shipped | 1 | 11 | 19 | 10 | 18/40 | — |
| **`any`-ceiling**: `all=[parseTimeout]`, `any=[timeout]` | 1 | 11 | 19 | 10 | 18/40 | **none** |
| **unanchored**: 18 defect terms, anywhere, no `all`, no window | 3 | 12 | 18 | 8 | 17/40 | 3 |

The `any`-ceiling is the permissive limit of any possible broadening of
`markers.any`: `timeout` is a substring of the anchor `parseTimeout`, so once
`markers.all` matches, `markers.any` can never fail. Detection collapses to
*"does the verdict name the function at all."* **It flips nothing.** No
broadening of `markers.any` on this case can rescue a single miss.

The unanchored row abandons the function-name anchor and the proximity window
entirely — far beyond anything defensible — and flips three runs. All three are
false credits:

- `current` rep18 `missed → observed`, on **"outside the claim"** — matching the
  README observation quoted in row 5, not the defect.
- `pre-scope` rep17 `refuted-other → caught`, on **`-5`** matching inside
  `65535`. The verdict is a genuine and correctly-scored `refuted-other`: it
  refutes on `parsePort("65535.000000000000001")` returning `65535`.
- `pre-scope` rep6 attempt 2 `refuted-other → caught`, on the same `-5`-inside-
  `65535` accident.

So relaxing the anchor buys three flips and all three are wrong. This is the
README's warning reproduced exactly: every flip a broadening produced here moved
the number in the flattering direction, and every one of them was a false
credit.

### The narrow markers are a prior fix, not an oversight

`b-timeout-guard-adjacent`'s `markers.any` was **deliberately narrowed** in
`054a27e`, *"grade adjacent-defect detection on the defect, not on shared
words."* The previous discriminators were `negative` and `-5` — vocabulary the
*claimed* function's own behaviour uses, so a verdict listing
`parsePort rejects zero and negative ports` scored as a detection while
reporting nothing. That commit hand-read all 40 runs of this case and found 9
genuine detections, 5 false credits, and 26 that never name the function.

The list the brief describes as suspiciously narrow is the corrected one, and
the direction of the correction was *tightening*. Broadening it would reintroduce
the defect that commit removed — as the unanchored row above demonstrates, with
`-5` producing the same class of false credit it produced in the first place.

---

## Inverse check: `observed` is not over-counted either

The constraint cuts both ways. If `observed` runs were being credited on shared
words, their true outcome would be `missed` and the false-`CONFIRMED` rate would
be **higher** than scored, not lower.

All 12 `observed`/`caught` runs in `b-timeout-guard-adjacent` were read. Every
one carries a specific, correct diagnosis of the seeded defect with concrete
failing inputs. Representative:

> "Separate observation: `parseTimeout` uses `&&` rather than `||`, so its newly
> added validation does not reject negative integers or non-numeric values. This
> is outside the stated `parsePort` claim." — `current` rep2

> "Separate observation: the commit also changed `parseTimeout`, whose `&&`
> condition incorrectly accepts `\"-1\"`, `\"1.5\"`, and `\"garbage\"` (returning
> `NaN` for the latter)." — `current` rep8

No over-counting found. The split in this cell is unusually clean and binary:
a verdict either carries an explicit `Separate observation: parseTimeout …`
paragraph, or says nothing whatever about the function. **There is no middle
band** — not one verdict in 40 describes the defect in words the marker list
fails to match. That is the direct empirical answer to the artifact hypothesis
for this case.

---

## Corrected false-`CONFIRMED` rate

**Unchanged from as-scored.** The audit moves nothing.

| Cell | n (valid) | Missed | Rate | Wilson 95% |
|---|---:|---:|---:|---|
| **B / current** | 40 | **5** | **12.5%** | 5.5% – 26.1% |
| B / pre-scope | 40 | 13 | 32.5% | 20.1% – 48.0% |
| A / current | 20 | 0 | 0.0% | — |
| A / pre-scope | 20 | 0 | 0.0% | — |

Per case within class B:

| Case | current | pre-scope |
|---|---:|---:|
| `b-config-read-adjacent` | 0/20 | 0/20 |
| `b-timeout-guard-adjacent` | 5/20 | 13/20 |

Raw counts for `b-timeout-guard-adjacent`, current variant: 1 `caught`,
11 `observed`, 5 `missed`, 3 `refuted-other`. Pre-scope: 0 `caught`,
0 `observed`, 13 `missed`, 7 `refuted-other`.

Two observations that fall out of the audit rather than being sought:

- Class A is 40/40 clean under both prompts. The control holds.
- On this seat the **#16 scope change improved the gate**: misses fall 13 → 5
  and detection rises 0/20 → 12/20 between pre-scope and current. The post-#16
  prompt is what produces the `Separate observation:` paragraph at all.

---

## Recommendation on `markers.any`

**Do not broaden any `markers.any` list on the evidence available here.**

| Case | Recommendation | Basis |
|---|---|---|
| `b-timeout-guard-adjacent` | **No change.** | Ceiling test flips nothing; `markers.all` is the binding constraint; the current list is a deliberate 054a27e tightening whose loosening reintroduces the `-5`-in-`65535` false credit. |
| `b-config-read-adjacent` | **No change.** | 0 misses in 40 runs. Nothing to audit. |
| `b-tail-off-by-one` | **Cannot assess.** | No runs in any result file present in this repository. |
| `b-shared-default-mutation` | **Cannot assess.** | Same. |
| `a-port-range-boundary` | **No change.** | 40/40 caught. |

A note on the two that cannot be assessed, since the brief singles out
`b-tail-off-by-one` as a narrow list. It is not narrow: 12 `any` markers
covering `off-by-one`, `off by one`, `one fewer`, `n-1`, `n - 1`, `drops one`,
`short by one`, `only n-1`, `misses one`, `fewer lines`, `one too few`, and
`regress`. `b-shared-default-mutation` carries 12. `b-timeout-guard-adjacent`'s
5 is the shortest list in the set, but list length is not coverage, and on this
suite its `any` list is provably not the binding constraint.

If the missing suite is recovered, the check that settles it is cheap and should
be run in this order:

1. Count how many of its `missed` verdicts contain the `markers.all` anchor
   (`tailLines`, `defaultOptions`). If the count is zero, the misses are real
   and no marker change is warranted, exactly as here.
2. Only for verdicts that *do* contain the anchor, read the 200-character window
   and ask whether that model's phrasing is covered.
3. Any proposed new discriminator must be checked against the `refuted-other`
   and `missed` sets for accidental substring matches before adoption — `-5`
   inside `65535` is the worked example of how that fails.

---

## What this does and does not establish

**Establishes.** In `replay-gpt56-sol-classAB-r20.json`, the gpt-5.6 class-B
miss rate is real and not a scoring artifact, in either direction. 12.5%
current, 32.5% pre-scope, both as originally scored.

**Does not establish.** Anything about the 21.6% figure. That number comes from
a file this repository does not contain, over a six-case set of which this suite
shares one case. The brief reports a controlled re-run tracking nearer 7%; this
audit neither supports nor contradicts that, and the gap between 21.6% and 7%
remains unexplained by marker vocabulary as far as the available evidence goes.

The one transferable finding is negative and worth carrying: on the single
class-B case common to both suites, the artifact hypothesis is not merely
unsupported but structurally inapplicable, because the misses fail at the
function-name anchor rather than at the discriminator list. If the same holds
for `b-tail-off-by-one` and `b-shared-default-mutation`, the 21.6% is real too.
That is a one-command check once the file is available, and it should be run
before the 21.6% is either retracted or defended.

Per issue #15 comment 5361704033, any conclusion here is scoped to
**adjacent-hunk detection**, not to verification quality in general.

## Reproducing this audit

```bash
node --test tests/bench/scoring.test.mjs
```

60/61 on the machine this audit ran on. The one failure is
`capture keeps provenance and drops duplicates`
(`tests/bench/scoring.test.mjs:479`), which asserts a brief's `source`
provenance equals `result.json` and receives the absolute Windows temp path
instead — a path-basename assumption that does not hold on `win32`. It is
pre-existing, unrelated to this audit, and touches brief capture rather than
the scorer. Every `mentionsDefect` / `scoreVerdict` test passes, which is the
part this audit rests on.

The counterfactual tables were produced by importing `mentionsDefect` from
`tests/bench/lib/scoring.mjs` and re-grading the stored verdicts under
alternative marker lists, without writing to the result file or to any
`case.json`. To test a marker change through the harness instead, copy the
result file first and run `verifier-correctness.mjs rescore` against the copy —
never against `tests/bench/results/replay-gpt56-sol-classAB-r20.json`, which is
committed evidence.
