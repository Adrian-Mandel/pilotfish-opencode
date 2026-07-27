# Local Installation Walkthrough

This walkthrough installs Pilotfish from a pinned local checkout. OpenCode reads the runbook and templates directly from the repository; no remote files are fetched during installation.

Pilotfish `0.1.0` requires OpenCode `1.17.18` or newer.

## 1. Clone the Pinned Release

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/Adrian-Mandel/pilotfish-opencode.git
cd pilotfish-opencode
```

Review the local runbook and templates before launching OpenCode.

## 2. Check OpenCode and Providers

Confirm the installed OpenCode version:

```bash
opencode --version
```

Connect the provider you want to use through OpenCode's `/connect` command, then confirm the preset models are available:

```bash
opencode models openai
opencode models google
```

The ChatGPT preset requires:

```text
openai/gpt-5.6-sol
openai/gpt-5.6-terra
openai/gpt-5.6-luna
```

The AntiGravity preset requires:

```text
google/antigravity-claude-opus-4-6-thinking
google/antigravity-claude-sonnet-4-6
google/antigravity-gemini-3-flash
google/antigravity-gemini-3.1-pro
```

The installer will not modify provider authentication.

The installer stops before writing if the version is older than `1.17.18` or cannot be identified.

## 3. Start OpenCode in the Checkout

Open a terminal in the Pilotfish repository and start OpenCode:

```bash
opencode
```

Use a normal primary agent such as Build for the installation. Do not select Pilotfish yet because it has not been installed.

## 4. Run the Local Installer

Paste this prompt into OpenCode:

```text
Read install/OPENCODE-INSTALL.md and follow it to install Pilotfish from this local checkout into my global OpenCode configuration.
Use only the templates in this checkout. Show me the complete plan and get my approval before writing anything.
```

The installer performs a read-only preflight first. It should report:

- The highest-precedence global config file it will edit.
- Whether the ChatGPT and AntiGravity presets are available.
- Existing agent-name or prompt-file collisions.
- Every role's model and variant.
- The backup and install-state paths.

Select one available preset and review the plan. Nothing should be written until you explicitly approve it.

## 5. Review the Result

After approval, the installer should report successful checks for:

- Resolved OpenCode configuration.
- The `pilotfish` primary model and variant.
- All eight worker definitions.
- Read-only Scout, Explore, Plan Verifier, and Security Reviewer permissions.
- Leaf-agent restrictions.
- Verifier edit denial.
- Unchanged global `model` and `default_agent` values.

The installed files live under:

```text
~/.config/opencode/pilotfish/
```

The installer also merges nine entries into the highest-precedence global JSON/JSONC config under `~/.config/opencode/`.

## 6. Restart and Select Pilotfish

Quit OpenCode completely and start it again. Configuration and agent files are loaded at startup.

Use the normal primary-agent switcher, usually `Tab`, until `pilotfish` is selected. Build and Plan remain available because Pilotfish is opt-in.

Try a read-only smoke test:

```text
Use scout to find the project version and report the file and value.
```

On the first turn, Pilotfish should inspect its resolved definition. A tested preset proceeds normally; an unspecified or changed primary model produces a short non-blocking warning.

## 7. Optional Manual Verification

From a neutral directory, inspect the global definitions without project overrides:

```bash
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug agent pilotfish
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug agent scout
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug agent plan-verifier
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug agent security-reviewer
OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug agent verifier
```

Expected results:

- `pilotfish` has `mode: primary` and the selected preset model.
- `scout` has no bash, edit, or Task access.
- `plan-verifier` has repository read tools only.
- `security-reviewer` adds web fetch to repository reads but has no bash, edit, or Task access.
- `verifier` has bash and read access but no edit or Task access.

## Updating

Clone the desired tagged release and start OpenCode in that checkout. The runbook, `VERSION`, `CHANGELOG.md`, and templates must all come from this same pinned ref. Updating is simply rerunning install:

```text
Read install/OPENCODE-INSTALL.md and update my existing Pilotfish installation from this local checkout.
Use only this checkout. Keep my recorded preset unless I ask to switch it.
Show the changelog and exact plan, then get my approval before writing anything.
```

If `install-state.json` already records this checkout's version, the installer reports that it is current and stops without asking for a preset or writing anything. Otherwise it follows the normal install Steps 1–4: identical agents and prompts skip; changed custom content is shown as a diff and requires a keep-or-replace decision. The original pre-install agent and prompt state remains preserved for uninstall.

## Uninstalling

Start OpenCode in the checkout containing the version you installed or a compatible newer version, then use:

```text
Read install/OPENCODE-INSTALL.md and follow its uninstall section for my Pilotfish installation.
Inspect state and current config layers, show one exact restoration plan with any diffs,
and get my approval before writing anything.
```

Uninstall first classifies current entries and prompts, then backs them up after approval. It restores or removes only the nine touched agent keys, handles prompts only after agent references are gone, validates the resolved config, and then removes state and empty directories. It keeps backups and never auto-deletes the global config. If state is missing, it can offer only conservative manual removal: overwritten pre-install values cannot be reconstructed.

Restart OpenCode after update or uninstall.
