# Changelog

All notable changes to Pilotfish for OpenCode. Installed versions are recorded in `~/.config/opencode/pilotfish/install-state.json`.

## v0.2.0 - Unreleased

Tested with OpenCode `1.18.18`.

### Added

- An install-time check that reports `subagent_depth`, the host default that holds the worker boundary. Host fact H14 means a `@token` resolving to an agent name makes OpenCode skip the Task permission check for that whole turn, and Task resolves mentions in its own `prompt` argument — so a primary writing `@executor` into a worker's prompt switches the bypass on inside that worker's session, where it skips the `task` deny meant to stop workers spawning workers. At the host default of `1` the depth check fails such a call first, because a worker session already has a parent. Pilotfish neither sets that key nor needs it raised, and the check writes nothing and blocks nothing; it exists so that a default this project depends on but does not own stops being invisible.
- Canonical ChatGPT, AntiGravity, and OpenRouter profiles, with a dependency-free runtime profile router. Each profile is named for its primary model identifier — `openai/gpt-5.6-sol`, `openrouter/qwen3.6-27b`, and so on — so a name states which orchestrator it selects rather than a vendor family that ships many models. Provider slashes are flattened to `--` when a profile name becomes a hidden agent name, and two profiles that would flatten together are refused.
- Session-pinned Task routing to hidden capability-preserving worker clones, plus focused executable router contracts.
- A profile router contract fixing the router's guarantees, its OpenCode `1.18.18` couplings, its accepted risks, and its threat model.
- An isolated OpenCode integration fixture and a host-level config-generation test that needs no provider request.
- Per-role `steps` backstops and a `doom_loop` deny on all eight subagents, where an `ask` has nobody attached to answer it and stalls instead of breaking the loop.
- `question` permission for the `pilotfish` primary, which OpenCode denies globally and re-allows only for its own built-in primaries.
- Measured evidence for issue #16 in `docs/issue-16-evidence.md`: the verification gate refutes 72% of the time and its cost is re-verification depth rather than gate frequency, read-only delegation runs serially 78% of the time, and inline reconnaissance costs round-trips rather than tool time.
- A verifier-correctness benchmark under `tests/bench/`, the first slice of issue #15. It runs `pilotfish` end-to-end against seeded-defect repositories inside the existing integration fixture and scores the verdict its own verifier returns against known ground truth, A/B against the pre-scope-change prompt. Measurement is in situ: no bench mode, no per-profile shim, and no change to production routing, permissions, or the authorization protocol. It exists because the failure mode of #16's narrowed verifier scope is a false `CONFIRMED`, which real telemetry cannot detect — the database records verdicts, never whether a verdict was right.
- An install-time advisory that `small_model` is unset, with a suggested value per preset. Pilotfish does not write or own the key; the observation is that compaction otherwise runs on the selected primary at a 22.1s median.
- An OpenRouter section in the README, which the preset shipped without.
- A visible refusal notice for issue #24. Every router guard fails closed, but OpenCode logs config-hook errors without surfacing them and replaces hook exceptions with a generic `Unexpected server error`, so a correct refusal reached the user as silence — twice reported as a broken model when the router had already written a precise reason. The two guard surfaces now also ask the TUI to show an error toast carrying that reason, scoped to the plugin's own directory because one process serves several projects. It is narration only: never awaited, never a substitute for the throw, and a notice channel that is missing, throws, or rejects leaves the refusal byte-identical. Recorded as host fact H12, with the `1.18.16` re-verification of H1, H2, and H10 that issue #24 asked for.
- `docs/token-budget.md` and `docs/profiles-and-caching.md`, recording where a session's tokens actually go and how to choose OpenRouter endpoints that cache. The measurements are wire-level: request bodies captured against a local endpoint rather than inferred from the host's own reporting, because `opencode debug agent` does not connect MCP servers and reports zero MCP tools for every agent including ones that demonstrably call them. The caching document ships an audit script that queries the live endpoints API and ranks by effective cost at a 90% hit rate rather than headline price, which inverts the choice on several models; endpoint pricing moved measurably within a single day, so the script is the source of truth and its tables are example output.

### Changed

- The primary prompt no longer spends a first-turn round-trip re-deriving its own resolved model; the installer asserts the tested configurations once, at install time.
- The Completion Gate bounds the verification chain instead of only the run: verification answers whether a claim holds rather than auditing the surrounding code, findings outside the claim return as observations, and the primary takes the work back after a second refutation.
- Read-only delegation is parallel by default, and the serialization rule now says explicitly that it covers writing roles only.
- Dispatch is gated on whether a complete, self-contained brief can be written without doing the work first, rather than on a round-trip count. The round-trip trigger added for issue #16 delegated exactly the shapes upstream's controls measured as losses: a small task-local read-only scan cost 12.9% more delegated than inline and took 14.2% longer, while a stable 12-file mechanical edit cost 36.0% less delegated. Both are past three round-trips, so the threshold could not tell them apart; specifiability can, because the case that loses is the one where the brief could only be written by first solving the problem, leaving the worker to re-derive what the session already knew. Upstream's braked-versus-delegating benchmark cut model input tokens 61.9% on one fixture with tests and the verifier's verdict unchanged. The price tiebreaker for small scans is marked as a paid-worker effect, so it decides nothing in a free-local-worker configuration.
- The primary may now continue an existing worker through the Task tool's `task_id` parameter, for genuinely new or redirected work on the same investigation and files, and never to collect or restate a result already in hand. The parameter has always existed and the router has always authorized resumed Tasks, but no prompt named it, so effective policy was to start fresh every time and pay a cold start every time: a session's first request is warm 18% of the time against 93% for later requests in the same session. Resumption cannot widen a worker's reach — the resumed child keeps its role's closed tool scope, and the router refuses a `task_id` that is not the exact child session of this parent under the same internal role. The prohibition on resuming a session for repeated context-heavy artifact inspection is unchanged.
- Profiles are data: `profiles.json` defines each profile and groups them into named presets, so adding a provider or model tier no longer changes router code.
- AntiGravity routes like every other preset instead of validating public bindings and passing Tasks through unchanged.
- Extended install, update, rollback, and uninstall ownership to the required router plugin tuple and hash-tracked runtime files.
- Raised the verified OpenCode baseline to `1.18.10` for the runtime hook contract.
- All eight workers now carry a closed tool scope rather than only the four read-only ones. The four executors previously took the default toolset, so every MCP server a user happened to have installed rode along on every one of their requests — measured at 13,748 tokens per request against a real 44-tool GitHub MCP server, paid again on each step of a role that runs up to 250 of them. A closed scope removes a tool from the request schema outright rather than refusing it at call time. The `pilotfish` primary stays open deliberately: it is the agent the user drives, and silently removing their MCP servers from their own session is not a trade worth making. Because a worker can no longer see any MCP server unless granted, installation now enumerates configured servers, measures each one's cost, reports which roles have actually used it, and asks per server per role; a grant must be appended after the deny, since OpenCode resolves a tool against the last matching rule.
- The host contract is re-pinned from OpenCode `1.18.10` to the shipped `1.18.18`, with all thirteen host-fact rows verified there rather than four of thirteen. Issue #24 had left a split pin — four rows current at `1.18.16`, eight never re-run — under a contract whose own rule says a host upgrade invalidates every claim until the fixture is re-run. The four rows whose consequence is an ordering or timing guarantee, H3, H4, H6, and H7, are now exercised against the real host by `tests/integration/host-facts.test.mjs` instead of read, and H11 by `tests/integration/host-fact-config-identity.test.mjs`, which drives one server process across three project directories, because a shared object reference is invisible to source reading. H11's boundary turned out to sit one level deeper than the row claimed: the `agent` map is rebuilt per instance but points back at the previous instance's agent record, so a plugin writing anywhere under `config.agent.<name>`, not only into `permission.task`, writes into every directory that process serves. H8 still holds and is still load-bearing: Task exposes no per-invocation model override at `1.18.18`, so hidden clones remain necessary and issue #13 stays answered in the negative. H2 loses the word "silently", because a skipped plugin factory does log. H12 gains the detail that the TUI filters a toast on its workspace rather than its directory. H9 changed materially: the host's wildcard matcher is case-insensitive on every platform while the router's mirror is case-insensitive only on Windows, so on a posix host a Task rule such as `"PILOTFISH-PROFILE-*"` passes the G9 guard while still admitting internal clones on the host. That is a G9 defect, split out as issue #38 under change control rather than patched here.

### Fixed

- Recorded host fact H14, found while closing issue #38 against an installed `1.18.18`: an `@agent` mention in the user's message sets `bypassAgentCheck` for the entire assistant turn, and the Task tool then skips its `permission.task` check for **every** call in that turn, not only for the agent that was mentioned. The `"*": "deny"` base that G9 exists to protect is therefore unenforced on any turn carrying a mention, and the host does this deliberately — it appends `Invoked by user; guaranteed to exist.` to its injected instruction when the mentioned agent's own rule resolves to `deny`. Nothing is reachable that was not reachable before: G6 raises from `tool.execute.before`, which H3 pins ahead of both the permission ask and agent resolution, so internal clones stay refused, and that ordering is exercised live against the real host. What the fact removes is the belief that `permission.task` is the thing holding an arbitrary agent out of a Task call. No router change accompanies it: G5 promises that a non-roster `subagent_type` passes through exactly as written, so closing the gap there would revoke a stated guarantee, and change control sends a guarantee refuted for a structural host reason back to issue #12 rather than into another patch.
- The G9 guard's mirrored Task-permission matcher is case-insensitive on every platform, as the host's is. OpenCode builds its wildcard regex with the flags `si` unconditionally, with no `process.platform` branch; the mirror enabled `i` only on `win32`, so off Windows the two disagreed in exactly the unsafe direction. A pre-existing rule such as `"PILOTFISH-PROFILE-*": "allow"` did not match `pilotfish-profile-openai--gpt-5.6-sol-executor` under the case-sensitive mirror, so config generation accepted it, while the host read that same rule as applying to every internal clone. Nothing upstream caught it first: the compatibility check inspects only the `"*": "deny"` base and the lowercase public workers, and the exact-key check is a case-sensitive `Array.includes`. The resolved action for a clone was `allow` either way, because the router appends its clone entries last and the host takes the last match, so this was never a widening of reach — it was a guard failing open: G9 promises to refuse a configuration it in fact accepted, so a user rule that genuinely admits internal agents passed review in silence, which is the threat model's direct-selection case going unwarned. Found by reading the shipped runtime during the `1.18.18` re-verification rather than by a failing test, so the regression tests now transcribe the host matcher beside the mirror and simulate each host platform around it; a mirror that is case-insensitive only on `win32` passes every case assertion when the suite itself runs on `win32`.
- Presets no longer bake a model onto the eight public workers. Task remapping is active only while Pilotfish is the resolved primary, so under any other primary agent those pins were the only routing left and sent every worker to the preset's provider regardless of the model the session was running. An AntiGravity session in OpenCode's built-in plan agent would delegate reconnaissance to `openai/gpt-5.6-luna` and stall on an exhausted ChatGPT quota it never selected. Public workers now install unbound and inherit the invoking primary; worker tiering stays in `profiles.json`, applied by the router to its hidden clones.
- Pilotfish no longer dies in the config hook for every project directory after the first one opened in a process. One OpenCode process serves several directories from one global config; it rebuilds `config.agent` per instance but hands every instance the same nested `permission.task` object. `extendTaskPermission` wrote its clone entries into that shared object, so the second instance read its own prior writes as pre-existing foreign customization and refused to configure — raising `pre-existing Task rule "pilotfish-profile-…" can match internal profile agent` before any provider request, which presents as a session that answers with nothing at all. Clone entries whose action is already `allow` are now recognized as idempotent self-state; an exact clone key carrying any other action is still refused, and every wildcard that could admit an internal agent still is. Recorded as host fact H11. Because the guard fired before model selection, the failure looked model-specific and was first reported as an OpenRouter Qwen bug; it affects every profile and provider equally.
- The DeepSeek profile now ladders reasoning effort instead of running every role at the provider default. Both of its models accept variants — `deepseek-v4-pro` takes `high` and `xhigh`, `deepseek-v4-flash-0731` takes `low`, `high`, and `max` — but the profile set none, on the assumption that variants were a gpt-5.6 and AntiGravity concept. Variant support is a per-model capability, not a per-provider-family one. The Qwen profile correctly keeps none, because neither of its models exposes any.

## v0.1.0 - Unreleased

Tested with OpenCode `1.17.18`.

### Added

- Phase-aware Discovery, Plan, Approval, Execution, and Verification lifecycle adapted from original Pilotfish `v1.2.0`.
- Fresh Explore routing for repeated, context-heavy accessible project-local artifact reconnaissance, with exact references, uncertainty reporting, and primary selective review.
- An authoritative upstream-deviations ledger and a sanitized ongoing artifact-routing evaluation record.
- Read-only `plan-verifier` with `READY` or `REVISE` verdicts before approval.
- Read-only `security-reviewer` for pre-approval trust-boundary and vulnerability evidence.
- ChatGPT and AntiGravity mappings for both new review roles.
- Dependency-free policy regression tests covering all nine agents, presets, permissions, phase gates, security boundaries, verdict vocabularies, installer counts, and long-running command handoffs.

### Changed

- Expanded the graph from one primary plus six workers to one primary plus eight workers.
- Restricted `security-executor` to approved stable implementation contracts.
- Clarified that Plan synthesis, integration, and final judgment remain in the primary session.
- Added dispatch brakes for low-benefit fan-out, tightly coupled debugging, and overlapping ownership.
- Replaced Claude-specific detached/background process behavior with an OpenCode-safe exact-context handoff contract.
- Extended install, update, rollback, and uninstall lifecycle state from seven to nine agent entries and prompts.
- Advanced the semantic upstream review baseline from original Pilotfish `v1.1.4` through commit `1251465`, including `v1.2.0`.
- Adapted the current upstream installer UX for OpenCode: updates are idempotent install reruns with an up-to-date no-write stop, while phased uninstall retains key-level restoration, layered-config checks, rollback, and retained backups.

### Deferred

- Claude-specific Baton runtime integration and benchmark fixtures are not copied; only applicable policy conclusions and attribution are retained.
- Parallel writing workers and persistent background shell execution remain unsupported by stable OpenCode configuration.

## v0.0.1 - Initial development

Tested with OpenCode `1.17.18`.

Initial experimental OpenCode port.

### Added

- Opt-in `pilotfish` primary agent with six role-based workers.
- ChatGPT and AntiGravity model presets with per-role variants.
- OpenCode permission enforcement for the delegation graph, read-only reconnaissance, leaf workers, and verifier edit denial.
- Fresh-context `CONFIRMED` or `REFUTED` verification contract.
- Approval-gated global installer with model checks, collision detection, backups, resolved-config validation, idempotent updates, and key-level uninstall restoration.
- Non-blocking warning for untested primary model configurations.
- Semantic upstream-sync ledger, baselined at original Pilotfish `v1.1.4`.
- Dependency-aware scheduling adapted from upstream `v1.1.4` without relying on experimental background agents.

### Changed

- Replaced Claude Code settings, agent frontmatter, and global `CLAUDE.md` policy with native OpenCode agent configuration and prompt files.
- Rewrote research and design documentation around verified OpenCode behavior.
- Restarted versioning at `0.0.1` for the new experimental fork.
- Made a pinned local `v0.0.1` checkout the recommended installation path; raw `main` is documented as an unpinned convenience path.
- Require OpenCode `1.17.18` or newer before installation so agent schema and permission assumptions use the tested runtime baseline.

### Removed

- Claude-specific aliases, fallback claims, worktree instructions, detached-agent behavior, and subscription economics.
- Traditional Chinese documentation, which described the obsolete Claude installation.

### Known limitations

- No native automatic model fallback chain.
- No stable Task-level worktree isolation or automatic result harvesting; writing workers are serialized.
- Background-subagent and worktree APIs are experimental and are not release dependencies.

## Original Claude Code History

The entries below are retained from the upstream Pilotfish project for historical attribution. They do not describe the OpenCode fork's active behavior.

## v1.1.3 — 2026-07-12

Community-driven patch. Re-run the install prompt to upgrade.

| Change | Credit |
|---|---|
| **The orchestration policy now covers running agents in parallel** — three rules earned in a real four-executor fan-out (long-form rationale in [#7](https://github.com/Nanako0129/pilotfish/pull/7)): every writing agent in a parallel batch gets its own worktree, and the orchestrator harvests each worktree's changes on completion; a yielded agent (detached launch, PID + log path) is a handoff the orchestrator must monitor and resume, not a result; agent liveness is probed with a message, never diagnosed from host signals (no local CPU + a stale transcript is not a stuck agent). | [@dromsak](https://github.com/dromsak) (#7) |

The liveness rule's probe semantics were verified empirically before merging (a busy agent queues the probe; a completed one is resumed by it), which caught that the exact response strings vary across harness versions — the shipped rule describes the behavior instead of quoting strings.

## v1.1.2 — 2026-07-10

Hardening patch. Re-run the install prompt to upgrade.

| Change | Credit |
|---|---|
| **The six roles are now hard leaf agents.** The four executor roles get `disallowedTools: Agent, Workflow`; `verifier` extends its existing read-only exclusions with the same; `scout`/`Explore` were already leaves via their `tools` allowlist. Each also carries an explicit "you are a leaf agent" line so a genuinely mis-routed task is reported back instead of re-delegated. | [@dromsak](https://github.com/dromsak) (#6) |

This replaces v1.1.1's prompt-only guard with capability removal. The prompt guard put the routing table into every subagent's context, so a `mech-executor` could pattern-match its own task and re-delegate — observed cascading four levels deep in a real incident. Verified before merge: with the prompt guard a nested role still spawned (a haiku scout ran real work); with `disallowedTools` the spawn is blocked and the role does the work itself.

## v1.1.1 — 2026-07-10

Community-driven patch. Re-run the install prompt to upgrade.

| Change | Credit |
|---|---|
| Policy block now forbids subagent roles from spawning further subagents — delegation is a main-session-only concern. The recursive-spawn risk was verified empirically (a sonnet role successfully dispatched a haiku role) before merging | [@nicofirst1](https://github.com/nicofirst1) (#3, #5) |
| `executor` / `mech-executor` no longer babysit long-running processes: launch detached (nohup + log), one sanity check, then yield with PID + log path for the orchestrator to monitor | [@nicofirst1](https://github.com/nicofirst1) (#2, #4) |
| Follow-up to the above: a detached launch must be reported as a handoff, not a completed verification, when done-criteria depend on the process outcome | maintainer |
| Installer Step 4 verification updated for Claude Code 2.1.198+ (the `/agents` wizard was removed); verify via `/model` and by asking Claude which subagent types are available | [@zxcj04](https://github.com/zxcj04) (#1) |

## v1.1.0 — 2026-07-09

Security, accuracy, and update-flow release. Re-running the install prompt upgrades in place.

### Security & trust

| Change | Why |
|---|---|
| New **Trust & security** README section, with a tag/SHA-pinned install variant | `main` can change between review and install (TOCTOU); pinning makes what-you-reviewed = what-installs |
| Runbook: templates must be fetched from the same pinned ref as the runbook | Pinning now covers the actual installed bytes, not just the instructions |
| `scout` / `Explore` switched from a `disallowedTools` denylist to a positive `tools: Read, Glob, Grep` allowlist | They previously retained Bash, so "read-only" was prompted, not enforced |
| Runbook detects agent collisions by frontmatter `name:` (not filename) and flags plugin shadowing | Claude Code loads only one definition per name; `executor`/`scout` are common names |

### Behavior & quality

| Change | Why |
|---|---|
| Policy block self-disables for subagent roles | A custom `Explore` loads user memory (the built-in skips it); the policy is main-session-only |
| New policy rule: scout findings are unverified inputs | The verifier gate covers executor output, not reconnaissance |
| `verifier` runs maximum-thoroughness on security-sensitive work | medium-effort verification of high-effort security work was inconsistent |
| Versioning + "Updating an existing install" flow (this release) | Early installs had no way to learn about updates |

### Docs & claim accuracy

| Change | Why |
|---|---|
| Split Anthropic's endorsement (delegation + fresh-context verification) from pilotfish's own cheap-model routing thesis | Attribution honesty |
| 12-worker numbers reframed as an upper-bound, API-dollar experiment, with inline sources | One community experiment ≠ a guarantee; subscription quota ≠ API dollars |
| Explore warning corrected: inherited model is Opus-capped on the Claude API | Precision |
| `best`-alias fallback at the 7/12 boundary restated honestly (documented rule + June outage precedent; boundary UX unpublished; `fallbackModel` never triggers on billing errors) | The boundary hasn't been observed by anyone yet |
| Windows portability note; subscription-vs-API/Bedrock scope note; FAQ rows for spawn overhead, fast off-switch, managed environments, project-CLAUDE.md stacking | Compatibility coverage |

## v1.0.0 — 2026-07-08

Initial public release: three-layer global architecture (settings `best` + `fallbackModel`, six role agents with tiered model/effort bindings, role-based delegation policy), one-prompt agent-guided installer with approval gate and idempotent upgrades, bilingual README, sourced research report and design rationale.
