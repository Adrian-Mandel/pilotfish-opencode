# OpenCode Multi-Model Orchestration Research

## Purpose

This report records the OpenCode capabilities verified for Pilotfish `0.2.0`. It replaces the original repository's Claude-specific model and subscription research with the mechanisms this port actually depends on. Findings are current as of 2026-08-09.

## Configuration and Discovery

OpenCode merges configuration from organization, global, custom, project, directory, inline, and managed sources. Pilotfish modifies only the highest-precedence active global user config under `~/.config/opencode/`.

Relevant facts:

| Capability | Verified behavior |
|---|---|
| Global config | Loads `config.json`, then `opencode.json`, then `opencode.jsonc`; later files override earlier ones |
| Merge behavior | Sources merge; later sources override conflicts |
| Schema | `https://opencode.ai/config.json`; unknown top-level keys are rejected |
| Agent files | Global Markdown agents may live under `~/.config/opencode/agents/` |
| Prompt references | Agent prompts may use `{file:./relative/path.md}` |
| Config inspection | `opencode debug config` prints the resolved configuration |
| Agent inspection | `opencode debug agent <name>` prints model, variant, permissions, and tools |
| Reload behavior | Configuration is loaded at startup; changes require restart |
| Plugins | A config-relative plugin may provide `config`, `chat.message`, `tool.execute.before`, `tool.execute.after`, and event hooks; config-hook errors are logged and ignored by the host |
| Session history | Plugin input includes `client`; in OpenCode 1.18.10, `client.session.messages({path:{id: sessionID}})` returns a HeyAPI result whose `data` is `{info, parts}` records. Prior user `info` records include `role`, `agent`, `model.providerID`/`modelID`, and `time.created`; `chat.message` runs before the current message is persisted. |

Pilotfish uses inline `agent` entries in the global config because that keeps all role-to-model assignments visible in one map. Prompt bodies remain separate files. The required plugin tuple loads `./pilotfish/profile-router.mjs` beside the managed `profiles.json` source of truth. The router uses the verified history API to recover the first persisted Pilotfish model-profile pin across process restarts instead of treating an empty in-memory cache as a new session.

## Agent Model

OpenCode distinguishes primary agents from subagents:

- Primary agents are directly selectable in the user interface.
- Subagents are invoked through Task or by direct mention.
- A custom agent may set its own provider-qualified model and variant.
- A subagent without a model inherits the invoking primary model.

Current OpenCode source creates a child session for Task and selects the subagent's configured model when present. Reusing a task ID resumes the existing child session. This gives Pilotfish the fresh-context verifier and stable role-model routing it needs.

Agent names loaded from Markdown preserve their relative filename, including case. This permits uppercase `Explore` to coexist with lowercase built-in `explore`.

## Permissions

OpenCode permissions resolve to `allow`, `ask`, or `deny`. Most tool permissions accept ordered pattern maps, and the last matching rule wins.

Relevant permission keys include:

- `read`
- `edit`, covering write, edit, and apply-patch tools
- `glob`
- `grep`
- `list`
- `bash`
- `task`
- `external_directory`
- `webfetch`
- `websearch`
- `lsp`
- `skill`

Per-agent permissions override global rules. `permission.task` matches the target subagent name, allowing the primary to expose only Pilotfish workers. A flat Task denial removes recursive delegation from workers.

OpenCode cannot express a universal read-only shell permission because arbitrary project test commands may themselves write files. Pilotfish therefore hard-denies file-edit tools and selected destructive commands for `verifier`, then reinforces the remaining boundary in its prompt.

## Models and Variants

OpenCode identifies models as `provider/model-id`. The available catalog depends on authenticated providers and can be inspected with `opencode models [provider] --verbose`.

The current OpenCode `1.18.10` evidence exposed these Phase 1 families with tool calling:

| Family | Context reported by OpenCode | Relevant variants |
|---|---:|---|
| GPT-5.6 Sol | 500,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| GPT-5.6 Terra | 500,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| GPT-5.6 Luna | 500,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| AntiGravity Gemini 3 Flash | 1,048,576 | `minimal`, `low`, `medium`, `high` |
| AntiGravity Gemini 3.1 Pro | 1,048,576 | `low`, `high` |
| AntiGravity Claude Sonnet 4.6 | 200,000 | no exposed variant |
| AntiGravity Claude Opus 4.6 Thinking | 200,000 | `low`, `max` |

These are integration observations, not universal availability guarantees. The installer verifies exact IDs and variants before offering a preset.

### Runtime profiles

`profiles.json` defines nine public roles, named presets, and one entry per profile. The ChatGPT preset groups Sol, Terra, and Luna; the AntiGravity preset groups Opus, Pro, and Flash. Adding a profile is a data edit, not a router change. Sol/high, Terra/high, Luna/max, Opus/max, Pro/high, and Flash/high are the recommended primaries; routing is keyed only by the selected primary model, so primary effort remains user-controlled. Two profiles may never claim the same primary model. The router creates one set of eight hidden worker clones per active profile while leaving the persisted public primary binding untouched. Public workers must have raw mode `subagent`, which the hidden clones retain. It pins a profile at the first Pilotfish message and routes later worker Tasks through `tool.execute.before`; the profile pin persists across agent switches, but remapping is active only while Pilotfish is the current successfully resolved agent. New Tasks use a transient SHA-256 call marker in the description, and only a matching later `session.created` event binds the exact marked child ID, title, and parent. Concurrent same-role calls therefore remain distinct and a pre-existing sibling cannot consume authorization. The marker is removed from the child title through `session.update` before provider execution, and `tool.execute.after` restores its mutable args/result objects. OpenCode `1.18.10` may retain the marked description in previously captured raw tool-input events; the digest contains no prompt or credential data. Resumed Tasks instead validate the exact `task_id`, parent, and internal agent without changing the description. Direct, root, sibling, mismatched, expired, and replayed internal chat is rejected. A different primary model in that session is rejected, while an effort change on the same model leaves the profile unchanged. Each preset activates only its own profiles, so one provider's clones never appear in another's configuration. On the CLI, OpenCode refuses a hidden subagent selected through `--agent` before the hook and may run its default primary instead; it does not execute the hidden clone. Experimental background Task timing is unsupported and fails closed.

New-task authorization starts unbound and is bound only by an exact post-authorization `session.created` event carrying the marker, child ID, parent, agent, and profile. Child chat requires that bound ID; title alone is insufficient. Creation time, when present, must not predate authorization. A foreground-only 30-second timer independently removes stale records even when Task throws before `tool.execute.after`; consume, after, parent deletion, and disposal clear timers. The required ordering is before → created event → child chat → after, and races fail closed.

The expiry/deletion/disposal path now revokes atomically, then asynchronously re-reads the exact bound child and restores its clean title only while the title is still marked. Authorization removal occurs in `finally`, and timer callbacks observe their cleanup rejection, so update failure cannot leave a usable authorization or an unhandled rejection. A host update failure can still leave display metadata requiring manual child-title cleanup; resumed Tasks have no marker to restore.

Because plugin config exceptions are non-fatal and OpenCode skips thrown plugin factories, router configuration errors are stored for the first Pilotfish message while catchable factory initialization errors are deferred through protective hooks. Those hooks block raw or resolved Pilotfish chat and internal chat/Task targets without affecting unrelated sessions. Module syntax and load failures happen before factory protection, so real plugin-loading smoke tests remain mandatory; configuration JSON alone cannot prove enforcement. Unsupported and cross-preset models are rejected before an assistant/provider request.

The standard OpenCode `1.18.10` JSON CLI renders these hook exceptions as a generic `Unexpected server error`; `--print-logs` retains the exact router reason. This is a host presentation limit, not a provider call or fallback.

### Artifact Inputs

`opencode models --verbose` reported that both configured Explore models (`openai/gpt-5.6-luna` and `google/antigravity-gemini-3-flash`) accept image and PDF input, and do not report video input. A generated frame sheet is an image input. Pilotfish does not perform native video decoding or extraction.

## Built-In and Custom Roles

The tested OpenCode runtime ships primary Build and Plan agents plus subagents including `general` and lowercase `explore`. Pilotfish does not modify Build or Plan.

Pilotfish supplies its own `scout` and uppercase `Explore` roles to preserve the original role contract. Uppercase `Explore` coexists with lowercase built-in `explore`; user-authored definitions with the exact Pilotfish names are installation collisions.

## Background Agents and Worktrees

OpenCode's current source contains experimental background-subagent support and experimental APIs to create, list, reset, and remove Git worktrees.

The stable Task schema does not accept a worktree or isolation argument. A child Task therefore runs in the parent project context rather than receiving Claude Code's `isolation: "worktree"` behavior. Pilotfish serializes writing workers and does not depend on experimental APIs.

## Fallback

The published OpenCode config schema provides one `model` per agent and no general `fallbackModel` or ordered per-role fallback field.

Provider gateways may implement their own routing, but that is provider-specific and outside Pilotfish's two presets. Prompt-driven retries are not equivalent because a worker may fail after side effects, and a failed primary cannot run its own recovery policy.

Pilotfish `0.2.0` documents this difference rather than claiming automatic failover.

## Implications for Pilotfish

| Requirement | OpenCode result |
|---|---|
| Opt-in orchestrator | Native custom primary agent |
| Per-role public model | Native agent `model` |
| Per-role reasoning setting | Native agent `variant`, provider-specific |
| Session-pinned ChatGPT profiles | Required config-relative plugin and canonical JSON data |
| Fresh verifier context | Native Task child session |
| Leaf workers | Native Task denial |
| Read-only reconnaissance | Native permissions |
| Read-only Plan and security review | Native permissions with separate role prompts |
| Allowed delegation graph | Native ordered Task permissions plus clone extension |
| Automatic model fallback | Not available generally |
| Task worktree isolation | Not available on stable Task surface |

## Upstream v1.2.0 Evidence

Original Pilotfish `v1.2.0` introduced phase-specific dispatch brakes and separate Plan, security, and outcome review contracts. Its published Baton and dispatch-brake fixtures are Claude-specific experiments, not OpenCode benchmarks, but their policy conclusions are host-independent: bounded discovery may precede a known implementation, Plan synthesis stays with the primary, approval gates precede writes, and fresh review roles need capability separation.

This port adopts those contracts through OpenCode agents and permissions. It does not copy Baton integration, Claude invocation-level model rules, worktree arguments, or background-process claims. OpenCode-native preset resolution, profile-router tests, and policy tests provide the local evidence instead.

## Sources

- [OpenCode configuration](https://opencode.ai/docs/config/)
- [OpenCode agents](https://opencode.ai/docs/agents/)
- [OpenCode models](https://opencode.ai/docs/models/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode tools](https://opencode.ai/docs/tools/)
- [OpenCode rules](https://opencode.ai/docs/rules/)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode configuration schema](https://opencode.ai/config.json)
- [OpenCode Task implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts)
- [OpenCode worktree implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/worktree/index.ts)
