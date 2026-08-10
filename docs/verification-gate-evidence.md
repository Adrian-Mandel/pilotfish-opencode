# Verification Gate Evidence (issue #16, P1 prerequisite)

Issue #16 requires this measurement before the Completion Gate is rewritten:

> Before implementing, sample historical verifier REFUTED verdicts and derive the trigger list empirically. If those verdicts cluster outside the proposed triggers, P1 must be redesigned.

They cluster outside it. **P1 as written should not be implemented.**

## Method

Source: `~/.local/share/opencode/opencode.db`, all 62 sessions with `agent = 'verifier'`, sampled 2026-08-10.

For each session, the last `part` row of `type = 'text'` is the returned verdict. Classification reads the first line that *begins* with `CONFIRMED` or `REFUTED`, falling back to first occurrence anywhere; a leading-line match avoids counting the verdict vocabulary quoted back from the task brief, which is why a naive substring scan reports 7 sessions as containing both words.

| verdict | sessions |
|---|---|
| REFUTED | 44 |
| CONFIRMED | 12 |
| CONFIRMED, restated rather than led with | 5 |
| unparseable (returned the brief, not a verdict) | 1 |

**72% of verifier runs return REFUTED** (44/61 parsed).

## Why P1 is refuted

P1 proposes cutting verification volume because verification is ~24% of total generation. That is a defensible trade only if the gate is mostly firing on work that turns out to be fine. It is not: it finds a real defect in roughly three of every four runs. Reducing gate frequency at a 72% hit rate removes defect detection roughly in proportion to the spend it saves, which the issue's own success criteria already rule out — *"a net win that degrades the REFUTED rate is not a win."*

A trigger list also cannot be derived from the sample, because the REFUTED verdicts do not respect a risk boundary. They fall into two groups:

- **High-risk work, as expected.** Installer ownership forgery, manifest write races between concurrent tool calls, router authorization binding and expiry. A risk-triggered gate keeps these.
- **Low-risk work a risk trigger would skip.** `AGENTS.md:186` still documenting a removed runtime helper; `PROJECT_NOTES.md` still claiming fixtures were pending after they were regenerated; a documented port-specific screenshot filename that the tool never writes. These are documentation and consistency drift on changes that read as small and obvious — precisely the class the current gate's own escape hatch already permits skipping, and precisely what a risk trigger would formalize skipping.

So the triggers would have to be broad enough to catch doc drift on trivial edits, at which point they are not a filter.

## What the data says the problem actually is

Verification volume is not distributed across many independent checks. It is concentrated in a few non-converging chains, grouped by the parent session that spawned each verifier run:

| parent session | verifier runs | REFUTED |
|---|---|---|
| Budget-conscious ChatGPT pilotfish config | 19 | 18 |
| Choosing first work priority | 9 | 8 |
| Starting work on issue #15 | 9 | 7 |
| Claude Code and OpenCode interoperability | 4 | 2 |
| Issue #11 overview | 4 | 4 |
| remaining 10 parents | 17 | 5 |

- Three parent sessions account for **37 of 62 verifier runs (60%)**.
- Chains of four or more runs refute **87%** of the time (39/45). Chains of one to three refute **29%** of the time (5/17).

The 19-run chain is the profile-router work, appearing in the database as `Verify runtime profile implementation` → `Reverify secured profile router` → `Final verify approved profile contract` → `Verify hardened routing outcome` → and on through fifteen more, nearly all REFUTED. That is the reported "stuck in loops" symptom, measured.

This reframes the cost. The waste is not that the gate runs; it is that each fix pass closes one finding and the next run finds another, so a single claim is re-verified five to nineteen times. Cutting gate frequency does not shorten these chains — it makes each iteration blinder while the chain runs just as long.

## Consequences for issue #16

- **P1 as specified is refuted by its own precondition and should be closed, not implemented.** The verification budget it proposes is still worth having, but as a chain-level budget: cap re-verification rounds per claim, and on exhaustion escalate to the primary session rather than dispatching another verifier.
- **P5 is not a follow-on to P1; it is the primary lever.** The issue estimates P5 as "likely partly resolved by P1 — re-measure first". The opposite holds. Repeated identical commands within a session (`git diff --check` ×47) and 19-run verify chains are the same phenomenon at two granularities.
- The `verifier` `steps` backstop added under P4 (60, above the observed per-session maximum of 55) bounds a single runaway run. It does not bound the chain, which is a sequence of separate sessions.

## Reproducing

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT s.title, json_extract(p.data,'\$.text')
FROM session s
JOIN part p ON p.id = (
  SELECT p2.id FROM part p2
  WHERE p2.session_id = s.id AND json_extract(p2.data,'\$.type')='text'
  ORDER BY p2.time_created DESC LIMIT 1)
WHERE s.agent='verifier' ORDER BY s.time_created;"
```

Counts are as of 2026-08-10 and grow with use; the ratios, not the absolute numbers, are the finding.
