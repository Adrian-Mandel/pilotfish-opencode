# Handoff: start issue #14 — package Pilotfish as an installable OpenCode plugin

**Repo:** `pilotfish-opencode` (this checkout). **Branch:** `main` at `0a162b1`, clean, up to date with origin.
**Task:** https://github.com/Adrian-Mandel/pilotfish-opencode/issues/14 — the **packaging** half only.
**Scope doc, written for you, read it first:** [`docs/issue-14-packaging-scope.md`](docs/issue-14-packaging-scope.md).
**Why this one:** the #32 Phase 3 disposition names packaging as the remaining substantial investment, and #16 P1 — the thing ahead of it — closed today.

---

## 1. Do this before anything else

**The live install is stale.** `~/.config/opencode/pilotfish/prompts/pilotfish.md` does not match `templates/pilotfish/prompts/pilotfish.md`, because PR #58 shipped a prompt change and nothing reinstalled. The verifier budget rules that just landed are **not live**. Two consequences: don't measure anything against the running install and expect it to reflect `main`, and if the owner wants those rules active, the install runbook has to be re-run.

Check drift yourself rather than trusting this paragraph — it ages:

```bash
for f in ~/.config/opencode/pilotfish/prompts/*.md; do cmp -s "$f" "templates/pilotfish/prompts/$(basename $f)" || echo "STALE: $(basename $f)"; done
```

**Three tests fail on `main` and are not yours.** `python3 -m unittest discover -s tests` is 41 tests, 3 failures — `test_installer_asserts_installed_content_after_install`, `test_installer_declares_plugin_and_runtime_lifecycle`, `test_installer_update_gate_is_content_based`. All three assert exact sentences in `install/OPENCODE-INSTALL.md` that `42bb46c` and `e2fc1fb` reworded. They predate this handoff, there is a pending task chip for them, and **they will touch the same runbook you are about to rewrite** — so either fix them first or expect to inherit them. `node --test tests/profile-router.test.mjs` is 65 pass, 0 fail.

**`HANDOFF-issue-55.md` at the repo root is stale.** #55 shipped in `2d57250`. Ignore it; it should probably be deleted.

---

## 2. What just happened, so the repo state makes sense

PR #58 merged. It did two things to #16 P1:

- **Shipped the budget half.** `pilotfish.md`'s Completion Gate now bounds the verifier's working surface to the files a change touched plus their immediate callers, caps a claim at three dispatches, and forbids an observation from reopening the claim it arrived under. Pinned in `test_policy.py`.
- **Closed the firing half on evidence.** The proposed skip rule was evaluated against all 62 exported historical verifier dispatches and would have skipped **zero** of them, including zero of the 44 `REFUTED`. Artifact: `tests/bench/data/gate-firing-classification.json`. The 224-run benchmark originally planned for it was withdrawn, not deferred — the fields that solve this problem (predictive test selection, effort-aware defect prediction) grade gates by replaying rules against recorded history, not by running the system live.

None of that blocks #14, and you do not need to understand the verifier work to do packaging.

---

## 3. Your task: the spike, and nothing else yet

`docs/issue-14-packaging-scope.md` §5 lays out nine steps. **Step 1 is all you should do without checking back**, because its first answer decides the shape of everything after it.

Three host facts, verified against the pinned OpenCode binary, recorded in `docs/profile-router-contract.md` under the existing H-number convention with the version they were read against:

1. **Does OpenCode resolve a non-path plugin specifier — a registry or versioned entry like `["pilotfish-opencode@0.3.0", {...}]` — and from where, with what caching, and what happens offline?** Every documented install path in this repo uses the config-relative form `"./pilotfish/profile-router.mjs"`. #14 asserts the registry form works; nothing here has checked it. **This is the gate.** If it does not work as #14 assumes, stop and report — the project changes shape and the owner has a decision to make (§7 Q1 of the scope doc).
2. **Does the agent schema accept an inline `prompt` string** where it accepts `{file:./pilotfish/prompts/<role>.md}`? Packaged prompts do not live under the global config dir, so either `{file:…}` can name a path the plugin knows, or the plugin reads its own `.md` files and inlines them. The scope doc recommends inlining; this is the check that makes that safe.
3. **Does a `config`-hook-created *public* agent behave identically to a persisted one, including across a second project directory?** The hook already synthesizes 16–24 hidden clones, so the mechanism is proven — but **H11** says one process serves several directories and the rebuilt agent map points back at the previous instance's record. That already bit this exact code path once and "killed every project after the first." Nine more synthesized agents doubles that surface. `tests/integration/host-fact-config-identity.test.mjs` is the right shape of test to extend: it shows identity by mutation visibility, never by comparing content.

**Write no product code in this step.** No `package.json`, no router changes. The deliverable is three recorded host facts and a recommendation.

---

## 4. Hard constraints

- **Never `git push`.** The owner pushes. You may open PRs and comment on issues — the GitHub MCP works for that, and a classifier denial is worth one retry before you believe it.
- **No metered spend.** Subscription-billed gpt is fine; metered OpenRouter is not.
- **Do not run `tests/bench/verifier-correctness.mjs`.** It needs the local bambi server and the owner's explicit go. Nothing in #14 needs it.
- **Do not run inference on the local model servers unasked.** `bambi` is standing-authorised; `omlx` and `mtplx` are not.
- **Do not edit `install/OPENCODE-INSTALL.md` during the spike.** It is the thing being replaced, and rewriting it before fact 1 is answered is work you may throw away.

---

## 5. Context to read, not re-derive

| Read | For |
|---|---|
| [`docs/issue-14-packaging-scope.md`](docs/issue-14-packaging-scope.md) | The whole plan. §1 is the decision the owner has not made yet; §5 is your step list; §7 is the open questions |
| [`docs/profile-router-contract.md`](docs/profile-router-contract.md) | H1–H14, the guarantees, the threat model, and the change-control rule. H2, H9 and H11 all bear on packaging |
| [issue #14](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/14) | The original scope. Note it predates `50c880b`/`19ed57c` by three weeks and its version premise is affected |
| [issue #32, latest comment](https://github.com/Adrian-Mandel/pilotfish-opencode/issues/32#issuecomment-5488831930) | The narrow-scope decision and why packaging is Phase 4 |
| `install/OPENCODE-INSTALL.md` | What you are replacing. 439 lines; §2 of the scope doc says which two thirds stop existing |

Two things the scope doc argues that are easy to miss and expensive to rediscover:

- **The first packaged release is additive, not subtractive.** Migration from a 0.2.x install *is* the existing uninstall — restore `previousAgents`/`previousPrompts` to true pre-install state, remove the runtime files, then add the plugin entry. So the uninstall machinery has to outlive the thing it replaces by at least one release. #14 reads as though packaging removes machinery immediately. It cannot.
- **Packaging deletes a safety property.** Preflight today catches an unavailable model *before* anything is written, and H2 means a failed plugin is a log line and an absent agent. The scope doc recommends a `doctor` entry point to replace it. #14 does not mention this.

---

## 6. How you will know the spike is done

- Three facts recorded in `docs/profile-router-contract.md` in the existing table's voice, each naming the OpenCode version it was read against and each falsifiable by someone repeating your check.
- A one-paragraph recommendation on §7 Q1: versioned package, or packaged-but-git-ref.
- No change to `templates/`, `install/`, or `tests/` beyond a possible extension of `host-fact-config-identity.test.mjs`.
- A PR, and a comment on #14 recording the facts. Do not close #14 — the TUI menu half is untouched and out of scope.

---

## 7. Loose ends you may pick up, and why they are not the task

- **Two merged remote branches** — `origin/docs/p1-proposal-and-packaging-scope` and `origin/perf/issue-16-p1-verifier-budget`. Both merged via #58, both safe to delete on GitHub. Housekeeping.
- **The three failing installer assertions** (§1). Small, and it intersects your work. Reasonable to do first.
- **The `edits` mechanism in `tests/bench/lib/variants.mjs` has no test**, flagged in the derivation doc §6.5 and again in the P1 proposal §4d. Three cases cover it — anchor missing, anchor duplicated, mixed line endings. It is the fail-closed property that stands between a drive-by reword of a pinned prompt and a silently mispatched experimental arm, and today only hand probes guarantee it. Worth doing, unrelated to #14.
- **#16 P5–P7** remain open and low priority. #17 and #29 were set aside indefinitely on #32. Do not pick these up over #14.

---

## 8. One thing to be careful about

This repository's documents argue with themselves on purpose — `docs/issue-53-phase1-trigger-derivation.md` opens with a correction retracting its own §0, and the P1 proposal retracts its own §5. That is the house style and it is load-bearing: when you find that something here is wrong, the expected move is to say so in place, in the document, with the evidence, rather than to quietly rewrite it. Two of the most useful results in this repo came from someone objecting to their own previous comment.
