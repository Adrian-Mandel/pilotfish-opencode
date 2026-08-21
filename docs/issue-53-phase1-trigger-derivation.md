# Issue #53 Phase 1: deriving the `severity-triggered` trigger list

What #16's P1 Risks section requires before P1 is implemented:

> Before implementing, sample historical verifier REFUTED verdicts and derive
> the trigger list empirically. If those verdicts cluster outside the proposed
> triggers, P1 must be redesigned.

This is that derivation. It ends in a redesign, for a reason the section
anticipated: the verdicts do cluster outside a severity boundary. The
recommendation keeps P1's goal and moves its mechanism.

## 0. The source sample no longer exists on disk

#53 names the source as the 44 historical `REFUTED` verifier sessions in
`~/.local/share/opencode/opencode.db`, and asks for the seven-bucket partition
to be verified rather than trusted. **It cannot be verified at source.** That
database contains no verifier sessions, and no session data at all:

| check | result |
|---|---|
| `session` rows | 0 |
| `message` / `part` rows | 0 / 0 |
| occurrences of `verifier` or `REFUTED` in the db file, raw | 0 |
| the same, in the 248 KB `-wal` | 0 |
| session-id-shaped tokens (`ses_*`) anywhere in db or WAL | 0 |
| non-empty tables | `migration` (38), `project` (1) |

The data directory itself was recreated on 2026-08-14; the file holds a schema,
one project row, and nothing else. The measurement in
[`issue-16-evidence.md`](issue-16-evidence.md) was taken on 2026-08-10, four
days before. The reproduction command that document records still parses, and
now returns nothing.

Searched and not found: a `.bak` or dated copy anywhere under the home
directory; a second `opencode.db` of any size (the only other one, 1.1 MB in a
`pilotfish-fixture-*` temp dir, holds 25 sessions — 1 `pilotfish`, 24 `scout`,
no verifier); an export of the 44 in any of this repository's 304 commits, on
any branch, or in a stash. Windows shadow copies were not attempted.

**Consequence for #53's acceptance criterion.** The line *"the list's miss rate
against all 44 historical refutations reported"* can be satisfied only at the
resolution the surviving write-ups preserve, which is bucket counts. Miss rates
below are computed per bucket, exactly as #53's own viability test is stated
("misses the security and race buckets … that is 48% of the sample"). No
per-session recount is possible, and no future one will be.

## 1. Provenance of the partition, and what can still be checked

#53 presents the seven buckets without a source. They trace to
[issue #15 comment 5361704033](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/15#issuecomment-5361704033),
the class-B calibration review, which states the classification, the window
(2026-07-14 to 2026-08-10), the seat (`openai/gpt-5.6-sol@high`), and that every
one of the 44 was assigned exactly one shape. So the partition is not invented
in #53 — it is quoted from a prior analysis. That analysis is the thing that can
no longer be re-derived.

Five checks it does survive:

1. **Coverage.** 15 + 7 + 7 + 6 + 4 + 3 + 2 = 44. No bucket double-counts.
2. **Shares.** 34 / 16 / 16 / 14 / 9 / 7 / 5 % match the counts to the rounding
   shown (sum 101%).
3. **The residual claim.** The comment says that setting aside the 15-case
   security sprint leaves 29 that are "still races, contract mismatches and doc
   drift, with the same two local-logic cases": 7 + 7 + 6 + 4 + 3 + 2 = 29.
4. **Independent corroboration inside the repository.**
   [`cases.mjs:24-25`](../tests/bench/lib/cases.mjs) records "about 5% of real
   defects" for the class-B shape, written against the same sample — matching the
   2/44 local-logic bucket, from a different file and a different author pass.
5. **Consistency with the 2026-08-10 read.** `issue-16-evidence.md` describes
   the same 44 qualitatively as two groups, naming installer ownership forgery,
   manifest write races, and router authorization binding (→ buckets 1 and 4)
   against `AGENTS.md` documenting a removed helper, stale `PROJECT_NOTES.md`,
   and a documented screenshot filename never written (→ bucket 3, three named
   instances of seven). Nothing in the coarse read contradicts the fine one.

Two biases the calibration review states about its own sample, both of which
matter to the trigger design and neither of which appears in #53's one-line
summary: **15 of 44 come from a single early-August security-hardening sprint**,
so the security bucket's 34% is partly a record of what was being worked on; and
the 44 are what a strong verifier *chose to refute on*, not a random sample of
defects, so they are biased toward findable ones.

And one property of the sample that turns out to decide the design: **41% of the
44 explicitly note that the test suite passed anyway**, and refutations cite a
mean of 1.3 distinct files, with 30% citing two or more.

**Status: the partition is sound on every check available, and permanently
unverifiable at source.** It is used below as given.

## 2. Miss rate per candidate trigger set

A *miss* is a historical refutation the variant would have filed as an
observation instead — i.e. a shape absent from the trigger set. Ladder built by
adding buckets in descending order of the severity a reader would assign them,
which is the ordering #53's "severity bar" framing implies.

| set | shapes it fires on | covers | misses | **miss rate** |
|---|---|---:|---:|---:|
| **A** | security/adversarial | 15 | 29 | **65.9%** |
| **B** | + race/shared resource | 21 | 23 | **52.3%** |
| **C** | + host/external contract | 28 | 16 | **36.4%** |
| **D** | + doc contradicts code | 35 | 9 | **20.5%** |
| **E** | + lifecycle, + missing feature | 42 | 2 | **4.5%** |
| **F** | + local logic in one function (all seven) | 44 | 0 | **0%** |

#53's viability floor is confirmed arithmetically: a set that misses security
and race misses 21/44 = **47.7%**, the "48%" the issue names. Sets A and B fail
it. **C is the narrowest viable set, and it still discards 36% of what the gate
historically caught.**

The ladder also locates the exact point the Aug-10 analysis was making. C is the
recognisable "high severity only" bar. Going from C to D — a 16-point
improvement, the largest single step in the table — is admitting
*documentation-contradicts-code*, which is low severity by any bar anyone would
write. A severity-ordered list has to break its own ordering at the third rung
to become defensible. That is not a bar with a badly chosen threshold; it is a
dimension that does not sort the sample.

## 3. The second axis, which decides it: Phase 1 cannot rank these sets

#53 sizes Phase 1 at 6 cases × 6 repeats per variant per tier and pre-registers
a 7% → 30% shift in stopping power. That measurement runs against the existing
class B/B2 corpus. Mapping each seeded defect to the same seven shapes:

| case | shape | in set… |
|---|---|---|
| `b-containment-inverted` (path containment returns `!startsWith`) | security/adversarial | A onward |
| `b-shared-default-mutation` (module-level object returned as a fresh literal) | race/shared resource | B onward |
| `b-config-read-adjacent` (`catch` widened past `ENOENT`, then overwrites) | host/external contract¹ | C onward |
| `b-cap-boundary-strict` (`<` for `<=`) | local logic in one function | F only |
| `b-tail-off-by-one` (`length - n + 1`) | local logic in one function | F only |
| `b-timeout-guard-adjacent` (`&&` for `\|\|`) | local logic in one function | F only |

¹ The judgement call in the table. It is the widening of an error contract with
the filesystem; classified as internal-lifecycle instead it moves from set C to
set E, which changes nothing below.

So the corpus is **50% local-logic against the field's 4.5% — an eleven-fold
over-representation** — and contains zero instances of doc-contradicts-code
(class C carries that separately), lifecycle, or missing-feature.

Two consequences:

**Phase 1's stopping-power number is arithmetic, not a measurement.** A
variant that obeys its list scores, near enough, *in-set share of the corpus ×
detection rate*, and detection is already measured at 95–100%:

| trigger set | refutable class-B cases | predicted stopping power |
|---|---:|---:|
| A | 1/6 | ~16% |
| B | 2/6 | ~32% |
| C, D, E | 3/6 | ~48% |
| F | 6/6 | ~95% |

Every one of these separates from `current`'s 7% at the pre-registered n. None
of them tells you whether the list is the right list. Note especially that **C,
D and E are indistinguishable on this corpus** — they differ only in shapes the
fixtures do not contain — while set B's predicted 32% sits on top of the
pre-registered 30% effect, so hitting the target would be consistent with a list
that fails #53's own viability floor.

**And the corpus is biased toward the broadest set.** Over-representing
local-logic elevenfold means any set that excludes it is penalised on the bench
relative to the field, and set F is rewarded. Run as designed, Phase 1 will find
that the broadest list wins — a result driven by fixture composition, not by the
prompt.

This is not fixable by adding fixtures. The calibration review already ruled out
seeding the two largest shapes: races are non-deterministic and would poison
deterministic scoring, and adversarial cases measure a competence #16 never
changed. **The shapes that dominate the field are the shapes this harness cannot
seed.** A shape-based trigger list is therefore unmeasurable here in principle,
not merely under the current fixtures.

## 4. Recommendation

**Adopt set F — all seven shapes refutable, 0% miss — and put the filter
somewhere other than shape.**

The 0% is honest about what it is: a list that covers every shape is not a shape
filter, and reporting 0% miss is reporting that this dimension was abandoned.
The reason to abandon it is that it buys nothing. Excluding the local-logic
bucket — the only exclusion the data would tolerate, and the one set E makes —
suppresses 2 refutations in 44. **A gate that fires 4.5% less often does not
address a 24%-of-generation cost**, and it costs the one shape the harness can
seed deterministically.

Where the saving actually is, from the same sample:

- **Reachability.** The 19-run chain in `issue-16-evidence.md` found *a
  different defect each time* — wildcard hardening, then resolved-default
  routing, then persisted pinning, then history parsing. That is an open-ended
  audit of pre-existing surface, and it is where the volume is: three parent
  sessions produced 60% of all verifier runs. Bounding refutation to defects
  reachable from code the change touched terminates it. Refutations in the
  sample cite a mean of 1.3 files, so the bound is drawn where the findings
  already are.
- **Demonstrability.** Refute on what you can exercise; observe what you can
  only assert. This keeps doc-vs-code drift *that the change caused* — the
  removed helper still documented is demonstrable and reachable — while dropping
  drift that predates the commit. That is the cut a severity bar could not make,
  and it is why D was the largest step in the table.
- **Explicitly not the test suite.** 41% of the sample noted the suite passed
  anyway. Any prompt that lets a green run downgrade a demonstrated defect
  reintroduces two fifths of the misses by itself, so the variant forbids it in
  as many words.

Honest accounting of the recommendation's own miss rate: on shape it is 0%. On
reachability it is **deliberately non-zero and unquantifiable from surviving
data** — the later findings of the long chains are exactly what it drops, and
nothing that survives records how many of the 44 were pre-existing-surface
findings. That is the trade being proposed, stated as a trade.

**If you want the shape list anyway**, set C is the narrowest viable one at 36.4%
miss and set E the broadest sensible one at 4.5%. Section 6 says how to swap
either in as a one-line edit. Phase 1 will not distinguish them.

## 5. What was built

`severity-triggered` is [`tests/bench/lib/variants.mjs`](../tests/bench/lib/variants.mjs),
resolvable now:

```bash
node tests/bench/verifier-correctness.mjs validate --variants severity-triggered
```

It replaces one paragraph of `verifier.md` — the scope paragraph at line 9 —
with the bar derived above, and changes nothing else in the prompt.

### Why the working-tree prompt was not edited

#53 TASK 2 says to rewrite `templates/pilotfish/prompts/verifier.md` line 9. Done
literally, that redefines `current`, which `variants.mjs` documents as "the
working tree prompts" — every stored result graded against `current` would
silently be a result about the new text, and the constraint *"keep `current` and
`pre-scope` behaving exactly as they do now"* would be broken by the edit that
was asked for. **The new text lives in the variant; the working tree is
untouched.**

### The mechanism

`resolveVariant` previously read every pinned prompt from a git ref. A variant
written for an experiment has no ref, so variants now pin a file either way:

- `prompts: { "verifier.md": ref }` — read the file out of a git ref. Unchanged,
  and still what `current`, `pre-scope` and `pre-scope-gate` use.
- `edits: { "verifier.md": { replace, with } }` — replace one exact passage in
  the working-tree copy.

An edit rather than a stored copy, because the contrast Phase 1 measures is *one
paragraph*. A stored full copy of `verifier.md` would quietly accumulate every
later change to the other eleven paragraphs and stop being that contrast. The
edit is anchored on the passage text, not a line number, and **fails closed**:
missing anchor or duplicate anchor throws during resolve, before any provider
request, so a reordered prompt aborts the run rather than patching the wrong
paragraph and returning a clean-looking result.

One defect found and fixed while verifying: the working-tree prompts are CRLF in
this checkout while the replacement text is written with bare newlines, so the
first version produced a prompt carrying both endings — reproducible from no ref,
and recorded by `promptDigests` as if the wording had changed. The edit now
adopts the target file's line ending, and **throws on a file that already mixes
them** rather than guessing which one the paragraph wants.

### Verified

- `current`, `pre-scope`, `pre-scope-gate` resolve to the same override sets and
  the same prompt digests as before the change; `DEFAULT_VARIANTS` is still
  `["current", "pre-scope"]`, so `severity-triggered` is opt-in and no existing
  invocation changes behaviour.
- The resolved `severity-triggered` prompt preserves all eleven other paragraphs
  byte-for-byte, drops the old scope paragraph, and carries no mixed line
  endings.
- Perturbing the anchor in the working tree makes resolve throw — anchor removed,
  anchor duplicated, anchor reworded by one space, anchor rewrapped across a line
  break, empty file. A pure-LF checkout resolves and stays LF; a mixed-ending file
  throws. The working tree was restored after each probe and `git diff` on it is
  empty.
- Resolution happens for every named variant before the queue is built
  (`verifier-correctness.mjs:1118-1122`), so a bad anchor aborts at zero spend.
- `node --test tests/bench/scoring.test.mjs`: 79 pass, 0 fail — unchanged from
  before. Including the guard at `scoring.test.mjs:727` that variants are
  written into the fixture and never into the real config directory.

### The text

Replacing:

> Verify the claim you were given. Your verdict is about that claim, not about
> the general health of the surrounding code. If you notice a defect outside the
> claim, report it below the verdict as a separate, clearly labelled
> observation; do not refute work that did what it said. …

With:

> Verify the claim you were given. Your verdict is about that claim, and about
> defects this change introduced even where the claim is silent about them.
> Refute when you can demonstrate one: it is reachable from code the change
> touched — that file, or an immediate caller of what changed in it — and you
> have a concrete counterexample with inputs, expected behavior, and actual
> behavior. No shape of defect is too small to refute on once you can show it
> failing: a documented behavior the code contradicts counts, and so does a
> wrong result at a single boundary value.
>
> Report as an observation below the verdict what you can only assert: a defect
> you suspect but did not exercise, anything in code this change did not touch,
> and design you would have written differently. Do not audit the surrounding
> module for defects that predate this commit — an open-ended audit has no
> termination condition and is not what you were asked for. That the test suite
> passes is not grounds to file a demonstrated defect as an observation; a suite
> exercises what it was written for, and the defect it does not cover is still a
> defect.

Each clause traces to a row above: *reachable from code the change touched* to
the 1.3-file mean and the 19-run chain; *no shape too small … a documented
behavior the code contradicts counts* to bucket 3 at 16% and the C→D step; *the
test suite passes is not grounds* to the 41%.

## 6. Open, and yours to decide

1. **The severity framing is not what shipped.** The variant keeps #53's name
   and its resolvable id, but the bar it draws is reachability and
   demonstrability, not severity. Section 2 is why. #16's Risks section
   authorises exactly this ("P1 must be redesigned"), but it is a deviation from
   the task as written and it is your call to keep or reverse.
2. **To use a shape list instead**, replace the second paragraph's first
   sentence with the shapes of the set you want and leave the rest; sets C
   (36.4% miss) and E (4.5%) are the two defensible ones. One edit inside
   `SEVERITY_TRIGGERED_SCOPE`. Note the ceiling it imposes on Phase 1 from the
   table in section 3.
3. **Phase 1's design should change before it runs 216 local runs.** As
   specified it will report a number that is a function of fixture composition.
   The cheapest repair is to pre-register the *predicted* stopping power for the
   chosen set from the section 3 table and test the prompt against that
   prediction, rather than against `current` — a prompt scoring far below its
   predicted ceiling is disobeying its list, which is the thing actually worth
   measuring on this corpus.
4. **Class D remains the guard**, unchanged: the reachability bound and the
   demonstrability bar both loosen what may be refuted relative to `current`, so
   the false-`REFUTED` floor is the outcome at risk here, not false `CONFIRMED`.
   #53 already requires class D before any variant ships. It should be in the
   Phase 1 run, not after it.
5. **The `edits` mechanism has no test, and I did not add one.**
   `scoring.test.mjs` is outside the files you assigned me, and adding cases
   would move the count off the 79 your done-criteria names. But fail-closed
   resolution is the load-bearing safety property here — it is what stands
   between a drive-by reword of `verifier.md` line 9 and a silently mispatched
   experimental arm — and right now it is guaranteed only by the probes above,
   not by the suite. Three cases would cover it (anchor missing, anchor
   duplicated, mixed endings). Say the word and I will write them.
6. **The 44 are gone.** Any future question about them is now unanswerable. If
   the current install's sessions matter for a later phase, they need exporting
   before the next data-directory reset.
