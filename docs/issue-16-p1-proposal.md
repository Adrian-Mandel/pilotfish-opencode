# Issue #16 P1: a proposal for when the Completion Gate fires, and what it may spend

**Status: draft for review. Nothing here has shipped, nothing has been posted to
GitHub, and no benchmark was run to produce it.** Every prompt snippet below is
a proposal quoted inside this document; `templates/pilotfish/prompts/` is
untouched on this branch. The measurement plan in §5 is written, not executed —
`tests/bench/verifier-correctness.mjs` was not invoked.

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

So P1 reduces to two deliverables: **a firing rule** (§3, §4) and **an explicit
budget** (§4), plus a measurement that the firing rule does not cost catches
(§5).

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
On the entire existing bench corpus it should skip nothing at all (§5.4). The
saving it produces is real but small and lives outside the fixtures — prose
commits, changelog entries, reverts — which is why §5 measures safety on the
bench and saving from real telemetry, and does not pretend one measures the
other.

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

## 4. Proposed rewrite — DRAFT SNIPPETS, NOT SHIPPED

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
bullets follow it:

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

### 4d. One harness prerequisite

`resolveVariant` in `tests/bench/lib/variants.mjs` takes **one** `{replace,
with}` per file, so a variant cannot express two separate anchors in
`pilotfish.md`. Two ways out: replace the contiguous block `:57`–`:64` as a
single anchor, which drags the very long baseline bullet at `:59` into the
variant text and couples the variant to every future edit of it; or let `edits`
accept an array applied in order, each still failing closed on a missing or
duplicated anchor. **The array is the better option** — it keeps each anchor
minimal and is a few lines — and it pairs with §6.5 of the derivation doc, which
notes the `edits` mechanism has no test at all and names the three cases that
would cover it (anchor missing, anchor duplicated, mixed line endings). Do both
in one change, or the fail-closed property that stands between a drive-by reword
and a silently mispatched arm stays guaranteed only by hand probes.

---

## 5. Measurement plan — WRITTEN, NOT RUN

The claim to be defended is a **non-inferiority** claim: the new gate does not
lower the rate at which a defective change is stopped. That is not the shape
#53's Phase 1 measured, and sizing it as a superiority test would be wrong.

### 5.1 The constraint that shapes everything: this cannot run in replay

`--replay` binds `--agent verifier` and runs **no primary at all**
(`verifier-correctness.mjs:263-268`, `:404-425`). The gate-firing decision lives
in the primary, so every arm of this measurement has to be **in situ**. That is
the expensive mode, and it is not negotiable: replaying a stored brief past a
verifier measures the refutation bar, which already shipped and is not what P1
changes.

**And the in-situ brief currently forces the gate.** `briefFor` (`tests/bench/lib/cases.mjs:173`) ends with *"Run your completion gate on this claim
and report the verdict you get back"*, and its own comment says why — *"a run
where the primary decides the change is small enough to skip verification
produces no verdict at all."* That sentence was correct for every measurement so
far and makes this one impossible. A P1 arm needs a **natural brief** with that
instruction removed, identical across arms, and it needs the *old* brief left in
place so no stored result changes meaning. Concretely: a second exported
function beside `briefFor`, selected by a flag, never a mutation of the existing
one.

### 5.2 Variants

| arm | what it is | how it resolves |
|---|---|---|
| `current` | the shipped `pilotfish.md` and the shipped `verifier.md` | `prompts: {}` — already the baseline in `VARIANTS` |
| `p1-gate` | `current`, with §4a and §4b substituted into `pilotfish.md` | `edits: { "pilotfish.md": [ … ] }`, needing §4d |

Two arms, not three. `pre-severity` and `pre-scope` are about the verifier's
refutation bar and are held constant here; the whole point of running against
`current` is that the shipped verifier prompt is identical in both arms, so any
difference is the gate.

### 5.3 Seat, mode, and pairing

- **Local seat only, zero paid tokens.** `bambi/qwen3.8-27b-mtp-pure` as both
  primary and verifier.
- **In situ**, per §5.1.
- **Paired on brief, satisfied by construction.** `briefFor` (and its natural
  replacement) is a pure function of the case and mentions no fixture path, so
  both arms receive a byte-identical brief at the same `(case, repeat)` index
  under one seed. This is tighter pairing than the replay store gives, because
  there is no brief selection step to drift.
- **One suite, one seed, one harness commit, order randomized across arms** —
  the correction #53 already had to make once when two arms ran twenty hours
  apart and variant was confounded with local-server state.

**Two prerequisites the owner has to clear before this can run at all:**

1. **`profiles.json` in the repo has no local preset.** The harness resolves
   `--primary` against `templates/pilotfish/profiles.json`
   (`lib/routing.mjs:19-21`), which defines only `chatgpt`, `antigravity`, and
   `openrouter`. The `local` preset and the `bambi/qwen3.8-27b-mtp-pure` profile
   exist **only in the installed config** at `~/.config/opencode/pilotfish/`,
   where they are recorded as user-added. So `--preset local` fails today. Either
   the local profile is promoted into the shipped template, or the harness is
   taught to read the installed file — and the first has a scope consequence
   (#30's remnant, profile-naming enforced for templates but not installs)
   the second does not.
2. **The installed local profile routes four roles to `omlx/…`.** `scout`,
   `Explore`, `mech-executor`, and `executor` bind
   `omlx/peculiar-ragdoll/Nail-Qwen3.6-35B-A3B-MLX`. An in-situ primary can
   dispatch those, and `docs/issue-53-handoff.md` records that omlx and mtplx
   need explicit permission where bambi is standing. Either bind all eight
   worker roles to bambi for the bench profile, or grant omlx for the run. **Do
   not start the suite without deciding this.**

### 5.4 Classes, outcomes, and one scoring change that is load-bearing

Classes **B**, **B2**, and **D**, as specified.

The scoring change: `summarizeCell` in `lib/scoring.mjs:243-249` excludes
`not-dispatched` from the denominator, on the stated grounds that it "is not
evidence either way about detection." That is right for every measurement taken
so far and **wrong for this one** — under P1 a non-dispatch *is* the outcome
under test. The plan therefore pre-registers a derived metric rather than
reinterpreting an existing one:

- **Primary outcome (B, B2): end-to-end catch rate** = `caught` ÷ *all valid
  runs*, with `not-dispatched` counted as a non-catch. This is the number the
  non-inferiority test runs on.
- **Secondary (B, B2): skip rate** = `not-dispatched` ÷ valid runs. Reported per
  arm and per case, and every non-zero cell hand-read.
- **Guard (B, B2): false `CONFIRMED`** = `missed` ÷ dispatched runs, on the
  existing denominator. Must not rise. Baseline is 0/30 on B2 for the local
  seat.
- **Ship gate (D): false-`REFUTED` floor** = `false-refuted` ÷ dispatched runs.
  Must not rise above the shipped arm. Baseline is 0/40.
- **Also on D: skip rate**, where a skip is the *correct* outcome — a clean
  change is the population the saving should come from.

**Pre-registered prediction, stated before the run because it decides how to
read it.** Every class B, B2 and D fixture changes files under `src/`, so under
§4a none of them is skippable. **The predicted skip rate is 0% in every cell of
this suite.** If that holds, the suite has measured one thing: whether rewriting
this section of the primary prompt changes the end-to-end catch rate through any
channel at all — a different brief to the verifier, a different framing of the
claim — with firing held at 100% by the corpus. If any cell skips, that run is
the finding and is hand-read before anything else is reported. Either way the
suite **cannot demonstrate the saving**, and no number from it should be quoted
as if it had. §5.7 says where the saving is measured instead.

### 5.5 Pre-registered n and the read rule

Non-inferiority against the measured class-B2 baseline of 26/30 = 86.7%, one
planned interim analysis at the halfway point and no other partial reads —
#53's standing rule, which has been broken three times on this harness and been
wrong every time.

**Margin: 10 points.** `p1-gate` passes only if the lower bound of its 95%
Wilson interval on end-to-end catch rate sits above **76.7%**. The margin is
chosen against #16's own line — *"a net win that degrades the REFUTED rate is
not a win"* — and is deliberately tight rather than conventional.

At p₀ = 0.867 and δ = 0.10, one-sided 95%: n ≈ 1.645² × 0.867 × 0.133 ÷ 0.01 ≈
**31 per arm**, rounded up to the corpus's own grid.

| class | fixtures | repeats | per arm | both arms | role |
|---|---:|---:|---:|---:|---|
| **B2** | 6 | 6 | 36 | **72** | decisive — the realistic-commit tier |
| **D** | 4 | 10 | 40 | **80** | ship gate; 40 exactly matches the stored 0/40 |
| **B** | 6 | 6 | 36 | **72** | confirmatory, run last, droppable |

**Total 224 in-situ runs**, or 152 without class B.

Run order: **B2, then D, then B.** B2 decides; D is the gate; B is corroboration
on the easier tier and is the first thing to cut if the price comes back high.

**Price it before committing to it.** There is no measured figure for a local
in-situ run anywhere in the harness — `ESTIMATES` has in-situ only for
`gpt-5.6-sol` (1.2 min) and `gemini-3.1-pro` (0.5 min), and replay-only for
bambi (2.9 min). An in-situ bambi run is a full primary orchestration *plus* a
bambi verifier session, so it is certainly slower than 2.9 minutes and the
multiple is unknown. **Run six calibration runs first and record the number**,
the way the harness's own comment insists ("an unmeasured routing must say so
rather than borrow another one's number"). At a guessed 6–12 min/run the full
224 is roughly 22–45 hours of local GPU; that guess is not evidence and should
be replaced before anyone starts.

### 5.6 The gap this plan has, and the fixtures that would close it

Nothing in classes B, B2 or D can ever exercise a *correct* skip, because none
of them is skippable. So the skip rule is measured only in the negative
direction — it does not lose catches — and never in the positive one. Closing
that needs three new fixtures, and I am recommending it rather than
pre-registering it, because it is net-new work and it is the owner's call:

- **two that must be skipped** — a changelog-only commit, and a README edit that
  changes prose asserting nothing about behavior;
- **one that must not be skipped** — a README edit that *does* state what the
  code does, and states it wrongly. This is the false-skip floor, and it is the
  exact analogue of class D: the shape where a loosened rule fails silently and
  in the reassuring direction.

The third is the one worth the money. Without it, "the skip list is narrow" is
an argument in this document rather than a measured property. Briefs would need
in-situ capture; #53 Phase 1c established that a free seat (antigravity
gemini-3.1-pro, 9/9 valid) plus hand-verification of every brief is acceptable
and costs no gpt quota.

### 5.7 Where the saving is actually measured

Not here. #16's revised success criteria already name the two structural numbers
that read out of ordinary use, and they are the right instruments for a change
whose saving is a lower firing rate on real work:

| criterion | target | how it is read |
|---|---|---|
| max verifier runs against one claim | ≤ 3 | count `verifier` sessions grouped by parent in `opencode.db` |
| verifier runs per parent session, p95 | ≤ 4 | same query |

Both need accumulated post-change sessions, and both reset on any prompt edit —
which this is. Say so when the change lands, and do not read the sample for at
least a week of real use.

---

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
4. **Non-inferiority margin of 10 points.** Tight, and chosen against #16's
   no-degradation line rather than from convention. A looser margin shrinks n
   substantially and would let a real regression pass.
5. **Class B demoted to confirmatory and run last.** The calibration review
   already found class B measures diff-reading; B2 is the tier that decides.
   **Rejected:** dropping B entirely, since the brief asked for it and it costs
   only 72 runs at the end of a queue.
6. **Two arms, not three.** `pre-severity` is about a bar that already shipped
   and would confound the gate contrast.
7. **`edits` as an ordered array rather than one contiguous anchor** (§4d).
   **Rejected:** the single big anchor, which works today with no harness change
   but swallows the 700-word baseline bullet.
8. **A second brief function rather than editing `briefFor`.** Editing it in
   place would silently redefine every stored in-situ result, which is the same
   trap `variants.mjs` documents for `current`.

## 7. Open questions for you

1. **Is the small saving worth the change at all?** This is the honest headline.
   The chain budget already shipped, the derivation located the volume in chain
   depth rather than gate frequency, and the skip list proposed here skips
   nothing in the entire bench corpus. P1's original targets — verifier share
   <12%, verifier:executor <1.2 — were *withdrawn* by #16's own status comment as
   encoding a refuted premise. **A defensible answer is to close P1's firing half
   as done-by-other-means and keep only §4b's budget clarifications**, which are
   cheap and carry no measurement burden. I did not take that answer because the
   #32 disposition names P1 as next and worth real effort, but it deserves an
   explicit decision rather than a default.
2. **Which prerequisite for the local in-situ seat** — promote the local profile
   into the shipped `profiles.json`, or teach the harness to read the installed
   file? The first is a shipped-surface change with a #30 consequence; the second
   makes bench results depend on a machine's private config.
3. **Bind the bench's local profile's eight workers all to bambi, or grant omlx
   for the suite?** Nothing should start until this is answered.
4. **Fund the three prose fixtures in §5.6?** Without the third one, the false-
   skip floor is an argument rather than a number.
5. **Class B in or out**, given the price of in-situ runs once §5.5's
   calibration lands.
