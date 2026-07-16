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

Connect the provider you intend to use, confirm its models appear in `opencode models`, then ask OpenCode to run the installer:

```text
Read https://raw.githubusercontent.com/Adrian-Mandel/pilotfish-opencode/main/install/OPENCODE-INSTALL.md
and follow it to install pilotfish into my global OpenCode configuration.
Show me the complete plan and get my approval before writing anything.
```

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

### Install a Reviewed Revision

Remote installation has the same trust boundary as running any fetched setup instructions. Review the files under `templates/` and pin every fetch to one release tag or commit SHA:

```text
Read https://raw.githubusercontent.com/Adrian-Mandel/pilotfish-opencode/<TAG_OR_SHA>/install/OPENCODE-INSTALL.md
and install pilotfish using every template from that same <TAG_OR_SHA>.
Show me the complete plan and get my approval before writing anything.
```

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

Rerun the install prompt. The installer reads `install-state.json`, shows changes since the installed version, surfaces customized prompts or model assignments, and updates only after approval.

## Uninstall

Ask OpenCode to follow the uninstall section of `install/OPENCODE-INSTALL.md`. It restores the exact pre-install values of the seven touched agent keys and preserves unrelated changes made after installation.

## Design and Research

- [Design rationale](./docs/design.md)
- [OpenCode research](./docs/research.md)
- [Upstream sync workflow](./docs/upstream-sync.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
