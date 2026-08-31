# pilotfish for OpenCode

> Small, specialized workers handle routine work so the strongest model can focus on planning and judgment.

Pilotfish is an experimental multi-model orchestration configuration for [OpenCode](https://opencode.ai). It adds an opt-in `pilotfish` primary agent that delegates phase-aware discovery, implementation, and verification to eight model-pinned public subagents.

Pilotfish `0.2.0` requires OpenCode `1.18.10` or newer. The global configuration persists the public agent graph and a required config-relative runtime profile router; OpenCode still creates sessions, calls providers, and enforces tool permissions.

Current version: `0.2.0`

Semantically synced through original Pilotfish commit `1251465`, including `v1.2.0`; see the [upstream sync workflow](./docs/upstream-sync.md).

## Why

Coding sessions spend substantial context on searching, routine edits, test execution, and documentation. Those tasks do not always need the same model used for planning or final review.

Pilotfish separates work by role:

- Keep architecture, ambiguity resolution, integration, and final review in the primary session.
- Route high-volume reconnaissance and mechanical work to less expensive models.
- Challenge material Plans before approval and non-trivial outcomes after implementation with separate fresh-context roles.
- Keep pre-approval security analysis capability-separated from approved security implementation.
- Enforce read-only and leaf-agent boundaries through OpenCode permissions.

## How It Works

Pilotfish installs one public primary and eight public workers in the global OpenCode config:

```text
You
 |
 +-- pilotfish (primary orchestrator)
       |-- scout
       |-- Explore
       |-- plan-verifier
       |-- security-reviewer
       |-- mech-executor
      |-- executor
      |-- verifier
      +-- security-executor
```

`pilotfish` is opt-in. It does not replace OpenCode's built-in Build or Plan agents and the installer does not change `model` or `default_agent`.

| Role | Used for |
|---|---|
| `scout` | Narrow read-only lookups with exact file references |
| `Explore` | Broad read-only codebase or accessible project-local artifact reconnaissance with exact references and uncertainties |
| `plan-verifier` | Read-only Plan challenge before approval; returns `READY` or `REVISE` |
| `security-reviewer` | Read-only pre-approval security evidence and threat analysis |
| `mech-executor` | Fully specified pattern edits, conventional tests, docs, and bulk work |
| `executor` | Features, bug fixes, and refactors requiring local judgment |
| `verifier` | Post-implementation attempts to refute completed work; returns `CONFIRMED` or `REFUTED` |
| `security-executor` | Approved authentication, authorization, secrets, crypto, validation, and hardening changes |

Workers cannot launch subagents. The four discovery and pre-approval review roles cannot edit or run shell commands. `security-reviewer` alone may fetch supplied external evidence. `verifier` cannot use file-edit tools but can run checks after implementation.

**MCP servers and subagents.** By default only the orchestrator — the agent you talk to — keeps your MCP servers; subagents get none. This is about context, not capability: a subagent is sent the full text of every tool it may use on every step, and a whole server is thousands of tokens (a 44-tool GitHub server measured ~13,700), which crowds the working context of the smaller models subagents are meant to run on. The recommendation is to grant *individual tools* to *specific roles*, and only once you have seen a role need one — an individual tool costs about 300 tokens, not thousands. [`docs/token-budget.md`](./docs/token-budget.md) explains the trade-off and ships a copy-pasteable audit that reports, from your own session history, which MCP tools each role actually used and what each role's context already costs.

Large, ambiguous, architectural, risky, cross-surface, or explicitly plan-first work follows Discovery, Plan, Approval, Execution, and Verification phases. Small stable work remains direct. A material Plan is synthesized in the primary session and may receive a read-only readiness review before explicit approval; writing workers receive only stable, authorized contracts.

### Runtime Profile Router

The global config must load `./pilotfish/profile-router.mjs` with `{"preset":"chatgpt"}` or `{"preset":"antigravity"}`. The managed runtime files are `~/.config/opencode/pilotfish/profile-router.mjs` and `profiles.json`; the latter is the exact approved profile source.

The first Pilotfish message selects a profile from the public primary model and pins it for the session; the active preset's profiles each contribute eight hidden worker clones, so a three-profile preset creates 24 hidden clones. The router recovers that pin from the first persisted Pilotfish user message when OpenCode or the plugin restarts, so a resumed session cannot silently change its primary model. The profile pin persists across agent switches, but Task remapping is active only while Pilotfish is the current successfully resolved agent. Tasks are redirected to the selected clone before Task resolution. For a new foreground Task, the router appends a transient SHA-256 call marker to the description, binds authorization to the exact child title and parent, then restores the clean child title before provider execution. For a resumed Task, it validates and binds the exact `task_id` without a marker. `tool.execute.after` restores the mutable description and result title and clears authorization; OpenCode `1.18.10` may retain the marked description in its already-captured raw tool-input event. The marker contains only a one-way hash of the call ID, not prompt or credential data. Direct root, sibling, mismatched, or replayed internal chat is rejected. Experimental background Task timing is unsupported and fails closed. The public primary model and variant remain untouched. Same-session model switches are rejected; start a new session. Unsupported or cross-preset models, unavailable history, and malformed persisted Pilotfish model data are rejected before provider execution. AntiGravity behaves identically to ChatGPT: its Opus, Pro, and Flash profiles route to their own hidden clones and recover their pin the same way. Hidden `pilotfish-profile-*` names are implementation details: only exact one-time router-authorized Task children may use them. OpenCode's CLI itself refuses a hidden subagent passed to `--agent` and may fall back to its default primary, so internal names must never be selected directly. Because OpenCode skips a plugin factory that throws, catchable factory initialization errors are deferred through protective hooks that block Pilotfish and internal-agent use while leaving unrelated sessions alone.

New-task authorization starts unbound. Only a matching post-authorization `session.created` event may bind the exact new child ID; a pre-existing sibling remains unauthorized even if retitled to the marker. Authorizations independently expire after 30 seconds, and their timers are cleared on consume, after-hook cleanup, parent deletion, or plugin disposal. The supported order is before hook → `session.created` → child chat → after hook; child chat racing the event fails closed.

Expiry, parent deletion, and plugin disposal atomically revoke authorization before asynchronous cleanup. If a new-task authorization is already bound and its child title is still marked, cleanup awaits a best-effort `session.update` to restore the exact clean title, then removes authorization in `finally`; resumed Tasks never need marker cleanup. A host lookup or update failure can leave a marked child title requiring manual child-title cleanup, but the failed cleanup cannot authorize execution or permit replay.

OpenCode replaces plugin-hook exceptions with `Unexpected server error. Check server logs for details.` in standard `opencode run --format json` output, and logs config-hook errors without surfacing them at all. Because of that, a refusal also asks the TUI to show an error toast carrying the guard's own reason. The toast is best-effort narration attached to the throw: it is never awaited, a host that drops or cannot show it changes nothing, and no toast reaches a non-interactive `opencode run`. The exact fail-closed reason is always available with `--print-logs`; installer preflight remains the normal user-facing protection against unsupported model selections.

## Presets

The `0.2.0` installer offers three tested presets. It verifies that every required model and variant exists in `opencode models --verbose` before changing configuration.

### ChatGPT runtime profiles

Only `pilotfish` is bound in the persisted config. The eight public workers are installed with no model, so outside a Pilotfish session they inherit the invoking primary and stay on the provider that session selected. The rows below are applied by the router to its hidden clones; the canonical mapping is `templates/pilotfish/profiles.json`:

| Primary profile | `pilotfish` | `scout` | `Explore` | `plan-verifier` | `security-reviewer` | `mech-executor` | `executor` | `verifier` | `security-executor` |
|---|---|---|---|---|---|---|---|---|---|
| Sol | Sol/high | Luna/low | Luna/medium | Sol/high | Sol/xhigh | Terra/low | Terra/high | Sol/high | Sol/xhigh |
| Terra | Terra/high | Luna/low | Luna/medium | Terra/high | Sol/high | Luna/low | Terra/medium | Terra/high | Sol/medium |
| Luna | Luna/max | Luna/low | Luna/medium | Luna/high | Sol/medium | Luna/low | Luna/high | Luna/high | Terra/high |

Each profile is named for its primary model, so the Sol, Terra, and Luna rows above are the profiles `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, and `openai/gpt-5.6-luna`. The primary variants shown in the `pilotfish` column are tested recommendations, not router gates. The selected primary model chooses the worker profile; primary effort remains under direct user control and may change within a model-pinned session without changing its worker profile.

### AntiGravity runtime profiles

Only `pilotfish` is bound in the persisted config; the eight public workers are installed unbound and inherit the invoking primary.

| Primary profile | `pilotfish` | `scout` | `Explore` | `plan-verifier` | `security-reviewer` | `mech-executor` | `executor` | `verifier` | `security-executor` |
|---|---|---|---|---|---|---|---|---|---|
| Opus | Opus/max | Flash/low | Flash/medium | Opus/max | Opus/max | Flash/low | Pro/high | Sonnet | Opus/max |
| Pro | Pro/high | Flash/low | Flash/medium | Pro/high | Opus/max | Flash/low | Pro/high | Pro/high | Opus/low |
| Flash | Flash/high | Flash/minimal | Flash/low | Pro/high | Opus/low | Flash/minimal | Flash/high | Pro/high | Pro/high |

Opus, Pro, Flash, and Sonnet are `google/antigravity-claude-opus-4-6-thinking`, `google/antigravity-gemini-3.1-pro`, `google/antigravity-gemini-3-flash`, and `google/antigravity-claude-sonnet-4-6`. Sonnet exposes no variant, so its roles run at the provider default; it is a separate quota bucket from Opus, which is why the Opus profile's verifier uses it. Opus exposes only `low` and `max`, and Pro only `low` and `high`, so this preset's effort ladder is shorter than ChatGPT's.

AntiGravity support targets the `google/antigravity-*` model IDs exposed by the user's existing OpenCode integration. Pilotfish does not install or configure that integration.

### OpenRouter runtime profiles

Two profiles built from two models each rather than three tiers. Only `pilotfish` is bound in the persisted config; the eight public workers are installed unbound and inherit the invoking primary.

| Primary profile | `pilotfish` | `scout` | `Explore` | `plan-verifier` | `security-reviewer` | `mech-executor` | `executor` | `verifier` | `security-executor` |
|---|---|---|---|---|---|---|---|---|---|
| Qwen-27B | Qwen-27B | Qwen-35B | Qwen-35B | Qwen-27B | Qwen-27B | Qwen-35B | Qwen-35B | Qwen-27B | Qwen-27B |
| Pro/high | Pro/high | Flash/low | Flash/low | Pro/high | Pro/xhigh | Flash/low | Flash/high | Pro/high | Pro/xhigh |

Qwen-27B and Qwen-35B are `openrouter/qwen/qwen3.6-27b` and `openrouter/qwen/qwen3.6-35b-a3b`; Pro and Flash are `openrouter/deepseek/deepseek-v4-pro` and `openrouter/deepseek/deepseek-v4-flash-0731`.

Variant support is a per-model capability, not a provider-family one. Neither Qwen model exposes a variant, so that profile sets none and its roles run at the provider default. Both DeepSeek models do — Pro accepts `high` and `xhigh`, Flash accepts `low`, `high`, and `max` — so that profile ladders effort like the ChatGPT profiles. Check `opencode models --verbose` rather than assuming.

These are the first supported models whose IDs carry two slashes; the router rebuilds the selection key without assuming a segment count.

## Install

The recommended path is to clone this repository locally and pin it to a commit, then start OpenCode from that checkout so it reads a local runbook and matching templates:

```bash
git clone https://github.com/Adrian-Mandel/pilotfish-opencode.git
cd pilotfish-opencode
git checkout <commit-sha>
opencode
```

> **No release tags are published yet** (#51), so there is nothing named `v0.1.0`
> or `v0.2.0` to clone — `CHANGELOG.md` still marks `v0.2.0` as Unreleased.
> Pinning to a commit SHA gives the same property a tag would: the runbook and
> templates cannot change between the moment you review them and the moment you
> install. Omit the `git checkout` line to install the default branch as it
> stands. Do not use `--depth 1` with a pinned checkout; a shallow clone has no
> other commit to check out.

In that OpenCode session, using a normal primary agent such as Build, paste:

```text
Read the local file install/OPENCODE-INSTALL.md in the current checkout and follow it to install Pilotfish into my global OpenCode configuration.
Use only the templates in this checkout.
Show me the complete plan and get my approval before writing anything.
```

> **Runtime requirement:** OpenCode `1.18.10` or newer. The installer stops before writing on an older or unidentifiable version.

The installer:

1. Inspects the three global JSON/JSONC config layers and selects the highest-precedence active file.
2. Checks which presets, exact model IDs, and variants are available.
3. Detects agent-name, prompt-file, and router-plugin collisions.
4. Shows the exact model/profile, runtime-file, and file plan.
5. Waits for approval.
6. Merges only the nine public Pilotfish agent entries and one exact plugin tuple.
7. Hashes runtime files and validates the resolved configuration and router behavior.

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

Pilotfish installs global prompts, agent definitions, a plugin tuple, and local runtime files that affect future OpenCode sessions. Treat the installer like any software setup process:

- Prefer the pinned local release so the runbook and templates cannot change between review and installation.
- Review `install/OPENCODE-INSTALL.md`, `templates/opencode.base.jsonc`, the selected preset, router files, and the prompt files before approval.
- Keep the approval gate; the installer must show every file and configuration change before writing.
- Do not bypass remote prompt-injection protection to make the raw URL path work.
- Pilotfish does not modify provider credentials, the global default model, or the default agent.

## What Gets Installed

| Target | Change |
|---|---|
| Highest-precedence global JSON/JSONC config | Adds nine public entries under `agent` and one router plugin tuple |
| `~/.config/opencode/pilotfish/prompts/` | Adds nine role prompts |
| `~/.config/opencode/pilotfish/profile-router.mjs`, `profiles.json` | Adds hash-tracked runtime router files |
| `~/.config/opencode/pilotfish/install-state.json` | Records prior touched values for safe uninstall |
| `~/.config/opencode/pilotfish/backups/` | Stores timestamped recovery copies |

Nothing is written into projects. Provider credentials and unrelated OpenCode settings are not touched.

## Configuration Warning

On its first turn, Pilotfish inspects only its resolved agent definition with `opencode debug agent pilotfish`.

It gives a short, non-blocking warning when the primary model is unspecified or differs from the tested Sol/high, Terra/high, Luna/max, or AntiGravity Opus/max configurations. The agent remains visible and usable with any manually selected model; unsupported router session selection still fails before provider execution.

## OpenCode Limitations

The OpenCode port cannot reproduce every Claude Code feature used by original Pilotfish:

| Original capability | OpenCode `0.2.0` behavior |
|---|---|
| Ordered automatic `fallbackModel` | No native general equivalent; model failures do not automatically switch roles |
| `isolation: "worktree"` on a Task | No stable Task option; writing workers are serialized |
| Automatic worktree result harvesting | Not available through stable agent configuration |
| Model aliases such as `best`, `opus`, or `haiku` | Presets use exact provider/model IDs |

OpenCode has experimental background-agent and worktree APIs, but Pilotfish does not depend on them. The router is a narrow required runtime adapter, not a general orchestration engine.

These gaps are tracked in [model fallback and ceilings](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/1) and [Task worktree isolation](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/2). Router usage telemetry is separately optional in [issue #11](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/11).

## Gotchas

Behaviour that is working as designed but surprises people the first time. Everything here is observed, not theoretical.

**A session's model is fixed once it pins.** The profile is selected from the primary model on the first Pilotfish message and cannot change for the life of that session — switching the model picker mid-session is refused. Reasoning effort and variant you *can* change freely; only the model is locked. Start a new session to switch. This exists so that a session's profile does not depend on whether the process happened to restart, since recovery re-pins from the first persisted message.

**A refused session can still look like a broken model.** Every router guard fails closed, and OpenCode logs plugin hook errors without surfacing them, so the underlying refusal arrives as *no answer at all* rather than a message. Pilotfish now asks the TUI to show an error toast with the guard's reason whenever it refuses, which covers the interactive case — but the toast is best-effort and TUI-only, so a non-interactive `opencode run` still just goes quiet. If Pilotfish produces nothing and you saw no toast, suspect a guard before you suspect the provider: the two most common reasons are a mid-session model switch, which is refused by design, and a configuration guard that fired at startup and is re-raised on every message. Restart OpenCode with `--print-logs` to read the exact reason from the server log. The generic `Unexpected server error. Check server logs for details.` with a `ref: err_…` is that same refusal after OpenCode has stripped its text; the `ref` correlates with the log line but does not carry the reason.

**It is one preset, or all profiles — presets do not combine.** The `preset` option takes a single name. There is no way to activate two presets. Omitting the option entirely activates every profile in `profiles.json`, which is the only configuration that supports concurrent sessions on different provider families.

**The profile is chosen by the primary model alone.** Not by the preset, not by the effort. Selecting a model that no *active* profile claims is refused before any provider request, which is easy to hit right after narrowing the preset.

**Every active profile costs tokens on every request.** Each one generates 8 hidden clones, and `hidden: true` removes a clone from the agent picker but not from the Task tool schema. Three profiles is 24 clones, all profiles is 64, and they ride along on every request including every subagent turn.

**Clone overhead is not the main cost — prompt caching is.** The `pilotfish` primary carries a static system-and-tools prefix of roughly 53K tokens that is re-sent on every request. Providers that cache it charge almost nothing for it; providers that do not charge full price every time. The same delegated task can differ by more than an order of magnitude in cost between two providers doing identical work.

**One model can be served by several upstreams.** On aggregators such as OpenRouter, consecutive requests for the same model may land on different upstream providers. Each keeps its own prompt cache, so rotation alone can drive the cache hit rate to near zero even when the model nominally supports caching. Pin a provider before concluding a model is expensive.

**Config and plugin changes need a restart.** Plugins load at OpenCode startup. Nothing you edit in the global config takes effect until the server restarts.

**A cheap worker can return nothing at all.** Observed on a flash-tier worker at low effort: it issued its tool call, received the result, then produced an empty final turn and stopped cleanly — no error, correct routing, zero output. Intermittent rather than systematic, but it means an empty worker result is a real outcome to design around, not an impossibility.

**Delegation is the primary's judgment call, not a guarantee.** A small question gets answered directly. When testing whether routing works, ask for delegation explicitly, or you are measuring the primary's discretion rather than the plumbing.

## Tuning

All persisted role assignments live together in the global `agent` map. Advanced users may change a role's `model` and `variant`, then restart OpenCode:

```jsonc
"executor": {
  "model": "provider/model-id",
  "variant": "high"
}
```

Manual combinations outside the two presets are supported by OpenCode but are not approved by the router for a Pilotfish session.

## Updating

Updating means rerunning the installer from the desired pinned checkout. Use a checkout whose runbook, `CHANGELOG.md`, and templates are all from the same ref; do not mix a pinned checkout with `main` files.

```bash
git clone https://github.com/Adrian-Mandel/pilotfish-opencode.git
cd pilotfish-opencode
git checkout <commit-sha>
opencode
```

```text
Read install/OPENCODE-INSTALL.md and update my existing Pilotfish installation from this checkout.
Use only this checkout. Keep my recorded preset unless I ask to switch it.
Show the changelog and exact plan, then get my approval before writing anything.
```

The installer stops without writing only when every managed agent, prompt, runtime file, and the plugin tuple already match this checkout — `profiles.json` counts as matching when its canonical profiles equal the checkout and its only extra entries are your own preserved profiles. The gate is content, not a recorded label, so a merged fix is never left undelivered, and a profile you added yourself is never treated as drift. Otherwise it reruns the normal install flow: unchanged agents, plugin/runtime files, and prompts are skipped, and any customization is diffed and requires a keep-or-replace decision. Raw `main` remains mutable; do not use it to mix refs or bypass safety checks. The original pre-install values remain preserved for uninstall.

## Uninstall

From a compatible pinned checkout, use:

```text
Read install/OPENCODE-INSTALL.md and uninstall my Pilotfish installation.
Inspect state and current config layers, show one exact restoration plan with any diffs,
and get my approval before writing anything.
```

Uninstall restores or removes only the nine touched agent keys and exact owned plugin tuple, then restores/removes prompts and hash-tracked runtime files after their config references are gone. It preserves unrelated config and plugin order, keeps backups, validates before removing state, and never auto-deletes the global config. Without install state, it offers only conservative manual removal because overwritten pre-install values cannot be reconstructed.

## Design and Research

- [Design rationale](./docs/design.md)
- [Profile router contract and threat model](./docs/profile-router-contract.md)
- [OpenCode research](./docs/research.md)
- [Artifact-routing evaluation](./docs/artifact-routing-evaluation.md)
- [Upstream sync workflow](./docs/upstream-sync.md)
- [Upstream deviations ledger](./docs/upstream-deviations.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)
