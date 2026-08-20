# Pilotfish OpenCode Install Runbook

This document is written for an OpenCode agent installing Pilotfish on a user's machine. Follow the steps in order. Do not write anything before the approval gate, never print secrets, and never replace unrelated configuration.

## What This Installs

Pilotfish is an opt-in, multi-model primary agent for OpenCode. It installs one persisted public primary, eight persisted public workers, their prompts, and a required runtime profile router. OpenCode creates sessions, calls providers, and enforces tool permissions; the router only pins approved session profiles and redirects Tasks to runtime-only internal workers.

| Target | Change |
|---|---|
| Highest-precedence global JSON/JSONC config | Merge one primary agent and eight worker definitions into `agent`, and manage one exact plugin tuple |
| `~/.config/opencode/pilotfish/prompts/` | Install the nine model-neutral role prompts |
| `~/.config/opencode/pilotfish/profile-router.mjs` | Copy the router runtime source byte-identically |
| `~/.config/opencode/pilotfish/profiles.json` | Copy the canonical profile data byte-identically |
| `~/.config/opencode/pilotfish/install-state.json` | Record selected preset, prior touched values, and installed prompt and runtime hashes for safe uninstall |

Pilotfish never changes global `model`, `small_model`, `default_agent`, providers, unrelated plugins, permissions, or credentials.

The user selects the `pilotfish` primary when orchestration is wanted. `installedAgents` contains only the nine persisted public definitions: ChatGPT's 24 hidden clones are runtime-only.

The source of truth is:

- `templates/opencode.base.jsonc`
- `templates/presets/chatgpt.jsonc`
- `templates/presets/antigravity.jsonc`
- `templates/presets/openrouter.jsonc`
- `templates/pilotfish/prompts/*.md`
- `templates/pilotfish/profile-router.mjs`
- `templates/pilotfish/profiles.json`

When running from a local clone, read those files directly. Otherwise, fetch every file from the same Git ref as this runbook. Never mix a pinned runbook with templates from `main`.

The required config-relative plugin tuple is exactly one of:

```json
["./pilotfish/profile-router.mjs", {"preset":"chatgpt"}]
["./pilotfish/profile-router.mjs", {"preset":"antigravity"}]
["./pilotfish/profile-router.mjs", {"preset":"openrouter"}]
```

The router is required. Usage telemetry tracked by [issue #11](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/11) is optional and independent.

OpenCode skips a plugin factory that throws. Catchable factory initialization errors, including an invalid or missing preset option, are therefore deferred through protective hooks that block Pilotfish and internal-agent use while leaving unrelated sessions unchanged. Module syntax or load failures occur before those hooks can be returned and are installation failures.

## Supported Presets

### ChatGPT

Requires these exact OpenCode model IDs and the variants in `profiles.json`:

- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`
- `openai/gpt-5.6-luna`

The first Pilotfish message pins the selected Sol, Terra, or Luna primary profile for that session. Sol/high, Terra/high, and Luna/max are tested primary recommendations rather than router gates: the selected model chooses the worker profile, while UI-selected effort remains under user control. The public primary model and variant are never changed. All public workers and hidden clones are subagents. The router creates 24 hidden internal clones (eight worker roles for each profile), and redirects each public worker Task to the selected profile's clone. The profile pin persists across agent switches, but Task remapping is active only while Pilotfish is the current successfully resolved agent. New Tasks receive a transient SHA-256 call marker and start unbound; only an exact later `session.created` event binds the new child ID, title, parent, agent, and profile. Resumed Tasks validate and bind the exact `task_id`, parent, and internal agent without marker mutation. Every authorization independently expires after 30 seconds; consume, after-hook cleanup, parent deletion, and disposal clear timers. `session.update` restores the clean title before provider execution, and `tool.execute.after` restores mutable description/result values and clears authorization. OpenCode `1.18.10` may retain the digest in already-captured raw tool-input events; it contains no prompt or credential data. Direct, root, sibling, mismatched, expired, and replayed internal chat is rejected. The supported foreground order is before hook → `session.created` → child chat → after hook; event races and experimental background timing fail closed. A primary-model/profile switch in the same session is rejected; changing effort on the same model does not change the profile. Unsupported or cross-preset models fail before assistant/provider execution.

Expiry, parent deletion, and plugin disposal revoke first, then await best-effort restoration when the exact bound child title is still marked, and always remove authorization in `finally`. If OpenCode's child lookup or title update fails, the marker may require manual child-title cleanup, but it cannot authorize execution. Resumed Tasks never require marker restoration.

### AntiGravity

Requires these exact OpenCode model IDs:

- `google/antigravity-claude-opus-4-6-thinking`
- `google/antigravity-claude-sonnet-4-6`
- `google/antigravity-gemini-3-flash`
- `google/antigravity-gemini-3.1-pro`

### OpenRouter

Requires these exact OpenCode model IDs, and for the DeepSeek pair the variants in `profiles.json`:

- `openrouter/qwen/qwen3.6-27b` — exposes no variant
- `openrouter/qwen/qwen3.6-35b-a3b` — exposes no variant
- `openrouter/deepseek/deepseek-v4-pro` — `high`, `xhigh`
- `openrouter/deepseek/deepseek-v4-flash-0731` — `low`, `high`, `max`

Two profiles, `qwen` and `deepseek`, each built from two models rather than three tiers. Nothing requires a profile to span more than two: the strong model takes the primary plus `plan-verifier`, `security-reviewer`, `verifier`, and `security-executor`; the cheap model takes `scout`, `Explore`, `mech-executor`, and `executor`. The router creates 16 hidden clones for this preset.

Variant support differs between the two profiles, and `opencode models --verbose` is the authority. The Qwen pair exposes no variants, so the `qwen` profile sets none; omission is supported, as the AntiGravity `opus` profile already shows. The DeepSeek pair does expose them — `deepseek-v4-pro` accepts `high` and `xhigh`, `deepseek-v4-flash-0731` accepts `low`, `high`, and `max` — so the `deepseek` profile ladders effort the way the ChatGPT profiles do: `low` for reconnaissance and mechanical work, `high` for implementation and verification, `xhigh` for both security roles. Variants are a per-model capability, not a provider-family one; never assume a model lacks them without checking.

Switching between the two profiles is one edit to `agent.pilotfish.model` — the profile is a pure function of the resolved primary model, so no reinstall or plugin change is involved. Like every preset, this one binds only the public primary; the eight public workers install unbound, and while Pilotfish is the resolved primary each Task is rewritten to the selected profile's clone.

These are the first supported models whose IDs carry two slashes. The router rebuilds the selection key as `providerID` + `/` + `modelID` without assuming a segment count, so `openrouter` plus `qwen/qwen3.6-27b` round-trips correctly. `tests/profile-router.test.mjs` covers it.

Every preset routes the same way: it creates hidden clones only for its own profiles, and Task arguments name public roles until the router rewrites them.

The installer does not configure provider authentication. If a required model or variant is unavailable, stop before the approval gate and direct the user to connect or repair that provider first.

## Updating an Existing Install

An update is an idempotent re-run of this install runbook. Before Step 1:

1. Read `~/.config/opencode/pilotfish/install-state.json` and detect the recorded installed version. If state is missing but Pilotfish entries, runtime files, plugin entries, or prompt files exist, treat the install as unmanaged and ask before adopting it; do not invent prior values for uninstall.
2. Read this checkout's `VERSION` and `CHANGELOG.md` from the same pinned ref as this runbook. Never compare state from one ref with templates or changelog data from another ref.
3. Run preflight regardless of the recorded version. Version equality is not a stop condition. It suppresses only the changelog replay; it never suppresses a write. It does not decide the preset question either, which rule 5 owns and answers from user intent and preset availability alone. A version number cannot detect a change that landed inside an unreleased version: `VERSION` read `0.2.0` unchanged from 2026-08-09 through 69 later commits, 21 of which touched `templates/` or `install/`, so a real install recording `0.2.0` matched a checkout whose content had moved a long way from it. The failure is silent in the reassuring direction — the runbook reports success while leaving a merged fix undelivered. On 2026-08-20 a live install still carried the pre-#38 `profile-router.mjs`, whose mirrored Task-permission matcher was case-insensitive only on Windows, so on a posix host the G9 guard accepted a rule such as `"PILOTFISH-PROFILE-*"` that the host itself read as admitting every internal clone. That file's SHA-256 still matched the recorded `installedRuntimeFiles` value, proving it had never been hand-edited — only never updated. A merged security fix sat undelivered behind a runbook reporting "up to date". Do not answer this by bumping `VERSION` for every change: that turns the version into a build counter and still fails anyone tracking `main` between bumps. Content comparison is the primitive.
4. Decide the stop condition from content, not from the version. Compare every managed agent entry, every managed prompt, every runtime file, and the plugin tuple against desired. Report that Pilotfish is up to date and stop only when every one of them is byte-identical to desired; in that case, and only in that case, do not ask for a preset, present a write plan, or write any file. Otherwise present a write plan covering only the items that differ and proceed through normal Steps 1–4, showing the relevant changelog entries when the recorded version differs from `VERSION`. A version update is not a separate mutation path: unchanged content is skipped and the normal approval, backup, validation, rollback, and state-last rules still apply. One consequence of stopping is deliberate: when content is identical but the recorded version differs from `VERSION`, nothing is written, so the recorded `version` stays behind and the next update replays the same changelog span again, cumulatively. That is the accepted cost of a stop that means what it says — a path promising to write no file must not write `install-state.json` either, and a duplicated changelog replay is cheaper than a write on a no-write path.
5. Keep the recorded preset by default when it remains available. Ask for a preset only when the user requests a switch or the recorded preset is unavailable.
6. Preserve every existing entry in `previousAgents` and `previousPrompts` from the first managed install. Never replace an existing entry during an update, or uninstall would restore the previous Pilotfish release instead of the true pre-install state. When a newer release introduces a required agent key or prompt filename that is absent from those maps, treat only that name as newly touched: after approval and before any write, append its exact current pre-update state using the same rules as a first install. Do not infer that state from `installedAgents` or from an older template.
7. Confirm the recorded `configPath` is still the highest-precedence active global config. If a new higher layer now exists, stop and ask the user to consolidate or remove the conflict before updating; do not silently migrate lifecycle state between files.

For the `0.1.0` first-touch migration, retain existing `previousAgents` and `previousPrompts`, then add missing `previousPlugin` and `previousRuntimeFiles` entries from their exact current tuple/bytes before any write. The first-touch migration is required. Capture durable pre-install runtime backups; never infer state from installed values.

The `installedPrompts` first-touch migration follows that same pattern and the same constraints. On the first update after this field exists, read the SHA-256 of each managed prompt's exact current installed bytes before any write, and classify the prompt from that. The value finally recorded is the SHA-256 of the bytes actually left on disk once the approved decision is applied, which is a different value whenever the user chose to replace a customization; recording the pre-write hash there would leave the entry describing content that is no longer installed. The first-touch migration is required. Never infer it from the templates: an install whose prompts are stale would then record the desired hash, its staleness would become invisible, and that is the same silent success the version gate produced. `installedPrompts` is not `previousPrompts` and never substitutes for it. `previousPrompts` holds pre-install state captured at the first managed install and is never replaced; `installedPrompts` records what the installer last wrote and is rewritten on every successful install.

The migrating update is the one run that cannot read its own marker, so it must not lose fidelity to gain the field. State carries no record of an earlier preserve decision, so during that run classify any prompt whose current bytes differ from the desired template as a customization — the third row of the prompt table — and show its diff and ask, exactly as the old two-row table did. The user's answer is what sets `preserved` for that entry. Never write `"preserved": true` from a guess.

During preflight, compare each current target-file agent entry with both `installedAgents[name]` and the desired definition, and compare each managed prompt with both `installedPrompts[filename]` and its desired template, reading that entry's `preserved` flag as part of the comparison. Compare prompts and runtime files using SHA-256 values from current, installed, and desired bytes.

| Agent state | Action |
|---|---|
| Current and desired are identical | Skip; report it as up to date. |
| Current matches the prior managed `installedAgents[name]`, but desired changed | Update only after approval of the plan. |
| Current differs from both the prior managed value and the desired value | Treat it as a customization: show the diff and ask whether to keep it or replace it. |

| Prompt state | Action |
|---|---|
| Current and desired are identical | Skip; report it as up to date, and clear any `preserved` marker on that entry. |
| Current matches the recorded `installedPrompts[filename]` hash and that entry is not marked preserved | Update only after approval of the plan. |
| Current differs from the recorded hash, or that entry is marked preserved | Treat it as a customization: show the diff and ask whether to keep it or replace it. |

Evaluate the rows in order, and keep them exhaustive. Between them they must classify every combination of the three facts an update actually has — whether current equals desired, whether current equals the recorded `installedPrompts` hash, and whether that entry is marked preserved — and that exhaustiveness is the point of the table rather than a property it happens to have. This table is followed by hand, so a state no row classifies is not a silent fallback to some default; it is an unhandled case in the middle of someone's install, with nothing to tell them what to do next. Any future edit must leave every combination landing on exactly one row. The agent table above has the same three-row shape but does not carry a preserved marker, so do not read the two as equivalent.

The middle row is the one the old two-row table could not express. A prompt that is merely stale — untouched since the installer last wrote it — and a prompt the user edited by hand were both "differs", so every routine update asked a keep-or-replace question about content the user had never touched, and answering it correctly required diffing the installed prompt against an older Git ref, which nothing here prescribes and no installer can do unaided. `installedPrompts` removes the ambiguity.

Preserved custom agents remain the installed values: set their `installedAgents` entries to the complete values actually left in the target config. Prompts need one thing more. A preserved custom prompt is the installed prompt, so record its exact current SHA-256 in `installedPrompts` — but record it with `"preserved": true`, because the installer did not write those bytes. `installedPrompts` means what the installer last wrote, and for a preserved prompt it wrote nothing; an entry that does not say so is indistinguishable from one the installer produced, and the next update would then see content matching the recorded hash with no way to know a human chose it over the template. Set `"preserved": false` on every entry the installer did write. Call every preservation out in the final summary. Record what is actually on disk; never fabricate state data.

## Step 1: Read-Only Preflight

### 1. Verify the OpenCode Version

Run `opencode --version` and parse its semantic version. Pilotfish requires OpenCode `1.18.10` or newer, the verified baseline for router hooks, agent schema, and permission enforcement.

If the command is unavailable, the version cannot be parsed, or the version is older, stop before presenting a write plan or changing anything. Ask the user to update OpenCode; do not install a prompt-only approximation of denied tools, Task boundaries, or runtime profile routing.

### 2. Locate the Global Config

Inspect all three global config layers under `~/.config/opencode/`: `config.json`, `opencode.json`, and `opencode.jsonc`. OpenCode loads them in that order, so later files override earlier ones.

Read every existing layer without printing secrets. Report which file supplies each existing Pilotfish agent key. Choose the writable target deterministically using OpenCode's own precedence:

1. Existing `opencode.jsonc`.
2. Otherwise, existing `opencode.json`.
3. Otherwise, existing `config.json`.
4. If none exists, create `opencode.jsonc` with the schema declaration.

The target file receives Pilotfish entries at the highest active global layer. Lower-layer definitions remain untouched and naturally reappear when an added target key is removed during uninstall.

### 3. Check Model Availability

Run `opencode models --verbose` and compare the output with both supported preset requirement lists, including every exact required model **and variant**.

Report each preset as available or unavailable. Offer only available presets. Do not accept a guessed alias or silently substitute another model.

### 4. Check Agent and Plugin Collisions

Inspect the resolved global `agent` object, each of the three global config files, and `~/.config/opencode/agents/` or singular `agent/` directories for these exact names:

- `pilotfish`
- `scout`
- `Explore`
- `plan-verifier`
- `security-reviewer`
- `mech-executor`
- `executor`
- `verifier`
- `security-executor`

OpenCode derives Markdown agent names from their relative filenames. Uppercase `Explore` intentionally coexists with lowercase built-in `explore`; that built-in is not a user collision.

For an inline config collision, show its source and ask whether to override it in the selected target layer or abort. Record only the target file's previous value in install state; lower-layer values are not modified.

For a Markdown agent collision, stop and ask the user to relocate or remove that file before rerunning the installer. An inline entry cannot reliably replace a later-loaded Markdown agent. Skipping a required Pilotfish role produces an incomplete installation and is not supported.

Inspect the config `plugin` array and every entry whose first element is `./pilotfish/profile-router.mjs`. Preserve unrelated entries and their order. Same-specifier entries are collisions: record their exact tuple in `previousPlugin`, then replace only after approval. Project-level agent definitions may override this global installation in individual repositories. Note that fact when relevant; never edit project configuration during a global install.

### 5. Inspect Existing Pilotfish Files

If `~/.config/opencode/pilotfish/` exists, list its files and compare them with the templates. Flag unknown or customized files. Hash `profile-router.mjs` and `profiles.json` with SHA-256. Never delete or overwrite unknown content silently.

### 6. Inspect MCP Servers and Worker Tool Scope

The eight Pilotfish **workers** ship a closed tool scope: `"*": "deny"` followed by an allowlist of the OpenCode built-ins the role needs. A closed scope removes a tool from the request schema entirely rather than blocking it at call time, so it is the difference between paying for a tool schema on every turn and not paying for it.

The `pilotfish` primary is deliberately left open. It is the agent the user drives interactively, and closing it would silently remove MCP servers from the session the user is actually sitting in. Offer to narrow it only if the user asks.

This matters most for MCP. A single MCP server is commonly 10,000-14,000 tokens of tool schema, re-sent on every request of every agent that can see it. Measured against a real 44-tool GitHub MCP server, a closed worker scope removed 13,748 tokens per request.

The closed scope also means **Pilotfish workers cannot see any MCP server unless this step grants it.** That is the correct default — it keeps a user's unrelated MCP servers out of Pilotfish's token budget — but it is a functional change for anyone whose workers currently use one.

Read the resolved `mcp` object. For each enabled server, record its name and count its tools:

```bash
curl -s -X POST <url> -H "Authorization: <header>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Estimate cost as `len(json.dumps(tools)) / 4` tokens. For a local (`"type": "local"`) server, run its command and speak the same two JSON-RPC lines over stdin.

On a fresh install there is no usage history, and there is no way to know what a user will need. Do not guess and do not prompt for a decision they cannot yet make. Default every worker to **not granted**, state that plainly, and tell them the two things that make it safe: the `pilotfish` primary keeps its MCP servers, so nothing becomes unreachable — only delegated work loses them; and a grant is one line added to a worker's `permission` block, applied on the next restart.

Then tell them to revisit it once they have real usage, using the query below against their own history. That turns a guess at install time into an evidence-based decision a week later.

If the install is an update and prior sessions exist, report which roles actually used each server, so the grant decision is evidence-based rather than a guess:

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT s.agent, substr(json_extract(p.data,'\$.tool'),1,40) AS tool, COUNT(*) n
FROM part p JOIN session s ON s.id = p.session_id
WHERE json_extract(p.data,'\$.type')='tool'
  AND json_extract(p.data,'\$.tool') LIKE '<server>_%'
GROUP BY s.agent, tool ORDER BY n DESC;"
```

Do not assume the answer. Real installs have shown heavy MCP use by roles that look read-only on paper — `verifier` in particular, which uses a code host to check claims against merged history.

Carry into the approval gate, for each enabled MCP server: its name, tool count, estimated tokens per request, and the observed per-role usage. Never enable a server for a role the user did not approve.

## Step 2: Approval Gate

For a fresh install, ask the user to choose an available preset: `ChatGPT` or `AntiGravity`. For an update, use the available recorded preset unless the user asked to switch; ask only when the recorded preset is unavailable.

Show a table containing:

- The selected preset and exact approved profile table from `profiles.json`.
- Every role's exact model and variant.
- The exact required plugin tuple.
- The global config path.
- Every agent key to create or replace.
- Every prompt and runtime file to create, replace, or preserve, with hashes.
- Backup and install-state paths.
- Any collisions or customizations.
- Every enabled MCP server, its tool count, its estimated tokens per request, and the roles observed using it. State plainly that workers lose access to every server not granted here.

Ask which MCP servers, if any, each Pilotfish worker should keep. Offer three shapes per server and name the cost of each:

1. **Not granted** (default) — cheapest; the worker cannot call the server.
2. **Whole server** — `"<server>_*": "allow"`; costs the server's full tool-schema budget on every request of that role.
3. **Named tools** — `"<server>_<tool>": "allow"` per tool; costs only those schemas. MCP tools are always named `<server>_<tool>`, and the name must match exactly. Usage is typically a steep power law, so a handful of tools usually covers nearly all real calls: on one measured install, 8 of 44 GitHub tools were 91% of ~899 calls, and narrowing to those 8 saved 9,598 tokens per request while keeping the workflow intact.

Explain that OpenCode must be restarted after installation. Do not write anything until the user approves this exact plan.

## Step 3: Apply

### 1. Back Up Existing State

Create `~/.config/opencode/pilotfish/backups/` if needed. Before changing the target config, copy it to a timestamped backup when it exists. Back up customized Pilotfish prompt files and runtime files before replacing them. On update, also back up the existing `install-state.json` before any write.

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
    "scout.md": { "present": true, "backupPath": "backups/preinstall-prompts/scout.md" }
  },
  "installedPrompts": {
    "pilotfish.md": { "sha256": "<SHA-256>", "preserved": false },
    "scout.md": { "sha256": "<SHA-256>", "preserved": true }
  },
  "previousPlugin": { "present": false },
  "installedPlugin": ["./pilotfish/profile-router.mjs", {"preset":"chatgpt"}],
  "previousRuntimeFiles": {
    "profile-router.mjs": { "present": false },
    "profiles.json": { "present": false }
  },
  "installedRuntimeFiles": {
    "profile-router.mjs": "<SHA-256>",
    "profiles.json": "<SHA-256>"
  },
  "installedAgents": {}
}
```

Include all nine agent keys and all nine prompt filenames. For a present agent key, `value` must contain its complete pre-install target-file object. For a present prompt or runtime file, copy its exact pre-install bytes to a durable path under `backups/preinstall-prompts/` or `backups/preinstall-runtime/` and record that relative `backupPath`. `installedAgents` must contain the complete merged Pilotfish public definitions actually written, including the selected model and variant. `installedPrompts` must contain all nine prompt filenames, each mapped to an object carrying the `sha256` of the bytes actually left on disk and a `preserved` flag saying whether the user chose those bytes over the template. The hash is what lets a later update tell a stale prompt from a customized one; the flag is what keeps a preservation the user already decided from being re-asked as staleness or, worse, overwritten as if the installer had written it.

Replace `<VERSION>` with the exact contents of the repository `VERSION` file. Replace `<CONFIG_PATH>` with the exact target file selected during preflight. Do not store provider credentials, unrelated config, or resolved environment values in this file.

On update, preserve `configPath`, `configExisted`, and every existing entry in `previousAgents`, `previousPrompts`, `previousPlugin`, and `previousRuntimeFiles`. After approval and before changing config or prompts, extend the maps (and plugin/runtime ownership maps) with exact current values and durable backups. If any required current value or backup cannot be captured, stop without writing anything. Prepare the extended maps plus updated `version`, `preset`, `installedPlugin`, `installedPrompts`, `installedRuntimeFiles`, and `installedAgents` in memory. Do not overwrite `install-state.json` until post-install validation succeeds.

### 3. Install Prompts and Runtime Files

Create `~/.config/opencode/pilotfish/prompts/` and write the nine files from `templates/pilotfish/prompts/` with identical filenames and content only when the approved plan requires it. Copy `profile-router.mjs` and `profiles.json` byte-identically from the same checkout and record their SHA-256 hashes.

Skip an identical installed file. If an installed file differs, show the diff or hash comparison and follow the user's approved preserve-or-replace decision. A preserved custom prompt remains the installed prompt and must be called out in the final summary.

### 4. Merge Agent Configuration and Plugin

Start with the nine definitions from `templates/opencode.base.jsonc`. Recursively merge the selected preset's matching `agent` entries. A preset binds only the public primary `pilotfish`; the eight public workers are installed unbound and must never gain a `model` or `variant`.

Leaving the public workers unbound is deliberate. A subagent without a model inherits the invoking primary, so a worker always runs on the provider the session itself selected. Task remapping is active only while Pilotfish is the current successfully resolved agent, so under any other primary agent a baked-in worker model would be the only routing left — sending that worker to the preset's provider and its quota rather than the session's own. Worker tiering belongs to `profiles.json`, which the router applies to the hidden profile clones.

Append the approved MCP grants from Step 2 to the `permission` object of each role that received one. Order is significant: OpenCode resolves a tool against the **last** matching rule, so every grant must sit after the `"*": "deny"` it overrides. Append, never reorder, and never insert a grant above the deny.

Merge only the approved changed definitions into the existing global `agent` object. Skip identical entries, preserve approved custom entries as installed values, and preserve every unrelated top-level key and every unrelated agent. Do not rewrite the entire file merely to normalize formatting.

Do not write a `provider`, `mcp`, or top-level `permission` block. Those belong to the user. Tool scope is applied only inside the nine Pilotfish agent entries, so a Pilotfish install never changes what any other OpenCode agent — `build`, `plan`, `general`, or the user's own — can see or do.

Ensure the config has:

```json
"$schema": "https://opencode.ai/config.json"
```

Prompt references stay relative to the global config:

```text
{file:./pilotfish/prompts/<role>.md}
```

Replace or append only the approved same-specifier plugin tuple; append it when absent. Preserve all unrelated plugin entries and their order. If the config did not exist, create the minimal config containing `$schema`, the nine merged agent entries, and the required plugin tuple.

## Step 4: Verify and Hand Off

Run all of these checks with `OPENCODE_DISABLE_PROJECT_CONFIG=1` from a neutral directory so project config cannot override the global installation:

1. `opencode debug config` succeeds and proves the required plugin loads.
2. `opencode debug agent pilotfish` reports `mode: primary`, the selected primary model and variant, and Task access to the eight Pilotfish worker roles.

   This is the only place the resolved primary configuration is asserted. The prompt deliberately does not re-check it at runtime, so a warning skipped here is never raised again. The tested primary configurations are:

   - `openai/gpt-5.6-sol` with variant `high`
   - `openai/gpt-5.6-terra` with variant `high`
   - `openai/gpt-5.6-luna` with variant `max`
   - `google/antigravity-claude-opus-4-6-thinking` with variant `max`

   If the resolved definition has no explicit model, or resolves to any other model or variant, do not label it tested: report it to the user as an untested configuration and continue. This is a warning, not an installation failure.

   Also confirm each of the nine roles resolves its `steps` backstop and that every subagent resolves `doom_loop` to `deny`; `tests/integration/agent-budgets.test.mjs` covers both against the real host.
3. Assert that the installed content matches the checkout it came from. For each of the nine managed prompts and both runtime files, compare the SHA-256 of the file now on disk with the SHA-256 of the corresponding source file in this checkout, and with the value just prepared for `installedPrompts` and `installedRuntimeFiles`. Every one must match, except a prompt the user explicitly chose to preserve, whose recorded hash must equal its on-disk bytes. This is the check that catches drift at the moment it is cheapest to fix: an install can resolve, load its plugin, and pass every behavioral check below while still running a file the update never replaced. Treat any other mismatch as a validation failure and roll back.
4. Inspect all eight workers with `opencode debug agent <name>`.
5. Confirm `scout`, `Explore`, `plan-verifier`, and `security-reviewer` cannot use edit, bash, or Task tools; only `security-reviewer` may use `webfetch`.
6. Confirm the three executors cannot use Task, and `security-executor` requires an approved stable contract in its prompt.
7. Confirm `verifier` cannot use edit or Task but can use bash and read tools; confirm its verdict vocabulary differs from `plan-verifier`.
8. Exercise router validation: ChatGPT creates exactly 24 hidden internal worker clones with `profiles.json` mappings and preserves the public primary model/variant; confirm all public workers and hidden clones are subagents, direct internal identities reaching chat or Task hooks are rejected, CLI `--agent` selection does not execute a hidden clone even if OpenCode falls back to its default primary, and Pilotfish-to-Build deactivates Task remapping without deleting the pin while a validated same-model switch back reactivates it. For a new foreground Task, prove before adds a unique marker but leaves authorization unbound, only a matching later `session.created` event binds the exact new child ID, and child chat racing that event fails closed. Prove the bound child title is restored before provider execution and after restores mutable args/result values and clears authorization. Accept that OpenCode may retain the digest in raw tool-input history, and verify it contains no prompt or credential data. Prove two concurrent same-role Tasks bind their own children, a pre-existing sibling retitled to a marker cannot steal authorization, and a failed bound Task with no after hook becomes unusable after the 30-second expiry while cleanup restores its marked title. Force that update to fail and prove authorization is still revoked without an unhandled rejection; also exercise expiry races with child chat and after. For resume, prove only the exact suitable `task_id` is accepted without description mutation. Confirm parent deletion and plugin disposal clear timers and restore any still-marked bound child title. Confirm an invalid preset returns protective hooks that block raw/resolved Pilotfish chat and internal Task targets without mutating config; AntiGravity validates its canonical public mappings, creates clones only for its own profiles, and passes Tasks through. Do not substitute an experimental background Task for this foreground sequence.
9. Confirm a primary/profile switch in one session is rejected and unsupported or cross-preset primary models fail before assistant/provider execution. Check `--print-logs` for the exact router reason because OpenCode `1.18.10` may expose only `Unexpected server error` on its standard JSON surface. Restart OpenCode, resume that same session with a different primary model, and confirm persisted-history recovery rejects it before assistant/provider execution.
10. Confirm the global `model`, `small_model`, and `default_agent` values are unchanged and the prepared install state contains no credentials or unrelated config.
11. Confirm the tool scope resolved as approved. `opencode debug agent <name>` reports built-in tools but **does not connect MCP servers**, so its `tools` map always shows zero MCP tools and cannot verify a grant either way. Verify MCP scope from real traffic instead — after the restart, run one short turn per role and read the recorded prefix:

    ```bash
    sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM message WHERE session_id='<id>' ORDER BY time_created LIMIT 2;" | python3 -c "import sys,json;[print((json.loads(l).get('tokens') or {})) for l in sys.stdin if l.strip()]"
    ```

    On the first assistant message, `input + cache.read` is the prefix. A granted role should exceed an ungranted one by roughly the server's measured tool-schema budget. If the two are equal, the grant did not apply — check that it sits after `"*": "deny"` and that the tool name matches `<server>_<tool>` exactly.

If validation fails, restore the target config and plugin entry, prompts, runtime files, and previous install state; remove newly created files, report the exact failure, and stop. Never leave OpenCode with an invalid global config or mismatched lifecycle state.

After every check succeeds, write `install-state.json` as the final installation step. Write `install-state.json` last. Its `installedAgents` values must match the validated target config, including every preserved custom agent value. If writing state fails, roll back the config and prompts, plus the plugin entry and runtime files. On update, restore the previous state backup; on first install, remove any partial state file. Never leave an unmanaged or mismatched installation.

Tell the user to quit and restart OpenCode. After restart, `pilotfish` should be available as a primary agent through the normal agent switcher. It is opt-in and does not replace Build or Plan.

### Suggest a `small_model`

Pilotfish does not manage this key, and this step writes nothing. Raise it once, as advice, and leave the decision and the edit to the user.

OpenCode uses `small_model` for background chores — session titles and context compaction. When the key is unset those run on whichever primary is selected, where compaction had a 22.1s median. There is no per-agent form, so the setting is global and applies to Build and Plan as well.

If the key is already set, say nothing. Otherwise report that it is unset, name a cheap model from the installed preset as a starting point — `openai/gpt-5.6-luna` for ChatGPT, `google/antigravity-gemini-3-flash` for AntiGravity, and the selected profile's cheap model for OpenRouter (`openrouter/qwen/qwen3.6-35b-a3b` or `openrouter/deepseek/deepseek-v4-flash-0731`) — and state the trade honestly: faster and cheaper titles and compaction, against a weaker summariser producing the context the session continues from. Do not set it, and do not record it in install state.

### Check `subagent_depth`

Pilotfish does not manage this key either, and this step writes nothing. Unlike the `small_model` advice above, this one is a safety check rather than a preference: report it whatever the answer, because silence here reads as "nothing to say" about a key that is load-bearing.

Host fact H14: a `@token` in any prompt that resolves to an agent name becomes an `agent` part, and one such part makes OpenCode skip the Task permission check for that entire turn. Task passes its own `prompt` argument through the same resolver, so a primary that writes `@executor` into a worker's prompt turns the bypass on inside that worker's session, where it skips the `task` deny that is supposed to stop a worker spawning further workers. What actually stops it is `subagent_depth`: a worker session already has a parent, so at the host default of `1` the depth check fails the call before the skipped permission would have mattered.

Read `subagent_depth` from the resolved config. If it is unset or `1`, say so in one line — the worker boundary rests on it and it holds. If it is greater than `1`, report that plainly: workers can now spawn workers, and on any turn carrying an agent mention they can do so without the `task` deny being consulted. Name the value found, say that Pilotfish neither set it nor needs it raised, and leave the decision with the user. Do not change it, do not block the install over it, and do not record it in install state.

Summarize the selected preset, created and replaced files, preserved customizations, validation results, and backup location.

## Uninstall

Reverse this installation in phases. Never replace the entire config with a backup and never auto-delete a config file.

### Phase 1: Inspect and classify (read-only)

1. Read `previousAgents`, `previousPrompts`, `installedAgents`, `installedPrompts`, `previousPlugin`, `installedPlugin`, `previousRuntimeFiles`, and `installedRuntimeFiles` from `install-state.json`; inspect the target config, all three global config layers, both global Markdown-agent directories, managed prompts, plugin entry, and runtime files.
2. For each of the nine touched agent keys, compare the current target-file entry with `installedAgents`; classify any difference as a customization. For each managed prompt, compare its current bytes with `installedPrompts[filename]`. Classify it as a customization when the bytes differ from the recorded hash **or** the entry is marked preserved. The marked-preserved case matters because those bytes match their recorded hash exactly: without it, content the user deliberately kept would pass through Phase 2 undiffed and be restored or removed at Phase 5 without ever being shown. The final action may well be the same one; what would be lost is the user's chance to decide it. Only when state carries no `installedPrompts` entry for that filename — state written before the field existed and never migrated — fall back to comparing against this checkout's template and classify the difference as a potentially customized prompt. Show the diff and ask before acting in either case.
3. Compare the exact same-specifier plugin tuple and runtime SHA-256 values against installed state. Preserve unrelated or later plugin entries and runtime changes; show differences and require an approved restore/remove decision.
4. If a higher-precedence file or Markdown agent added after installation defines a Pilotfish name, stop and show the dependency. Require the user to remove, relocate, or explicitly handle it before agent references or prompts can be removed.
5. If state is missing, offer a conservative manual-removal plan limited to explicitly selected current Pilotfish entries and prompts. Say plainly that overwritten pre-install values cannot be reconstructed without state; do not infer them.

### Phase 2: Present one restoration plan and get approval

Show one exact plan for all nine agent keys, all managed prompts, the plugin tuple, and runtime files: restore the recorded value or remove an entry/file recorded as absent. Show diffs for every customized agent, every customized or potentially customized prompt, plugin entry, or runtime file and ask for approval of the corresponding restore/remove action. A customized agent must still be restored or removed, or uninstall must abort; do not preserve a Pilotfish agent while deleting the prompt it references. Do not write anything until the user approves this plan.

### Phase 3: Back up before writes

Back up the current target config, managed prompts, runtime files, plugin state, and `install-state.json` to timestamped backup paths. Keep these backups after a successful uninstall.

### Phase 4: Restore or remove agents and plugin

Restore or remove only the nine touched agent keys in the target file. When `previousAgents[name].present` is true, restore its complete recorded target-file value; when false, remove that key so a lower-layer value can reappear naturally. Restore or remove the exact owned plugin tuple while preserving unrelated config keys, agents, plugin entries, and plugin order. Remove the config reference **before** deleting runtime files.

### Phase 5: Restore or remove prompts and runtime files

Only after agent references are gone, restore prompts recorded as present in `previousPrompts` from their durable pre-install backups or remove prompts recorded as absent. For a customized or potentially customized prompt, apply only the approved restore/remove decision after showing its diff. Restore byte-identical runtime files from durable backups when previously present; otherwise remove only files whose current hash is the installed hash.

### Phase 6: Validate, roll back, and clean up

Run `OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode debug config` from a neutral directory. If validation fails, restore the config, plugin entry, runtime files, prompts, and install state from the uninstall backups and stop. Only after validation succeeds, remove `install-state.json` and any now-empty Pilotfish directories; keep backups. Never auto-delete the global config, even if only its schema declaration remains. Tell the user to restart OpenCode.

## Known OpenCode Limitations

- OpenCode has no native general equivalent to Claude Code's ordered `fallbackModel` chain.
- Stable Task configuration has no `isolation: "worktree"` option or automatic result harvesting.
- Pilotfish therefore serializes writing workers and does not promise automatic model failover.
- Background subagents and worktree APIs exist experimentally in OpenCode but are not Phase 1 dependencies.

These limitations are documented behavior, not installer errors. The required router is a narrow OpenCode runtime adapter, not a provider gateway or replacement session/tool host.
