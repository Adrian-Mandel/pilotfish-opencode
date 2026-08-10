# Profile Router: Host Contract and Threat Model

## Purpose

This document fixes the boundary of the Pilotfish profile router before further implementation. It exists because the first implementation attempt on issue #12 expanded from "select a worker profile" into hidden-child authorization, cross-process state recovery, permission-wildcard emulation, and CLI error behavior without re-approving that scope.

Anything in **Guarantees** is owned and must stay tested. Anything in **Non-guarantees** is accepted risk and must not be fixed by growing the router. Anything in **Out of scope** requires re-approval on issue #12 before work starts.

Pinned host: OpenCode `1.18.10`. A host upgrade invalidates every claim below until the integration fixture is re-run.

Profiles are data. `profiles.json` defines one entry per profile and groups them into named presets; the router contains no profile-specific code, so adding a provider or a model tier is a data edit. Two profiles may never claim the same primary model, and a preset activates only its own profiles.

Current profiles: `sol`, `terra`, `luna` (ChatGPT preset) and `opus`, `pro`, `flash` (AntiGravity preset).

## Why hidden clones exist

OpenCode 1.18.10 has no per-invocation model override for Task. The plugin surface that runs closest to the provider call, `chat.params`, receives `agent` and `model` as **input only**; its output is limited to `temperature`, `topP`, `topK`, `maxOutputTokens`, and `options` (`@opencode-ai/plugin/dist/index.d.ts:199`). A plugin therefore cannot change which model a role runs on while keeping the public role name.

The only remaining mechanism is to generate profile-specific agents at config time and rewrite `subagent_type` in `tool.execute.before`. Every guarantee below is a consequence of that constraint, not a preference. If a future OpenCode exposes a constrained per-Task model override (issue #13), most of this contract can be deleted.

## Guarantees

| ID | Guarantee |
|---|---|
| G1 | Exactly one visible Pilotfish primary. Generated workers are `hidden` and named `pilotfish-profile-<profile>-<role>`. |
| G2 | The profile is selected from the primary **model** alone. The user's selected effort/variant is never read for routing and never overridden. |
| G3 | The profile pin is immutable for the life of the session. A different primary model raises an error; it never silently reroutes or mixes profiles. |
| G4 | Routing is active only while `pilotfish` is the current successfully resolved and pinned agent in that session. After an agent switch, Task calls pass through untouched. |
| G5 | Only the eight public worker roles are rewritten. Any other `subagent_type` is left exactly as the caller wrote it. |
| G6 | Internal agent names cannot be invoked directly, either as a chat agent or as a Task `subagent_type`. |
| G7 | Each internal child chat requires a one-time authorization bound to an exact child session ID, parent ID, agent, and marked title. Direct, root, sibling, mismatched, expired, replayed, and ambiguous children are rejected. |
| G8 | Every failure is closed and raised before any assistant/provider request: unsupported primary model, missing `callID`, malformed description, duplicate `callID`, background Task, or a stored configuration error. A partial or mixed profile is never applied. |
| G9 | Config generation refuses to weaken user customization. It requires `permission.task` to start at `"*": "deny"` with each public worker resolving through its own `allow`, refuses any pre-existing rule that could match an internal name, refuses internal-name collisions, and requires public workers to be `mode: "subagent"`. |
| G10 | Across process restarts the pin is recovered from the first persisted Pilotfish user message. If history cannot be read or the recovered model is unsupported, the session errors rather than re-pinning to a different profile. |

## Host facts this depends on

Each row is a coupling point to OpenCode 1.18.10. If one changes upstream, the linked guarantee must be re-verified.

| ID | Host behavior | Consequence |
|---|---|---|
| H1 | `config` hook errors are logged and ignored by the host | The error is stored and rethrown at the first Pilotfish message (G8) |
| H2 | A plugin factory that throws is skipped entirely, silently | The factory catches and returns protective hooks instead of throwing (G8) |
| H3 | `tool.execute.before` may mutate args, but runs before Task permission and agent resolution | Internal names must be statically allowed, which is why G6 exists as a separate guard |
| H4 | The before-hook has parent `sessionID` and `callID` but not the child session ID | Exact binding requires a description marker plus the later `session.created` event (G7) |
| H5 | Task child titles are `"<description> (@<agent> subagent)"` | The router mirrors this format to recognize and clean its own marker |
| H6 | `tool.execute.after` does not run when execution throws | Authorization expiry needs an independent 30-second timer (G7) |
| H7 | `chat.message` runs before the current message is persisted; prior messages are readable via `client.session.messages` | Restart recovery reads history rather than trusting empty in-memory state (G10) |
| H8 | Task selects a named agent and exposes no per-call model override | Hidden clones are required at all |
| H9 | Task permission patterns use OpenCode's wildcard semantics, last match wins | The router mirrors that matcher to validate customized permissions (G9) |
| H10 | Standard CLI JSON replaces hook exceptions with a generic `Unexpected server error` | Exact router reasons require `--print-logs` |

## Non-guarantees (accepted risk)

These are known, bounded, and must not be addressed by adding router complexity.

- **Marker residue in captured events and in the UI.** A task description carries a transient SHA-256 call marker. Raw tool-input events captured before cleanup retain it, and the CLI/TUI shows the marked description in the running task label, e.g. `read VERSION file [pilotfish-task:a3a03696…]`. Only the child session title is cleaned. The digest contains no prompt or credential data.
- **AntiGravity 3.5 and 3.6 flash are unreachable.** `opencode-antigravity-auth` 1.6.0 intercepts every `google/*` request and strips the `-preview` suffix, and the AntiGravity endpoint has no `gemini-3.5-flash` or `gemini-3.6-flash`, so both 404 through every path. The plugin implements only `antigravity-gemini-3-flash`, `-3-pro`, `-3.1-pro`, `antigravity-claude-opus-4-6-thinking`, and `antigravity-claude-sonnet-4-6`. No configuration change reaches the newer flash models; that needs plugin or upstream support.
- **Child title cleanup is best-effort.** If the host's `session.update` fails, a child session may keep its marked title and need manual cleanup. Authorization is already revoked at that point, so this is display metadata only.
- **Resumed Tasks have no marker** to restore, by design; they authorize on exact `task_id`, parent, and agent instead.
- **Hidden agents via `--agent`.** OpenCode refuses a hidden agent before router hooks run and may fall back to its own default primary. That is not a Pilotfish execution and Pilotfish does not attempt to intercept it.
- **Experimental background Tasks are unsupported** and fail closed.
- **Authorization TTL is 30 seconds.** A host that delays `session.created` beyond that window fails closed rather than routing.
- **Router state is process-local** apart from the recovered pin. Nothing else survives a restart by design.
- **Module load and syntax errors precede factory protection.** Configuration JSON alone cannot prove enforcement, so plugin-loading smoke tests remain mandatory.
- **No automatic model fallback.** OpenCode exposes one model per agent and no ordered fallback field.
- **Listed is not entitled.** `opencode models --verbose` lists every model a provider plugin registers, including ones the account cannot call. `google/antigravity-gemini-3.5-flash` and `-3.6-flash` are listed but return provider `404` on this account, while `-3-flash` serves. Installer preflight checks presence and variants only; a profile's models must be exercised once against the real provider before it is approved.

## Threat model

**Trusted.** The host, the user's own OpenCode configuration, the installed plugin files, and `profiles.json`. A user who deliberately edits their own config to expose internal agents is out of scope; the router protects against accident and against model output, not against the operator.

**Semi-trusted.** Model output. The primary or a worker may emit a Task call with any `subagent_type`, `description`, or `task_id`. The router must ensure such a call cannot reach an internal clone except through its own rewrite, and cannot capture another call's authorization.

**Untrusted.** Project files, tool results, and web content read by workers. Prompt injection is assumed possible.

**In scope.** Direct selection of an internal agent; a sibling, root, replayed, or expired session consuming an authorization; concurrent same-role calls being confused for one another; a permission wildcard admitting an arbitrary agent as a Task target; and profile downgrade — routing a security role to a weaker model than its profile specifies.

**Out of scope.** Host compromise; provider-side behavior; cost or token limits; sandboxing what a worker does once correctly routed; and any guarantee that injected content cannot influence a worker's *output* — the router governs model and agent selection only.

## Change control

Adding a capability outside **Guarantees** — new authorization states, new persisted state, new host APIs, or a broadened permission surface — requires re-approval on issue #12 first. If verification refutes a guarantee for a structural host reason, the response is to return to the architecture decision, not to patch the router again.
