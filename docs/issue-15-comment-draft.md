<!--
DRAFT for posting to issue #15. Not documentation — delete this file once posted.
Everything in it is sourced from docs/issue-15-gpt56-miss-audit.md,
docs/issue-15-seat-comparison-audit.md and docs/issue-15-b2-runbook.md.
-->

## Withdrawing the seat inversion: 21.6% was not real, and the controlled run does not separate the seats

[The comment above](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361389362)
reported the frontier seat at 11/51 = 21.6% false `CONFIRMED` against the local
seat's 0/60, and called it an inversion of the roadmap's founding assumption.
**Both halves of that comparison have now been audited by hand. The headline does
not survive and should be treated as withdrawn.**

### What the 21.6% actually was

Two independent defects, compounding.

**Six of the eleven misses were detections.** The verifier found the seeded
defect, named the function, quoted the exact wrong output and flagged it as
outside the claim — and was scored as having missed it, because the marker list
for `b-tail-off-by-one` names the *bug class* (`off-by-one`, `one fewer`, `n-1`)
while `gpt-5.6` describes the defect *demonstratively*:

> "The commit also changes `tailLines` and removes its test. `tailLines("a\nb\nc\nd", 2)` now returns `"d"` instead of `"c\nd"`."

All twelve markers credited 2 of 10 detecting runs on that case, and both credits
came from the incidental word "regress" in *"an unrelated regression"*.

**The suite was 37% complete.** 88 valid runs of 240 planned, cells between 4 and
11 of 20. And it did not stop by choice: it crashed at run 88 because `--resume`
was passed without a path and silently swallowed the following `--timeout` flag
as its value, dying on `readFileSync("--timeout")`. The retyped command resumed
with a 4-minute per-run cap where the original had 20 — which is why every
invalid run in that file is a timeout.

Corrected, that cell is **5/51 = 9.8%**.

### The controlled two-seat run

`seat-comparison-final.json` — one suite, one commit, both seats, six class-B
cases, `current` variant, 10 repeats.

| Seat | n | Originally scored | Corrected | Wilson 95% |
|---|---:|---:|---:|---|
| `openai/gpt-5.6-sol` | 60 | 9 = 15.0% | **5 = 8.3%** | 3.6 – 18.1% |
| `bambi/qwen3.8-27b-mtp-pure` | 44 | 2 = 4.5% | **0 = 0.0%** | 0.0 – 8.0% |

**Fisher exact, two-tailed: p = 0.07.** As originally scored it was p = 0.11.
Neither supports the claim that the local seat beats the frontier one.

The frontier number's whole arc: **21.6% → 9.8% → 8.3%**, converging on what the
re-run was already tracking.

The local seat's 0/44 is a real zero and it remains the better of the two
nominally. But 0/44 carries an 8.0% upper bound against the frontier's 8.3%, so
the intervals overlap almost entirely. The defensible claim is **"the local seat
does not lose"** — which is enough to keep the local-worker profile viable on the
metric #16 was blocked on, and not enough for the inversion.

### The audit found a second artifact mechanism, and it hit the other seat

Worth stating because it is what makes the corrected comparison trustworthy in
both directions.

The frontier seat's artifacts were **vocabulary**. The local seat's were the
**proximity window**: both of its misses in the whole suite had the discriminator
*present*, merely 224–250 characters from the anchor against a 200-character
window. One of them reads *"An off-by-one regression with its coverage deleted"*
and was scored as never having noticed the defect.

The window was defended in the scorer as a plateau, because all 120 runs of the
`gpt-5.6` class-A/B suite graded identically at 200 and 400. That plateau was a
property of one seat's prose: `gpt-5.6` writes 300–700 character verdicts, the
local seat writes 2,700–3,200 with structured observation paragraphs that
separate the function name from the diagnosis.

### One trap, recorded because it nearly shipped

Fixing the window and the backticks first corrected **both** of the local seat's
artifacts and only **one** of the frontier seat's five. The stored summary moved
from p = 0.14 to **p = 0.0195** — into significance, in the flattering direction
— on that asymmetry alone. It was a partial correction, not a result.

`tests/bench/README.md` now carries this as a named mistake: never ship a
correction that fixes one arm of a comparison and not the other.

### What changed in the harness

Scorer, all retroactive via `rescore`:

- Proximity window 200 → **400**. Settled in both directions: four `qwen3.6-27b`
  runs move at 800 and all four were hand-read as genuine misses, credited only
  by the `||` in `parsePort`'s own guard 700+ characters away — the
  shared-vocabulary false credit `054a27e` removed, arriving via proximity. 800
  is wrong, not merely generous.
- Backticks stripped before matching. `b-cap-boundary-strict`'s `<= to <` marker
  was written for exactly the sentence one run produced and missed it on
  formatting alone.
- `b-tail-off-by-one` graded on a **value** rather than vocabulary. The quoted
  token `"c\nd"` never occurs in the input literal `"a\nb\nc\nd"`, so producing
  it requires having determined what the function should return. It covers 27 of
  27 valid runs of that case across every stored suite.

Harness:

- A missing option value is now a hard error instead of swallowing the next flag.
- A timed-out session that leaves the brief as its last text part no longer has
  that brief graded as a verdict — it parses, because the brief itself says to
  return `CONFIRMED` or `REFUTED`.
- Replay now refuses up front when a selected case has no captured brief, and
  `plan` scopes its brief counts to the suite's own cases.

After all of it, the scorer reproduces the hand audits run for run — the
predecessor suite grades 5/51 = 9.8% and 5/37 = 13.5%, exactly the hand-derived
figures.

### What is still open

- **The local arm is 44 of 60.** The frontier arm is complete. Finishing it is
  the cheapest remaining improvement to the comparison.
- **That suite ran as two concurrent halves split by seat**, merged — not one
  interleaved queue. Sound only because the endpoints are independent, but it
  meets three of the four conditions the earlier comment set, not four.
- **B2 has not run, and it is the experiment that matters.** Everything measured
  so far is adjacent-hunk detection on a two-hunk diff, which is ~5% of the real
  defect sample. All six B2 cases build, the diff shape is right (3 files, 7–13
  hunks against class B's 2 files, 3–6), and every fixture suite stays green with
  the defect present. The one blocker is captured briefs: B2 needs its own,
  because its claim also describes the legitimate changes, so B's cannot be
  reused. `docs/issue-15-b2-runbook.md` has the two-step sequence and costs
  (~1.0h in-situ capture, then ~2.9–3.6h for the 120-run suite).

### Consequence for #13 and #32

The trigger note above said to revisit filing the upstream per-call model
override "if the false-`CONFIRMED` result here comes back good enough to continue
at full scope." It did — 0/44 on a free local seat, with the frontier seat
statistically indistinguishable — so that trigger fires. But the justification is
"local verification is viable", not "local verification is better", and the
upstream request should be written against the former.

Scoped, per the calibration comment: all of this is about **adjacent-hunk
detection**, not verification quality in general. B2 is what widens it.
