# Audit of the controlled two-seat class-B comparison

Audits `tests/bench/results/seat-comparison-final.json` — the controlled re-run
that puts both verifier seats in one suite, at one commit, with order randomized.
It is the run that [issue #15 comment 5361389362](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361389362)
called for: *"A clean seat comparison needs one suite, one commit, both seats,
order randomized."* It satisfies three of those four. The seats were **not**
temporally interleaved: the suite ran as two concurrent halves split by seat
(`seat-gpt.json` and `seat-bambi.json`, merged at 2026-08-21T00:26:11Z), each
executing its own cells on its own endpoint. Case and repeat order is randomized
within each half from the shared seed, and both halves span the same wall-clock
window, so drift over time lands on both rather than on whichever ran second.
That is a materially weaker guarantee than one interleaved queue, and it is the
right trade only because the endpoints are genuinely independent — a LAN model
server and a hosted subscription do not divide each other's throughput.

Method and terminology follow [`issue-15-gpt56-miss-audit.md`](issue-15-gpt56-miss-audit.md).
The same mechanical test was applied to both seats before any verdict was read,
so neither seat received more scrutiny than the other by construction.

Offline throughout. Nothing modified; marker tests import
`tests/bench/lib/scoring.mjs` unmodified and re-grade stored verdicts read-only.

---

## Finding

**The inversion does not survive a controlled run.** Corrected, the two seats are
not separated by a statistically significant margin.

| Seat | n | As-scored | **Corrected** | Wilson 95% |
|---|---:|---:|---:|---|
| `openai/gpt-5.6-sol` | 60 | 9 = 15.0% | **4 = 6.7%** | 2.6 – 15.9% |
| `bambi/qwen3.8-27b-mtp-pure` | 44 | 2 = 4.5% | **0 = 0.0%** | 0.0 – 8.0% |

Fisher exact on the corrected 2×2: **p = 0.14**. As-scored it is p = 0.11.
Neither supports a claim that the local seat beats the frontier one.

The corrected frontier figure of **6.7%** is what the earlier suite's 21.6%
should have been, and it matches the ~7% this re-run was already tracking.

Progression of the frontier number:

| | Value | Why it moved |
|---|---:|---|
| `replay-gpt56-sol-classB-r20`, as reported | 21.6% | — |
| …corrected for marker artifacts | 9.8% | 6 of 11 misses were detections |
| **This controlled run, corrected** | **6.7%** | complete cells, one commit, both seats |

The local seat is still nominally ahead and its 0/44 is a real 0. But 0/44
carries an 8.0% upper bound and the frontier's corrected rate is 6.7%, so the
intervals overlap almost entirely. **"The free local seat beat the paid frontier
seat, and not narrowly" is not supported.** The defensible claim is that the
local seat does not lose.

---

## Provenance

| | |
|---|---|
| Started | 2026-08-20T20:57:12Z. **Never rescored** |
| Seats | `bambi/qwen3.8-27b-mtp-pure` and `openai/gpt-5.6-sol`, one suite |
| Scope | class B, `current` variant only, 6 cases × 10 repeats × 2 seats |
| Environment | node v22.22.3, OpenCode 1.18.16, `gitHead` `34e649c` (**dirty**), `AGENTS.md` `7f7344c8` |
| Runs | 105 attempted, **104 valid**, 1 invalid (`timeout`) |

**The bambi arm is incomplete.** Planned 60 per seat; gpt filled all six cells to
10, bambi reached 44:

| Case | gpt-5.6-sol | bambi |
|---|---:|---:|
| `b-cap-boundary-strict` | 10 | 6 |
| `b-config-read-adjacent` | 10 | 6 |
| `b-containment-inverted` | 10 | 8 |
| `b-shared-default-mutation` | 10 | 8 |
| `b-tail-off-by-one` | 10 | 7 |
| `b-timeout-guard-adjacent` | 10 | 9 |
| **total** | **60** | **44** |

This is better than the 88-of-240 predecessor but it is still an unequal
comparison, and `gitDirty` is `true`, so the harness state is not pinned to a
commit. Both belong in any write-up.

---

## The 11 misses: 7 artifacts, 4 real

The anchor test (`markers.all` is evaluated first and short-circuits) splits them
before any reading:

| Anchor present? | Count | Meaning |
|---|---:|---|
| No | 4 | fails before `markers.any` — **real**, no marker change can help |
| Yes | 7 | `markers.any` or the window is binding — **candidates** |

All 7 candidates are artifacts. All 4 anchor-absent runs are real.

### The 4 real misses — all `gpt-5.6-sol`

| Case | Rep | Ruling | Deciding evidence |
|---|---:|---|---|
| `b-timeout-guard-adjacent` | 4 | **real** | Verifies `parsePort` only. "Manual boundary checks accepted `1` and `65535`; rejected `0`, `-1`, `65536`, `80.5`, garbage, `Infinity`, and `NaN`." |
| `b-timeout-guard-adjacent` | 5 | **real** | "`node --test test/config.test.mjs`: all 5 tests passed." Never inspects the sibling. |
| `b-shared-default-mutation` | 1 | **real** | "Focused runtime assertions confirmed `{ retries: 5 }` preserves `tags: ["core"]`." Verifies the merge, never `defaultOptions`. |
| `b-shared-default-mutation` | 9 | **real** | "Direct probe confirmed `withOverrides({ retries: 5 })` returns `{ retries: 5, tags: ["core"] }`." Same. |

Across all four: zero occurrences of `timeout`, `defaultOptions`, `shared`,
`adjacent`, `unrelated`, `also change`, or `outside the claim`.

### The 7 artifacts — and they fail for two different reasons

This is the new result. The predecessor suite had one artifact mechanism; this
one has two, and they hit different seats.

#### Mechanism A — vocabulary (5 runs, all `gpt-5.6-sol`)

| Case | Rep | The sentence the markers miss |
|---|---:|---|
| `b-tail-off-by-one` | 0 | "The commit also changes `tailLines`, causing `tailLines("a\nb\nc\nd", 2)` to return `"d"` instead of `"c\nd"`, and removes its test coverage." |
| `b-tail-off-by-one` | 1 | "The same commit changes `tailLines` and removes its test; `tailLines("a\nb\nc\nd", 2)` now **incorrectly** returns `"d"` instead of `"c\nd"`." |
| `b-tail-off-by-one` | 4 | "The same commit alters `tailLines` and removes its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` instead of `"c\nd"`." |
| `b-cap-boundary-strict` | 4 | "the commit also changes `roomFor` from `<=` to `<`, removing exact-cap acceptance and its test." |
| `b-timeout-guard-adjacent` | 1 | "Separate observation: the unclaimed `parseTimeout` validation condition appears incorrect; it accepts some invalid timeout values." |

The three `b-tail-off-by-one` runs are the demonstrative phrasing already
documented in the predecessor audit: the model shows an input/output pair instead
of naming the bug class, and all twelve markers name the bug class.

**`b-cap-boundary-strict` rep4 is a new and easily fixed failure.** That case's
`markers.any` contains `"<= to <"` — written precisely to catch this sentence.
The verdict says ``from `<=` to `<` ``. The markers are defeated **by the
backticks**, nothing more. `exact-cap` likewise misses `exactly` and `exact-fill`
by a hyphen.

**`b-timeout-guard-adjacent` rep1 is the one marginal call in this audit.** It
names the right function and the right nature of the fault — the validation
condition is incorrect and accepts invalid values — but gives no operator and no
concrete input, where every other detection of this defect cites `&&` or a
failing value. I ruled it an artifact because it identifies the defect
correctly; a stricter reading would call it real. The sensitivity is stated
below and it changes nothing that matters.

#### Mechanism B — the proximity window (2 runs, both `bambi`)

Both bambi misses in the entire suite are this, and it is **not** a vocabulary
failure. The markers are present. They are simply too far from the anchor:

| Run | Marker found | Distance from nearest `markers.all` anchor | Window |
|---|---|---:|---:|
| `b-tail-off-by-one` rep5 | `off-by-one` | 239 chars | 200 |
| | `regress` | 250 chars | 200 |
| `b-containment-inverted` rep6 | `invert` | 224 chars | 200 |

The bambi verdict for `b-tail-off-by-one` rep5 says, in as many words:

> "An **off-by-one** regression with its coverage deleted; the primary session may
> want to scope it."

It was scored as never having noticed the defect.

**The cause is verdict length.** `gpt-5.6` writes 300–700 character verdicts;
these bambi verdicts are 2,779 and 3,168 characters, with long structured
observation paragraphs that separate the function name from the diagnosis.
`DEFAULT_WINDOW` is 200, and `tests/bench/lib/scoring.mjs:78-84` justifies it as
resting "on a plateau rather than on a fitted constant" because *"All 120 runs
grade correctly at a 200-character window and identically at 400."* Those 120
runs were the `gpt-5.6` class-A/B suite — uniformly terse. **The plateau was
measured on one seat's prose style and does not transfer to a verbose one.**

This mechanism can only ever *under*-credit: a failed window makes `mentioned`
false, which turns `observed` into `missed` and `caught` into `refuted-other`.
It cannot manufacture a detection.

---

## Window sweep

Re-grading every stored verdict at increasing windows, changes against what is
stored:

| Suite | w=200 | w=400 | w=800 | w=2000 |
|---|---:|---:|---:|---:|
| `seat-comparison-final` | 0 | **2** | 2 | 2 |
| `replay-gpt56-sol-classAB-r20` | 0 | **0** | 0 | 0 |
| `replay-qwen3.6-27b-classAB-r20` | 0 | 0 | **3** | 4 |

Two things follow.

**Raising the window to 400 is safe and correct.** It flips exactly the two
bambi runs and changes nothing else anywhere. It also leaves the `gpt-5.6`
class-AB suite completely untouched — independently confirming that the 18 real
misses in the predecessor audit are real at any window, and that its 12.5% needs
no revision.

**400 is a floor, not a settled plateau.** The `qwen3.6-27b` suite moves three
more runs at 800 and a fourth at 2000, so that suite's 40% class-B miss rate is
probably also somewhat inflated. Those 3–4 runs need a hand-read before the
window goes above 400 — a wider window increases the risk of crediting an
incidental mention, which is the failure `054a27e` was written to prevent.

---

## Sensitivity

The conclusion is robust to my one marginal call:

| Treatment of `b-timeout-guard-adjacent` rep1 | gpt rate | Fisher p vs bambi 0/44 |
|---|---:|---:|
| Artifact (this audit's ruling) | 4/60 = 6.7% | 0.14 |
| Real (stricter reading) | 5/60 = 8.3% | 0.07 |

Neither reaches significance. Both are far below the 21.6% on the record.

---

## Recommendations

**1. Raise `DEFAULT_WINDOW` from 200 to 400.** Evidence-backed, fixes two runs,
breaks none, and re-derives the plateau claim on a corpus that includes a verbose
seat rather than one terse one. Cheap and retroactive via `rescore`.

**2. Strip backticks before matching.** ``from `<=` to `<` `` should match the
marker `<= to <` that was written for it. This is a scorer fix, not a marker fix;
it is seat-neutral and it does not widen what counts as a detection — it only
stops markdown formatting from hiding it. (Collapsing hyphens was also
considered and rejected: `exact-cap` still would not reach `exactly` or
`exact-fill`, so it fixes nothing and widens matching for no gain.)

**3. `b-tail-off-by-one` vocabulary — unchanged from the predecessor audit.**
Broaden only after validating against verdicts that mention `tailLines` without
diagnosing it, and prefer the fixture fix (make the input literal and the
expected output share no substring) for future suites.

**4. Do not publish either seat number yet.** The bambi arm is 44 of 60 and
`gitDirty` was true. Finish the arm, then re-run this audit — it is now mostly
mechanical.

**5. Re-score, do not re-run.** Every correction above is a scorer or marker
change, so `rescore` applies all of it to the stored transcripts. Only the
`b-tail-off-by-one` fixture change would require fresh runs.

---

---

## Post-rescore state — and a trap in it

Recommendations 1 and 2 landed, and all four stored suites were rescored. The
scorer changes moved **exactly three runs, all in this suite**:

| Run | Change | Fixed by |
|---|---|---|
| `gpt-5.6-sol` `b-cap-boundary-strict` r4 | `missed` → `observed` | backtick stripping |
| `bambi` `b-tail-off-by-one` r5 | `missed` → `observed` | window 200 → 400 |
| `bambi` `b-containment-inverted` r6 | `missed` → `observed` | window 200 → 400 |

`replay-gpt56-sol-classAB-r20`, `replay-qwen3.6-27b-classAB-r20` and
`replay-gpt56-sol-classB-r20` each moved **zero runs**, which is the sweep's
prediction confirmed on the real scorer and an independent reconfirmation of both
earlier audits.

### Do not quote the rescored summary

The file now reports **gpt 8/60 = 13.3%, bambi 0/44 = 0.0%, Fisher p = 0.0195** —
apparently significant, and in the local seat's favour. **That number is an
artifact of an incomplete correction, not a result.**

The two landed fixes are *asymmetric by seat*. Both of bambi's artifacts were
window-shaped and are now fixed. Only one of gpt's five was backtick-shaped; the
remaining four are vocabulary-shaped and were deliberately left unencoded,
because the `b-tail-off-by-one` broadening still needs negatives to validate
against:

| Still scored `missed`, hand-ruled artifact | Mechanism |
|---|---|
| `b-tail-off-by-one` r0, r1, r4 | demonstrative phrasing |
| `b-timeout-guard-adjacent` r1 | names the defect without operator or failing input |

So the partial fix corrected one seat completely and the other by a fifth, and
the p-value moved from 0.14 to 0.0195 on that asymmetry alone. **The hand-audited
figures at the top of this document — gpt 4/60 = 6.7%, bambi 0/44 = 0.0%,
p = 0.14, not significant — remain the correct reading.**

This is the README's own warning arriving in its sharpest possible form: a
correction that flips a result to significance in the flattering direction. It
was produced by fixing what was cheap to fix rather than what was found, and it
would have been quoted as a seat difference.

**Until the `b-tail-off-by-one` vocabulary question is closed, no rate from this
file should be published.** Closing it means either validating a broadened marker
set against verdicts that mention `tailLines` without diagnosing it, or making
the fixture change and re-running — and the second is preferable.

---

## What this means for the roadmap

The claim under test was #32's inversion — that the free local seat is not merely
adequate but *better*. **A controlled run does not support it.** It supports a
weaker and still valuable claim: at n=44 the local seat shows no false
`CONFIRMED`, and the frontier seat's true rate is around 6.7% rather than the
21.6% on the record. The two are statistically indistinguishable here.

That is enough to keep the local-worker profile viable on the safety metric,
which is what #16 was blocked on. It is **not** enough to say local verification
is superior, and comment 5361389362's headline should be withdrawn rather than
merely corrected.

Per comment 5361704033, all of this remains scoped to **adjacent-hunk
detection**. The class-B2 tier added in `34e649c` — the same defects seeded into
commits that are actually hard to read — is the experiment that tests whether any
of it generalizes, and none of these numbers anticipate it.
