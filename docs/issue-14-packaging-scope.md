# Issue #14 packaging: what turning the runbook into an installable plugin actually requires

**Status: §§1–7 are a draft for review; §8 is a result. Planning only remains
true of everything but §8 — no `package.json` was written, and no file under
`templates/`, `install/` or `tests/` has changed. §5 step 1, the host-fact
spike, has since been carried out; [§8](#8-step-1-results-the-spike-and-the-answer-to-7-q1)
records what it found, including one thing §3.2 gets wrong, and answers §7 Q1.**

Scope of this document is #14's **first** deliverable only: packaging. The TUI
profile menu is #14's second deliverable and #14's own sequencing note already
says packaging goes first, independently, because it removes more code than it
adds and depends on no TUI API. Everything below assumes that order.

Written against `install/OPENCODE-INSTALL.md` (439 lines) at
`e2fc1fb`, `templates/`, `docs/profile-router-contract.md`, and the [#32 Phase 3
disposition](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/32#issuecomment-5488831930),
which puts packaging after #16 P1 as "the remaining substantial investment …
done once, on the settled design."

---

## 1. The thing to decide before anything else: this reverses `50c880b`

Two days before this was written, `50c880b` deleted `RELEASING.md` and the
19-step release checklist, and `19ed57c` deleted the `VERSION` file and replaced
it in install state with the install commit SHA. The stated reason was exact and
correct:

> No consumer justified it. The install path pins by commit SHA, not a tag; the
> update/uninstall gate compares content hashes, not the version; and VERSION has
> been inert at 0.2.0 for ~70 commits.

#14's motivation is the opposite premise: *"Users get standard version
resolution instead of a pinned-ref runbook, and update becomes a version bump,"*
with a target config entry of `["pilotfish-opencode@0.3.0", {…}]`. A package
resolved by version needs a version that moves, a tag or a registry entry that
names it, and a changelog keyed to it — the exact machinery just removed.

**Both are right, at different times.** `50c880b` says the ceremony had no
consumer. Packaging *is* the consumer. So the decision is not "was gutting
versioning a mistake" (it was not) but "are we now acquiring the consumer that
justifies bringing it back." If the answer is yes, the release work is a **hard
prerequisite** of packaging rather than a chore beside it: there is no v0.x tag
in this repository (`git tag -l 'v0*'` is empty; all 23 tags are inherited
upstream), so today there is nothing a version specifier could resolve to.

If the answer is no — if the preferred distribution stays a git ref — then
packaging is still worth doing for the *config-hook synthesis* half (§3), and
only the resolution half changes shape. That is a smaller, cheaper project and
it keeps the commit-SHA provenance model intact. **This split is the first thing
to decide, because §2's subtraction list is the same either way but §5's step
order is not.**

---

## 2. Subtractive: what packaging deletes

The runbook is large because the installer writes into files it does not own. A
plugin owns its own contents, so most of the runbook is not rewritten — it stops
existing. Roughly two thirds of `OPENCODE-INSTALL.md` is in this list.

| What goes | Why it existed | Why it stops existing |
|---|---|---|
| Step 3.4, merging nine agent definitions into the user's global config | The nine roles have to be resolvable agents | The `config` hook synthesizes them (§3) |
| Step 3.3, installing nine prompt files | Agents reference `{file:./pilotfish/prompts/<role>.md}` | Prompts are package content |
| Copying `profile-router.mjs` byte-identically, and hashing it | The router had to reach a path OpenCode loads plugins from | The router *is* the package |
| `previousAgents`, `previousPrompts`, `installedPrompts`, `previousRuntimeFiles`, `installedRuntimeFiles`, `installedAgents` | Every one records what the installer overwrote so uninstall can restore it | Nothing is overwritten |
| The three-row agent table and three-row prompt table (identical / stale / customized) | An installed copy can diverge from its template | There is no installed copy |
| Every first-touch migration — `previousPlugin`, `previousRuntimeFiles`, `installedPrompts`, the `profiles.json` bare-hash→object form | Each retrofits a field onto installs made before it existed | No such fields |
| Step 3.1 backups and the rollback path | Writes must be reversible | One config line is reversible by hand |
| Uninstall Phases 1–6 | Restoring nine agent keys, nine prompts, two runtime files, a plugin tuple | Removing the plugin entry |
| Step 4 check 3, the content-hash drift assertion | The #38 incident: a merged security fix sat undelivered behind a version gate reporting "up to date" | Package resolution is the delivery mechanism; a stale package is a stale dependency, not silent drift |
| The whole "Updating an Existing Install" section's content-comparison stop condition | Same | Same |

**One caution about this table.** It describes the *end state*. §5 explains why
none of it can be deleted in the release that introduces the plugin — the
uninstall machinery is what migrates a 0.2.x install, so it has to outlive the
thing it replaces by at least one release.

---

## 3. Net-new: what has to be built

### 3.1 A `package.json`, the first one in the repository

There is none anywhere (`find . -name package.json` outside `.git` returns
nothing), so this is genuinely greenfield: name, version, `exports`, `files`,
`engines`, and a pinned `@opencode-ai/plugin` dependency. #14 already flags the
skew — the locally installed plugin package is `1.14.48` against binary
`1.18.10` — and this repository's whole router rests on documented host facts
H1–H14 that are observed behavior rather than contract. A packaged plugin makes
that dependency explicit for the first time, which is an improvement, and it
also means a resolver can now hand a user a combination nobody tested.

It also decides repository layout. `templates/` currently means "content the
installer copies." After packaging it means "package content," and six files
reference those paths by string: `tests/test_policy.py` (30 occurrences),
`tests/profile-router.test.mjs`, `tests/integration/fixture.mjs`,
`tests/integration/config-generation.test.mjs`, `tests/bench/lib/routing.mjs`,
and `tests/bench/lib/variants.mjs`. Moving the tree is mechanical; **deciding
whether to move it is not**, and leaving it in place under a package `files`
entry is a legitimate answer that costs one release of confusing naming.

### 3.2 Synthesizing the nine public agents in the `config` hook

The mechanism is already proven: `configureProfiles`
(`templates/pilotfish/profile-router.mjs:322`) synthesizes 16–24 hidden clones
on every config resolution today. Synthesizing nine more agents is the same
call. Three sub-problems are not the same, though.

**Prompts have to arrive some other way.** Today each agent carries
`"prompt": "{file:./pilotfish/prompts/<role>.md}"`, resolved relative to the
global config directory. A packaged prompt is not under that directory. The two
options are to find out whether `{file:…}` can name a path the plugin knows, or
to have the plugin read its own `.md` files and set `prompt` to the inline
string. **Recommend inline**: it is testable, it needs no host behavior nobody
has checked, and it changes nothing the model sees. It costs a copy of nine
prompt texts in every config resolution, which is memory rather than tokens.
Needs one verification — that the agent schema accepts an inline prompt string
where it accepts a `{file:…}` reference.

**H11 is the hazard, and it has already bitten this exact code path.** The
contract records that one OpenCode process serves several project directories
from one global config, and that the rebuilt `agent` map points back at the
*previous instance's* agent record — so a plugin writing anywhere under
`config.agent.<name>` writes into every directory that process serves.
`configureProfiles` had to be made idempotent against its own prior clone
entries for exactly this reason, after treating self-written rules as foreign
customization "killed every project after the first." Nine synthesized public
agents double the surface of that hazard. The fix pattern is known and
`tests/integration/host-fact-config-identity.test.mjs` already demonstrates
identity by mutation visibility rather than by comparing content, which is the
right shape of test to extend.

**Two guards invert.** `requirePilotfishAgents`
(`profile-router.mjs:314`) throws when the public `pilotfish` agent is absent,
and `validatePublicWorkers` (`:228`) throws when any of the eight is missing or
is not `mode: "subagent"`. After this change, absence is the normal case and the
router creates them. The `mode: "subagent"` check must survive, because a user
config can still override a synthesized agent, and a customized non-subagent
worker is precisely what that guard refuses to clone or route.

### 3.3 A home for MCP grants — the hardest genuinely-new design question

Step 1.6 and Step 2 of the runbook are the most carefully written part of the
whole document: workers ship a closed `"*": "deny"` scope, grants default to
none, the approval questions are specified down to banned vocabulary, and H9
makes ordering load-bearing because the host resolves a tool against the **last**
matching rule, so a grant must sit *after* the deny it overrides.

Today a grant is a line the installer appends inside a persisted agent's
`permission` block. If the agents are synthesized rather than persisted, that
line has nowhere to live. Three candidates:

1. **A plugin option**, e.g. `{"grants": {"verifier": ["github_*"]}}`. Keeps the
   ordering guarantee inside the router, which is where H9 is already mirrored
   and tested. Costs a new option schema and a validation path.
2. **A user config override** of `agent.verifier.permission`, merged over the
   synthesized definition. Uses only host merge semantics — but the merge order
   between a config-hook write and the user's own file is not something this
   repository has established as a host fact, and getting it wrong silently
   places a grant *above* the deny, which H9 says loses.
3. **The overlay file** from §3.4, extended to carry grants alongside profiles.

**Recommend (1).** It keeps the one property the whole closed-scope design rests
on — grant after deny, always — inside the code that already mirrors the host
matcher and is pinned by `tests/profile-router.test.mjs`. (2) is the most
idiomatic and the least verifiable.

### 3.4 `profiles.user.json`, the overlay

#14's own design constraint already states this: split the canonical
`profiles.json` (package content, never edited) from an unmanaged
`profiles.user.json` overlay that is validated at load and never hashed. The
requirement is live and recent — `42bb46c` and the follow-up in `e2fc1fb`
exist because a whole-file `profiles.json` replace destroyed a user's own local
profile, and the runbook now says in as many words that presenting a choice
between overwriting and aborting "is a defect, not an acceptable fallback."

Two constraints from #14 carry into the overlay's validation: a partial profile
that omits roles must be **rejected at edit time**, never completed from another
profile's defaults; and a custom profile cannot activate without a restart,
because agent definitions come from the `config` hook which runs once at
startup. Both must be enforced by the loader, not just documented.

Note the direct consequence for this repository's own tooling: the bench
harness resolves `--primary` against
`templates/pilotfish/profiles.json` (`tests/bench/lib/routing.mjs:19-21`), and
the owner's local `bambi` profile lives only in the installed file as a
user-added key. Whatever the overlay's path and precedence are, `routing.mjs`
has to learn them, or the harness silently measures a different profile set than
the one running.

### 3.5 A preflight the plugin can run itself

This is the safety property packaging *removes*, and it needs replacing rather
than accepting.

Today Step 1 runs before anything is written: OpenCode version ≥ `1.18.10`,
and every required model and variant resolved against `opencode models
--verbose` with an anchored per-ID search. That check exists because of a
specific failure — on 2026-08-24 a preflight read a prefix of a 432,604-byte
output, reported that seven working models were unavailable, and sent the user
to repair two providers that were already fine. The runbook's fix is to search
the whole output anchored per ID and to name exactly what did not resolve.

A `plugin` config entry has no preflight. An unavailable model becomes a runtime
failure, and H2 says a plugin factory that throws is skipped entirely with only
a log line — so the failure mode is *Pilotfish silently is not there*. The
router already handles its own configuration errors by returning protective
hooks rather than throwing (H1, H2, G8) and surfacing them at the first
Pilotfish message, and by best-effort toast under H12. That pattern has to be
extended to cover "the package resolved but this host cannot run it."

**Recommend a `doctor` entry point in the package** — a command the README tells
users to run once after adding the plugin line — carrying Step 1's version
check, the anchored model-availability check, the `subagent_depth` safety
report, and the `small_model` advisory. Those last two write nothing today and
exist purely as install-time conversation; without an entry point they have
nowhere to go.

### 3.6 Tests

`tests/integration/fixture.mjs` builds a throwaway config by reading
`templates/opencode.base.jsonc` and a preset, then copying `templates/pilotfish`
into the config dir (`:177-178`, `:221`). Under packaging it would install the
package instead, which is a smaller fixture and is one of the places #14
correctly predicts the change removes code. New coverage needed: config-hook
synthesis of the nine public agents; H11 idempotency across a second project
directory; overlay merge and rejection; grant ordering after the deny; migration
from a runbook install; and headless equivalence — routing identical with no TUI.

---

## 4. Risks

**Plugin resolution is unverified in this repository, and it is load-bearing.**
Every install path documented here uses the config-relative form
`"./pilotfish/profile-router.mjs"`. #14 asserts the registry form
`["pilotfish-opencode@0.3.0", {…}]` works, and nothing in `docs/profile-router-
contract.md`'s H1–H14 covers how OpenCode resolves a non-path plugin specifier,
from where, with what caching, or how it behaves offline. **If that resolution
does not work the way #14 assumes, the shape of the whole project changes**, so
it is the first thing to check and it costs a spike, not an implementation.

**H11 cross-project writes**, per §3.2. Known hazard, known fix pattern, doubled
surface.

**Failure visibility regresses.** An install failure today is loud: a runbook
stops before the approval gate, and validation failure rolls everything back. A
packaged failure is a log line (H2) and the absence of an agent. §3.5's doctor
is the mitigation, and it is a mitigation rather than a fix, because a user who
never runs it gets the silent path.

**API version skew**, which #14 names. A registry resolver can hand a user a
plugin/binary pair nobody has tested. Pin the dependency and keep asserting the
OpenCode version at runtime, not only in a doctor command.

**MCP grants are the part most likely to be got quietly wrong**, because H9's
last-match-wins rule means a misordered grant does not error — it silently
admits more than intended, on a surface whose entire design premise is a closed
default.

**Migration is not optional and cannot be deferred.** A 0.2.x install has nine
persisted agents in the user's own config, each referencing a prompt path under
`~/.config/opencode/pilotfish/prompts/`. Add the plugin line without removing
them and the user's persisted definitions win; delete the prompt files without
removing the definitions and every agent references a file that is gone.

**The bench harness reads template paths directly**, per §3.4. Silent
mismeasurement rather than a failure.

---

## 5. Concrete steps, in an order that survives partial completion

1. **Spike the host facts, write no product code.** Does OpenCode resolve a
   registry/version plugin specifier, and from where? Does the agent schema take
   an inline `prompt` string? Does a `config`-hook-created public agent behave
   identically to a persisted one, including under H11's second project
   directory? Record each as a numbered host fact with the pinned OpenCode
   version, per the convention `docs/profile-router-contract.md` already sets.
   **This is the gate**: fact one decides §1.
2. **Decide §1** — versioned package, or packaged-but-git-ref. If versioned, the
   release work is now a prerequisite and `50c880b` gets partially reversed with
   a consumer to justify it.
3. **`package.json` and the layout decision.** Cheap, and it unblocks the rest.
4. **Config-hook synthesis of the nine public agents, additive.** Ship it
   alongside the existing require-them path so both work in one release: synthesize
   only what the config does not already define. This is what makes step 7
   possible without a flag day.
5. **`profiles.user.json` overlay**, with the reject-partial and
   restart-required rules enforced in the loader. Teach `routing.mjs` the new
   precedence in the same change.
6. **The grant surface** (§3.3) and the **doctor entry point** (§3.5). These are
   independent of each other and of step 7.
7. **Migration from 0.2.x.** The migration *is* the existing uninstall: restore
   `previousAgents` and `previousPrompts` to true pre-install state, remove the
   runtime files, then add the plugin entry. So the uninstall machinery must
   still be present and working here — which is why §2's deletions cannot happen
   in this release.
8. **Delete the runbook's install half**, one release after migration ships.
9. **Delete the uninstall half**, once no supported install predates the plugin.

Steps 1–3 are days. Step 4 is the substantial one. Steps 7–9 are a deprecation
schedule, not engineering, and their cost is calendar time.

---

## 6. Decisions I made that are normally yours

1. **Scoped this to packaging only**, excluding the TUI menu. #14's own
   sequencing says so and the #32 disposition calls Phase 4 "packaging (#14)".
2. **Named `50c880b` as the first decision rather than assuming #14's version
   premise.** #14 predates both gutting commits by three weeks and cannot have
   accounted for them.
3. **Recommended inline prompt text** over resolving `{file:…}` from a package
   path — verifiable today against unverified host behavior.
4. **Recommended a plugin option for MCP grants** over a user-config override —
   keeps H9's ordering guarantee inside code that already mirrors and tests the
   host matcher.
5. **Recommended a `doctor` entry point** rather than accepting the loss of
   preflight. Nothing in #14 mentions it, and without it three install-time
   behaviors — model availability, `subagent_depth`, `small_model` — have nowhere
   to live.
6. **Put migration at step 7 and the deletions at 8–9**, which means the first
   packaged release is *additive*, not subtractive. #14 reads as though packaging
   removes machinery immediately; it cannot, and saying so changes how the work is
   sized.
7. **Left `templates/` in place as a recommendation-by-default**, rather than
   proposing a tree move. Six files reference those paths by string and the move
   buys naming clarity, not behavior.

## 7. Open questions for you

1. **Versioned package or git-ref package?** §1. Everything downstream of it is
   the same; the release prerequisite is not.
2. **Which registry, and is publishing it something you want to own?** A public
   npm package is an outward-facing artifact with a name to defend and an issue
   tracker aimed at it. The git-ref option avoids that entirely.
3. **MCP grants: plugin option, user-config override, or overlay?** §3.3.
   Recommend the option; the alternatives are more idiomatic and less verifiable.
4. **How long is the migration window** — how many releases carry the uninstall
   machinery before §2's deletions land? This is the only part of the estimate
   that is calendar rather than effort.
5. **Does `templates/` move, and if so in the same change or a separate one?**
6. **Does the doctor command belong in this package at all**, or is it the thing
   #14's TUI menu half should be, arriving earlier than planned? The menu already
   promises to validate profiles against the live provider list, which is Step
   1.3's check with a face on it.

---

## 8. Step 1 results: the spike, and the answer to §7 Q1

**Status of this section: done, not planned.** Step 1 of §5 has been carried
out. Three host facts are recorded as **H15, H16 and H17** in
[`docs/profile-router-contract.md`](profile-router-contract.md), each naming the
OpenCode version it was read against. Nothing else in §5 was started: no
`package.json` exists, no file under `templates/`, `install/` or `tests/`
changed, and the router is untouched.

Everything below was read from, or driven against, the binary now installed on
the development host, **OpenCode `1.18.22`** — not the `1.18.18` the contract
pins. That drift is stated in the contract rather than papered over; H1–H14 have
not been re-run against `1.18.22` and this spike did not re-run them.

### 8.1 The gate is open

§4 called plugin resolution "unverified in this repository, and it is
load-bearing," and said the shape of the whole project changes if it does not
work the way #14 assumes. It works. A config entry of the exact form #14
proposes — `["<name>@<version>", {…}]` — resolves, loads, and delivers its
options object to the plugin factory as a second argument.

The strongest single piece of evidence needed no fixture at all: **this project
already depends on the mechanism it was about to treat as unknown.** The
owner's own global config carries `"opencode-antigravity-auth@latest"` and
`"opencode-openai-codex-auth"` beside `"./pilotfish/profile-router.mjs"`, and
`~/.cache/opencode/packages/` holds both resolved. Every install path this
repository documents uses the config-relative form, which is what made the
registry form look unexamined; but the host has been resolving versioned npm
specifiers on this machine the whole time.

So §5's step 2 is unblocked, and the four properties that turned out to be
load-bearing are in H15: the package must declare `exports["./server"]`;
`engines.opencode` is the only version-skew guard the host offers;
the specifier string *is* the cache key, so a fetched version is thereafter
immutable and a bare name never updates; and a resolution failure is completely
silent — no log line at any level, `--log-level DEBUG` included.

### 8.2 One thing §3.2 got wrong, and it fails open

§3.2 says synthesizing nine public agents is "the same call" as the hidden
clones the router already makes. It is not quite, and the difference is the kind
that does not announce itself.

An agent definition written by a `config` hook never passes through the
`AgentConfig` decode transform, because that transform runs while the config
*file* is read and the hook runs afterwards. The transform is what converts
`tools: {edit: false}` into `permission: {edit: "deny"}`. A hook that writes
`tools` therefore writes into the void: the field is dropped without an error,
and the agent resolves with `edit` and `write` **allowed**. Written as
`permission: {edit: "deny", write: "deny"}` instead, it resolves identically to
the persisted form.

The router is not affected today, because `configureProfiles` clones an
already-decoded record rather than building one. But the nine public workers
ship a closed scope, and if that scope is carried across as `tools` when they
stop being persisted, every one of them silently gains `edit` and `write`. On a
surface whose whole design premise is a closed default, that is the worst
available failure mode. H17 records it; §3.2 should be read as amended by this
paragraph.

### 8.3 Two of §3's open verifications are now closed

- **Inline prompts are safe, and they are also the only option.** §3.2 asked for
  "one verification — that the agent schema accepts an inline prompt string
  where it accepts a `{file:…}` reference." It does, and the two produce
  byte-identical agent records. The second half is new: `{file:…}` is a
  *config-file* expansion, so a `{file:…}` string written by a `config` hook is
  not expanded and reaches the model as literal text. The alternative §3.2 left
  open — teaching `{file:…}` to name a path the plugin knows — does not exist.
  H16.
- **H11 is narrower than §3.2 assumed.** Driving one `opencode serve` process
  across three project directories shows the sharing is per agent *record*, not
  per agent *map*: a write into an existing `config.agent.<name>` is visible to
  the next directory's hook, but a new key the hook adds is not — every instance
  starts from a map holding only the config-file agents. So "nine synthesized
  public agents double the surface of that hazard" is wrong. They add none.
  Adding a key is idempotent because there is nothing to be idempotent against;
  the hazard remains exactly where `configureProfiles`'s existing guard already
  sits. H17.

### 8.4 Migration has a mechanism now, not just a warning

§4 warns that adding the plugin line without removing the persisted agents
breaks a 0.2.x install. There is a sharper version of that: plugin origins are
deduplicated **by package name**, and a `file://` path entry and an npm entry
are different keys. A config carrying both `"./pilotfish/profile-router.mjs"`
and `"pilotfish-opencode@0.3.0"` loads **both** — two independent router
instances in one process, each with its own state, each rewriting the same Task
calls. Migration must remove the path entry, not merely add the package one.
Two npm entries naming the same package at different versions do collapse, last
one winning, which is the ordinary case and is fine.

### 8.5 The answer to §7 Q1: publish a versioned npm package

**Recommendation: versioned npm package, not a git ref.** Both work — a
git-ref specifier resolves, tag-pinned, entirely without a registry, so the
git-ref option is real and not a fallback. But the version specifier is the
better fit for three reasons that the spike made concrete rather than
aesthetic. First, the host's *only* protection against the API skew #14 names is
`engines.opencode`, read from the package's own `package.json`; that field is
equally available either way, but it only means anything next to a version a
user can move deliberately, and a git ref gives them a commit SHA whose
relationship to a supported OpenCode range is invisible. Second, the cache key
is the whole specifier and there is no freshness check, so *whatever* form is
chosen freezes at first fetch — which means the form's real job is to be legible
in a config file, and `pilotfish-opencode@0.3.0` says what a user is running
where `git+https://github.com/Adrian-Mandel/pilotfish-opencode#a1b2c3d` does not.
Third, the git-ref cache path is genuinely bad: the host's `sanitize` is a no-op,
so a git URL becomes nested directories under `packages/` named after its
scheme and host. The name `pilotfish-opencode` is unclaimed on npm (`pilotfish`
is taken). The cost is the one §1 already priced: publishing is an outward-facing
commitment, and the release machinery `50c880b` removed has to come back — but
now with the consumer that justifies it, which is precisely the test `50c880b`
set. If the owner would rather not own a public package name, the git-ref
option costs nothing technically and this recommendation reverses cleanly; it is
§7 Q2, not a re-litigation of Q1.

### 8.6 How to repeat any of this

No test file was added, because the handoff scoped `tests/` out of this step.
Each fact is reproducible from an isolated fixture built by hand:

```bash
R=$(mktemp -d); mkdir -p $R/config/opencode $R/data/opencode $R/cache/opencode/packages $R/proj
export XDG_CONFIG_HOME=$R/config XDG_DATA_HOME=$R/data XDG_CACHE_HOME=$R/cache
```

`XDG_CACHE_HOME` is the important one and the existing `tests/integration/fixture.mjs`
does not set it: without it a probe installs into the user's real package cache.
Seed a package at
`$XDG_CACHE_HOME/opencode/packages/<specifier>/node_modules/<name>/` with a
`package.json` declaring `exports["./server"]`, name it in `opencode.json`'s
`plugin` array, and run `opencode debug info --print-logs` from `$R/proj`. Set
`npm_config_registry=http://127.0.0.1:9/` to prove a case needs no network.
`opencode debug agent <name>` prints a resolved agent record and is how H16 and
H17's comparisons were made; `opencode serve --port 0` plus
`GET /agent?directory=…` for several directories is how the H11 half of H17 was
driven, following the pattern in `tests/integration/host-fact-config-identity.test.mjs`.

Beware one trap: `opencode debug info` prints the plugin **origins from the
config**, not the plugins that loaded. It lists a plugin that failed to resolve
exactly as it lists one that worked. Every load check here is a side effect the
plugin itself wrote to a log file, never that listing.

### 8.7 Decisions made in this step that are normally yours

1. **Left the contract's pin at `1.18.18`** and stated the drift in place,
   rather than moving it to `1.18.22`. Moving it would claim a re-verification of
   H1–H14 that nobody performed.
2. **Recorded H15–H17 in the contract even though they bind no guarantee yet.**
   They are host behaviour with the same shelf life as the rest of that table,
   and whoever builds the package will look for them beside H11. The preamble to
   the table says explicitly that they hold nothing up today.
3. **Added no test file.** The handoff scoped `tests/` out of step 1, so §8.6 is
   the reproduction path instead. A permanent test for H17 belongs with §5 step
   4, where it can assert against the real synthesis rather than a probe.
4. **Recommended npm over git-ref** (§8.5) rather than leaving Q1 open, since the
   handoff asked for a recommendation. The reversal is cheap if Q2 goes the other
   way.
