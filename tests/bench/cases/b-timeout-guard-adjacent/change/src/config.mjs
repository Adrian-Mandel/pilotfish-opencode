// Runtime configuration parsing for the sync daemon.

export function parsePort(value) {
  // Only a number or a string is a port. Anything else stringifies to
  // something that can still look numeric -- `String([80])` is "80" -- so the
  // type is checked before the text is.
  if (typeof value !== "number" && typeof value !== "string") {
    // No interpolation here: `${symbol}` throws a TypeError of its own, which
    // would escape this function as the wrong error type.
    throw new RangeError("port must be a number or a numeric string");
  }
  // Checked as text before conversion: Number("65535.000000000001") rounds to
  // exactly 65535, so a digits-and-a-dot string can pass Number.isInteger and
  // slip through as a valid port.
  if (!/^\d+$/.test(String(value).trim())) {
    throw new RangeError(`port out of range: ${value}`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new RangeError(`port out of range: ${value}`);
  }
  return port;
}

export function parseTimeout(value) {
  const ms = Number(value);
  if (!Number.isInteger(ms) && ms < 0) {
    throw new RangeError(`timeout out of range: ${value}`);
  }
  return ms;
}
