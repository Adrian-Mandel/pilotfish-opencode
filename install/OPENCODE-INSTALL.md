# Pilotfish OpenCode Install Runbook

This document is written for an OpenCode agent installing Pilotfish on a user's machine. Follow the steps in order. Do not write anything before the approval gate, and never replace unrelated configuration.

## What This Installs

Pilotfish is an opt-in, multi-model primary agent for OpenCode. It remains configuration and prompts only; it installs no runtime plugin.

| Target | Change |
|---|---|
| Highest-precedence global JSON/JSONC config | Merge one primary agent and six worker definitions into `agent` |
| `~/.config/opencode/pilotfish/prompts/` | Install the seven model-neutral role prompts |
| `~/.config/opencode/pilotfish/install-state.json` | Record the selected preset and prior touched values for safe uninstall |

Pilotfish does not change the user's global `model`, `small_model`, `default_agent`, providers, plugins, permissions, or credentials. The user selects the `pilotfish` primary when orchestration is wanted.

The source of truth is:

- `templates/opencode.base.jsonc`
- `templates/presets/chatgpt.jsonc`
- `templates/presets/antigravity.jsonc`
- `templates/pilotfish/prompts/*.md`

When running from a local clone, read those files directly. Otherwise, fetch every file from the same Git ref as this runbook. Never mix a pinned runbook with templates from `main`.

## Supported Presets

### ChatGPT

Requires these exact OpenCode model IDs:

- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`
- `openai/gpt-5.6-luna`

### AntiGravity

Requires these exact OpenCode model IDs:

- `google/antigravity-claude-opus-4-6-thinking`
- `google/antigravity-claude-sonnet-4-6`
- `google/antigravity-gemini-3-flash`
- `google/antigravity-gemini-3.1-pro`

The installer does not configure provider authentication. If a required model is unavailable, stop before the approval gate and direct the user to connect or repair that provider first.

## Updating an Existing Install

Before the normal preflight:

1. Read `~/.config/opencode/pilotfish/install-state.json`.
2. If it is missing but Pilotfish agent entries or prompt files exist, treat the install as unmanaged and ask before adopting it. Do not invent prior values for uninstall.
3. Compare the recorded version with the repository `VERSION` and show relevant `CHANGELOG.md` entries.
4. Compare installed prompts and touched agent entries with the current templates. Show every customization before asking whether to preserve or replace it.
5. Preserve the original `previousAgents` map from the first managed install. Never replace it during an update, or uninstall would restore the previous Pilotfish release instead of the true pre-install state.
6. Confirm the recorded `configPath` is still the highest-precedence active global config. If a new higher layer now exists, stop and ask the user to consolidate or remove the conflict before updating; do not silently migrate lifecycle state between files.

## Step 1: Read-Only Preflight

### 1. Verify the OpenCode Version

Run `opencode --version` and parse its semantic version. Pilotfish requires OpenCode `1.17.18` or newer, the verified baseline for its agent schema and permission enforcement.

If the command is unavailable, the version cannot be parsed, or the version is older, stop before presenting a write plan or changing anything. Ask the user to update OpenCode; do not install a prompt-only approximation of denied tools or Task boundaries.

### 2. Locate the Global Config

Inspect all three global config layers under `~/.config/opencode/`: `config.json`, `opencode.json`, and `opencode.jsonc`. OpenCode loads them in that order, so later files override earlier ones.

Read every existing layer without printing secrets. Report which file supplies each existing Pilotfish agent key. Choose the writable target deterministically using OpenCode's own precedence:

1. Existing `opencode.jsonc`.
2. Otherwise, existing `opencode.json`.
3. Otherwise, existing `config.json`.
4. If none exists, create `opencode.jsonc` with the schema declaration.

The target file receives Pilotfish entries at the highest active global layer. Lower-layer definitions remain untouched and naturally reappear when an added target key is removed during uninstall.

### 3. Check Model Availability

Run `opencode models` and compare the output with both supported preset requirement lists.

Report each preset as available or unavailable. Offer only available presets. Do not accept a guessed alias or silently substitute another model.

### 4. Check Agent Collisions

Inspect the resolved global `agent` object, each of the three global config files, and `~/.config/opencode/agents/` or singular `agent/` directories for these exact names:

- `pilotfish`
- `scout`
- `Explore`
- `mech-executor`
- `executor`
- `verifier`
- `security-executor`

OpenCode derives Markdown agent names from their relative filenames. Uppercase `Explore` intentionally coexists with lowercase built-in `explore`; that built-in is not a user collision.

For an inline config collision, show its source and ask whether to override it in the selected target layer or abort. Record only the target file's previous value in install state; lower-layer values are not modified.

For a Markdown agent collision, stop and ask the user to relocate or remove that file before rerunning the installer. An inline entry cannot reliably replace a later-loaded Markdown agent. Skipping a required Pilotfish role produces an incomplete installation and is not supported.

Project-level agent definitions may override this global installation in individual repositories. Note that fact when relevant; never edit project configuration during a global install.

### 5. Inspect Existing Pilotfish Files

If `~/.config/opencode/pilotfish/` exists, list its files and compare them with the templates. Flag unknown or customized files. Never delete or overwrite unknown content silently.

## Step 2: Approval Gate

Ask the user to choose an available preset: `ChatGPT` or `AntiGravity`.

Show a table containing:

- The selected preset.
- Every role's exact model and variant.
- The global config path.
- Every agent key to create or replace.
- Every prompt file to create, replace, or preserve.
- Backup and install-state paths.
- Any collisions or customizations.

Explain that OpenCode must be restarted after installation. Do not write anything until the user approves this exact plan.

## Step 3: Apply

### 1. Back Up Existing State

Create `~/.config/opencode/pilotfish/backups/` if needed. Before changing the target config, copy it to a timestamped backup when it exists. Back up customized Pilotfish prompt files before replacing them. On update, also back up the existing `install-state.json` before any write.

Backups are recovery aids, not the uninstall mechanism. Uninstall uses key-level state so changes made after installation are preserved.

### 2. Build Install State

On the first managed install, record the pre-install value of every touched agent key before modifying the config. Use this structure:

```json
{
  "version": "<VERSION>",
  "preset": "chatgpt",
  "configPath": "<CONFIG_PATH>",
  "configExisted": true,
  "previousAgents": {
    "pilotfish": { "present": false },
    "scout": { "present": true, "value": {} }
  },
  "previousPrompts": {
    "pilotfish.md": { "present": false },
    "scout.md": {
      "present": true,
      "backupPath": "backups/preinstall-prompts/scout.md"
    }
  },
  "installedAgents": {}
}
```

Include all seven agent keys and all seven prompt filenames. For a present agent key, `value` must contain its complete pre-install target-file object. For a present prompt, copy its exact pre-install bytes to a durable path under `backups/preinstall-prompts/` and record that relative `backupPath`. `installedAgents` must contain the complete merged Pilotfish definitions actually written, including the selected model and variant.

Replace `<VERSION>` with the exact contents of the repository `VERSION` file.
Replace `<CONFIG_PATH>` with the exact target file selected during preflight.

Do not store provider credentials, unrelated config, or resolved environment values in this file.

On update, preserve `configPath`, `configExisted`, `previousAgents`, and `previousPrompts`; prepare updated `version`, `preset`, and `installedAgents` values in memory after approval. Do not overwrite the existing state yet.

### 3. Install Prompts

Create `~/.config/opencode/pilotfish/prompts/` and write the seven files from `templates/pilotfish/prompts/` with identical filenames and content.

If an installed file differs, show the diff and follow the user's approved preserve-or-replace decision. A preserved custom prompt remains the installed prompt and must be called out in the final summary.

### 4. Merge Agent Configuration

Start with the seven definitions from `templates/opencode.base.jsonc`. Recursively merge the selected preset's matching `agent` entries so each role gains its model and optional variant.

Merge those seven complete definitions into the existing global `agent` object. Preserve every unrelated top-level key and every unrelated agent. Do not rewrite the entire file merely to normalize formatting.

Ensure the config has:

```json
"$schema": "https://opencode.ai/config.json"
```

Prompt references stay relative to the global config:

```text
{file:./pilotfish/prompts/<role>.md}
```

If the config did not exist, create the minimal config containing `$schema` and the seven merged agent entries.

## Step 4: Verify and Hand Off

Run all of these checks with `OPENCODE_DISABLE_PROJECT_CONFIG=1` from a neutral directory so project config cannot override the global installation:

1. `opencode debug config` succeeds.
2. `opencode debug agent pilotfish` reports `mode: primary`, the selected primary model and variant, and Task access to the six Pilotfish roles.
3. Inspect all six workers with `opencode debug agent <name>`.
4. Confirm `scout` and `Explore` cannot use edit, bash, or Task tools.
5. Confirm the three executors cannot use Task.
6. Confirm `verifier` cannot use edit or Task but can use bash and read tools.
7. Confirm the global `model` and `default_agent` values are unchanged.
8. Confirm the prepared install state contains no credentials or unrelated config.

If validation fails, restore the target config backup, prompts, and previous install state; remove newly created files, report the exact failure, and stop. Never leave OpenCode with an invalid global config or mismatched lifecycle state.

After every check succeeds, write `install-state.json` as the final installation step. Its `installedAgents` values must match the validated target config. If writing state fails, roll back the config and prompts. On update, restore the previous state backup; on first install, remove any partial state file. Never leave an unmanaged or mismatched installation.

Tell the user to quit and restart OpenCode. After restart, `pilotfish` should be available as a primary agent through the normal agent switcher. It is opt-in and does not replace Build or Plan.

Summarize the selected preset, created and replaced files, preserved customizations, validation results, and backup location.

## Uninstall

Uninstall requires `install-state.json`. If it is missing, present a manual removal plan and get approval; do not infer overwritten values.

1. Read `previousAgents`, `previousPrompts`, and `installedAgents` from state.
2. Reinspect all three global config layers and both global Markdown agent directories. If a higher-precedence file or Markdown agent added after installation now defines a Pilotfish name, stop and show the dependency; require the user to remove, relocate, or explicitly handle it before prompts can be safely removed.
3. Back up the target config, installed prompts, and install state before changing anything.
4. For each of the seven current target-file agent entries, compare it with `installedAgents`.
5. If any entry differs, show the customization and ask the user either to restore the pre-install value or abort uninstall. Do not preserve a Pilotfish agent while deleting the prompt it references.
6. When `previousAgents[name].present` is true, restore its complete recorded target-file value.
7. When it is false, remove that key from the target file. Any lower-layer value then reappears naturally.
8. Preserve every unrelated config key and agent.
9. Restore prompts recorded as present in `previousPrompts` from their durable pre-install backups. Remove prompts recorded as absent only after all seven Pilotfish entries have been restored or removed. If a current prompt was customized after installation, show the diff and require approval before replacing or deleting it.
10. Run `OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug config` from a neutral directory. If validation fails, restore the config, prompts, and install state from the uninstall backups and stop.
11. After successful validation, remove `install-state.json` and empty Pilotfish directories. Keep backups unless the user explicitly asks to delete them.
12. If Pilotfish created the target config and removing its entries leaves only the schema declaration, offer to delete the file; do not delete it automatically.
13. Tell the user to restart OpenCode.

## Known OpenCode Limitations

- OpenCode has no native general equivalent to Claude Code's ordered `fallbackModel` chain.
- Stable Task configuration has no `isolation: "worktree"` option or automatic result harvesting.
- Pilotfish therefore serializes writing workers and does not promise automatic model failover.
- Background subagents and worktree APIs exist experimentally in OpenCode but are not Phase 1 dependencies.

These limitations are documented behavior, not installer errors. Pilotfish remains configuration and instructions rather than adding a runtime orchestration plugin.
