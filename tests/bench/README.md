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
| C | documentation drift on a trivial edit | the class the #16 historical sample proved it catches today |
| D | no defect | false-REFUTED noise floor |

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
