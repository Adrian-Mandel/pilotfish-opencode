# sync agent path helpers

Every file the agent touches must live under a configured root. `src/paths.mjs`
is the only place that assembles or tests a path, so the containment rule is
stated once.

| helper | purpose |
|---|---|
| `joinUnderRoot(root, rel)` | join a relative path onto the root, rejecting escapes |
| `isUnderRoot(root, path)` | is this path inside the root? |
| `relativeTo(root, path)` | the path below the root, or `null` |
| `splitSegments(path)` | non-empty path segments |
| `ensureExtension(path, ext)` | append an extension if missing |
| `isHidden(path)` | does any segment start with a dot? |
| `depthUnder(root, path)` | segment count below the root, or `-1` |

Run the tests with `node --test`.
