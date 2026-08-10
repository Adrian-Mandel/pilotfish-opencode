# Pilotfish for OpenCode: Design Rationale

## Purpose

Pilotfish routes coding work by role so a capable primary model can spend its context on planning and judgment while less expensive workers handle volume. This document explains how that idea maps onto OpenCode with a narrow runtime profile adapter rather than a parallel session, provider, or tool host.

## Configuration and Narrow Runtime Routing

Original Pilotfish is three kinds of configuration layered over Claude Code. This port keeps role policy in configuration and prompts, and adds only the runtime behavior OpenCode configuration cannot express:

```text
Pilotfish defines public roles, models, permissions, policy, and canonical profiles.
The profile router pins a supported session profile and redirects worker Tasks.
OpenCode creates sessions, calls providers, and executes tools.
```

The required config-relative plugin `./pilotfish/profile-router.mjs` loads its adjacent `profiles.json` from the global Pilotfish directory. The router is required. It does not launch models, create worktrees, provide model fallback, or replace OpenCode permissions.

The router's owned guarantees, the OpenCode behaviors it depends on, its accepted risks, and its threat model are fixed in the [profile router contract](./profile-router-contract.md). That document, not this one, governs whether a proposed change is in scope.

## Three Concerns

| Concern | OpenCode mechanism | Changes when |
|---|---|---|
| Who orchestrates | Opt-in `pilotfish` primary agent | The preferred primary model changes |
| Who performs each public role | Eight subagent definitions with model and variant | A preset or role assignment changes |
| How delegation behaves | Model-neutral prompt files and profile-router hooks | Workflow policy or approved profile routing changes |

The global config stores the public agent graph. Plain prompt files store behavior. Source preset fragments store public model and variant overlays. `profiles.json` is the exact internal routing table.

## Why an Opt-In Primary

Original Pilotfish puts orchestration instructions in global `CLAUDE.md`, so every main session and custom worker sees them. Workers need instructions telling them to ignore the global routing policy.

OpenCode supports custom primary agents. Attaching the orchestration prompt only to `pilotfish` gives cleaner scoping:

- Built-in Build and Plan remain unchanged.
- Workers receive only their own role prompt.
- Users choose when orchestration overhead is worthwhile.
- The installer does not change `default_agent` or the global model.

## Why These Roles

| Role | Design reason |
|---|---|
| `scout` | Narrow fact finding is frequent, cheap, and safe to constrain to read/search tools |
| `Explore` | Broad codebase or accessible project-local artifact reconnaissance needs a larger search budget but still no write access |
| `plan-verifier` | A material Plan benefits from fresh-context challenge before approval, with repository reads but no command or write capability |
| `security-reviewer` | Pre-approval security evidence needs high-capability judgment and a read-only tool boundary |
| `mech-executor` | A complete specification has already supplied the judgment; the worker should execute rather than redesign |
| `executor` | Real implementation needs local decisions and stronger code reasoning |
| `verifier` | Post-implementation fresh-context refutation catches unchecked claims and context blindness better than implementer self-review |
| `security-executor` | Approved security implementation deserves explicit routing, assumptions, abuse-case testing, and a high-capability model |

The original names are preserved. Pilotfish supplies `scout`, while uppercase `Explore` coexists with OpenCode's lowercase built-in `explore` because OpenCode agent names are case-sensitive.

## Permission-Controlled Agent Graph

The `pilotfish` primary may invoke only the eight Pilotfish workers. Each public worker has Task denied, making it a leaf agent.

Read-only roles start with a deny-all rule and then allow only explicit evidence tools. Environment files remain denied. `security-reviewer` additionally allows web fetches; the verifier denies file-edit tools and Task while retaining bash so it can reproduce tests after implementation.

Permissions provide stronger guarantees than prompts alone, but they are not a complete sandbox. In particular, arbitrary shell commands can write files. The verifier prompt and focused bash denials preserve the read-and-run contract where OpenCode cannot express it perfectly.

## Profile Routing Contract

For the ChatGPT preset, the public config remains the Sol-default public graph. The router uses `config`, `chat.message`, `tool.execute.before`, `tool.execute.after`, and `session.deleted` hooks. On an in-memory cache miss, `chat.message` reads the persisted session history through the plugin client, orders prior Pilotfish user messages by `info.time.created` (with model-name tie breaking), and recovers the earliest model profile before accepting the current turn. This preserves a pin across OpenCode/plugin restarts and history forks; an unavailable, erroneous, or malformed history result fails closed before provider execution. A session with no prior Pilotfish user message pins the current resolved model. At the first Pilotfish message it accepts the Sol, Terra, or Luna primary model, pins the selected profile by session ID, and creates 24 hidden clones: the eight public workers for each profile. Every public worker must remain a subagent, and each hidden clone preserves that mode. Sol/high, Terra/high, and Luna/max are tested primary recommendations rather than routing gates; UI-selected effort remains under user control. A `tool.execute.before` hook maps each Task role to the selected hidden worker before Task permission and agent resolution and records a one-time authorization keyed by parent session and call ID. The internal child must resolve to that exact agent and report the authorized parent through `client.session.get`; authorization is consumed before allowing chat. `tool.execute.after` removes unused authorization. Clone permissions are copied from the public worker, and the primary receives permission only to invoke those clones. Hidden `pilotfish-profile-*` names are implementation details, not an authorization boundary: direct, root, mismatched, and replayed internal chat is rejected while one-time router-authorized Task children are allowed. OpenCode's CLI refuses hidden subagents selected with `--agent` before the hook and may fall back to its default primary; that fallback is host behavior, not execution of the hidden clone.

The public primary's model and variant are never changed. The selected model chooses the worker profile; changing primary effort within that model-pinned session does not change the profile. The profile pin persists across agent switches, but Task remapping is active only while Pilotfish is the current successfully resolved agent. A non-Pilotfish chat deactivates routing without deleting the pin, and a validated same-model Pilotfish chat reactivates it. The router rejects a same-session primary-model change, unsupported primary models, and cross-preset models before provider execution. Session deletion clears the active-agent marker plus cached and pending recovery state. AntiGravity deliberately validates canonical public worker bindings and then passes Tasks through unchanged; it makes no clones, while using the same persisted-history recovery for its primary pin.

New Tasks bind child identity through a transient marker: `tool.execute.before` hashes the call ID with SHA-256, appends that encoded marker to the description, and records an unbound authorization with its creation time. Only a synchronous matching `session.created` event may bind the exact post-authorization child ID, title, parent, agent, and profile; an older event cannot bind when OpenCode supplies creation time. Child chat is accepted only for that bound ID after `session.get` revalidates those fields. This prevents a pre-existing sibling from stealing authorization even if retitled to the marker, and concurrent same-role calls remain distinct. The router consumes authorization and restores the standard clean `description (@agent subagent)` title through `session.update` before provider execution. Resumed Tasks do not use a marker: before rewriting, the router fetches and binds the exact `task_id` and requires its ID, parent, and agent to match. Every authorization has an independent foreground-only 30-second expiry; consumption, `tool.execute.after`, parent deletion, and plugin disposal clear its timer. After restores the mutable args description and output title and clears authorization. OpenCode `1.18.10` captures raw tool input before that after-hook, so JSON event history may retain the marked description; the marker is only a SHA-256 call-ID digest and contains no prompt or credential data.

Expiry, parent deletion, and disposal synchronously claim and revoke each authorization before awaiting cleanup, so a racing child chat or after hook cannot consume or replay it. For a bound new Task, cleanup re-reads the exact event-bound child and updates its title only if it still equals the marked title; timer/args cleanup and authorization removal run in `finally`. Child chat and `tool.execute.after` retain awaited title restoration on their normal paths. Resumed Tasks skip marker restoration. Host lookup/update failure still revokes and removes authorization, though the marked title may require manual child-title cleanup.

Pilotfish supports the verified foreground Task sequence `tool.execute.before` → `session.created` → child `chat.message` → `tool.execute.after`. Child chat racing ahead of the creation event fails closed. Experimental background Task timing is not a dependency: if OpenCode runs the after hook before a detached child starts, the authorization is cleared and the child fails closed rather than leaving a detached authorization.

OpenCode logs and ignores plugin configuration errors, and skips a plugin whose factory throws. The router therefore records config-hook errors for the first Pilotfish message and converts catchable factory initialization errors into protective hooks that reject raw or resolved Pilotfish chat, internal-agent chat, and internal Task targets while unrelated sessions remain no-ops. Module syntax and load failures occur before the factory can return hooks, so installer and release smoke checks must prove loading and routing rather than infer it from JSON parsing.

OpenCode `1.18.10` also renders plugin-hook exceptions as a generic `Unexpected server error` on the standard JSON CLI surface. Exact router reasons are visible with `--print-logs`; preflight validation prevents ordinary users from reaching unsupported configurations.

## Model Presets

OpenCode models are identified as `provider/model-id`; there is no portable alias layer equivalent to Claude's `best`, `opus`, `sonnet`, and `haiku`.

Version `0.2.0` ships two explicit, tested mappings:

- ChatGPT through the OpenAI provider, with three session-pinned Sol/Terra/Luna profiles.
- AntiGravity through model IDs exposed by the user's existing Google integration, validated as public passthrough.

Model and variant are configured together because reasoning controls differ by provider. The policy prompt names roles, not models, so model assignments can change without rewriting workflow rules. The router rejects unapproved runtime selections rather than silently falling back: there is no fallback.

## Quality Controls

Pilotfish protects delegated quality structurally:

1. Discovery receives a bounded evidence contract; the primary synthesizes one Plan.
2. Material Plans may receive a fresh, read-only `plan-verifier` challenge before approval.
3. Writing roles receive stable, authorized contracts with scope, ownership, constraints, and done criteria.
4. A role gets two attempts before escalation or primary takeover.
5. Non-trivial implementation receives a fresh `verifier` child session.
6. Reconnaissance is treated as evidence to check rather than an authoritative conclusion.
7. Workers are prevented from recursively delegating.

Both verification roles are independent but not free. Small work may skip them when a second context cannot reasonably protect enough value.

## Phase-Specific Dispatch Brakes

Role eligibility does not make delegation mandatory. Small, local, stable work remains in the primary session. Larger work moves through Discovery, Plan, Approval when required, Execution, and Verification. Discovery can begin before the implementation outcome is known, but only under a stable question, evidence format, scope, and stop condition. Plan synthesis, integration, and final judgment remain primary-session responsibilities.

Delegation is blocked when workers would repeatedly depend on evolving primary-session evidence, ownership overlaps, or synthesis and verification cost exceed the likely benefit. One unknown bug therefore keeps diagnosis, first minimal fix, and live verification in one reasoning chain instead of becoming a sequential scout-to-executor pipeline.

## Parallelism

Read-only searches may run concurrently because they cannot conflict in the worktree.

Writing workers are serialized in `0.2.0`. OpenCode contains experimental worktree APIs, but its stable Task schema does not expose Claude Code's `isolation: "worktree"` behavior or automatic result harvesting. Depending on experimental APIs would violate the release's stable-surface goals.

Leaf roles never detach long-running commands. If a command cannot finish within the host tool timeout, the worker returns its exact command and execution context to the primary. Stable OpenCode configuration does not guarantee persistent background shell tracking, so Pilotfish reports that limitation instead of promising Claude-specific process behavior.

## Fallback

OpenCode's current agent schema accepts one model per agent and has no general ordered fallback list. Pilotfish does not approximate automatic failover with hidden agents because a failed worker may already have produced side effects, and the primary model cannot rescue itself when its own request fails.

Fallback design remains a tracked limitation. Any future solution must preserve clear cost boundaries, handle partial writes, and avoid requiring a broader Pilotfish runtime engine.

## Configuration Check

The primary prompt asks OpenCode to inspect `opencode debug agent pilotfish` once per new session. It warns without blocking when the resolved primary model and variant do not match a tested preset.

This is a compatibility warning, not a visibility gate. The `pilotfish` agent remains selectable with any model configuration; the router's separate runtime contract decides whether a Pilotfish session can proceed.

## Deliberately Left Out

| Feature | Reason |
|---|---|
| Per-project installation | A global opt-in primary provides one personal source of truth |
| Arbitrary installer model picker | `0.2.0` tests bounded mappings; advanced users can edit config directly, but unsupported sessions reject before provider execution |
| Mixed-provider preset | Deferred until single-provider behavior is proven |
| Local Qwen preset | Planned for later OMLX evaluation, including missing context/output metadata |
| Automatic fallback | No stable native OpenCode mechanism |
| Parallel writers | No stable Task-level worktree isolation |
| Provider gateway or custom Task tool | OpenCode remains the execution and permission host |

## Evolution Rule

Pilotfish may adopt new behavior when OpenCode exposes it through stable configuration or a narrow stable plugin hook. It should not grow a parallel orchestration runtime merely to imitate another host's features.

Upstream Pilotfish changes are reviewed through the [semantic sync workflow](./upstream-sync.md). The [upstream deviations ledger](./upstream-deviations.md) is the authoritative current record of intentional differences from the reviewed baseline. The recorded upstream commit advances only after each change has been adopted, adapted, deferred, or marked inapplicable for OpenCode.
