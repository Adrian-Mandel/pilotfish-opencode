# Releasing

Pilotfish for OpenCode starts a new experimental version line at `0.0.1`.

## Checklist

1. Update `VERSION`.
2. Add a matching entry at the top of `CHANGELOG.md`.
3. Confirm the installer reads the version from `VERSION`; do not add independent version stamps to prompts.
4. Run `python3 -m unittest discover -s tests -v`, `node --test tests/profile-router.test.mjs`, and `git diff --check`.
5. Validate JSON syntax for `templates/opencode.base.jsonc`, both preset fragments, and `templates/pilotfish/profiles.json`.
6. Resolve the base plus each preset with the current supported OpenCode release.
7. Inspect all nine public agents with `opencode debug agent <name>`.
8. Confirm the required model IDs and variants still appear in `opencode models --verbose`.
9. Exercise fresh install, repeated install, update with customization, and uninstall restoration.
10. Follow `docs/upstream-sync.md`, review through current `upstream/main`, and update `UPSTREAM_VERSION`.
11. Review `docs/upstream-deviations.md`; every current difference must be represented, and no row may have `Pending` in Source at release.
12. Verify active documentation contains no Claude installation paths or removed files.
13. Run the Node router tests: `node --test tests/profile-router.test.mjs` must prove exact profile data, default-only export, clone count/mappings, same-session rejection, unsupported/cross-preset rejection, post-authorization `session.created` binding, exact marked-child and resumed-task authorization, atomic expiry races, awaited bound-title cleanup on expiry/deletion/disposal, update-failure revocation without unhandled rejection, and AntiGravity passthrough.
14. Run the mandatory isolated smoke in an isolated/neutral OpenCode context with `OPENCODE_DISABLE_PROJECT_CONFIG=1`; do not write global configuration. It must prove plugin loading, the exact router plugin tuple and runtime hashes, public primary model/variant unchanged, 24 hidden ChatGPT clones or no AntiGravity clones, and the foreground host sequence `tool.execute.before` → `session.created` → child chat → `tool.execute.after`. Before must add a transient marker and leave authorization unbound; the synchronous created event must bind the exact post-authorization child ID and clean title, and child chat must reject if it races ahead. Only that bound child may start, its title must be clean before provider execution, and after must restore mutable description/result values and clear authorization. OpenCode may retain the digest in raw tool-input history; verify it contains no prompt or credential data. A pre-existing sibling retitled to the marker must reject, two concurrent same-role calls must each accept their own child, and stale authorization must expire after 30 seconds even when Task throws and after is skipped. For a bound child in that failure path, expiry must restore the still-marked title before removing authorization; if a forced host update fails, authorization must still revoke without an unhandled rejection, although manual child-title cleanup may be required. Exercise timer races with child chat and after, and confirm parent deletion and plugin disposal perform equivalent best-effort restoration. A resumed Task must validate and accept only its exact `task_id` without marker mutation or marker restoration. It must also prove unsupported routing fails before assistant/provider execution with no assistant/provider execution. Capture `--print-logs` to verify the exact router reason when OpenCode's standard JSON output reports only `Unexpected server error`. Confirm CLI selection of an internal hidden name does not execute that clone, while allowing for OpenCode's documented fallback to its default primary. The smoke must restart OpenCode, resume a prior Pilotfish session with a different primary model, and prove persisted-history recovery rejects that cross-process resume before assistant/provider execution. Experimental background Task timing is unsupported and must not replace this foreground smoke.
15. Run the mandatory authenticated ChatGPT provider smoke only with the exact approved models. Dispatch one bounded Luna/low task, allow at most five minutes (a five-minute maximum), and use no retries. If credentials or model prerequisites are unavailable, block the release: the release is blocked; do not claim the gate passed.
16. Run the mandatory authenticated AntiGravity provider smoke with its exact approved credentials, models, and variants. If credentials or model prerequisites are unavailable, block the release: the release is blocked; do not claim the gate passed.
17. Confirm smoke and provider gates make no global writes and never mutate global `model` or `default_agent`.
18. Review the release diff, commit, tag, and publish.

```bash
git tag vX.Y.Z
git push
git push --tags
gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
```

## Compatibility Notes

Record the tested OpenCode version in every release entry. If a provider changes a model ID or variant, update the affected preset and treat that as a user-visible compatibility change.

Prompt files under `templates/pilotfish/prompts/`, public agent definitions in `templates/opencode.base.jsonc`, and the required `profile-router.mjs` and `profiles.json` runtime artifacts are the sources of truth. Do not validate releases against a maintainer's installed files without first checking for local customization.
