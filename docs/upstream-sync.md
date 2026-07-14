# Upstream Sync Workflow

Pilotfish for OpenCode is a semantic port of [Nanako0129/pilotfish](https://github.com/Nanako0129/pilotfish), not a byte-for-byte mirror. The upstream project targets Claude Code while this fork targets OpenCode, so upstream changes must be reviewed and translated rather than merged blindly.

`UPSTREAM_VERSION` contains the exact upstream commit last reviewed for applicability. The current baseline is upstream `v1.1.4`.

## Why Direct Merges Are Avoided

A normal merge from `upstream/main` would repeatedly reintroduce Claude-specific paths, settings, model aliases, frontmatter, and documentation. It would also create modify/delete conflicts because the OpenCode fork intentionally replaced those files.

Keeping an explicit review baseline provides a verifiable answer to two questions:

1. Which upstream changes have been examined?
2. How was each relevant behavior represented in OpenCode?

## File Mapping

| Upstream source | OpenCode destination | Review focus |
|---|---|---|
| `templates/claude-md.orchestration.md` | `templates/pilotfish/prompts/pilotfish.md` | Delegation, escalation, verification, and scheduling policy |
| `templates/agents/scout.md` | `templates/pilotfish/prompts/scout.md` | Narrow reconnaissance behavior |
| `templates/agents/Explore.md` | `templates/pilotfish/prompts/Explore.md` | Broad reconnaissance behavior |
| `templates/agents/mech-executor.md` | `templates/pilotfish/prompts/mech-executor.md` | Mechanical execution contract |
| `templates/agents/executor.md` | `templates/pilotfish/prompts/executor.md` | Judgment-bearing implementation contract |
| `templates/agents/verifier.md` | `templates/pilotfish/prompts/verifier.md` | Independent verification contract |
| `templates/agents/security-executor.md` | `templates/pilotfish/prompts/security-executor.md` | Security execution contract |
| `templates/settings.snippet.json` | `templates/presets/*.jsonc` | Model assignment and fallback implications |
| `install/AGENT-INSTALL.md` | `install/OPENCODE-INSTALL.md` | Safe installation, update, validation, and uninstall behavior |
| `README.md`, `docs/design.md`, `docs/research.md` | Same paths in this fork | Claims, rationale, compatibility, and attribution |

## Sync Procedure

1. Ensure the `upstream` remote points to `https://github.com/Nanako0129/pilotfish.git`.
2. Fetch upstream without merging it.
3. Read the baseline SHA from `UPSTREAM_VERSION`.
4. Review commits and changed files between the baseline and `upstream/main`.
5. Classify each meaningful change as adopted, adapted, deferred, or not applicable.
6. Port applicable behavior into the mapped OpenCode files.
7. Validate both OpenCode presets and agent permissions.
8. Update `UPSTREAM_VERSION` to the reviewed upstream commit.
9. Record the sync and important decisions in `CHANGELOG.md`.

Reference commands:

```bash
git remote add upstream https://github.com/Nanako0129/pilotfish.git
git fetch upstream
git log --oneline "$(cat UPSTREAM_VERSION)..upstream/main"
git diff --stat "$(cat UPSTREAM_VERSION)..upstream/main"
git diff "$(cat UPSTREAM_VERSION)..upstream/main"
```

If the `upstream` remote already exists, verify its URL instead of adding it again.

## Decision Rules

- Preserve upstream role and quality improvements when OpenCode can express them safely.
- Translate tool names, permissions, models, and lifecycle behavior to verified OpenCode mechanisms.
- Do not copy Claude-specific claims merely to remain textually current.
- Document host limitations instead of approximating them with brittle prompt behavior.
- Do not add runtime code to reproduce a feature that original Pilotfish delegates to its host.
- Never advance `UPSTREAM_VERSION` past a change that has not been reviewed.

## Baseline Review: v1.1.4

Upstream `v1.1.4` added dependency-aware background delegation: schedule independent agents early, continue useful work, and collect every result before dependent work or completion.

OpenCode's background-subagent support is experimental, so this fork adapts the stable principle rather than the Claude-specific parameter. The Pilotfish primary schedules independent read-only reconnaissance early and in parallel, continues non-overlapping work when possible, and collects results before dependent decisions or the final response. Writing workers remain serialized until stable Task-level worktree isolation exists.
