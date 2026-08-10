# Issue #16 Evidence

Measurements taken against `~/.local/share/opencode/opencode.db` on 2026-08-10, and what they changed about the plan. Counts grow with use; the ratios, not the absolute numbers, are the findings.

## P1: the verification gate

Issue #16 requires this measurement before the Completion Gate is rewritten:

> Before implementing, sample historical verifier REFUTED verdicts and derive the trigger list empirically. If those verdicts cluster outside the proposed triggers, P1 must be redesigned.

They cluster outside it. **P1 as written should not be implemented.**

### Method

Source: `~/.local/share/opencode/opencode.db`, all 62 sessions with `agent = 'verifier'`, sampled 2026-08-10.

For each session, the last `part` row of `type = 'text'` is the returned verdict. Classification reads the first line that *begins* with `CONFIRMED` or `REFUTED`, falling back to first occurrence anywhere; a leading-line match avoids counting the verdict vocabulary quoted back from the task brief, which is why a naive substring scan reports 7 sessions as containing both words.

| verdict | sessions |
|---|---|
| REFUTED | 44 |
| CONFIRMED | 12 |
| CONFIRMED, restated rather than led with | 5 |
| unparseable (returned the brief, not a verdict) | 1 |

**72% of verifier runs return REFUTED** (44/61 parsed).

### Why P1 is refuted

P1 proposes cutting verification volume because verification is ~24% of total generation. That is a defensible trade only if the gate is mostly firing on work that turns out to be fine. It is not: it finds a real defect in roughly three of every four runs. Reducing gate frequency at a 72% hit rate removes defect detection roughly in proportion to the spend it saves, which the issue's own success criteria already rule out — *"a net win that degrades the REFUTED rate is not a win."*

A trigger list also cannot be derived from the sample, because the REFUTED verdicts do not respect a risk boundary. They fall into two groups:

- **High-risk work, as expected.** Installer ownership forgery, manifest write races between concurrent tool calls, router authorization binding and expiry. A risk-triggered gate keeps these.
- **Low-risk work a risk trigger would skip.** `AGENTS.md:186` still documenting a removed runtime helper; `PROJECT_NOTES.md` still claiming fixtures were pending after they were regenerated; a documented port-specific screenshot filename that the tool never writes. These are documentation and consistency drift on changes that read as small and obvious — precisely the class the current gate's own escape hatch already permits skipping, and precisely what a risk trigger would formalize skipping.

So the triggers would have to be broad enough to catch doc drift on trivial edits, at which point they are not a filter.

### What the data says the problem actually is

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

### Consequences

- **P1 as specified is refuted by its own precondition and should be closed, not implemented.** The verification budget it proposes is still worth having, but as a chain-level budget: cap re-verification rounds per claim, and on exhaustion escalate to the primary session rather than dispatching another verifier.
- **P5 is not a follow-on to P1; it is the primary lever.** The issue estimates P5 as "likely partly resolved by P1 — re-measure first". The opposite holds. Repeated identical commands within a session (`git diff --check` ×47) and 19-run verify chains are the same phenomenon at two granularities.
- The `verifier` `steps` backstop added under P4 (60, above the observed per-session maximum of 55) bounds a single runaway run. It does not bound the chain, which is a sequence of separate sessions.

### Reproducing

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

## P2: read-only delegation is serialized in practice

The issue asks whether the serialization rule at `pilotfish.md:46` is being over-applied to read-only roles, which own no files and cannot conflict. It is.

Comparing start and finish timestamps of every child session against its siblings:

| measure | value |
|---|---|
| read-only child sessions | 92 |
| ...that ever overlapped another read-only sibling | 20 (21.7%) |
| adjacent read-only dispatch pairs | 53 |
| ...where the second started before the first finished | 10 (18.9%) |
| median gap between one finishing and the next starting | 207s |

Four out of five recon tasks run alone, and when two are dispatched back to back the primary usually waits out the first. The 207-second median gap says recon is being used as a serial lookup rather than a parallel sweep.

The prompt was a contributing cause, in two places. `Serialize writing roles` did not say *only* writing roles, leaving the constraint's scope to inference. And the neighbouring rule opened with `Keep bounded repository scans in this session by default`, a discouraging default that fought the parallel-dispatch guidance three sections later. Both are now explicit.

## P3: the cost of inline reconnaissance is round-trips

Pilotfish's own tool calls, with the execution time OpenCode recorded for them:

| tool | calls | total execution |
|---|---|---|
| `bash` | 552 | 0.188h |
| `read` | 525 | 1.850h |
| `grep` | 153 | 0.007h |
| `glob` | 62 | 0.097h |

`bash`, `grep`, and `glob` together are 767 calls costing **0.29h of execution**. At ~21s of generation per pilotfish step, the round-trips around them cost roughly fifteen times what the tools do. Context size is not the mechanism and neither is tool latency; it is one full model turn per cheap call.

`read` is the exception at ~12.7s per call, which argues for delegating bulk reading rather than against it.

The trigger added to the Dispatch Rules is therefore expressed in round-trips — more than about three, and the answer wanted is a conclusion — rather than in context size or file count.

## P6: the injected `AGENTS.md`

Confirmed at 2,053 words in 560 lines, injected into all nine agents. Two problems, and the second is worse than the size:

- Roughly sixty lines under `## Subagent Delegation` instruct the reader to delegate discovery to `Explore`, plus `Delegate discovery to subagents when repository context is needed` among the Core Principles. Eight of the nine agents have `task` denied, so for them this is an instruction to use a tool they cannot call.
- The file ends with a second appended document (`# Agent Directives`, line 557) carrying a `## Qwen-Specific Bias` section and a rule to format tool calls as XML. Neither applies to the gpt-5.6 or Claude models in either preset, and model-specific formatting instructions aimed at the wrong model are a correctness risk, not just waste.

This file is user configuration at `~/.config/opencode/AGENTS.md`, outside anything the installer owns, so it is not fixed here. The recommendation is to scope the delegation section to the primary and delete the appended directives; the measurement above is what makes it worth doing.

## Revised success criteria

Two of the issue's five targets measure verification *volume*, which the P1 evidence showed is the wrong axis: reaching them by verifying less is the degradation the issue itself rules out. They are restated here against chain depth, which is what actually ran away.

| metric | baseline | original target | revised target |
|---|---|---|---|
| verifier share of generation | 19.5% | < 12% | *withdrawn* — a share that falls because defects ship is a loss, not a win |
| verifier:executor step ratio | 2.06 | < 1.2 | *withdrawn* — same reason; 2.06 is what a 72% refute rate looks like |
| max verifier runs against one claim | 19 | — | **≤ 3** |
| verifier runs per parent session, p95 | 19 | — | **≤ 4** |
| REFUTED rate | 72% | (implicit floor) | **no material fall** — the gate must keep finding what it finds |
| pilotfish `task` wait | 9.64h | −25% wall clock | unchanged |
| max repeated identical command per session | 47 | < 10 | unchanged |
| steps ≥60s as share of wall clock | 74.1% | < 50% | unchanged |

The two withdrawn rows are not replaced by a cheaper proxy. If verification cost must be reported as a single number, report chain depth: it falls only when work converges, and it cannot be gamed by skipping the gate.

## Reproducing the timing figures

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT json_extract(p.data,'$.tool') AS tool, count(*),
       sum(json_extract(p.data,'$.state.time.end')
         - json_extract(p.data,'$.state.time.start'))/3600000.0 AS hours
FROM part p JOIN session s ON s.id = p.session_id
WHERE s.agent = 'pilotfish' AND json_extract(p.data,'$.type') = 'tool'
GROUP BY tool ORDER BY 2 DESC;"
```

`task` rows report nonsense totals here because nested runs leave end timestamps unset; every other tool is sound.
