# statusd log helpers

Line-oriented helpers for the daemon's status log. The daemon writes one entry
per line; the CLI's `status` command, the crash reporter and the support bundle
all read through these helpers rather than splitting the text themselves.

| helper | purpose |
|---|---|
| `headLines(text, n)` | first `n` lines; a negative `n` yields `""` |
| `tailLines(text, n)` | last `n` lines |
| `parseLevel(line)` | the bracketed level, or `null` |
| `filterByLevel(text, min)` | entries at or above a level |
| `redactSecrets(text)` | strip token, password and api-key values |
| `formatEntry(level, msg, at)` | render one entry |
| `countByLevel(text)` | tally entries per level |

Run the tests with `node --test`.
