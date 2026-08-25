# sync agent config store

Profiles live as JSON files in one directory. Nothing outside `src/store.mjs`
reads or writes them, so the file layout and the failure rules live there.

| helper | purpose |
|---|---|
| `readConfig(path)` | parse a config; a missing file is `{}` |
| `writeConfig(path, data)` | write a config as pretty JSON |
| `backupConfig(path)` | copy to `<path>.bak`, or `null` |
| `listProfiles(dir)` | sorted profile names |
| `deleteProfile(dir, name)` | remove one, reporting whether it existed |
| `describeProfiles(dir)` | a one-line summary |

Run the tests with `node --test`.
