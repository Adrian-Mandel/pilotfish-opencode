# upload queue limits

A cap is a byte budget. Every call site asks `src/limits.mjs` rather than
comparing numbers itself, so the meaning of "at the cap" is decided in one
place.

| helper | answers |
|---|---|
| `withinCap(used, cap)` | is the current usage acceptable? A cap of zero or less means no cap. |
| `roomFor(used, size, cap)` | will one more item fit? |
| `remaining(used, cap)` | how many bytes are left? |
| `clampToCap(used, cap)` | usage, never reported above the cap |
| `totalUsed(items)` | sum of item sizes |
| `percentUsed(used, cap)` | usage as a whole percentage |
| `describeCap(used, cap)` | a one-line summary |

Run the tests with `node --test`.
