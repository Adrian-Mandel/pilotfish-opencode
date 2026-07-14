# Releasing

Pilotfish for OpenCode starts a new experimental version line at `0.0.1`.

## Checklist

1. Update `VERSION`.
2. Add a matching entry at the top of `CHANGELOG.md`.
3. Confirm the installer reads the version from `VERSION`; do not add independent version stamps to prompts.
4. Validate JSON syntax for `templates/opencode.base.jsonc` and both preset fragments.
5. Resolve the base plus each preset with the current supported OpenCode release.
6. Inspect all seven agents with `opencode debug agent <name>`.
7. Confirm the required model IDs and variants still appear in `opencode models --verbose`.
8. Exercise fresh install, repeated install, update with customization, and uninstall restoration.
9. Follow `docs/upstream-sync.md`, review through current `upstream/main`, and update `UPSTREAM_VERSION`.
10. Verify active documentation contains no Claude installation paths or removed files.
11. Review the release diff, commit, tag, and publish.

```bash
git tag vX.Y.Z
git push
git push --tags
gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
```

## Compatibility Notes

Record the tested OpenCode version in every release entry. If a provider changes a model ID or variant, update the affected preset and treat that as a user-visible compatibility change.

Prompt files under `templates/pilotfish/prompts/` and agent definitions in `templates/opencode.base.jsonc` are the sources of truth. Do not validate releases against a maintainer's installed files without first checking for local customization.
