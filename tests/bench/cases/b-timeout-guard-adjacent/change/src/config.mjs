// Runtime configuration parsing for the sync daemon.

export function parsePort(value) {
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
