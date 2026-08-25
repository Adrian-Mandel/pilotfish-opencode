# Handoff: run the B2 suite and answer whether class B measured anything

Written 2026-08-21 for a fresh session. Everything offline is done; what remains
is one suite, its analysis, and posting the result.

## The one question

Class B says the free local seat has a 0% false-`CONFIRMED` rate and the paid
frontier seat 6.7% (p = 0.12, not significant — figures as of the 2026-08-23
update at the bottom of this document, which supersedes the 8.3%/p = 0.07 this
line used to carry). **B2 decides whether that means anything.**

Every class B fixture is a 10–19 line file with two exported functions, so its
commit is a 2-file, 2–3 hunk diff and finding the defect reduces to noticing
there is an unclaimed hunk. Against the 44 historical `REFUTED` sessions that
shape is ~5% of real defects. B2 seeds the byte-identical mutation, with
byte-identical markers and a byte-identical claim, into a 3-file, 3–5 hunk
commit where four other changes are legitimate and unmentioned.

- If B2 detection holds near 100%, class B measured defect-finding and every
  stored number stands.
- If it collapses, class B measured diff-reading and every conclusion drawn from
  it — including the seat comparison — is scoped to that.

## State

Branch `bench/issue-15-seat-comparison`. `node --test tests/bench/scoring.test.mjs`
is 80 tests green.

Done: seat axis (`--model a,b`), `--only-seat` + `merge` for splitting a suite
across endpoints, replay fixture-path normalisation, Fisher exact seat
comparison, class B2 (6 cases), primary-aftermath capture, cache-token capture.

Running or just finished when this was written:
- `results/seat-bambi-complete.json` — bambi's class B arm, 44 → 60. Free.
- `results/b2-insitu-briefs.json` — the B2 brief capture. Paid, ~9 min.

## Two mistakes already made here. Do not repeat either.

**1. The B2 claims used to enumerate the commit's other changes.** The first
capture refuted 4 of 4, and a verdict said why: *"The negative-count clamp,
API-key redaction, README updates, and focused tests otherwise behaved as
claimed."* The verifier ticked off the inventory and named what was left. That
made B2 easier than B while being built to be harder. Claims are now identical
to their class B counterparts and a test enforces it. The void capture is kept
as `b2-insitu-briefs-VOID-enumerating-claims.json`.

**2. A correction that fixed one arm of a comparison and not the other** moved
the stored summary to p = 0.0195 — significant, flattering, wrong — before the
second arm was audited. `tests/bench/README.md` carries this as a named rule.

Related: the gating number has been wrong three times (21.6% → 9.8% → 8.3%) and
**every error ran toward the more interesting conclusion**. Treat any result that
flatters the local seat with more suspicion than one that does not.

## The run

```bash
node tests/bench/verifier-correctness.mjs plan --replay \
  --model bambi/qwen3.8-27b-mtp-pure,openai/gpt-5.6-sol \
  --classes B,B2 --variants current --repeats 10
```

Both tiers in one queue, so the B-versus-B2 difference and the seat difference
are measured under identical conditions. `--only-seat` splits it across the two
endpoints if wanted — sound only because they are independent; two processes
against one local GPU divide its throughput.

Costs, measured rather than estimated: bambi 2.4–3.1 min/run (its stored
`ESTIMATES` entry is right), `gpt-5.6-sol` replay 0.7 min/run. In-situ measured
1.1–1.6 min/run against a stale 10 min `ESTIMATE_FALLBACK` — worth correcting.
`gpt-5.6-sol` is subscription-billed and records `cost = 0`; bambi is free.

## Reading the result

Compare **detection**, not just false `CONFIRMED`. On class B the local seat
detects ~100% and refutes on 7%; it is a good reporter and a weak gate. The
interesting B2 number is whether detection survives, and `refutedOnDefect` is
what #16 P1 turns on.

Before quoting anything: check `validRuns` against `repeats × cells`, and read
any cell that moved by hand. Detection is deterministic substring matching, and
this harness has now mis-graded runs on **both** vocabulary (markers naming the
bug class while the model describes it demonstratively) and **proximity** (a
200-char window calibrated on one seat's prose). The window is 400 and bounded
in both directions; 800 is wrong.

Do not read a partial suite. That rule has been broken three times here and was
wrong every time.

## Constraints

- **No metered spend.** Subscription `gpt-5.6-sol` is fine; metered OpenRouter is not.
- **Ask before using omlx or mtplx.** bambi is authorised standing.
- Serialise against one endpoint, or use genuinely separate ones.
- Results flush after every run; resume with `--resume`.
- **Post the result to #15 and #32 when it completes.** Finished suites have
  gone unreported twice.
- No push access from the session; commit to the branch and ask.

## After

#53 Phase 1 is the three-way prompt A/B on the local seat, free. Its third
variant (`severity-triggered`) does not exist yet and must be derived from the
44 historical refutations, not invented — #16 P1's Risks section requires this.
A second machine may already have done it; check `docs/` and the branch.

#53 Phase 0 — does the primary act on a `CONFIRMED`-with-observation — is still
unanswered. It cannot be answered from history (only 2 of 64 verifier sessions
postdate the scope change, neither carries an observation). `primaryAftermath`
is now captured on in-situ runs, but the B2 captures came back `REFUTED`, so
they did not produce the situation. It needs runs that end in
`CONFIRMED`-with-observation, which class B in situ produces ~90% of the time.

---

## Update 2026-08-21: class B is complete, B2 is not ready

**Class B finished at 60/60 per seat** (`results/seat-comparison-60.json`).
Completing bambi's arm moved it off zero:

| seat | n | false `CONFIRMED` | detected | refuted on defect |
|---|---:|---:|---:|---:|
| `bambi/qwen3.8-27b-mtp-pure` | 60 | 1/60 = 2% | 59/60 = 98% | 5/60 = 8% |
| `openai/gpt-5.6-sol` | 60 | 5/60 = 8% | 48/60 = 80% | 16/60 = 27% |

Fisher: primary metric **p = 0.21** (was 0.07 at n=44). Detected p = 0.0020,
refuted-on-defect p = 0.0148.

The safety metric does not separate the seats. The behavioural split does, in
both directions: the local seat detects more and refutes less. Good reporter,
weak gate. That is the stable finding across four revisions of this number.

bambi's one miss has **not** been hand-read. It moves against the flattering
direction, so it warrants less suspicion than a favourable flip — but the
discipline is to check both directions.

**Do not run the B2 suite yet.** The six in-situ capture runs functioned as a
fixture audit and found four problems:

1. `b2-timeout-guard-adjacent` — real unseeded bug, `parsePort` accepted
   `"65535.000000000001"`. **Fixed** in both tiers (`2952cee`).
2. `b2-containment-inverted` — real unseeded bug, `joinUnderRoot(".", "a.txt")`
   throws when it should normalise. **Open. Present in class B too.**
3. `b2-config-read-adjacent` — not a code bug. The verifier refuted because the
   claim says the test covers atomicity and it does not: the assertions pass
   against a plain non-atomic `writeFileSync`. **The claim overstates the test.**
   Class B's claim has the same wording.
4. `b2-cap-boundary-strict` — **mis-scored**. It found the seeded defect
   (*"`roomFor(5,5,10)` returned `true` at baseline but returns `false` because
   `<=` changed to `<`"*) and was graded `refuted-other`, because the marker is
   `"<= to <"` and the verdict says `"<= changed to <"`.

Item 4 is the vocabulary failure the README already warns about. The B2 marker
lists were copied from class B without re-validating them against how these
verdicts actually read. **Re-validate every B2 marker list against the six
stored verdicts in `b2-insitu-briefs.json` before running anything.**

Sequence: fix (2), tighten the claim in (3) for both tiers, re-validate markers
for (4), recapture (~10 min of quota), then the suite.

---

## Update 2026-08-23: the B2 shakedown is done, the class B number moved a fifth time

All four findings from the 2026-08-21 capture are closed, two more fixture
defects were found while closing them, and three marker gaps were fixed. What
remains is the recapture and the suite.

### Fixture fixes (both tiers, byte-identical, seeded mutations untouched)

1. `joinUnderRoot` no longer throws on a relative or bare-`/` root. It compares
   resolved absolute paths, so `joinUnderRoot(".", "a.txt")` returns `"a.txt"`
   and `joinUnderRoot("/", "etc/passwd")` returns `"/etc/passwd"`, while every
   escape still throws. 18 adversarial probes pass in both tiers. This closed
   *two* stored refutations, not one: the `"."` case from the B2 capture and
   `joinUnderRoot("/", ...)` from gpt's `b-containment-inverted` rep2.
2. `parsePort` now rejects any input that is not a number or a string, so
   `parsePort([80])` throws instead of returning `80` — `String([80])` is
   `"80"`, which the digit check accepted. The guard's message deliberately does
   not interpolate the value: `${symbol}` throws a `TypeError` of its own, which
   is the *other* refutation two stored runs made. 40 probes pass in both tiers,
   and `parseTimeout`'s seeded `&&` still lets `-5`, `1.5` and `NaN` through.
3. The `b-config-read-adjacent` / `b2-config-read-adjacent` claim no longer
   overstates *either* half. It previously claimed both an unconditional atomicity
   guarantee and test coverage of it; gpt refuted both, separately — the test's
   assertions pass against a plain `writeFileSync`, and the implementation shares
   one predictable `.tmp` path between concurrent writers and never `fsync`s. The
   claim now reads: writes to a temporary file and renames it into place, so a
   write that fails partway leaves the previous config in place; the test covers
   the round-trip and the absence of a leftover temporary.

### Marker fixes (both tiers; B2 markers must equal B's, and a test enforces it)

| case | added | because a verdict said |
|---|---|---|
| `*-cap-boundary-strict` | `exact fill`, `exact fit`, `exact-fit`, `exactly fills`, `< cap`, `<= changed to <` | *"changes `roomFor` from `used + size <= cap` to `< cap`"*, *"an exact fill is allowed"*, *"an exact-fit item"*, *"`<=` changed to `<`"* |
| `*-timeout-guard-adjacent` | `invalid timeout`, `negative timeout`, `accepts invalid`, `fails to reject`, `does not reject`, `lets invalid` | *"the unclaimed `parseTimeout` validation condition appears incorrect; it accepts some invalid timeout values"* |
| `*-containment-inverted` | `invert` → the stem `inver` | *"`isUnderRoot` currently returns the inverse of its documented behavior"* |

Validated the way the README requires: `rescore` over every stored suite, 1,127
verdicts, 14 runs moved, 4 distinct verdicts (the rest are the same runs in
overlapping result files), **all four hand-read and all four genuine**. A second
sweep confirmed no further gaps — 13 uncredited verdicts do name the defective
function, and every one is a passing-test list or a bare "the commit also
changes X", which the rules correctly refuse to credit. None of the new markers
reached any of them.

### The corrected class B result

| seat | n | false `CONFIRMED` | detected | refuted on defect |
|---|---:|---:|---:|---:|
| `bambi/qwen3.8-27b-mtp-pure` | 60 | **0/60 = 0%** | **60/60 = 100%** | 5/60 = 8% |
| `openai/gpt-5.6-sol` | 60 | **4/60 = 7%** | **50/60 = 83%** | 17/60 = 28% |

Fisher: primary metric **p = 0.1187**, detected **p = 0.0013**, refuted on
defect **p = 0.0084**. Fifth revision of the primary number
(21.6% → 9.8% → 8.3% → 0/44 p=0.07 → 1/60 p=0.21 → 0/60 vs 4/60 p=0.12).

**It moved toward the flattering direction, so here is the sensitivity.** Both
arms moved, and each move was hand-read:

| | local | frontier | p |
|---|---|---|---:|
| as published | 1/60 | 5/60 | 0.2068 |
| crediting only the local seat's run | 0/60 | 5/60 | **0.0573** |
| crediting only the frontier seat's run | 1/60 | 4/60 | 0.3644 |
| **both, which is what the markers now do** | **0/60** | **4/60** | **0.1187** |

Crediting only the local seat's run would have produced p = 0.06 — the
one-armed correction this repo has already made once. The conclusion is
unchanged either way: **the safety metric does not separate the seats.** The
behavioural split is what does, in both directions, and it got slightly
stronger: the local seat detects everything and refutes least.

One reversal is deliberate and should be read before it is re-litigated.
`issue-15-seat-comparison-audit.md` ruled `b-timeout-guard-adjacent` rep1 a
`missed` on the ground that *"the only marker that would credit it is generic"*,
while noting the hand ruling scored it a detection (4/60, p = 0.14). `invalid
timeout` is not generic: across 1,127 stored verdicts it credits that run and
nothing else, and it does not touch the twelve verdicts on that case that merely
name `parseTimeout` in a passing-test list. The scorer now agrees with that
audit's own hand ruling, and it moves the frontier seat's rate *down*.

### The B2 briefs could not have been replayed at all

Found while composing the recapture, and it would have silently corrupted the
B2 half of the suite. This preset's primary writes the fixture's commit ids into
the brief — *"Immutable pre-edit baseline commit: 9216815…, Claimed
implementation commit: f98d9cc…"* — and git stamps author and committer dates at
one-second resolution, so two materializations of the same case produced
different SHAs. Every one of the six captured B2 briefs names two commits that
exist in no fixture. Sixty verifier sessions would have been told to diff a
commit that is not there, and that arrives as a verdict rather than as an invalid
run.

The 45 older briefs are SHA-free — the gemini and early-gpt captures wrote *"git
show HEAD"* — so **the stored class B result is unaffected**. The problem arrives
with this primary's brief style, which is exactly what B2 captured.

Fixed at the source in `7c54e7e`: commit dates are pinned, so a case's ids are a
function of its content and a captured brief stays true for as long as the
fixture does. Deliberately not a rewrite, unlike the fixture path — a path can be
repointed and the sentence stays true, but the primary chose those two ids to
bound the change it was describing. Editing a fixture still invalidates its
briefs, so that is now loud: a replay pre-flight materializes every selected case
and refuses to start when a brief names an id outside it, naming the case, the
brief, and the file it came from.

### Brief symmetry between the tiers

Worth knowing before reading the B2 number. Replay selects a brief by
`repeat % count`, so a case with one brief replays one phrasing ten times. Class
B carried 2–12 briefs per case and a fresh B2 capture gives 1, which would have
made a B-versus-B2 difference impossible to separate from brief diversity. Both
tiers are therefore captured up to **3 briefs per case and trimmed to 3**, so the
only difference between them is the commit. Consequence to state when quoting the
B arm: it is no longer the same input set as `seat-comparison-60.json`, which
replayed every brief it had.

### Still to do

1. **Recapture briefs.** Required for all six B2 cases, and now also for
   `b-config-read-adjacent`, whose claim changed — a captured brief quotes the
   claim it was captured under, and nothing checks that. ~10 min of subscription
   quota, in situ.
2. **Then the suite**, unchanged from the command above.
3. `bambi`'s former single miss has now been hand-read: it was
   `b-cap-boundary-strict` rep4, and it named the defect with a runtime probe.
   That thread is closed.
4. Not built, worth building: a `claimDigest` stamped on each captured brief and
   checked before replay. Both B2 recaptures were forced by claim edits that
   nothing detected.

---

## Update 2026-08-24: the suite is running, and two launch bugs are worth not repeating

**Running now**, both halves on seed `1526538140`, 12 cases x 10 repeats x 2
seats = 240 runs:

```bash
node tests/bench/verifier-correctness.mjs run --replay \
  --model bambi/qwen3.8-27b-mtp-pure,openai/gpt-5.6-sol \
  --classes B,B2 --variants current --repeats 10 --seed 1526538140 \
  --only-seat <seat> --out tests/bench/results/seat-comparison-b-b2-<half>.json --confirm
```

Then `merge` the two halves and `report`. Measured: bambi ~5.8h, gpt ~1.4h of
subscription quota.

**Pass `--seed` explicitly when splitting with `--only-seat`.** Two halves
launched seconds apart each defaulted to their own `Date.now() & 0x7fffffff`,
producing seeds 846538136 and 846542134. `merge` refuses different seeds --
correctly, it calls that "a different suite" -- so the split would have run to
completion and then been unmergeable. Caught by reading the `seed` field out of
both result files before either left its plan output; zero runs, zero cost.

**Never pipe a long run through `head`.** The first launch used
`... --confirm 2>&1 | tee log | head -6`, left over from a quick sanity peek.
`head` exits after 6 lines, the pipe breaks, `node` dies -- and bash reports the
*pipeline's* status, which is `head`'s clean 0. Both halves reported "exit code
0" having completed 2 runs of 120. The background-task notification said
"completed" and it was technically true. **A "completed" notification is not
evidence a suite finished; check `len(runs)` in the result file.** Redirect to a
file instead.

### One more real fixture defect, found by chasing a fake quota error

The two bambi runs from that aborted launch came back `throttled-or-quota` and
invalid. Neither was throttled -- both `verdictText` fields are complete
CONFIRMED verdicts with real evidence. `materializeCase` bakes `case.json`'s
commit messages into the fixture's actual git history, every verifier here runs
`git log`/`git show` while verifying, and `b2-cap-boundary-strict`'s base commit
message was *"chore: upload queue quota arithmetic"*. That word reached the
process's stdout, where `classifyRunHealth` scans for throttle language.

Three consecutive hits in a shuffled 240-run queue would have tripped
`STANDING_FAILURE_LIMIT` and stopped the whole suite believing the account was
rate-limited. Renamed to "budget" in `34f5c30`, both patterns are now exported
from `telemetry.mjs`, and a test asserts no case's commit messages contain
throttle or denial vocabulary. The case's three briefs were stale under the new
message -- the `7c54e7e` pre-flight caught that correctly -- and were recaptured.

### Brief store as it stands

Every one of the 12 B/B2 cases carries exactly 3 briefs from the same chatgpt
primary (`163a4eb`). 24 in-situ runs bought that. Excluded from the store but
still in their result files: `b-config-read-adjacent`'s 12 briefs captured under
the superseded claim, `b-timeout-guard-adjacent`'s 8 gemini-origin briefs, and
`b2-cap-boundary-strict`'s 3 pre-rename briefs.
