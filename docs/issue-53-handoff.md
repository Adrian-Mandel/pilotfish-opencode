# Handoff: run the B2 suite and answer whether class B measured anything

Written 2026-08-21 for a fresh session. Everything offline is done; what remains
is one suite, its analysis, and posting the result.

## The one question

Class B says the free local seat has a 0% false-`CONFIRMED` rate and the paid
frontier seat 8.3% (p = 0.07, not significant). **B2 decides whether that means
anything.**

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
