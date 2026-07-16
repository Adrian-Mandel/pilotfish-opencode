# pilotfish for OpenCode

> Small, specialized workers handle routine work so the strongest model can focus on planning and judgment.

Pilotfish is an experimental multi-model orchestration configuration for [OpenCode](https://opencode.ai). It adds an opt-in `pilotfish` primary agent that delegates reconnaissance, implementation, verification, and security work to six model-pinned subagents.

Pilotfish is configuration and prompts, not a runtime orchestrator. OpenCode creates the sessions, calls the models, and enforces tool permissions.

Current version: `0.0.1`

Semantically synced through original Pilotfish `v1.1.4`; see the [upstream sync workflow](./docs/upstream-sync.md).

## Why

Coding sessions spend substantial context on searching, routine edits, test execution, and documentation. Those tasks do not always need the same model used for planning or final review.

Pilotfish separates work by role:

- Keep architecture, ambiguity resolution, integration, and final review in the primary session.
- Route high-volume reconnaissance and mechanical work to less expensive models.
- Use fresh-context adversarial verification for non-trivial changes.
- Enforce read-only and leaf-agent boundaries through OpenCode permissions.

## How It Works

Pilotfish installs one primary agent and six workers in the global OpenCode config:

```text
You
 |
 +-- pilotfish (primary orchestrator)
      |-- scout
      |-- Explore
      |-- mech-executor
      |-- executor
      |-- verifier
      +-- security-executor
```

`pilotfish` is opt-in. It does not replace OpenCode's built-in Build or Plan agents and the installer does not change `model` or `default_agent`.

| Role | Used for |
|---|---|
| `scout` | Narrow read-only lookups with exact file references |
| `Explore` | Broad read-only searches across files and naming conventions |
| `mech-executor` | Fully specified pattern edits, conventional tests, docs, and bulk work |
| `executor` | Features, bug fixes, and refactors requiring local judgment |
| `verifier` | Fresh-context attempts to refute completed work; never fixes findings |
| `security-executor` | Authentication, authorization, secrets, crypto, validation, and hardening |

Workers cannot launch subagents. `scout` and `Explore` cannot edit or run shell commands. `verifier` cannot use file-edit tools and reports `CONFIRMED` or `REFUTED` with independent evidence.

## Presets

The `0.0.1` installer offers two tested presets. It verifies that every required model exists in `opencode models` before changing configuration.

### ChatGPT

| Role | Model | Variant |
|---|---|---|
| `pilotfish` | `openai/gpt-5.6-sol` | `high` |
| `scout` | `openai/gpt-5.6-luna` | `low` |
| `Explore` | `openai/gpt-5.6-luna` | `medium` |
| `mech-executor` | `openai/gpt-5.6-terra` | `low` |
| `executor` | `openai/gpt-5.6-terra` | `high` |
| `verifier` | `openai/gpt-5.6-sol` | `high` |
| `security-executor` | `openai/gpt-5.6-sol` | `xhigh` |

### AntiGravity

| Role | Model | Variant |
|---|---|---|
| `pilotfish` | `google/antigravity-claude-opus-4-6-thinking` | `max` |
| `scout` | `google/antigravity-gemini-3-flash` | `minimal` |
| `Explore` | `google/antigravity-gemini-3-flash` | `low` |
| `mech-executor` | `google/antigravity-claude-sonnet-4-6` | default |
| `executor` | `google/antigravity-gemini-3.1-pro` | `high` |
| `verifier` | `google/antigravity-claude-opus-4-6-thinking` | `max` |
| `security-executor` | `google/antigravity-claude-opus-4-6-thinking` | `max` |

AntiGravity support targets the `google/antigravity-*` model IDs exposed by the user's existing OpenCode integration. Pilotfish does not install or configure that integration.

## Install

The recommended path is to clone the pinned `v0.0.1` release locally, then start OpenCode from that checkout so it reads a local runbook and matching templates:

```bash
git clone --branch v0.0.1 --depth 1 https://github.com/Adrian-Mandel/pilotfish-opencode.git
cd pilotfish-opencode
opencode
```

In that OpenCode session, using a normal primary agent such as Build, paste:

```text
Read the local file install/OPENCODE-INSTALL.md in the current checkout and follow it to install Pilotfish into my global OpenCode configuration.
Use only the templates in this checkout.
Show me the complete plan and get my approval before writing anything.
```

> **Runtime requirement:** OpenCode `1.17.18` or newer. This is the verified baseline for the agent schema and permission enforcement Pilotfish relies on. The installer stops before writing on an older or unidentifiable version.

The installer:

1. Inspects the three global JSON/JSONC config layers and selects the highest-precedence active file.
2. Checks which presets are available.
3. Detects agent-name and prompt-file collisions.
4. Shows the exact model and file plan.
5. Waits for approval.
6. Merges only the seven Pilotfish agent entries.
7. Validates the resolved configuration.

Quit and restart OpenCode after installation. Select `pilotfish` through the normal primary-agent switcher when orchestration is wanted.

For a local checkout with step-by-step verification, see the [local installation walkthrough](./docs/local-install.md).

### Raw Main Convenience Path

You can ask OpenCode to fetch the current runbook directly, but this is mutable and unpinned: `main` can change between review and installation, and remote-instruction safety checks may intercept it. If that happens, use the pinned local checkout above; do not disable or bypass the safety check.

```text
Read https://raw.githubusercontent.com/Adrian-Mandel/pilotfish-opencode/main/install/OPENCODE-INSTALL.md
and follow it to install Pilotfish into my global OpenCode configuration.
Show me the complete plan and get my approval before writing anything.
```

## Trust and Security

Pilotfish installs global prompts and agent definitions that affect future OpenCode sessions. Treat the installer like any software setup process:

- Prefer the pinned local release so the runbook and templates cannot change between review and installation.
- Review `install/OPENCODE-INSTALL.md`, `templates/opencode.base.jsonc`, the selected preset, and the prompt files before approval.
- Keep the approval gate; the installer must show every file and configuration change before writing.
- Do not bypass remote prompt-injection protection to make the raw URL path work.
- Pilotfish does not modify provider credentials, the global default model, or the default agent.

## What Gets Installed

| Target | Change |
|---|---|
| Highest-precedence global JSON/JSONC config | Adds seven entries under `agent` |
| `~/.config/opencode/pilotfish/prompts/` | Adds seven role prompts |
| `~/.config/opencode/pilotfish/install-state.json` | Records prior touched values for safe uninstall |
| `~/.config/opencode/pilotfish/backups/` | Stores timestamped recovery copies |

Nothing is written into projects. Provider credentials and unrelated OpenCode settings are not touched.

## Configuration Warning

On its first turn, Pilotfish inspects only its resolved agent definition with `opencode debug agent pilotfish`.

It gives a short, non-blocking warning when the primary model is unspecified or differs from the two tested configurations. The agent remains visible and usable with any manually selected model; that combination is simply untested.

## OpenCode Limitations

The OpenCode port cannot reproduce every Claude Code feature used by original Pilotfish:

| Original capability | OpenCode `0.0.1` behavior |
|---|---|
| Ordered automatic `fallbackModel` | No native general equivalent; model failures do not automatically switch roles |
| `isolation: "worktree"` on a Task | No stable Task option; writing workers are serialized |
| Automatic worktree result harvesting | Not available through stable agent configuration |
| Model aliases such as `best`, `opus`, or `haiku` | Presets use exact provider/model IDs |

OpenCode has experimental background-agent and worktree APIs, but Pilotfish does not depend on them. The project remains a configuration package rather than adding a runtime plugin.

These gaps are tracked in [model fallback and ceilings](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/1) and [Task worktree isolation](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/2). They will be adopted only if they can preserve Pilotfish's configuration-only architecture.

## Tuning

All role assignments live together in the global `agent` map. Advanced users may change a role's `model` and `variant`, then restart OpenCode:

```jsonc
"executor": {
  "model": "provider/model-id",
  "variant": "high"
}
```

Manual combinations outside the two presets are supported by OpenCode but untested by Pilotfish `0.0.1`.

## Updating

Obtain the release tag you want to install, clone that tagged checkout, and start OpenCode inside it. Then ask OpenCode to read the local `install/OPENCODE-INSTALL.md` and follow its update flow. The installer reads `install-state.json`, shows changes since the installed version, surfaces customized prompts or model assignments, and updates only after approval.

## Uninstall

Ask OpenCode to follow the uninstall section of `install/OPENCODE-INSTALL.md`. It restores the exact pre-install values of the seven touched agent keys and preserves unrelated changes made after installation.

## Design and Research

- [Design rationale](./docs/design.md)
- [OpenCode research](./docs/research.md)
- [Upstream sync workflow](./docs/upstream-sync.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
