# export job options

A job's options are the defaults with the caller's overrides layered on top.
Every caller goes through `src/defaults.mjs` rather than spelling the defaults
out, so a new default reaches every job at once.

| helper | purpose |
|---|---|
| `defaultOptions()` | the default option set |
| `withOverrides(user)` | defaults with the caller's overrides applied; tags are combined, not replaced |
| `optionKeys()` | the known option keys |
| `validateOptions(options)` | reject unknown keys and a fractional retry count |
| `describeOptions(options)` | a one-line summary of what is set |

Run the tests with `node --test`.
