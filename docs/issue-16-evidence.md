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
- ~~**P5 is not a follow-on to P1; it is the primary lever.**~~ Written before P5 was measured, on the assumption that `git diff --check` ×47 and 19-run verify chains were the same phenomenon at two granularities. They are not: the ×47 is a `build` session, and the chains are Pilotfish. See P5 below — the chain depth found here is the whole finding, and it has no within-session counterpart.
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

`read` appears to be the exception at ~12.7s per call. **It is not** — see P5 below. The mean is carried by three permission-stalled calls; 515 of pilotfish's 520 reads complete in under 0.5s. Bulk reading is worth delegating for the same round-trip reason as everything else, not because reads are slow.

The trigger added to the Dispatch Rules was therefore expressed in round-trips — more than about three, and the answer wanted is a conclusion — rather than in context size or file count.

**That trigger has since been withdrawn (issue #31).** The measurement above stands: inline reconnaissance does cost a model turn per cheap call, and that is still why bulk scanning is worth delegating. What does not follow is the threshold. Upstream ran the controls this evidence never had, and a small task-local read-only scan of about a dozen files — comfortably past three round-trips — cost 12.9% *more* delegated than inline and took 14.2% longer, while a stable 12-file mechanical edit cost 36.0% less delegated. Round-trip count does not separate those two cases; whether a complete brief can be written without doing the work first does. The Dispatch Rules now gate on that instead, which also matches upstream's own wording that recurrence qualifies through a stable one-shot brief rather than a numeric threshold. P3's mechanism survives as rationale; its threshold does not.

## P5: re-verification churn is not a Pilotfish problem

P5 was carried forward as the primary remaining lever, on the strength of `git diff --check` ×47 in a single session. The prior note asked for measurement first, to separate two patterns needing opposite fixes: one agent re-checking itself within a session, versus successive fresh contexts each re-deriving the same check.

**Neither is what the ×47 is.** P5 should be closed.

### The repeated commands belong to an agent Pilotfish does not own

Of 2,734 completed `bash` calls, grouping by (session, command) and keeping pairs repeated five or more times:

| agent | repeated calls | worst single command |
|---|---|---|
| `build` | 265 | 47 |
| `security-executor` | 70 | 23 |
| `pilotfish` | 26 | 9 |
| `executor` | 16 | 6 |
| `mech-executor` | 14 | 7 |
| `plan` | 5 | 5 |

`build` is OpenCode's built-in primary, not a Pilotfish agent. It accounts for **67% of repeated-command volume at this threshold**, and the ×47 headline is one `build` session (*Issue #65 branch and plan*, which also holds `./tools/test-fast.sh` ×43 and `./tools/test-smoke.sh` ×33). No Pilotfish prompt change reaches it. The worst any Pilotfish agent does to one command in one session is 9.

The 67% is threshold-dependent and should be quoted with its threshold: build holds 54.3% of repeat volume at ≥2, 63.9% at ≥4, 66.9% at ≥5, and 77.3% at ≥10. It is the plurality-to-majority holder at every threshold — 824 of all 2,734 completed `bash` calls — so the conclusion is stable even though the single number is not.

### Almost every repeat follows an edit, which is correct behaviour

For each pair of consecutive identical commands, whether any `edit`/`write`/`patch` landed in between:

| agent | consecutive repeats | after a write | no write between |
|---|---|---|---|
| `build` | 326 | 282 | 44 |
| `pilotfish` | 69 | 51 | 18 |
| `security-executor` | 66 | 65 | 1 |
| `executor` | 65 | 64 | 1 |
| `mech-executor` | 16 | 16 | 0 |
| `plan` | 11 | 1 | 10 |
| `verifier` | 5 | 0 | 5 |
| `general` | 2 | 0 | 2 |

**85.5%** of consecutive identical runs (479/560) follow an edit — which is the behaviour you want. Stripping them out leaves **81 genuinely redundant re-runs across all 347 sessions, costing 4.1 seconds of combined execution**. The largest single category is `git status --short --branch` ×17 in `build`, at an average gap of 49 minutes — a session resumed, not a loop.

Duplicate reads tell the same story: 128 exact repeats (same file, same offset/limit window, no intervening write to that file) out of 3,881 reads, **3.3%**. Treat that as an upper bound: `apply_patch` is the dominant write tool at 577 calls and records no `filePath` (its targets live inside the patch text), so the "no intervening write" filter cannot see it. Counting an `apply_patch` whose patch text names the file as a write drops duplicates to **73 (1.9%)**.

Against 21.9h of generation, the entire P5 phenomenon is noise.

### Correction: `read` is not slow

The P3 table above records 1.85h across 525 pilotfish reads, ~12.7s each, and reasoned from it. The distribution refutes the mean:

| bucket | pilotfish reads | total |
|---|---|---|
| < 0.5s | 515 | 0.2 min |
| 0.5–2s | 2 | 0.0 min |
| > 60s | 3 | **110.7 min** |

Three calls, the longest 6,345s, carry 99.8% of the total. Read-only agents with pre-approved reads show what the tool actually costs: `Explore` averages 0.04s over 582 reads, `plan-verifier` 0.03s over 415. The outliers are permission prompts waiting on a human, not I/O.

### Two success criteria measure human idle time

The same artifact invalidates the last two rows of the criteria table.

Total recorded wall clock across assistant messages is 224.34h, against 21.9h of actual generation. Steps of ≥60s are 90.4% of it. Decomposing those 460 steps:

- **73.45h** (214 steps) sits in steps whose longest single tool call itself exceeded 60s. This is *not* mostly human wait: it decomposes as `task` 56.04h, `question` 11.42h, `glob` 5.84h, `read` 2.73h, `grep` 0.97h, `bash` 0.52h. Three-quarters of it is `task` — nested subagent runs, i.e. the double-counting this document's closing note already warns about. Only `question` is unambiguously waiting on a person.
- **118.54h** (90 steps) sits in steps with no tool call at all. Of those, **8 steps carry 114.93h and produced zero output tokens** — the `tokens` object is present and explicitly zero on every one, not missing, and 7 of the 8 carry a recorded error (6 `MessageAbortedError`, 1 `UnknownError`). They are abandoned messages.
- The remainder, 10.80h across 156 steps, is the only part that plausibly measures the system being slow.

The rate check settles it: sub-60s steps generate at **17.0 tokens/sec**; the tool-less ≥60s steps at **0.278**. Repo-wide, 63 aborted assistant messages carry **147.42h of the 224.34h total**.

So `steps ≥60s as share of wall clock` measures abandoned messages and nested-task double-counting, not model latency; and `max repeated identical command per session` measures `build` re-running tests after edits. Both are withdrawn.

### Reproducing

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT s.agent, count(*) reruns
FROM (SELECT p.session_id sid,
             trim(json_extract(p.data,'\$.state.input.command')) cmd,
             p.time_created t,
             LAG(p.time_created) OVER (PARTITION BY p.session_id,
               trim(json_extract(p.data,'\$.state.input.command'))
               ORDER BY p.time_created) prev_t
      FROM part p
      WHERE json_extract(p.data,'\$.type')='tool'
        AND json_extract(p.data,'\$.tool')='bash'
        AND json_extract(p.data,'\$.state.status')='completed') b
JOIN session s ON s.id=b.sid
WHERE b.prev_t IS NOT NULL GROUP BY s.agent ORDER BY 2 DESC;"
```

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
| max repeated identical command per session | 47 | < 10 | *withdrawn* — the 47 is a `build` session, and 85.5% of repeats follow an edit |
| steps ≥60s as share of wall clock | 74.1% | < 50% | *withdrawn* — 8 zero-token abandoned messages carry 115h of the 224h measured |

The 74.1% baseline does not reconcile with anything measurable now: the figure is 90.4% across all agents and 95.3% for pilotfish alone. It predates this branch, so the scope it was computed over is unrecoverable — one more reason not to carry the row forward.

The withdrawn rows are not replaced by cheaper proxies. If verification cost must be reported as a single number, report chain depth: it falls only when work converges, and it cannot be gamed by skipping the gate.

Four of the eight original criteria are now withdrawn, in two pairs and for two different reasons. The first pair measured the wrong axis — verification volume, where less is not better. The second pair measured the wrong clock: any metric built on assistant-message wall time is dominated by permission stalls and abandoned messages, and reports on the user's availability rather than the system's speed. **Own-generation time is the only sound timing base in this database**, which is what the issue's original 21.9h decomposition correctly used.

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

## The scope change, measured against ground truth (2026-08-15)

The last open risk in this issue is a false `CONFIRMED`: telling the verifier not
to refute work outside its claim could suppress a real finding, and real
telemetry cannot see that because it records the verdict and never whether the
verdict was right. Seeded defects answer it. Two suites now exist.

**Gemini 3.1 Pro, in situ, 14 valid runs.** Ended early: AntiGravity's soft quota
guard tripped 14 runs into a 60-run suite, after which the backend refused with
`403 IAM_PERMISSION_DENIED` rather than a quota message. The runs that completed
are a truncated prefix of a randomized queue, so the cells are unbalanced and no
rate from it is worth quoting on its own.

**qwen3.6-27b, replay, 120 valid runs of 120.** Complete, paired, and the basis
for everything below. Replay measures the verifier's response to a brief a real
primary wrote; it does not measure the primary's choice of brief.

| class | variant | n | false CONFIRMED | detected at all | refuted on the defect |
|---|---|---|---|---|---|
| A | current | 20 | 0% | 100% | 100% |
| A | pre-scope | 20 | 0% | 100% | 100% |
| B | current | 40 | 38% (24–53%) | 63% | 0% |
| B | pre-scope | 40 | 33% (20–48%) | 65% | 13% (5–26%) |

### The scope change has no detectable effect on this model

Every class B cell is paired: the same repeat index replays the same brief to
both variants, so a difference cannot be a difference in what was asked. Of 40
paired cells, 9 missed under both, 21 missed under neither, 6 missed only under
`current` and 4 only under `pre-scope`. Ten discordant pairs split 6–4 is an
exact two-sided **p = 0.75**. There is no effect here to act on.

The one difference that is real is the one the change was designed to produce.
`pre-scope` refuted on the adjacent defect 5 times in 40; `current` never did,
reporting it as an observation instead. The finding still reaches the primary —
that is the intended channel — but the gate stops the change under the old
prompt and does not under the new one.

### The defect decides detection, not the prompt

Pooling class B hides a bimodal split, and the split is by case, not by variant:

| case | current missed | pre-scope missed |
|---|---|---|
| `b-config-read-adjacent` | 2/20 | 1/20 |
| `b-timeout-guard-adjacent` | 13/20 | 12/20 |

Both defects sit in the same file as the claim and inside the same diff. One is
found almost always and the other missed about two thirds of the time, under
either prompt. Whatever governs detection at this tier, it is a property of the
defect, not of the instruction — which is also why a two-case class B is too
narrow a base for a general claim about adjacent defects.

### The finding that matters is the level, not the delta

A cheap verifier misses roughly a third of adjacent defects **under the old
prompt too**. Pilotfish is a frontier orchestrator with cheap workers and the
verifier is a worker, so this is not a proxy for #16's `gpt-5.6` criterion — it
is the architecture's own viability question. At this tier the gate is reliable
for defects inside the claim it was given (class A, 40/40) and unreliable for
anything beside them, and no prompt wording in this experiment moved that.

### What this does not settle

`gpt-5.6` is untested. Every number this issue's revert decision rests on — the
72% REFUTED baseline, the 19-run chain — is a `gpt-5.6` number, and a
`qwen3.6-27b` result cannot move it. Classes C and D were not replayed: neither
has a captured brief, so the documentation-drift case and the false-REFUTED
noise floor are unmeasured here. Chain depth was 1 throughout, by construction
in replay, so this says nothing about the chain budget.

### A scoring defect found while reading the raw verdicts

Detection is substring matching over the whole verdict, so a run that mentions
the adjacent function in passing *and* separately uses a discriminator word
about the claimed function scores as `observed` without ever having found the
defect. Two of 46 `observed` runs are false credits on that account; correcting
them moves class B `current` to 40% and `pre-scope` to 35%, which changes no
conclusion.

The error is one-directional and was checked in both: **zero of the 25 `missed`
runs mention the adjacent function at all**, so nothing is being scored as a
miss that was really a detection. The reverse direction is worth fixing — the
markers should require the discriminator near the anchor rather than anywhere in
the document — and worth knowing about before trusting an `observed` cell from
any future run.

### Reproducing

```bash
node tests/bench/verifier-correctness.mjs report \
  tests/bench/results/replay-qwen3.6-27b-classAB-r20.json
```
