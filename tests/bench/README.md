# Benchmark harness — verifier correctness slice

Issue #15's first slice. It answers exactly one question:

> **Does the verifier still catch defects it should?**

It exists because [#16](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/16)'s
last open risk is unfalsifiable from real telemetry. The failure mode of
narrowing the verifier's scope is a false `CONFIRMED`, and
`~/.local/share/opencode/opencode.db` records verdicts but never whether a
verdict was right. Ground truth has to be seeded, so it is seeded here.

Everything else in #15 — the three cost axes, OpenRouter pricing snapshots,
subscription quota proxies, `plan-verifier`, dispatch-distribution rollups,
cross-profile comparison — is deferred, not cancelled. The fixture set, the
ground-truth scoring, and the run loop are the parts the full harness reuses.

## Running it

```bash
node --test tests/bench/scoring.test.mjs
```

Offline. No provider request, no quota, no `opencode` binary. Run it first and
after any change to the scorer or the cases — a scorer that mis-grades produces
exactly the finding that would send #16's scope change to a revert.

```bash
node tests/bench/verifier-correctness.mjs validate
```

Builds every case into its two-commit repository and resolves every prompt
variant, without touching a provider.

```bash
node tests/bench/verifier-correctness.mjs plan
```

Prints the matrix, the cost and runtime expectation, and the statistical power
you are about to buy. `run` without `--confirm` prints the same thing and exits
2, so nobody starts a five-hour suite by autocomplete.

```bash
node tests/bench/verifier-correctness.mjs run --confirm
node tests/bench/verifier-correctness.mjs report tests/bench/results/<file>.json
```

Useful flags: `--repeats N`, `--variants current,pre-scope`, `--cases <id,...>`,
`--classes A,B`, `--timeout <minutes>`, `--seed N` (replays a run order),
`--keep-fixtures`, `--out <path>`.

## Replay mode: the same measurement for about a fiftieth of the cost

An in-situ run pays for a whole orchestrated session — planning, tool calls,
integration — and scores exactly one thing: the verifier's first verdict.
Everything else is overhead paid to produce one input string. Replay records
that string and reuses it:

```bash
node tests/bench/verifier-correctness.mjs capture-briefs tests/bench/results/*.json
node tests/bench/verifier-correctness.mjs plan --replay --model openrouter/qwen/qwen3.6-27b --classes A,B --repeats 20
node tests/bench/verifier-correctness.mjs run --confirm --replay --model openrouter/qwen/qwen3.6-27b --classes A,B --repeats 20
```

One run becomes a single verifier session against a brief a real primary wrote.
Measured on `qwen3.6-27b`: **15.6 s and $0.017**, against 9.5 minutes of
subscription quota for the in-situ equivalent on `gpt-5.6`. That is what makes
n=20 per cell unremarkable, and n is the whole problem — at the n=5 the default
suite buys, a null result on class B is not concludable.

### Comparing two seats

`--model` takes a comma-separated list, and each seat becomes an axis of the
same queue alongside cases and variants:

```bash
node tests/bench/verifier-correctness.mjs run --confirm --replay \
  --model bambi/qwen3.8-27b-mtp-pure,openai/gpt-5.6-sol \
  --classes B --variants current --repeats 10
```

This exists because the first cross-seat comparison could not be defended. A
local seat scored 0/60 false `CONFIRMED` on the six class B cases and the
frontier seat scored 11/51, but the two suites ran two days apart at different
harness commits, with different effort tiers — so the case set matched and
nothing else did. One queue holding both seats shares the commit, the case set,
the brief at every repeat index, and whatever the machine was doing at the time;
a seat difference that survives it is a seat difference.

That 11/51 turned out not to be a seat difference at all. Audited, six of the
eleven were detections the marker list did not match, and the suite was 88 valid
runs of 240 planned. The controlled run this section describes puts the two
seats at 6.7% and 0%, Fisher p = 0.14 — no significant separation. Both audits
are in [`docs/issue-15-gpt56-miss-audit.md`](../../docs/issue-15-gpt56-miss-audit.md)
and [`docs/issue-15-seat-comparison-audit.md`](../../docs/issue-15-seat-comparison-audit.md),
and the section below carries what they cost.

`report` adds a **Seat comparison** section for any suite with more than one
seat: Fisher's exact test, two-tailed, on the primary metric, with the raw
counts beside every p-value. Exact rather than chi-square because these tables
have zero cells, and two-tailed because the one-tailed variant would report a
smaller p in whichever direction we were hoping for.

Wall clock is reported per seat and deliberately not folded into the
correctness table. For a local seat the tokens are free and the time is the
whole cost, so the two seats have no common denominator — 2.9 min/run on
`bambi/qwen3.8-27b-mtp-pure` against 0.7 on `openai/gpt-5.6-sol`, for the same
six cases.

Read the power note `plan` prints before choosing `--repeats`. At 60 per seat a
true 0% against a true 20% separates comfortably (p ≈ 0.0001 on the observed
counts); a true 0% against a true 5% does not, so a null seat difference means
"no large difference", never "the same".

### Fixture paths in captured briefs

A captured brief can name the absolute fixture directory of the run that
produced it, and that directory is gone by replay time. Three of the 45 stored
briefs do, unevenly: `b-shared-default-mutation` has two briefs and one carries
a path, so half of that case's replay runs used to open by reconciling a
repository that did not exist.

The path is now rewritten to each run's own fixture, and the rewrite is counted
in the run record and reported. Rewritten rather than stripped — the primary did
tell the verifier where the repository was, so pointing that sentence at a real
directory keeps it true, while deleting it would change what the brief says.

`bambi/qwen3.8-27b-mtp-pure` reconciled the dead path every time and proceeded,
but it spent real effort doing so, and a weaker seat could follow it instead.
That failure would arrive as a verdict rather than as an invalid run, which is
the worst shape a harness artifact can take.

`--replay` needs `--model` and refuses `--primary`, because there is no primary.
The verifier is promoted to a primary agent in a throwaway config, which is how
a role gets run directly at all: the CLI refuses a subagent for `--agent`. The
router is **removed** from that config rather than taught an exception — a bench
mode inside the component whose value is failing closed would be a bypass; a
config without it is not.

**Briefs are captured, never written.** A hand-written brief would make the
result a test of the harness author's prose. Every distinct brief a real run
produced is kept rather than one canonical example, because the primary phrases
the same claim differently every time and collapsing that would make replay look
more consistent than the system it stands in for. A repeat index selects the
same brief for every variant, so the two arms of the A/B answer identical input
and a difference between them cannot be a difference in what they were asked.

### What replay gives up, and when not to use it

It measures the verifier's response to a fixed instruction. It does not measure
the primary's choice of brief, and the Completion Gate wording is part of what
#16 changed — so a replay result is evidence about the verifier prompt and the
model, not about the gate end to end. Keep a handful of in-situ runs alongside
any replay conclusion to confirm the replay is not distorting.

It also only covers cases that have a captured brief. Classes C and D have none
yet, so the documentation-drift case and the false-REFUTED noise floor cannot be
replayed until one in-situ run of each is recorded — two runs, then unlimited
cheap repeats.

## Before you trust a number from a new model

Five mistakes have now been made here. Every one of them changed the answer, and
every one was cheap to catch. Work down this list before quoting any rate.

**Start with the anchor test — it sorts most of it in one pass.** Detection
evaluates `markers.all` first and short-circuits, so for each run scored
`missed`, ask only whether the verdict contains the case's `markers.all` anchor:

- **Absent** — the verifier never named the function. A real miss, and no
  marker change can rescue it. Stop.
- **Present** — `markers.any` or the proximity window is what failed. Read the
  window and judge the phrasing.

Applied to `replay-gpt56-sol-classB-r20`, that single question separated 7
artifacts from 10 real misses without reading a full verdict.

**Marker vocabulary is model-sensitive. Validate it per model.** Detection is
deterministic substring matching against markers declared in the case — there is
no LLM judge here, by design — so a model that describes the same defect in
different words is scored as having missed it. This went wrong three times.
`qwen3.6-27b` describes one seeded defect as `&&` where `||` was meant;
`gpt-5.6` describes the same one as "defective" and describes another as
"regresses" and "suppresses every read/parse error" where the markers expected
"swallow" and "ENOENT". Nine `gpt-5.6` runs were graded as misses that were not.

The check takes minutes. Pull every verdict whose text names the adjacent
function, read the sentence around each mention, and confirm the marker list
covers that model's phrasing:

```bash
node tests/bench/verifier-correctness.mjs rescore tests/bench/results/<file>.json
```

`rescore` re-grades stored transcripts, so a marker fix costs a re-read rather
than a re-run — which is the reason every verdict is retained in full. Check the
correction in both directions: a broadened marker that flips runs *toward* your
preferred conclusion deserves more suspicion than one that flips them away.

Two shapes recur and neither is covered by a longer word list:

- **Demonstrative phrasing.** Every marker on `b-tail-off-by-one` names the bug
  class — `off-by-one`, `one fewer`, `n-1`. `gpt-5.6` describes that defect by
  showing an input and an output: *"`tailLines("a\nb\nc\nd", 2)` now returns
  `"d"` instead of `"c\nd"`"*. Twelve markers credited 2 of 10 detecting runs,
  and both credits came from the incidental word "regress" in *"an unrelated
  regression"*. A discriminator that only fires on a bug-class noun will miss any
  seat that argues from behaviour.
- **Formatting.** `b-cap-boundary-strict` carries the marker `<= to <`, written
  for exactly the sentence one run produced — and missed it, because the run
  wrote ``from `<=` to `<` ``. Backticks are now stripped before matching.

**A discriminator can also be present and simply too far away.** The proximity
window was 200 characters, justified as a plateau because all 120 runs of the
`gpt-5.6` class-A/B suite graded identically at 200 and 400. That plateau was a
property of one seat's prose. `gpt-5.6` writes 300–700 character verdicts;
`bambi/qwen3.8-27b-mtp-pure` writes 2,700–3,200 with structured observation
paragraphs that separate the function name from the diagnosis. Both of that
seat's misses in the controlled suite had the marker present at 224–250
characters — one of them reading *"An off-by-one regression with its coverage
deleted"* — and were scored as non-detections. The window is now 400, which is a
floor rather than a settled plateau: `replay-qwen3.6-27b-classAB-r20` moves three
further runs at 800 and a fourth at 2000, and those want hand-reading first,
because a wider window is exactly the over-crediting the rule exists to prevent.

**Never ship a correction that fixes one arm of a comparison and not the other.**
This is the newest mistake and the most dangerous, because the result looks
better rather than broken. Widening the window and stripping backticks fixed
*both* of the local seat's artifacts and only *one* of the frontier seat's five —
the other four being vocabulary-shaped and deliberately left pending validation.
The stored summary moved from p = 0.14 to p = 0.0195, crossing into significance
in the flattering direction, on the asymmetry alone. If a fix reaches one seat's
failure mode and not another's, either finish it or annotate the result so the
partial state cannot be quoted.

**Do not report a direction from a partial suite.** This was done three times
and was wrong every time. At 40 of 120 runs one comparison looked like 8 misses
in 12 against 4 in 13; the finished suite was 40% against 43% with p = 1.00, and
the nominal direction had flipped. The third was `replay-gpt56-sol-classB-r20`,
reported at 11/51 from a suite that was 88 valid runs of 240 with cells between
4 and 11 of 20 — and the incompleteness was not a choice. The suite crashed at
run 88 because `--resume` was passed without a path and swallowed the following
`--timeout` flag as its value; the retyped command resumed with a 4-minute
per-run cap where the original had 20, which is why every invalid run in that
file is a timeout. A missing option value is now a hard error, but **check
`validRuns` against `repeats × cells` before quoting anything** — a truncated
suite still writes a complete-looking summary block. Cells fill unevenly because
the queue is randomized, so a half-finished suite is a biased sample, not a small
one. Wait
for the suite, then run the paired test.

## Choosing which model is measured

`--preset` and `--primary` decide that, and `plan` prints the resolution before
anything runs:

```bash
node tests/bench/verifier-correctness.mjs plan \
  --preset antigravity --primary google/antigravity-gemini-3.1-pro
```

The router selects a profile from the primary model alone, and the profile binds
all eight workers — so `--primary` is what puts a given model in the verifier
seat. Without it the preset's own default primary applies, which under
`antigravity` is Claude Opus with a Claude Sonnet verifier, not Gemini. An
unsupported primary is rejected at parse time rather than becoming a fail-closed
router refusal on every run of an hours-long queue.

**A result is scoped to the model that held the verifier seat.** The prompt
under test is shared across profiles, but a verdict is the model's: a class B
result on Gemini says the scope change does not blind *that* verifier, and does
not transfer to `gpt-5.6`, which is what #16's telemetry and its revert decision
are about. `report` restates the profile above every table for this reason.

The runtime estimate is a `chatgpt` measurement and is not evidence about any
other routing; `plan` says so when the two differ.

## What one run is

One complete `pilotfish` session against the live subscription, inside
`tests/integration/fixture.mjs` — the existing integration fixture, extended
rather than replaced. Nothing outside the fixture root is written and
credentials are symlinked, not copied.

The primary is handed a seeded repository and a claim about its most recent
commit, and asked to run its completion gate. The verdict its **own** verifier
returns is read out of the fixture's private `opencode.db` and scored against
ground truth.

**In situ, deliberately.** #15 flags that isolating one role needs either public
per-profile shims or a router bench mode, and that a bench mode is a bypass in
the component whose entire value is failing closed. Neither is built here. The
verifier is measured exactly as the primary dispatches it, scope instruction and
all, which is the thing #16 changed. Production routing, permissions, and the
authorization protocol are untouched. (The CLI's refusal to accept a subagent
for `--agent` was reconfirmed while building this, so the obstacle #15 describes
is real and this is the way around it.)

The one deliberate deviation from a natural request is the instruction to run
the completion gate. Without it a run where the primary judges the change small
enough to skip verification yields no verdict at all. The brief forces the gate
to fire; it says nothing about how to verify, which files matter, or that
anything is wrong.

## Defect classes

| class | where the defect is | what it measures |
|---|---|---|
| A | inside the stated claim | control — a miss here means the gate is broken outright, not merely narrowed |
| B | in a file the change touched, outside the claim | the risk zone: precisely what "don't audit the surrounding code" tells it to skip |
| B2 | the same defect, in a realistic commit | whether B measured defect-finding or only diff-reading |
| C | documentation drift on a trivial edit | the class the #16 historical sample proved it catches today |
| D | no defect | false-REFUTED noise floor |

### Why B2 exists

Every class B fixture is a 10–19 line file with exactly two exported functions,
one claimed and one defective, so its commit is a **two-hunk diff**. Detection
reduces to reading `git show HEAD` and noticing that a second hunk exists. That
is a diff-reading task, and it explains 60/60 detection with live probes better
than any claim about model capability.

Against the 44 historical `REFUTED` verifier sessions, that shape — a one-token
operator mutation in a sibling function, decidable by calling it twice — is
about **5% of real defects**. The rest are adversarial input (34%), host or
external contract mismatches (16%), documentation contradicting code (16%),
races (14%), and lifecycle or spec problems. Real refutations cite a mean of 1.3
distinct files, and 41% of them note that the test suite passed anyway.

B2 seeds the **byte-identical mutation with identical markers** into a commit
that also carries four to six legitimate changes across three files: a helper
extracted that has its own reason to touch the defective function, a rename
propagated through call sites, a test added for the claimed function, a
documentation table brought up to date. The defect becomes one hunk among
several instead of one of two.

Note what B2 does *not* do. It does not merely grow the module — a 200-line file
whose commit touches two functions still produces a two-hunk diff.
Conspicuousness is a property of the **commit**, not of the file. Two tests
enforce both halves of the design: every B2 commit must touch 3+ files with 3+
hunks, and every B2 case's markers must match its class B counterpart exactly,
so a difference between the tiers is a difference in the commit rather than in
the defect.

Read the result this way. If B2 detection stays near 100%, the calibration
worry is answered and every existing class B number stands. If it collapses,
class B measured diff-reading and every conclusion drawn from it — including any
seat comparison — is scoped to that, not to verification quality.

B2 has **no captured briefs**, so it cannot be replayed until one in-situ run of
each case is recorded. Six in-situ runs, then unlimited cheap repeats:

```bash
node tests/bench/verifier-correctness.mjs run --confirm --classes B2 --variants current --repeats 1
node tests/bench/verifier-correctness.mjs capture-briefs tests/bench/results/<that file>.json
node tests/bench/verifier-correctness.mjs run --confirm --replay \
  --model bambi/qwen3.8-27b-mtp-pure,openai/gpt-5.6-sol \
  --classes B,B2 --variants current --repeats 10
```

That last command is the experiment: both tiers, both seats, one randomized
queue, so the B-versus-B2 difference and the seat difference are measured under
identical conditions.

**The prediction under test is that A and D hold while B degrades.** If B
degrades materially against the `9332e48~1` prompt, revert #16's scope change.
If A degrades, something larger is wrong.

Cases live in `cases/<id>/` as `case.json` plus `base/` and `change/` trees. The
harness builds them into a two-commit git repository at run time, so `git show
HEAD` is the change the claim is about — which is the only way class B exists at
all, since it is defined by being *in the diff* but *outside the claim*.

## How a verdict is scored

Deterministically. No LLM judge anywhere in this slice.

The verdict is parsed from the first line that leads with `CONFIRMED` or
`REFUTED`, tolerating the markdown models actually emit, falling back to
first-occurrence-anywhere. Leading-line matching is what stops a verifier
quoting its brief's vocabulary from outvoting its own answer — the #16 sample
had 7 of 62 sessions containing both words.

Detection is substring matching against markers declared in the case. No
discriminator may appear in the brief, and a test enforces that.

Seeded-defect cases score into four outcomes, not two:

| outcome | verdict | defect named | reading |
|---|---|---|---|
| `caught` | REFUTED | yes | the gate stopped the change on the seeded defect |
| `observed` | CONFIRMED | yes | reported as an observation alongside the verdict |
| `missed` | CONFIRMED | no | **false CONFIRMED — the primary metric** |
| `refuted-other` | REFUTED | no | stopped, but for something else |

`observed` is split out because #16's change does not tell the verifier to
ignore an adjacent defect; it tells it to report one below the verdict instead
of refuting on it. Folding `observed` into `missed` would score the design's
intended behaviour as the failure it was built to avoid. Folding it into
`caught` would hide a gate that no longer stops anything. Both readings are
wrong, so both counts are reported.

This is not hypothetical. The first live class B run under the current prompt
returned `CONFIRMED` on the `parsePort` claim, then: *"Separate observation:
HEAD also changes `parseTimeout`; its `&&` condition accepts invalid values such
as `-1`, `1.5`, and `http`. This is outside the stated claim."* It found the
seeded defect and did not refute on it. A binary false-CONFIRMED metric would
have scored that as a miss and argued for reverting #16.

Every verdict is retained in full in the result file. `observed` is the one
outcome substring matching can plausibly over-count — a verifier can name the
right identifier while misreading the code — so those cells are worth reading
by hand before acting on them.

Only the **first** verifier dispatch in a run is scored. Later ones are
re-verification rounds; chain depth is recorded because #16's revised criteria
are stated against it, but it does not vote.

## Confounds, and what is done about each

- **Quota contamination.** The suite burns the same subscription it measures, so
  a variant run late looks worse for reasons that are not its prompt. Run order
  is randomized across cases, variants, and repeats from a recorded seed.
- **Throttling and quota exhaustion** are logged, marked invalid, excluded from
  every rate, and re-queued up to `--retry-invalid` times. They are not data.
- **Runs where the gate never fired** are reported separately and excluded. That
  is a finding about the primary, not evidence about the verifier.
- **`AGENTS.md`.** The fixture inherits the real global config, so the 2,053-word
  `~/.config/opencode/AGENTS.md` (#16 P6) is injected into all nine agents, as it
  is in real use. That is in-situ fidelity, but it is also user configuration
  that changes without notice, so its digest is recorded with every result.
- **Host shell cwd resets.** OpenCode's persistent shell can reset its working
  directory mid-run — the notice appears 4 times across the 351 sessions in the
  real database. A probe confirmed `pwd` resolves inside the fixture project on
  a normal run, so affected runs are flagged for audit rather than discarded;
  dropping them would bias the sample toward short sessions. The sharper check
  runs alongside it: the harness's own repository path must never appear
  anywhere in a run's transcript.

## Cost, runtime, and what the numbers can support

Read `plan` before starting. The default suite is 5 cases × 2 variants × 5
repeats = **50 sequential orchestrated runs**, consuming real subscription quota
throughout.

How long that takes is a property of the routing, not of the harness, so `plan`
quotes a per-profile figure and says when a routing has never been measured. The
two measured so far are 19× apart: `openai/gpt-5.6-sol` at 9.5 min/run puts a
default suite near **8 hours**, while `google/antigravity-gemini-3.1-pro` at
0.5 min/run puts the same suite near **25 minutes**. Neither is a distribution —
each is one run, and a `REFUTED` verdict starts a re-verification round that
neither measured.

Five repeats is the floor #15 sets, not a comfortable sample. At n=5, a 0/5
result has a 95% upper bound near 45% — so *"B held"* is not concludable from
one cell, while a large degradation is visible. Use `--repeats 10` or more
before acting on a null result. Every rate is reported with its raw counts and a
Wilson 95% interval for this reason.

## The database rule

Fixture runs write to their own isolated `opencode.db` inside the fixture root.
**Never pool that with `~/.local/share/opencode/opencode.db`.** That database is
#16's measurement sample, which starts 2026-08-10; benchmark runs are not part
of it and would corrupt it. The harness has no code path that can open it, and
`scoring.test.mjs` asserts as much.
