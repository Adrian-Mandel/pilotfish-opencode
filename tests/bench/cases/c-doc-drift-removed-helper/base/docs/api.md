# Public API

## `parseBytes(text)`

Parses a human-readable size such as `"12 MiB"` into a whole number of bytes.
Throws `TypeError` on an unparseable string or an unknown unit.

## `formatBytes(bytes)`

Formats a byte count into the largest unit that keeps the value at or above 1,
rounded to one decimal place. `formatBytes(1536)` returns `"1.5 KiB"`.

## `totalBytes(manifest)`

Sums the `size` field of every manifest entry, in bytes.
