# Handoff: issue #51 — tag and publish the fork (v0.1.0 and v0.2.0)

**Repo:** `pilotfish-opencode` (this checkout). **Branch:** `main`. Pull first, then `git status`.
**Task:** https://github.com/Adrian-Mandel/pilotfish-opencode/issues/51
**Read `RELEASING.md` in full before doing anything** — it is a 19-step gated checklist, not a quick tag. This handoff frames the parts it doesn't spell out.

> ⚠️ This is a substantial, owner-collaborative release with **provider-spend gates** and **owner-only decisions**. It is not fire-and-forget. Do the prep and the free gates, surface the decisions, and stop at the spend/push lines for the owner. Do not tag or push anything yourself — you have no push access.

---

## 1. Where things stand

The project just validated viability (#53 → "continue", verdict on #32), shipped the perf/gate work (#16 P1–P4 in v0.2.0), and finished #55. `VERSION` is `0.2.0`; `CHANGELOG.md` marks **both `v0.2.0` and `v0.1.0` as `Unreleased`** and there are **no `v0.x` tags yet** — that is exactly what #51 is: cut real `v0.1.0` and `v0.2.0` releases.

## 2. The tag-namespace situation (investigated — here are the facts)

`git tag` shows `v1.0.0`–`v1.4.1` and `pilotfish--v1.4.x`. **Those are upstream's, not the fork's.** They came in via the `upstream` remote (`Nanako0129/pilotfish`); most are not even on `origin/main` (`v1.2.0`, `v1.4.0`, `v1.4.1` are NOT ancestors of `origin/main`). The fork deliberately numbers itself on a separate **v0.x** line (`CHANGELOG.md` has `v0.2.0`, `v0.1.0`, `v0.0.1`, and an "Original Claude Code History" section documenting the upstream v1.x lineage). So **v0.x (fork) and v1.x (upstream) do not collide** — different major — but they share the tag list, which is the only real source of confusion.

## 3. Decisions to get from the owner FIRST (do not decide these yourself)

1. **What commit does `v0.1.0` point to?** v0.1.0 is a past state (its CHANGELOG section describes it). Either the owner names the commit, or you propose one from history + the CHANGELOG and confirm. v0.2.0 is the current release commit.
2. **What to do about the inherited upstream `v1.x` tags on the origin.** Options: (a) leave them and document in the release notes / README that v1.x are upstream's and the fork's line is v0.x; (b) delete the upstream tags from `origin` so `git tag` shows only the fork's line (destructive — they may be referenced by upstream-sync tooling; the `pilotfish--v1.4.x` prefixed ones look deliberate). Recommend (a) unless the owner wants a clean namespace.
3. **Is step 11 (upstream-sync review, = #52) done as part of this release, or deferred?** RELEASING.md step 11–12 require reviewing through `upstream/main`, updating `UPSTREAM_VERSION`, and clearing `docs/upstream-deviations.md` of `Pending`. That couples this release to #52 (sync to v1.3.10). Ask the owner whether to fold #52 in now or cut v0.2.0 against the current `UPSTREAM_VERSION` and do #52 separately.
4. **Approve the provider-smoke spend (steps 16–17).** See lane C.

## 4. Three lanes of work

### Lane A — session can drive alone (free, offline / free-model)
- Finalize the `v0.1.0` and `v0.2.0` CHANGELOG entries: change `- Unreleased` to a dated release line, record the tested OpenCode version (v0.2.0 says "Tested with OpenCode 1.18.18").
- Confirm `VERSION` = `0.2.0` and the installer reads version from `VERSION` only (RELEASING step 3).
- Run the offline gates: `python3 -m unittest discover -s tests -v`; `node --test tests/profile-router.test.mjs`; `node --test tests/integration/config-generation.test.mjs`; `git diff --check`; JSON validation of `templates/opencode.base.jsonc`, both preset fragments, and `templates/pilotfish/profiles.json` (steps 4, 6, 14).
- `opencode debug agent <name>` on all nine (step 8); `opencode models --verbose` for required IDs/variants (step 9).
- Exercise fresh install / repeated install / update-with-customization / uninstall restoration (step 10) — **in an isolated context; never overwrite the owner's real `~/.config/opencode/pilotfish/` (it has a customized `profiles.json` + no-preset plugin line).**
- Draft the release notes for each version from its CHANGELOG entry.

### Lane B — the host-fact gate (free model, needs network) — step 5
- `node --test tests/integration/host-fact-config-identity.test.mjs` and `node --test tests/integration/host-facts.test.mjs`. The second runs live turns on a free shared model and is bounded (~15 min cap). **Triage before treating a failure as real:** the suite marks inconclusive runs with a leading `INCONCLUSIVE` (model never emitted the tool call, etc.) — those are *repeated*, not findings. A permission refusal is **not** a host verdict (issue #39: uncanonical fixture root). Only an unmarked ordering/key-set/hook assertion failure is a genuine host change that blocks the release. RELEASING step 5 spells this out — read it.

### Lane C — spend-gated and push-gated (owner) — do NOT run without explicit owner approval
- **Provider smokes (steps 16–17):** one bounded ChatGPT Luna/low task (≤5 min, no retries) and the AntiGravity smoke. These consume provider quota. Standing rule: subscription-billed gpt is fine, but **no metered spend, and no provider run without the owner's explicit go.** Confirm which is metered before running; if credentials/models are unavailable the release is *blocked* — do not claim the gate passed.
- **The actual publish (step 19):** `git tag`, `git push`, `git push --tags`, `gh release create`. You have **no push access** — prepare everything and hand the owner the exact commands to run.

## 5. Constraints this project has paid for — do not re-pay
- **No push access.** Commit prep to `main` locally; owner pushes and tags. Never attempt `git push`.
- **The installed Pilotfish differs from this repo** — never overwrite `~/.config/opencode/pilotfish/` (customized `profiles.json` = a `local`/bambi preset that's in no template; no-preset plugin line). Install/uninstall testing goes in an isolated fixture only.
- **Re-read any config immediately before editing** — the owner edits configs between turns.
- **GitHub MCP is flaky** (static PAT in `~/.claude.json` → `mcpServers.github.headers.Authorization`; 401 when expired, needs the header fixed + Claude restarted). If you can't read/post the issue, that's why — don't spin.
- Don't touch `~/.claude.json`, the bench harness, or the router for this task.

## 6. Definition of done
- v0.1.0 and v0.2.0 CHANGELOG entries finalized (dated, tested-OpenCode noted); VERSION correct.
- All free gates (lanes A + B) pass or their failures are triaged and dispositioned per RELEASING.md.
- Owner decisions (§3) captured in the release plan; provider smokes run *with approval* or explicitly handed to the owner.
- The exact tag/push/`gh release create` commands for both versions handed to the owner, with drafted release notes.
- Prep committed to `main` locally (CHANGELOG dates, any doc updates). Owner pushes, tags, and publishes.

## Why this task (and not the others)
- #16 P1–P4 shipped in v0.2.0; #53 closed; #55 done.
- #52 (upstream sync) is coupled to this via RELEASING step 11 — decision §3.3 decides whether they merge.
- #14 (installable plugin), #30 (curated presets) are bigger adoption plays that want a tagged release under them first — which is this.
