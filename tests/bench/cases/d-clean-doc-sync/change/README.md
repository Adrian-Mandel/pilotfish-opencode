# duration-format

Formats a duration for display.

| range | format | example |
|---|---|---|
| under 1000 ms | `<n>ms` | `250ms` |
| 1000 ms up to a minute | `<n.n>s` | `1.5s` |
| a minute and above | `<n>m` or `<n>m<n>s` | `1m`, `1m30s` |

A duration that rounds up to a whole minute is shown in the minute row, so
59999 ms is `1m` rather than `60.0s`.

Run the tests with `node --test`.
