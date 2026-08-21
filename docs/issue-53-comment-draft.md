<!--
DRAFT for posting to issue #53. Not documentation — delete this file once posted.
Everything in it is sourced from docs/issue-53-phase1-trigger-derivation.md.
Nothing here has been posted to GitHub.
-->

## Phase 1's third arm is built, and two of the phase's premises did not survive building it

Addresses the acceptance line *"`severity-triggered` variant built with an
empirically derived trigger list, and the list's miss rate against all 44
historical refutations reported."* Full derivation in
`docs/issue-53-phase1-trigger-derivation.md` on `bench/issue-15-seat-comparison`.
No provider was called; everything below is offline work.

### First: the 44 are gone

This issue names the source as the 44 historical `REFUTED` verifier sessions in
`~/.local/share/opencode/opencode.db`. That database now holds a schema, 38
`migration` rows and one `project` row — **0 sessions, 0 messages, 0 parts**, and
zero occurrences of `verifier`, `REFUTED` or any `ses_*` id in either the file or
its 248 KB WAL. The data directory was recreated **2026-08-14**; the sample was
taken **2026-08-10**.

Searched and not found: any `.bak` or dated copy under the home directory; a
second `opencode.db` of any size (the only other one, 1.1 MB in a fixture temp
dir, holds 25 sessions — 1 `pilotfish`, 24 `scout`, no verifier); an export in
any of this repository's 304 commits, on any branch, or in a stash.

So the partition **cannot be verified at source, now or ever.** It is not
invented here, though — it traces to the
[class-B calibration review](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361704033),
and it survives all five consistency checks that remain available (coverage sums
to 44; the shares match; the "set aside the security sprint" residual is 29;
`cases.mjs:24` independently records the same ~5% local-logic figure from a
different pass; and nothing in the coarser 2026-08-10 read contradicts it). It is
used below as given, with the two sampling biases the review states about itself
— 15 of 44 come from one security-hardening sprint, and all 44 are what a strong
verifier *chose* to refute on.

Two properties of the sample that this issue's one-line summary drops, and that
turned out to decide the design: **41% of the 44 explicitly note the test suite
passed anyway**, and refutations cite a mean of **1.3 distinct files**.

### Miss rate per candidate trigger set

At bucket resolution — the only resolution the surviving write-ups preserve, and
the same one this issue's own viability test uses.

| set | fires on | covers | misses | **miss rate** |
|---|---|---:|---:|---:|
| **A** | security/adversarial | 15 | 29 | **65.9%** |
| **B** | + race/shared resource | 21 | 23 | **52.3%** |
| **C** | + host/external contract | 28 | 16 | **36.4%** |
| **D** | + doc contradicts code | 35 | 9 | **20.5%** |
| **E** | + lifecycle, + missing feature | 42 | 2 | **4.5%** |
| **F** | all seven | 44 | 0 | **0%** |

The viability floor checks out arithmetically: a set missing security and race
misses 21/44 = **47.7%**, the "48%" this issue names. **A and B fail it. C is the
narrowest viable set, and it still discards 36% of what the gate historically
caught.**

### Recommendation: keep P1's goal, move its mechanism off severity

Two findings from the ladder, both pointing the same way.

**The severity dimension does not sort the sample.** The largest single step in
the table, C → D at 16 points, is admitting *documentation-contradicts-code* —
low severity by any bar anyone would write. A severity-ordered list has to break
its own ordering at the third rung to become defensible. This is the same wall
`docs/issue-16-evidence.md` hit on 2026-08-10 from the coarser two-group read;
the finer partition quantifies it rather than overturning it.

**And the one exclusion the data tolerates buys nothing.** Set E drops only
local-logic-inside-one-function: **2 refutations in 44**. A gate that fires 4.5%
less often does not address a 24%-of-generation cost.

So the filter moves off *what kind* of defect it is and onto *what the verifier
can show*: refute an out-of-claim defect when it is **reachable from code the
change touched** and you have a **concrete counterexample**; observe what you can
only assert. That also aims at where the volume actually is. This issue inherits
from #16 the finding that three parent sessions produced 60% of all verifier
runs, and that the 19-run chain found *a different defect each time* — an
open-ended audit of pre-existing surface. The reachability bound is what
terminates that; gate frequency never was.

Honest accounting: on shape this list's miss rate is **0%**, which is a way of
saying the shape dimension was abandoned rather than tuned. On reachability the
miss rate is **deliberately non-zero and unquantifiable** — the later findings of
the long chains are exactly what it drops, and nothing surviving records how many
of the 44 were pre-existing-surface findings. That is the trade, stated as a
trade.

### Second premise that did not survive: Phase 1 as sized would measure the fixtures

Mapping each seeded class-B defect to the same seven shapes:

| case | shape |
|---|---|
| `b-containment-inverted` | security/adversarial |
| `b-shared-default-mutation` | race/shared resource |
| `b-config-read-adjacent` | host/external contract |
| `b-cap-boundary-strict` | local logic in one function |
| `b-tail-off-by-one` | local logic in one function |
| `b-timeout-guard-adjacent` | local logic in one function |

The corpus is **50% local-logic against the field's 4.5% — elevenfold
over-represented** — and contains no instance of three of the seven shapes.
Consequences for the 216 planned local runs:

- A variant that obeys its list scores roughly *in-set share × detection rate*,
  and detection is already measured at 95–100%. So the number Phase 1 returns is
  close to arithmetic: A ~16%, B ~32%, C/D/E ~48%, F ~95%.
- **Sets C, D and E are indistinguishable on this corpus** — they differ only in
  shapes the fixtures do not contain.
- **Set B's predicted 32% lands on top of the pre-registered 30% effect**, so
  hitting the target would be consistent with a list that fails the viability
  floor above.
- The corpus is biased toward the broadest set, so run as designed Phase 1 will
  find that the broadest list wins — driven by fixture composition, not by the
  prompt.

This is not fixable by adding fixtures. The calibration review already ruled out
seeding races (non-deterministic, would poison deterministic scoring) and
adversarial cases (measure a competence #16 never changed) — **the two shapes that
dominate the field are the two this harness cannot seed.**

Cheapest repair, and it costs no extra runs: pre-register the *predicted* ceiling
for the chosen set from the table above and test the prompt against that, rather
than against `current`. A prompt scoring far below its predicted ceiling is
disobeying its list, which is the thing this corpus can actually measure.

### What was built

```bash
node tests/bench/verifier-correctness.mjs validate --variants severity-triggered
```

**The working-tree `verifier.md` was not edited.** Doing that literally would
redefine `current` — documented as "the working tree prompts" — and silently
invalidate every stored result graded against it. The new text lives in the
variant instead.

Variants can now pin a prompt two ways: `prompts` reads a file out of a git ref
(unchanged, still what all three existing variants use), and `edits` replaces one
exact passage in the working-tree copy, for a variant written for an experiment
and so having no ref to recover. An edit rather than a stored copy, so it keeps
substituting for exactly the one scope paragraph as the rest of the prompt
changes; a stored copy would quietly accumulate every other difference and stop
being the contrast the A/B isolates. Anchored on the passage text, not a line
number, and **fails closed** on a missing, reworded or duplicated anchor — before
the queue is built, so a drive-by prompt edit aborts at zero spend instead of
patching the wrong paragraph and returning a clean-looking arm.

Verified: `current`, `pre-scope` and `pre-scope-gate` resolve to identical
override sets, text and digests; `DEFAULT_VARIANTS` unchanged, so the new arm is
opt-in and no existing invocation changes behaviour; the resolved prompt
preserves the other eleven paragraphs byte-for-byte; the working tree is
untouched; `node --test tests/bench/scoring.test.mjs` 79/79.

Two defects found while verifying and fixed: the replacement is written with bare
newlines and this checkout is CRLF, so the first version emitted a prompt
carrying both endings — reproducible from no ref, and recorded by `promptDigests`
as if the wording had changed. The edit now adopts the file's ending, and throws
on a file that already mixes them.

**Known gap:** the `edits` mechanism has no test. Fail-closed resolution is its
load-bearing safety property and is currently guaranteed only by manual probes.
Three cases in `scoring.test.mjs` would cover it (anchor missing, anchor
duplicated, mixed endings), taking the count 79 → 82.

### Acceptance status

- [x] `severity-triggered` built, resolvable offline
- [x] Miss rate reported against all 44 — at bucket resolution, which is all that
      survives, with the per-candidate ladder above
- [ ] **Trigger list derived from the 44** — derived from the surviving
      *classification* of the 44, not from the sessions. The sessions are gone.
      Flagging rather than ticking.
- [ ] Phase 1 run — **should not start until the design point above is settled**
- [ ] Class D in the Phase 1 run, not after it. Both changes here loosen what may
      be refuted relative to `current`, so the false-`REFUTED` floor is the
      outcome at risk, not false `CONFIRMED`.

### One open decision

The variant keeps this issue's name and its resolvable id, but the bar it draws
is reachability and demonstrability, **not severity**. #16 P1's Risks section
authorises exactly this — *"if those verdicts cluster outside the proposed
triggers, P1 must be redesigned"* — but it is a deviation from the plan as
written. To keep a shape list instead, sets C (36.4% miss) and E (4.5%) are the
two defensible ones and each is a one-line edit inside
`SEVERITY_TRIGGERED_SCOPE`; note the ceiling that imposes on Phase 1.
