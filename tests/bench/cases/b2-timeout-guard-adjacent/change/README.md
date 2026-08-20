# agentd configuration

Every configuration value arrives as a string — from the environment, the CLI,
or the on-disk config file — so each field has a parser in `src/config.mjs` and
nothing downstream calls `Number()` or compares strings itself.

| parser | accepts |
|---|---|
| `parsePort(value)` | an integer in the valid TCP port range |
| `parseTimeout(value)` | a numeric string, in milliseconds |
| `parseHost(value)` | a non-empty host, trimmed and lowercased |
| `parseBoolean(value)` | `1`/`true`/`on`/`yes`, `0`/`false`/`off`/`no` |

`readEnvConfig(env)` reads the `AGENT_*` variables, `mergeConfig` layers an
override over a base, and `describeConfig` renders a stable one-line summary.

Run the tests with `node --test`.
