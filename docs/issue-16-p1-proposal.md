# Issue #16 P1: a proposal for when the Completion Gate fires, and what it may spend

**Status, 2026-09-01. The recommendation is to close P1's firing half and keep
its budget half, which has shipped.** §4b landed in `0c9dd8a`. §3 and §4a — the
firing rule — are recorded as a design and are **not** proposed for
implementation, because §5.2 evaluated them against every verifier dispatch this
project has ever made and found they would have skipped none of them.

No benchmark was run to produce any of this: `tests/bench/verifier-correctness.mjs`
was never invoked, and the 224-run suite this document originally specified is
withdrawn rather than pending. Prompt snippets in §4a are proposals quoted inside
this document and are not in `templates/`.

Written against the [#32 Phase 3
disposition](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/32#issuecomment-5488831930)
(continue at narrow scope; P1 is next; #14 packaging is the phase after), #16's
P1 spec, and the redesign in
[`issue-53-phase1-trigger-derivation.md`](issue-53-phase1-trigger-derivation.md).

---

## 1. What is left of P1, because half of it already shipped

P1 as written is two changes in one line: *"Rewrite the Completion Gate
(`pilotfish.md:51-57`) to fire on risk triggers, and give the verifier an
explicit budget."* Between #53 and #16's own earlier work, three of the four
things P1 was reaching for have already landed, and it matters to say which,
because the remaining lever is smaller than the issue's headline 24% suggests.

**Shipped: the refutation bar.** `f7e93a8` replaced the scope paragraph of
`templates/pilotfish/prompts/verifier.md` with the reachability-and-
demonstrability text derived in #53. That is the change that moved stopping
power from 6.7% to 86.7% on class B2 and reproduced on the frontier seat. The
verifier prompt is not in scope here and this proposal does not touch it.

**Shipped: the chain budget.** `pilotfish.md:63` already ends a chain after the
second `REFUTED` on one claim, and `pilotfish.md:60` already tells the primary
that verification is a bounded question rather than an audit. Both landed in
`9332e48`. The 19-run chain that produced 60% of all verifier runs is the thing
those two rules were written against.

**Shipped: the runaway backstop.** `templates/opencode.base.jsonc` sets
`verifier.steps = 60`, from #16 P4. There is a hard ceiling on a single verifier
run already.

**Not shipped, and the actual subject of this proposal:** the gate still fires
on every non-trivial change, and the only thing that lets it not fire is
`pilotfish.md:64` — *"Small, obvious changes may skip independent verification
when it would cost more than it could reasonably protect."* That sentence is a
judgment call handed to the agent that wrote the change, with no criterion in
it. It is both the entire firing rule and, as §3 argues, the wrong shape of one.

So P1 reduces to two deliverables: **a firing rule** (§3, §4a) and **an explicit
budget** (§4b). The budget shipped. The firing rule was designed, then evaluated
against the historical corpus in §5.2 and found to save nothing, so it is
recorded rather than built.

---

## 2. Why this is not a severity bar

The derivation established this and it is not re-argued here, only recorded so
the proposal below is legible as following from it.

Sorting the 44 historical refutations by severity and taking the top buckets
gives miss rates of 65.9% (security only), 52.3% (+ race), 36.4% (+ host
contract), 20.5% (+ doc-vs-code), 4.5% (+ lifecycle and missing feature), 0%
(all seven). The largest single improvement in that ladder — sixteen points —
comes from admitting *documentation contradicts code*, which is the least severe
shape in the sample. A severity-ordered list has to break its own ordering at
the third rung to become defensible, so severity is not a dimension that sorts
these verdicts. §7's independent re-derivation against the recovered 44
strengthens rather than weakens this: security reproduces exactly at 15/44, but
roughly a fifth of the sample moves across the tail buckets under a second
reader, so the shape boundaries are soft enough that two careful people
partition them differently.

One consequence carries directly into the firing rule and is the hinge of §3: a
list that covers every shape is not a filter. **Any positive allowlist of "what
kinds of change deserve verification" is a shape list under a different name,**
and it inherits the same failure — either it misses a third of what the gate
catches, or it is broad enough to be no filter at all.

---

## 3. The proposed mechanism: a closed skip list, not a risk-trigger list

The redesign that worked for *what the verifier may refute on* was to stop
asking what kind of defect it is and start asking what the verifier can reach
and show. Mirrored onto *when the primary dispatches*, that becomes:

> Fire the gate unless there is nothing in this change the verifier could reach
> and demonstrate failing.

Written that way the rule inverts. It is not a list of triggers that turn the
gate on; it is a closed, exhaustive list of conditions that turn it off, where
every entry is justified by *the verifier had no refutable surface here*, never
by *the defect would have been minor*. Three properties follow, and they are the
reasons to prefer this over a trigger list:

1. **It is falsifiable per change.** "Does any program in this repository read
   what I touched?" is a fact the primary can check. "Is this change risky?" is
   not, and #53 Phase 1 showed that the same judgment inside the verifier —
   deciding a demonstrated defect was "an unrelated behavior change in the same
   commit" — is exactly where the old prompt lost catches.
2. **Its errors are visible.** A skip is a claim that the change had no
   refutable surface, and that claim can be checked after the fact against the
   diff. A trigger list's error is a silent non-firing on a change nobody
   classified.
3. **It cannot quietly widen.** A closed list grows only by someone adding an
   entry and arguing for it. `pilotfish.md:64` as written widens every time an
   agent feels confident.

The cost, stated as a trade rather than hidden: **this rule skips very little.**
That was written as a prediction and §5.2 turned it into a measurement — across
62 historical dispatches it skips nothing, including the one documentation-only
change, which it refuses by name. The saving it was reaching for lives in prose
commits, changelog entries and reverts, and the corpus contains none that a
completion gate ever fired on. This is the paragraph that ends up deciding
against the rule.

### The one positive trigger, and why only one

Security is the single exception: a change touching authentication,
authorization, credentials, identity, privacy, secrets, cryptography, input
validation, or a trust boundary always fires, and no skip condition applies to
it. This is not a severity bar smuggled back in. It is the one bucket whose
count reproduced *exactly* under an independent classification of the recovered
44 — 15/44, 34%, unchanged between two readers when the rest of the tail moved
by about a fifth of the sample. It is the only shape in the whole derivation
that survives being re-read by someone else, and it costs nothing to name,
because under the skip list every security change would have fired anyway. It is
there as a backstop against a future skip condition being added carelessly.

---

## 4. Proposed rewrite — §4a NOT SHIPPED AND NOT PROPOSED, §4b SHIPPED IN `0c9dd8a`

Both edits are inside `## Completion Gate` in
`templates/pilotfish/prompts/pilotfish.md`. Nothing else in the file changes,
and `verifier.md` is untouched.

### 4a. The firing rule

**BEFORE** — `pilotfish.md:57`, the sentence that opens the section:

> Before reporting non-trivial implementation as complete, send the claimed
> outcome and relevant paths or diff to `verifier`.

**BEFORE** — `pilotfish.md:64`, the only thing today that lets it not fire:

> - Small, obvious changes may skip independent verification when it would cost
>   more than it could reasonably protect.

**AFTER** — `:57` becomes:

> Before reporting non-trivial implementation as complete, send the claimed
> outcome and relevant paths or diff to `verifier`. Fire the gate unless the
> change meets one of the skip conditions below. Those conditions are the whole
> list: a change that is merely small, obvious, or one you are confident in is
> not on it, and neither is one you have already tested yourself.

**AFTER** — `:64` is replaced by this block:

> - Skip only when there is nothing in the change a verifier could refute on.
>   That bar is the verifier's own: it refutes what is reachable from the code
>   the change touched and what it can demonstrate failing with a concrete
>   counterexample. So the gate may be skipped when the change touches nothing
>   any program in this repository reads — prose, a changelog entry, a comment
>   no tool consumes — **and** asserts nothing about behavior that code could
>   contradict. Documentation that describes what the code does is not on this
>   list. A documented behavior the code contradicts is one of the shapes the
>   verifier refutes on, and it is the shape a severity bar would have thrown
>   away.
> - Skip also when the change restores an exact prior committed state, and you
>   have run `git diff <sha>` against that state and seen it empty. The empty
>   diff is the evidence, and you produce it before you skip rather than after.
> - Never skip a change that touches authentication, authorization, credentials,
>   identity, privacy, secrets, cryptography, input validation, or a trust
>   boundary, whatever else is true of it. About a third of every refutation this
>   gate has ever produced is that shape, and it is the one shape two independent
>   readings of the sample agree on exactly.
> - Cost is not a skip condition and neither is your confidence in the change.
>   Whether a counterexample exists in work you just wrote is the judgment being
>   delegated, so it is not available to you as grounds for not delegating it. An
>   argument that verification would cost more than it protects is available for
>   every change ever made, and accepting it once ends the gate.

### 4b. The budget

**BEFORE** — `pilotfish.md:63`, the existing chain rule, kept verbatim and
extended:

> - Budget the chain, not only the run. After the second `REFUTED` on the same
>   claim, stop dispatching and take the work into this session. …

**AFTER** — `:63` keeps its existing text and gains a numeric backstop; two new
bullets join it. This is what shipped in `0c9dd8a`; the wording there is final
and differs slightly from the draft below, which is left as written:

> - Budget the chain, not only the run. After the second `REFUTED` on the same
>   claim, stop dispatching and take the work into this session. *[existing text
>   unchanged]* At most three verifier dispatches may ever run against one
>   claim, counting re-verifications; the second-`REFUTED` rule normally ends a
>   chain sooner, and the count is the backstop for verdicts that alternate.
> - Budget the run. The brief carries the claim, the immutable baseline
>   reference, and the surface the verifier may work over: the files the change
>   touched and their immediate callers. It does not carry a request to look
>   anywhere else, and you do not widen it on a second dispatch. One dispatch per
>   claim per state of the code — re-running the gate against unchanged code
>   produces no new evidence and is the loop the audit rule below exists to stop.
> - An observation does not reopen the claim it arrived under. When a verifier
>   returns `CONFIRMED` with a finding beside it, that finding is yours to scope:
>   if it belongs to this change, it becomes new work with its own claim and its
>   own single gate firing. It never restarts the gate on the claim just
>   confirmed.

### 4c. What this does not change

`:59` (the unforgeable baseline), `:60` (bounded question, not an audit), `:61`,
`:62`, and the closing paragraph on commissioned adversarial audit are all
unchanged. So is every prompt other than `pilotfish.md`.

### 4d. A harness prerequisite, now moot for P1 but not for the harness

Moot here, because §5 withdrew the benchmark this was a prerequisite for. Kept
because its second half is a standing safety gap that nothing else tracks.

`resolveVariant` in `tests/bench/lib/variants.mjs` takes **one** `{replace,
with}` per file, so a variant cannot express two separate anchors in
`pilotfish.md`. Two ways out: replace the contiguous block `:57`–`:64` as a
single anchor, which drags the very long baseline bullet at `:59` into the
variant text and couples the variant to every future edit of it; or let `edits`
accept an array applied in order, each still failing closed on a missing or
duplicated anchor. **The array is the better option** — it keeps each anchor
minimal and is a few lines — and it pairs with §6.5 of the derivation doc, which
notes the `edits` mechanism has no test at all and names the three cases that
would cover it (anchor missing, anchor duplicated, mixed line endings). **Those
three tests are worth writing whatever happens to P1**: fail-closed resolution is
what stands between a drive-by reword of a pinned prompt and a silently
mispatched experimental arm, and today it is guaranteed only by hand probes
recorded in a document.

---

## 5. Measurement — RESOLVED RETROSPECTIVELY, 2026-09-01

**Superseded.** This section originally specified 224 in-situ benchmark runs.
That design was wrong for the question, and the fields that do this in
production say so. It is replaced by a retrospective evaluation that cost no GPU
time and no tokens, and that answers the question the suite was meant to answer.
The original plan is preserved in git history at `7dbf33f` rather than reprinted.

### 5.1 What the prior art does instead

Deciding which changes deserve an expensive check is a solved problem outside
agent systems, and none of the mature approaches evaluates a gate by running it
live.

**Predictive test selection** (Meta, in production since 2018) picks per-change
which tests to run. Three practices transfer. It reports a **metric pair with
explicit floors** rather than a single quality verdict — over 95% of individual
test failures and over 99.9% of faulty changes still caught, stated alongside
the 2x infrastructure saving. It **validates on held-out recent changes**, not a
random split, because the change distribution drifts. And it **de-flakes the data
before training and evaluation**, or the gate learns to predict nondeterminism
rather than defects. That last one is not academic here: #53 had to rescore
1,916 stored runs after the throttle detector and `parseVerdict` each mis-graded
runs, which is this project's flakiness in the same sense.

**Effort-aware just-in-time defect prediction** is a large literature on exactly
"which changes deserve inspection," and it supplies the evaluation instrument. It
does not grade a gate pass/fail. It uses an **effort–recall curve** — recall at
k% of effort (PofB20, R@20%) and Popt, the area between the curve and a perfect
oracle's. Applied here that means plotting catches retained against gate firings
saved across candidate rules, which says whether *any* rule has a usable
operating point before one is built.

**Selective verification for LLM reasoning** contributes two findings, with the
caveat that it is single-turn reasoning work and the transfer to a code-change
gate is an analogy rather than evidence: cheap observable features perform about
as well as learned gates, and verification can *hurt* when miscalibrated — which
is the class-D false-refuse risk in another vocabulary.

The common practice is the important part. **Gates are evaluated by replaying
candidate rules against recorded history.** This project has that history.

### 5.2 The retrospective evaluation, and its result

The 62 exported historical verifier sessions
(`tests/bench/data/historical-verifier-sessions.json`) carry the full dispatch
brief alongside the verdict. So each one can be asked directly: would §4a's skip
rule have skipped this dispatch? That is the same method §7 of the derivation
doc used for shapes, applied to firing instead, and it is free.

Done, with per-session judgements and rationales in
[`tests/bench/data/gate-firing-classification.json`](../tests/bench/data/gate-firing-classification.json).

| | count |
|---|---:|
| dispatches | 62 |
| completion gates | 57 |
| read-only reviews (the rule does not govern these) | 5 |
| **would have been skipped** | **0** |
| **would have been skipped, among the 44 `REFUTED`** | **0** |

Why each one fires: 31 touch code or host-consumed configuration, 25 touch
authorization or a trust boundary and hit the always-fire clause, 1 is
documentation only, and 5 are not gate firings at all.

**The saving on the only corpus of real work that exists is nil.**

Two details worth more than the headline. The single documentation-only
completion gate in the sample — index 10, README plus walkthrough plus install
runbook, the brief stating explicitly that no code changed — is the exact case
§4a refuses to skip, because the prose asserts what the installer does. The rule
was written to refuse it, and the one chance it had to fire, it refuses. And
**five dispatches are not completion gates at all**: the verifier was used as a
read-only reviewer of a document or of repository state. A firing rule does not
reach that usage, which is a fifth of the pre-scope corpus.

### 5.3 What this evaluation does not establish

Stated as limits rather than buried. It is **one classifier pass by one reader**,
the same standing as §7's shape re-derivation, and the tail there moved by about
a fifth under a second reader. It reads **briefs, not diffs** — the export
carries dispatch text and verdicts, not the changes — so a brief that understates
its own surface is classified from what it says. The 25 security-clause hits are
counted by **what the change touches**, which is a different question from §7's
15/44 count of what defect *shape* was found; the two numbers are not in conflict
and are not comparable. And the corpus is three of this project's own
repositories over four weeks, one of which was a security sprint.

None of those limits moves the result, because the result is not marginal. To
overturn "zero skipped" a second reader would have to find that a dispatch
touching executable source touched none.

### 5.4 What would still need measuring, if the rule were built

Nothing on the bench. The class B, B2 and D fixtures all change files under
`src/`, so the predicted skip rate there is 0% by construction and a suite would
re-measure fixture composition — the same failure §3 of the derivation doc
identified in #53's original Phase 1 design.

What is missing is the **positive** direction: the rule is now shown never to
skip something it should have caught, and never shown to skip anything at all.
Demonstrating it skips correctly needs fixtures the corpus does not contain — a
changelog-only commit, a prose README edit, and, most importantly, a README edit
that states what the code does and states it wrongly, which is the false-skip
floor and the analogue of class D. That work is only worth funding if the firing
rule is being built, and §7 recommends it is not.

## 6. Decisions I made that are normally yours

Made rather than stalled on, per the standing instruction; each is reversible
and each names what I rejected.

1. **Closed skip list instead of a positive risk-trigger list.** #16 P1 asks for
   "risk triggers". §3 argues a positive list is a shape list under another name
   and inherits the derivation's failure. **Rejected alternative:** trigger set C
   or E from the derivation's table, which §6.2 there says is a one-line swap.
   Both are defensible on the historical sample and neither is distinguishable
   on this corpus.
2. **Security kept as the one positive trigger.** It is redundant under the skip
   list — every security change would fire anyway — so it is there as a backstop
   against a future skip entry. **Rejected:** dropping it for cleanliness, which
   costs the only bucket two independent classifications agree on exactly.
3. **A three-dispatch numeric cap per claim**, on top of the existing
   second-`REFUTED` rule. Matches #16's revised criterion of ≤3. **Rejected:** ≤2,
   which forbids the ordinary refute→fix→confirm→refute-again sequence.
4. **Evaluating the rule retrospectively rather than by benchmark**, once the
   prior art made clear that is how gates are graded everywhere this problem is
   already solved. **Rejected:** the 224-run in-situ suite this document
   originally specified, which would have cost 20–45 hours of local GPU to
   re-measure fixture composition. That reversal is mine and it is the single
   most consequential call in this document.
5. **Counting a read-only review as outside the rule** rather than as a skip. A
   firing rule governs the Completion Gate; five dispatches gate nothing.
   Counting them as skips would have manufactured a saving the rule does not
   produce.
6. **Classifying the security clause by what the change touches**, not by the
   defect shape that was found. It is the only way to evaluate a firing rule,
   which must decide before the defect is known — but it means the 25 here and
   §7's 15/44 there are different measurements and must not be compared.

Withdrawn with the benchmark, and recorded only so nobody re-derives them: the
non-inferiority margin, the two-arm variant design, class B's demotion, the
ordered-array change to `edits`, and the second brief function that would have
let an in-situ run decline the gate.

## 7. Open questions for you

**Answered since this was drafted.** §5.2 settles the one that mattered: the
firing rule would have skipped zero of 62 historical dispatches, so its saving on
real work is nil. **The recommendation is to close P1's firing half** — §3 and §4a
stand as the design, recorded for whoever revisits it, but nothing here argues for
building it. §4b's budget rules are separable, carry no measurement burden, and
shipped in `0c9dd8a`.

The questions that only existed to serve the benchmark are withdrawn with it: the
local-preset prerequisite, the omlx grant, the prose fixtures, and whether class B
is in or out. None of them has to be answered now.

What remains for you:

1. **Accept closing P1's firing half**, on §5.2 rather than on the prediction this
   document originally offered.
2. **Adopt the effort–recall framing** from §5.1 as the standard instrument for any
   future gate change here, in place of a binary pass/fail on a stored rate.
3. **Reopen the firing rule only on new evidence** — specifically, if the post-#53
   corpus starts carrying prose-only or revert commits at a rate the pre-scope
   sample did not. That is a query against accumulated sessions, not a benchmark.
