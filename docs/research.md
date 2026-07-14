# OpenCode Multi-Model Orchestration Research

## Purpose

This report records the OpenCode capabilities verified for Pilotfish `0.0.1`. It replaces the original repository's Claude-specific model and subscription research with the mechanisms this port actually depends on. Findings are current as of 2026-07-13.

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

Pilotfish uses inline `agent` entries in the global config because that keeps all role-to-model assignments visible in one map. Prompt bodies remain separate files.

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

The local test environment exposed these Phase 1 families with tool calling:

| Family | Context reported by OpenCode | Relevant variants |
|---|---:|---|
| GPT-5.6 Sol | 1,050,000 | `none`, `low`, `medium`, `high`, `xhigh` |
| GPT-5.6 Terra | 1,050,000 | `none`, `low`, `medium`, `high`, `xhigh` |
| GPT-5.6 Luna | 1,050,000 | `none`, `low`, `medium`, `high`, `xhigh` |
| AntiGravity Gemini 3 Flash | 1,048,576 | `minimal`, `low`, `medium`, `high` |
| AntiGravity Gemini 3.1 Pro | 1,048,576 | `low`, `high` |
| AntiGravity Claude Sonnet 4.6 | 200,000 | no exposed variant |
| AntiGravity Claude Opus 4.6 Thinking | 200,000 | `low`, `max` |

These are integration observations, not universal availability guarantees. The installer verifies exact IDs before offering a preset.

## Built-In and Custom Roles

The tested OpenCode runtime ships primary Build and Plan agents plus subagents including `general` and lowercase `explore`. Pilotfish does not modify Build or Plan.

Pilotfish supplies its own `scout` and uppercase `Explore` roles to preserve the original role contract. Uppercase `Explore` coexists with lowercase built-in `explore`; user-authored definitions with the exact Pilotfish names are installation collisions.

## Background Agents and Worktrees

OpenCode's current source contains experimental background-subagent support and experimental APIs to create, list, reset, and remove Git worktrees.

The stable Task schema does not accept a worktree or isolation argument. A child Task therefore runs in the parent project context rather than receiving Claude Code's `isolation: "worktree"` behavior. Pilotfish serializes writing workers and does not depend on experimental APIs.

## Fallback

The published OpenCode config schema provides one `model` per agent and no general `fallbackModel` or ordered per-role fallback field.

Provider gateways may implement their own routing, but that is provider-specific and outside Pilotfish's two presets. Prompt-driven retries are not equivalent because a worker may fail after side effects, and a failed primary cannot run its own recovery policy.

Pilotfish `0.0.1` documents this difference rather than claiming automatic failover.

## Implications for Pilotfish

| Requirement | OpenCode result |
|---|---|
| Opt-in orchestrator | Native custom primary agent |
| Per-role model | Native agent `model` |
| Per-role reasoning setting | Native agent `variant`, provider-specific |
| Fresh verifier context | Native Task child session |
| Leaf workers | Native Task denial |
| Read-only reconnaissance | Native permissions |
| Allowed delegation graph | Native ordered Task permissions |
| Automatic model fallback | Not available generally |
| Task worktree isolation | Not available on stable Task surface |
| Runtime plugin required | No, for the Phase 1 feature set |

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
