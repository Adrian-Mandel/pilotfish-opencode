// Runtime configuration parsing for the sync daemon.

export function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65536) {
    throw new RangeError(`port out of range: ${value}`);
  }
  return port;
}

export function parseTimeout(value) {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 0) {
    throw new RangeError(`timeout out of range: ${value}`);
  }
  return ms;
}
