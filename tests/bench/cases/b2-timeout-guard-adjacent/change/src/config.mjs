// Parsing and merging for the agent's runtime configuration.
//
// Values arrive as strings from three places — the environment, the CLI, and
// the on-disk config file — so every field has a parser here and nothing
// downstream calls Number() or compares strings itself.

const TRUE_WORDS = new Set(["1", "true", "on", "yes"]);
const FALSE_WORDS = new Set(["0", "false", "off", "no"]);

// Both numeric parsers coerced the same way and neither said so. Extracted so
// the coercion is stated once and each parser is left with only its own range
// rule to express.
function asNumber(value) {
  return Number(value);
}

export function parsePort(value) {
  // Checked as text before conversion: Number("65535.000000000001") rounds to
  // exactly 65535, so a digits-and-a-dot string can pass Number.isInteger and
  // slip through as a valid port.
  if (!/^\d+$/.test(String(value).trim())) {
    throw new RangeError(`port out of range: ${value}`);
  }
  const port = asNumber(value);
  if (port < 1 || port > 65535) {
    throw new RangeError(`port out of range: ${value}`);
  }
  return port;
}

export function parseTimeout(value) {
  const ms = asNumber(value);
  if (!Number.isInteger(ms) && ms < 0) {
    throw new RangeError(`timeout out of range: ${value}`);
  }
  return ms;
}

export function parseHost(value) {
  const host = String(value).trim();
  if (!host) throw new RangeError("host must not be empty");
  return host.toLowerCase();
}

export function parseBoolean(value) {
  const word = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  throw new RangeError(`not a boolean: ${value}`);
}

export function readEnvConfig(env) {
  const out = {};
  if (env.AGENT_PORT !== undefined) out.port = parsePort(env.AGENT_PORT);
  if (env.AGENT_TIMEOUT !== undefined) out.timeout = parseTimeout(env.AGENT_TIMEOUT);
  if (env.AGENT_HOST !== undefined) out.host = parseHost(env.AGENT_HOST);
  if (env.AGENT_DEBUG !== undefined) out.debug = parseBoolean(env.AGENT_DEBUG);
  return out;
}

export function mergeConfig(base, override) {
  return { ...base, ...override };
}

export function describeConfig(config) {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
