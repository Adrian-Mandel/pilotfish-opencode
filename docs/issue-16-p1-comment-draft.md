<!--
DRAFT for posting to issue #16. Not documentation — delete this file once posted.
Sourced from docs/issue-53-phase1-trigger-derivation.md and the 2026-08-21
update to docs/issue-16-evidence.md. Nothing here has been posted to GitHub.
-->

## P1 update: the Risks precondition has now been done at full resolution, and its measurement sample no longer exists

Two things about P1 that the [earlier status comment](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/16#issuecomment-5246872599)
could not have known. Full working in
`docs/issue-53-phase1-trigger-derivation.md` on `bench/issue-15-seat-comparison`.

### The 44-session sample is gone, so nothing in `issue-16-evidence.md` is reproducible

`~/.local/share/opencode/opencode.db` now holds a schema, 38 `migration` rows and
one `project` row — **0 sessions, 0 messages, 0 parts**, and zero occurrences of
`verifier`, `REFUTED` or any `ses_*` id in either the file or its 248 KB WAL. The
data directory was recreated **2026-08-14**; every measurement in that document
was taken **2026-08-10**.

That covers all of it: the 328-session / 21.9h telemetry behind this issue's
per-agent table, the 936 `verifier` steps, the 72% REFUTED rate, the 19-run
chain, and the 44 refutations P1's Risks section is gated on. No backup exists
under the home directory, in any of the repository's 304 commits on any branch,
or in a stash. The `Reproducing` block in `issue-16-evidence.md` still parses and
returns nothing.

**The ratios stand as recorded and cannot be re-derived.** `issue-16-evidence.md`
has been annotated to say so, so nobody spends an afternoon re-running its
queries. Live sessions now land in per-run fixture databases rather than the
shared one, so this will not self-heal — anything a future phase needs must be
exported while its fixture still exists.

### The Risks precondition, done at seven-shape resolution

The precondition:

> Before implementing, sample historical verifier REFUTED verdicts and derive the
> trigger list empirically. If those verdicts cluster outside the proposed
> triggers, P1 must be redesigned.

`issue-16-evidence.md` answered this on 2026-08-10 from a two-group read and
concluded P1 should be closed. The
[class-B calibration review](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361704033)
later partitioned the same 44 into seven shapes, which makes the miss rate
computable per candidate trigger set:

| set | fires on | misses | **miss rate** |
|---|---|---:|---:|
| **A** | security/adversarial | 29 | **65.9%** |
| **B** | + race/shared resource | 23 | **52.3%** |
| **C** | + host/external contract | 16 | **36.4%** |
| **D** | + doc contradicts code | 9 | **20.5%** |
| **E** | + lifecycle, + missing feature | 2 | **4.5%** |
| **F** | all seven | 0 | **0%** |

**The 2026-08-10 conclusion holds and is now quantified.** The largest single
step in the ladder, C → D at 16 points, is admitting
*documentation-contradicts-code* — low severity by any bar anyone would write, and
exactly the group that document named as the reason a risk trigger cannot work. A
severity-ordered list has to break its own ordering at the third rung to become
defensible. That is not a threshold set badly; it is a dimension that does not
sort the sample.

And the only exclusion the data tolerates buys nothing: set E drops just
local-logic-inside-one-function, **2 refutations in 44**. A gate firing 4.5% less
often does not address a 24%-of-generation cost.

### What changes: P1 should be reopened as a scope bound, not closed

The earlier comment's recommendation was to close P1 and keep only a chain-level
budget. The first half of that should be revised. The chain-depth finding is
right, and it points at a mechanism P1 can still supply — just not the one P1
proposed.

This issue's own evidence is the argument. Three parent sessions produced 60% of
all verifier runs, and the 19-run chain found *a different defect each time*:
wildcard hardening, then resolved-default routing, then persisted pinning, then
history parsing. That is an open-ended audit of pre-existing surface, and it has
no termination condition by construction. **Cutting gate frequency does not
shorten it. Bounding what the gate may refute on does.**

So the trigger dimension moves off shape and onto reachability and
demonstrability: refute an out-of-claim defect when it is reachable from code the
change touched and you have a concrete counterexample; observe what you can only
assert. Refutations in the sample cite a mean of 1.3 distinct files, so the bound
is drawn where the findings already were. Two supporting details from the same
sample: **41% of the 44 explicitly note the test suite passed anyway**, so the
prompt must forbid a green run as grounds to downgrade a demonstrated defect; and
the 15-case security block comes from a single sprint, so weighting triggers
toward security would be overfitting to what was being worked on that fortnight.

This is implemented as the `severity-triggered` prompt variant for #53's Phase 1
rather than as a change to the shipped prompt, so it gets measured before it
ships. The working-tree prompts are untouched.

### Consequence for this issue's success criteria

`issue-16-evidence.md` already withdrew the *verifier share of generation* and
*verifier:executor step ratio* rows, and retired the *REFUTED rate* row. One more
note now belongs beside them: with the source database empty, **none of the
baselines in the success-criteria table can be re-measured**, so a
before/after on this issue's own metrics is no longer available. Any P1 result
has to be argued from the bench harness, which is what #53 exists to do.
