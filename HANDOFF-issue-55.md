# Handoff: implement issue #55 — UNMET-CAPABILITY signal for closed-default MCP

**Repo:** `pilotfish-opencode` (this checkout). **Branch:** `main`, clean, up to date with origin.
**Task:** https://github.com/Adrian-Mandel/pilotfish-opencode/issues/55
**Why this one:** it's the highest-value task that is genuinely undone *and* self-contained. See "Why not the others" at the bottom.

---

## 1. What just happened (so you're not confused by the repo state)

The previous session closed #53 (verifier gate experiment) and posted the viability verdict on #32: **continue at full scope** — a small local verifier is not measurably less safe than the frontier and is a better detector once the prompt lets it refute. Most of #16 (P1–P4) already shipped in v0.2.0. Nothing here is blocked on any of that; #55 is independent.

You do **not** need to run the benchmark or touch the router for this task.

---

## 2. The task (read #55 in full first)

Pilotfish workers get **no MCP access by default** (closed scope, shipped in #54/#28 — a 44-tool server is ~13,748 tokens re-sent every worker step). The install ships an audit (`mcp-audit.mjs`, embedded in `docs/token-budget.md`) that reports, per role, which MCP tools a role *used* and its prefix cost. The missing third piece: **what a locked-down role needed but couldn't do**. A closed worker stalls, reports in prose, the orchestrator covers it — and nothing records it, so "start closed, grant as needed" has no data for the "as needed" half.

**The design (from #55 — do not redesign it):** don't make the worker name the *tool* (that needs the schema in context, defeating the closed default). Make it name the *need* in prose behind a greppable marker:

```
UNMET-CAPABILITY: needed to read GitHub issue #53 to verify the claim cites it correctly
```

Zero new prefix, structured enough to grep, degrades gracefully (a weak model forgetting it just means "no worse than today").

### Scope (the four checkboxes on #55)

1. **Add the `UNMET-CAPABILITY:` convention to the worker prompt(s).** At minimum the roles that observe MCP need — `verifier` and `executor`. Decide, and state in your PR, whether it also belongs on the other write/bash-capable workers (`mech-executor`, `security-executor`) — the read-only recon roles (`scout`, `Explore`, `plan-verifier`, `security-reviewer`) matter less but use judgment. **There is no shared preamble file** — prompts are standalone under `templates/pilotfish/prompts/*.md`, so add the line to each file you choose.
   - `verifier.md` already carries the instinct this formalizes (line ~7: *"report that the comparison is unavailable and say why"*). Phrase the new line to fit that voice, not bolt onto it.
2. **Extend `mcp-audit.mjs`** (embedded as a code block in `docs/token-budget.md`, starts ~line 201) to grep session text for `UNMET-CAPABILITY:` lines and tally them per role, alongside the existing used-tools + prefix report. The script reads `~/.local/share/opencode/opencode.db` (the `part` table holds text parts; `session.agent` is the role) and writes nothing. Match the existing style.
3. **Document the read** in `docs/token-budget.md`: absence of markers means "no demand observed," not "no demand"; prose→tool is a human decision; **never auto-grant**.
4. **Note the prefix cost** of the added prompt line itself (a handful of tokens) so the fix doesn't silently violate the budget it serves.

### Non-goals (explicit on #55 — don't do these)
- No auto-granting. No tool-listing meta-tool for workers (re-incurs schema cost). Not trying to capture low-frequency needs (those correctly stay with the orchestrator).

---

## 3. How to verify

- **Audit script:** it's greppable data work — you can test it against the real `~/.local/share/opencode/opencode.db` (read-only). To prove the tally works without waiting for real markers, hand-insert a fixture: create a throwaway session row + a part containing `UNMET-CAPABILITY: test` in a **temp copy** of the DB (never mutate the real one), point the script at the copy, confirm it tallies. Or unit-test the grep/tally function on sample text.
- **Prompt line:** measure its token cost (`node -e` with a tokenizer, or just note the word count → ~tokens) for checkbox 4.
- **Degradation:** confirm the audit still runs and reports correctly when there are zero `UNMET-CAPABILITY:` lines (the common case today).
- This task has **no benchmark run** and needs **no gpt/local inference** — it's prompt text + a grep script + docs. If you think you need to run the bench, you've over-scoped.

---

## 4. Hard constraints this project has already paid for — do not re-pay

- **No push access from the session.** Commit to `main` locally (this project commits results to `main`; the owner pushes). Never attempt `git push`. When done: commit, then tell the owner to push. If a file is under a `.gitignore` (e.g. `tests/bench/results/`), use `git add -f` — but #55 shouldn't touch those.
- **The installed Pilotfish differs from this repo.** `~/.config/opencode/pilotfish/` has a customized `profiles.json` (a `local`/bambi preset that exists nowhere in the repo) and a no-preset plugin line. **Never overwrite those.** For #55 you're editing repo `templates/` only — you do **not** need to reinstall. But if you ever test a prompt change live, remember: prompt changes are invisible until the install is updated *and* OpenCode is restarted (config/prompts load at startup).
- **Re-read any config file immediately before editing it.** The owner edits `opencode.json` and configs between turns; merge specific fields, never assign whole blocks.
- **Don't touch:** the profile router (`profile-router.mjs`), the bench harness (`tests/bench/`), or `~/.claude.json`. None are needed for #55.
- **GitHub MCP is flaky.** It authenticates via a static PAT in `~/.claude.json` → `mcpServers.github.headers.Authorization`; when that expires it fails with HTTP 401 and OAuth won't help until the header is fixed + Claude restarted. If you can't post to the issue, that's why — commit the work and tell the owner; don't spin on it.
- **Never run inference on the owner's local model servers unasked** (bambi/omlx) — not relevant to #55, but a standing rule.

---

## 5. Definition of done

- The `UNMET-CAPABILITY:` line is in the chosen worker prompts, in each prompt's own voice.
- `mcp-audit.mjs` in `docs/token-budget.md` tallies markers per role, tested (against a temp DB copy or a unit test), still correct with zero markers.
- `docs/token-budget.md` documents the read (floor-not-census, human maps prose→tool, never auto-grant) and notes the added line's prefix cost.
- Committed to `main` locally with a clear message referencing #55. Owner pushes; then (if the GitHub MCP is connected) post a short summary comment on #55, or hand the owner the summary to post.

## Why not the others (context for your judgment)
- **#16 P1–P4:** shipped in v0.2.0. Don't redo.
- **#51 (publish/tag):** high value but *not* cold-handoffable — there are already `v1.0.0`–`v1.2.0` tags (inherited from upstream) alongside `VERSION=0.2.0`, so it needs a versioning decision from the owner. Do it *with* them, not from a handoff.
- **#52 (upstream sync to v1.3.10):** large; follows `docs/upstream-sync.md`; a bigger bite than a single clean handoff.
- **#16 P5–P7:** measurement-gated tail items ("re-measure first").
