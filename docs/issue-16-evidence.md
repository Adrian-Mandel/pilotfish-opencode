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

Its raw result file is deliberately **not** committed — 6,310 lines of transcript
for fourteen runs whose rates are unusable. Both things it produced are kept:
the 32 dispatch briefs it generated are in `tests/bench/briefs.json` with their
provenance recorded, and the quota-wall behaviour it exposed is the reason
`provider-denied` and the standing-failure guard exist. One in-situ Gemini
transcript is retained in full as `calibration-gemini-3.1-pro.json`.

**qwen3.6-27b, replay, 120 valid runs of 120.** Complete, paired, and the basis
for everything below. Replay measures the verifier's response to a brief a real
primary wrote; it does not measure the primary's choice of brief.

| class | variant | n | false CONFIRMED | detected at all | refuted on the defect |
|---|---|---|---|---|---|
| A | current | 20 | 0% | 100% | 100% |
| A | pre-scope | 20 | 0% | 100% | 100% |
| B | current | 40 | 40% (26–55%) | 60% | 0% |
| B | pre-scope | 40 | 43% (29–58%) | 55% | 13% (5–26%) |

These are the figures after the scorer correction described at the end of this
section. The first reading of the same runs put class B at 38% and 33%; five
runs had been credited with a finding they never made.

### The scope change has no detectable effect on this model

Every class B cell is paired: the same repeat index replays the same brief to
both variants, so a difference cannot be a difference in what was asked. Of 40
paired cells, 13 missed under both, 20 missed under neither, 3 missed only under
`current` and 4 only under `pre-scope`. Seven discordant pairs split 3–4 is an
exact two-sided **p = 1.00**. There is no effect here to act on.

The uncorrected scoring gave a 6–4 split and p = 0.75 — the same conclusion, but
its direction pointed the other way. Neither direction means anything at this
separation, which is the point: an interim read of a partial suite pointed at
`current` being worse, and the completed, corrected suite has `pre-scope`
nominally worse. Both are noise.

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
| `b-timeout-guard-adjacent` | 14/20 | 16/20 |

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

### A scoring defect, found by reading the raw verdicts, now fixed

Detection was substring matching over the whole verdict, so a run that mentioned
the adjacent function in passing *and* separately used a discriminator word
about the claimed function scored as `observed` without ever having found the
defect. Every one of the 40 `b-timeout-guard-adjacent` runs was then hand-read
and labelled: **9 genuine detections, 5 false credits, 26 that never mention the
function at all**. The other class B case was hand-read too and had none — all
37 of its detections are real.

The larger of the two causes was the marker list, not the matching. The
discriminators were `negative` and `-5`, which is vocabulary the *claimed*
function's own behaviour uses: a verdict listing `parsePort rejects zero and
negative ports` next to `parseTimeout reads a numeric string` contains both
markers and reports nothing. An adjacent-defect case needs words unique to the
defect, which here is how the models actually described it — `&&` where `||` was
meant.

Proximity is the second half, and it is deliberately generous. Scoping to the
line grades both class B cases perfectly and then breaks the class A control,
30 of 40, because a verdict discussing one function across several sentences
naturally separates the name from the detail. All 120 runs grade correctly at a
200-character window and identically at 400, so the rule sits on a plateau
rather than on a constant fitted to one dataset.

The error was one-directional, checked in both: **zero of the 25 runs scored
`missed` mention the adjacent function at all**, so nothing real was being
scored as a miss. Correcting it moved 5 runs and changed no conclusion.

Because every verdict is retained in full, the fix was applied to the runs that
already happened rather than by re-running them:

```bash
node tests/bench/verifier-correctness.mjs rescore <result.json>
```

### Reproducing

```bash
node tests/bench/verifier-correctness.mjs report \
  tests/bench/results/replay-qwen3.6-27b-classAB-r20.json
```

## gpt-5.6: the scope change improves the gate (2026-08-16)

The model #16's criterion is actually written against, measured the same way: 120
replay runs on `gpt-5.6-sol` at `high`, the binding the original telemetry was
collected on, answering the identical recorded briefs the qwen suite used. 119
valid, one throttled.

| class | variant | n | false CONFIRMED | detected at all | refuted on the defect |
|---|---|---|---|---|---|
| A | current | 20 | 0% | 100% | 100% |
| A | pre-scope | 20 | 0% | 100% | 100% |
| B | current | 40 | **13%** (5–26%) | **73%** (57–84%) | 40% |
| B | pre-scope | 40 | **33%** (20–48%) | **38%** (24–53%) | 38% |

Paired on identical briefs, 40 cells: false CONFIRMED discordant 1–9 in favour of
`current`, exact **p = 0.022**; detection discordant 17–3, **p = 0.003**. The
same analysis on `qwen3.6-27b` gives p = 1.00 and p = 0.69 — no effect at all.

**The feared regression is the opposite of what happens.** The change was
expected to risk suppressing findings outside the claim. On `gpt-5.6` it more
than doubles them and cuts false CONFIRMEDs from a third to an eighth.

### The mechanism is a missing channel, and the outcome counts show it exactly

| variant | caught | observed | missed | refuted-other | REFUTED verdicts |
|---|---|---|---|---|---|
| `current` | 16 | **13** | 5 | 6 | 22/40 |
| `pre-scope` | 15 | **0** | 13 | 12 | 27/40 |

`caught` is unchanged — 16 against 15. The old prompt did not refute on the
adjacent defect more often; it had **nowhere to put a finding that did not
justify refusal**, so `observed` is zero across all forty runs. Adding that
channel converts thirteen silent misses into reported findings without costing a
single refusal.

### This invalidates the `REFUTED rate` criterion rather than passing it

Total REFUTED verdicts fall, 27 to 22. Read against the issue's surviving
criterion — *"REFUTED rate: no material fall"* — that is a regression. Read
against what the criterion was for, it is the opposite: the gate detects
**73% against 38%** and ships fewer defects.

The criterion counts refusals as a proxy for findings. The scope change is
precisely the intervention that breaks the proxy, because it separates the two.
**Report detection and false CONFIRMED; retire the REFUTED-rate row**, which now
joins the four already withdrawn for measuring the wrong thing.

### Robustness

The markers under-counted `gpt-5.6`, which describes this defect in vocabulary
the qwen-tuned list did not carry — "regresses", "suppresses every read/parse
error", "malformed JSON now returns `{}`" rather than "swallow" or "ENOENT".
Nine runs were re-graded after hand-reading every verdict that named the
adjacent function. **Six of the nine corrections favoured `pre-scope`**, and the
result survived them: the correction pushed against the conclusion and the
conclusion held. The same broadened markers change **zero** of the 120 qwen runs,
so the previously reported qwen null is unaffected.

Remaining limits are unchanged: two class B cases, replay measures the verifier
prompt rather than the gate end to end, and classes C and D are still unmeasured
though their briefs now exist.

## bambi/qwen3.8-27b: a free local verifier on classes B, C, and D (2026-08-19)

Closes the gap the previous section leaves open — *"classes C and D are still unmeasured though their
briefs now exist"* — and extends the question to a free local model, the configuration this project is
ultimately for. Measured with `tests/bench/verifier-correctness.mjs` in replay mode. This is the risk the
benchmark harness was built for — the failure mode of narrowing the verifier's scope is a false
`CONFIRMED`, and `opencode.db` records verdicts but never whether a verdict was right, so ground truth
had to be seeded.

Verifier seat: `bambi/qwen3.8-27b-mtp-pure` (LM Studio, IQ4_XS-pure MTP quant), a free local model.

| class | variant | n | missed | false CONFIRMED | detected | refuted on defect |
|---|---|---|---|---|---|---|
| B (adjacent defect) | current | 60 | 0 | **0%** (CI 0–6%) | **100%** | 7% |
| B (adjacent defect) | pre-scope | 60 | 1 | 2% (CI 0–9%) | 98% | 35% |
| C (doc drift) | current | 10 | 0 | 0% (CI 0–28%) | 100% | 10% |
| D (clean control) | current | 40 | — | — | — | false REFUTED **0%** (CI 0–11%) |

All 60 class B cells paired on `(caseId, repeat)`, so both arms answered identical briefs. Transitions
`pre-scope` → `current`: `observed`→`observed` 37, `caught`→`observed` **18**, `caught`→`caught` 3,
`observed`→`caught` 1, `missed`→`observed` 1.

**The dominant effect is `caught` → `observed` in 18 of 60 cells.** The scope change converted
refutations into observations without changing whether the defect was found. Exactly one cell was
discordant on a miss and it favours `current`.

The class D control matters as much as the class B result: a verifier that objects to everything would
score 0% missed and 100% detected and be worthless. Forty consecutive `clean-confirmed` verdicts on
defect-free code establish that the detection rate is discrimination, not reflex.

For comparison on the same harness, `replay-qwen3.6-27b-classAB-r20` missed 27% (16/60). The local
model missed none.

> **Withdrawn:** this paragraph previously cited `replay-gpt56-sol-classB-r20` at 22% (11/51). That
> figure does not survive audit and should not be quoted. Six of the eleven were detections the marker
> list failed to match, and the suite was 88 valid runs of 240 planned with cells between 4 and 11 of
> 20. Corrected, that cell is 5/51 = 9.8%. The controlled two-seat re-run puts the frontier seat at
> 5/60 = 8.3% against the local seat's 0/44, Fisher p = 0.07 — not a significant separation. See
> [`issue-15-gpt56-miss-audit.md`](issue-15-gpt56-miss-audit.md) and
> [`issue-15-seat-comparison-audit.md`](issue-15-seat-comparison-audit.md). The `qwen3.6-27b` and
> `gpt-5.6@high` class-A/B figures in this document are unaffected: re-scoring under the corrected
> scorer moves zero of their runs.

### The unresolved tension with this issue's own bar

Issue #16 states *"a net win that degrades the REFUTED rate is not a win."* The REFUTED rate fell from
35% to 7% — a 5× drop. Read strictly, that is the disqualifying condition. The defence is that nothing
became invisible: detection held at 100% and the lost refutations became observations, not misses. Which
reading applies depends on whether the criterion protects **defect detection** or **the gate stopping
work**, and the measurement cannot distinguish them, because the difference lives in what the primary
does with an `observed` finding. Treat the risk as provisionally cleared, not cleared.

### What this measurement cannot speak to

**Chain depth, which P1 above identifies as the actual problem.** Every run here records
`chain depth: max 1, mean 1.0` — replay dispatches one verifier against one recorded brief with no
primary in the loop, so the 5-to-19-round chains that account for 60% of verifier runs have no
counterpart in this harness by construction. Nothing here says whether the scope change shortens those
chains, which is the finding that actually drives the cost.

It also does not measure dispatch, the primary's choice of brief, or whether the primary acts on
`observed` findings. In-situ runs are the only instrument for those, and per #41 they should wait for
the baseline-integrity fix — a writing executor that can overwrite the verifier's pre-edit baseline would
corrupt exactly this metric.

Caveats on the numbers: `d-clean-cache-cap` has only 3 captured briefs, so its n=40 buys model-variance
samples rather than brief diversity. `b-shared-default-mutation` and `b-timeout-guard-adjacent` returned
`observed` in both arms on all 20 runs, never refuted — they may be structurally out-of-claim in a way no
prompt variant refutes. Runs excluded as `throttled-or-quota` were re-run: 1 in class B current, 2 in
C/D, 3 in class D r30.

Results: `tests/bench/results/bambi-qwen38-classB-current-r10.json`,
`bambi-qwen38-classB-prescope-r10.json`, `bambi-qwen38-classCD-current-r10.json`,
`bambi-qwen38-classD-current-r30.json`.

## The four revised criteria against post-change telemetry (2026-08-19)

The scope change is commit `9332e48` (2026-08-10). This section measures the four surviving criteria
from *Revised success criteria* above against sessions created on or after 2026-08-11, using the queries
under *Reproducing* and *Reproducing the timing figures*. **The headline is not any of the four numbers.
It is that the post-change window contains almost no verification and almost no work**, so three of the
four criteria are met vacuously and the fourth — the one that matters — cannot be tested at all.

`session.time_created` is epoch milliseconds; the cutoff is
`CAST(strftime('%s','2026-08-11') AS INTEGER)*1000`. A bare `strftime` comparison silently returns zero
rows.

### The post-change window is 3% of the baseline, and it is smoke tests

There are 36 post-change sessions out of 387 in the database. Attributing by own-generation time — message
elapsed minus summed part elapsed, per the issue's own methodology note — they carry **123 assistant steps
and 1.75h**, against the baseline's 4,036 steps and 21.9h. That is 3.0% of the steps and 8.0% of the hours.

The 8.0% is itself inflated. A single `pilotfish` message carries **4,222s of the 1.75h** with zero output
tokens and a recorded `MessageAbortedError` — the abandoned-message artifact this document already
documents under P5. Excluding it, post-change generation is **0.58h, or 2.6% of the baseline**, and
`pilotfish` runs 43 steps at 28.4s each rather than the 44 steps at 123.7s the raw figure reports.

What that generation was spent on decides everything below. The twelve post-change `pilotfish` sessions
are titled *Connection test check-in*, *Audio or connection check*, *Test conversation*, *Connection test*,
*Subagent routing smoke test*, two `New session` placeholders, three variants of *profiles.json usage
references search*, *Audio test check*, and *fiona.html comment update and verifier check*. Nine of the
twelve are connectivity or routing probes. The one session that exercises the completion gate end to end
does so against a sandbox HTML file, not against this repository.

This is not a smaller sample of the same workload. It is a different and far more trivial workload, drawn
from a period spent building and probing the profile router rather than doing development. Any criterion
that improves here improves because the system was barely used.

### Criteria 1 and 2: met, but vacuously

| criterion | baseline | target | post-change | verdict |
|---|---|---|---|---|
| max verifier runs against one claim | 19 | ≤ 3 | **1** | met vacuously (n=2 runs) |
| verifier runs per parent session, p95 | 19 | ≤ 4 | **1** | met vacuously (n=2 parents) |

The whole post-change window contains **two** verifier sessions, both on 2026-08-18, each under a different
parent: `Subagent routing smoke test` and `fiona.html comment update and verifier check`. One run each. The
maximum is 1 and the p95 is 1.

Note that both arrive under the agent name `pilotfish-profile-bambi--qwen3.8-27b-verifier`, not `verifier`.
The baseline's `WHERE s.agent='verifier'` filter returns **zero** post-change rows, because the profile
router renames worker agents per profile — an ad-hoc re-measurement pasted from P1's *Reproducing* block
would report an empty window as a clean one. The shipped harness is not affected:
`tests/bench/lib/telemetry.mjs:37-38` already matches both the plain and the profile-suffixed name and
excludes `plan-verifier`. The stale query is the one recorded in this document, and the block at the end of
this section supersedes it.

A further 11 `task` dispatches to `*-verifier` and `*-executor` profile agents returned errors, all with
the same message — *"Pilotfish internal profile agents cannot be invoked directly; request a public
Pilotfish worker role instead."* Those are the router's direct-invocation guard firing correctly against
deliberate probes, not failed verification attempts. They confirm the character of the window rather than
adding to the sample.

Chains of 5 to 19 rounds cannot appear in two runs against two different claims. The chain budget shipped
at `pilotfish.md:62` is therefore **untested in situ**: nothing in this telemetry exercised it, and nothing
here says whether it works.

### Criterion 3: no rejection region exists at n=2

This was the priority, because the 2026-08-19 replay benchmark above found the REFUTED rate falling from
35% to 7% on class B seeded defects. Real telemetry cannot speak to it.

The two verdicts are one `CONFIRMED` and one `REFUTED` — 50%, with an exact Clopper-Pearson 95% interval of
**[1.3%, 98.7%]**. That interval contains both the 72% baseline and the 7% replay figure, so it discriminates
nothing.

The sharper statement is that no possible outcome could have failed this criterion. Testing H₀ *(rate holds
at 72%)* against a fall, one-sided at α=0.05, the critical region at n=2 is **empty**: even 0 of 2 REFUTED
has probability 0.28² = 0.078 under the null. There was no observation the window could have produced that
would have registered as a material fall.

For scale on what would be needed, using exact binomial power against the same null:

| verifier runs | reject if REFUTED ≤ | power vs a fall to 35% | power vs a fall to 55% |
|---|---|---|---|
| 2 | *(none)* | 0.00 | 0.00 |
| 10 | 4 | 0.75 | 0.26 |
| 13 | 6 | 0.87 | 0.31 |
| 30 | 16 | 0.99 | 0.50 |
| 60 | 36 | 1.00 | 0.82 |

**About thirteen real verifier runs would settle whether the replay's 5× collapse reproduces in situ.** That
is a modest bar — roughly one normal week of development on this repository at the pre-change rate, and far
short of the 328-session baseline. The criterion is not unmeasurable; it is simply unmeasured.

Two confounds would remain even at that sample size, and both need removing first. The post-change verifier
seat is `bambi/qwen3.8-27b-mtp-pure`, a local model; the 62 baseline runs are all `openai/gpt-5.6-sol` at
`high`. Prompt and model changed together, so the comparison is not clean. And per #41 the baseline-integrity
fix should land before in-situ verifier metrics are trusted at all.

**Verdict: underpowered at n=2 verifier runs (of 36 post-change sessions). Criterion 3 is not met, not
failed, and not testable from this data.**

### A classification wrinkle the next measurement will hit

The P1 method reads the first line that *begins* with `CONFIRMED` or `REFUTED`. Every sampled pre-change
verdict complies — `REFUTED`, then a blank line, then the counterexample. Neither post-change verdict does:
they open `**Verdict: CONFIRMED**` and `VERDICT: REFUTED`, so both fall through to the substring fallback the
method treats as a last resort.

This is confounded with the model change and may be a qwen formatting habit rather than an effect of the
scope change; two samples cannot separate them. **The benchmark harness already handles it**:
`normalizeLine` in `tests/bench/lib/scoring.mjs:14-21` strips markdown decoration and a leading
`Verdict:` / `Final verdict —` before the begins-with test, and its header comment names
`Verdict: REFUTED` as the case it was written for. Both post-change verdicts parse there as `leading-line`,
not fallback.

So this is a note about the P1 method as recorded above, not a defect in anything that runs. Any hand-run
re-measurement should use the harness's normalisation rather than the bare begins-with test; the baseline
table itself stays as computed, since re-scoring it under a different rule would make the two numbers
incomparable.

### Criterion 4: the number moves, for the wrong reason

Pilotfish `task` wait, counting only `completed` parts (the 6 pre-change `error` parts carry 29.3h of
timestamp garbage, and 2 `running` parts have no end at all):

| window | completed `task` calls | total wait | mean per call |
|---|---|---|---|
| pre-2026-08-11 | 163 | 12.36h | 273.1s |
| post-2026-08-11 | 10 | **0.124h** | **44.5s** |

The 12.36h is the same measurement as the issue's 9.64h baseline, taken later: the snapshot behind the
baseline was mid-day 2026-08-10 and 103 more sessions were created that day. Against either figure the
total falls ~99% and the mean falls 84%, both far past the −25% target.

**This should not be recorded as met.** Ten task calls across twelve sessions, nine of which are connection
probes, is not the workload the 9.64h was measured over. The mean per call is the less abusable of the two
numbers — it is not a pure volume artifact — but 44.5s for dispatches like *Subagent routing smoke test*
says what a trivial delegation costs, not what the scope change did to a real one.

### Summary

| criterion | baseline | target | post-change | verdict |
|---|---|---|---|---|
| max verifier runs against one claim | 19 | ≤ 3 | 1 | met vacuously — 2 runs, 2 claims |
| verifier runs per parent, p95 | 19 | ≤ 4 | 1 | met vacuously — 2 parents |
| REFUTED rate | 72% | no material fall | 50% (CI 1.3–98.7%) | **underpowered at n=2; empty rejection region** |
| pilotfish `task` wait | 9.64h | −25% | 0.124h total, 44.5s mean | moves past target on a workload that cannot support the claim |

The replay result therefore stands unchallenged and unconfirmed. Nothing in the real telemetry contradicts
the 35% → 7% collapse, and nothing corroborates it either; the window that would have tested it contains two
smoke-test verifications on a different model.

The actionable finding is not about instrumentation after all. Both wrinkles above are already handled in
`tests/bench/lib/` — the agent-name match and the verdict normalisation — so the only stale copies are the
ad-hoc queries recorded in this document, which the block below replaces. What is missing is data:
**roughly thirteen verifier runs from real development work on a stable verifier seat**, with #41's
baseline-integrity fix landed first so the runs are trustworthy. That requires no benchmark and no code. It
requires the tool to be used on real work.

### Reproducing

```bash
# post-change verifier runs per parent, and the verdicts
sqlite3 "file:$HOME/.local/share/opencode/opencode.db?mode=ro" "
SELECT COALESCE(ps.title,'(no parent)'), v.agent, count(*)
FROM session v LEFT JOIN session ps ON ps.id = v.parent_id
WHERE v.agent LIKE '%verifier%' AND v.agent NOT LIKE 'plan-%'
  AND v.time_created >= CAST(strftime('%s','2026-08-11') AS INTEGER)*1000
GROUP BY v.parent_id, v.agent ORDER BY 3 DESC;"

# own-generation time by agent, post-change
sqlite3 "file:$HOME/.local/share/opencode/opencode.db?mode=ro" "
WITH msg AS (
  SELECT m.id mid, s.agent agent, s.time_created stc,
         json_extract(m.data,'\$.time.created') mc,
         json_extract(m.data,'\$.time.completed') mp,
         json_extract(m.data,'\$.tokens.output') outtok
  FROM message m JOIN session s ON s.id = m.session_id
  WHERE json_extract(m.data,'\$.role') = 'assistant'),
pw AS (
  SELECT p.message_id mid,
         sum(COALESCE(json_extract(p.data,'\$.state.time.end'),
                      json_extract(p.data,'\$.state.time.start'))
             - json_extract(p.data,'\$.state.time.start')) toolms
  FROM part p WHERE json_extract(p.data,'\$.type') = 'tool' GROUP BY p.message_id)
SELECT agent, count(*),
       round(sum(max(mp-mc-COALESCE(toolms,0),0))/3600000.0,3),
       round(avg(max(mp-mc-COALESCE(toolms,0),0))/1000.0,1), sum(outtok)
FROM msg LEFT JOIN pw USING(mid)
WHERE mp IS NOT NULL
  AND stc >= CAST(strftime('%s','2026-08-11') AS INTEGER)*1000
GROUP BY agent ORDER BY 3 DESC;"

# pilotfish task wait, split by era and status
sqlite3 "file:$HOME/.local/share/opencode/opencode.db?mode=ro" "
WITH parts AS (
  SELECT s.time_created st, json_extract(p.data,'\$.state.status') stat,
         (json_extract(p.data,'\$.state.time.end')
          - json_extract(p.data,'\$.state.time.start'))/1000.0 secs
  FROM part p JOIN session s ON s.id = p.session_id
  WHERE s.agent = 'pilotfish' AND json_extract(p.data,'\$.type') = 'tool'
    AND json_extract(p.data,'\$.tool') = 'task')
SELECT CASE WHEN st >= CAST(strftime('%s','2026-08-11') AS INTEGER)*1000
            THEN 'post' ELSE 'pre' END,
       stat, count(*), round(sum(secs)/3600.0,3), round(avg(secs),1)
FROM parts GROUP BY 1, 2;"
```

### P4 closed: `small_model` is now set

The last open P4 item was `small_model`, unset in `~/.config/opencode/opencode.json`, leaving compaction and
session titles on the primary at a 22.1s median. It is now set to **`openai/gpt-5.6-luna`** — the value
`install/OPENCODE-INSTALL.md:356` names for the ChatGPT preset — added as a single top-level key beside
`model`, with the previous file kept as a timestamped `.bak`. All nine agent blocks are unchanged. The
installer still does not manage this key; the edit was made by hand, as that document requires.
