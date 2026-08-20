// Parsing and merging for the agent's runtime configuration.
//
// Values arrive as strings from three places — the environment, the CLI, and
// the on-disk config file — so every field has a parser here and nothing
// downstream calls Number() or compares strings itself.

const TRUE_WORDS = new Set(["1", "true", "on"]);
const FALSE_WORDS = new Set(["0", "false", "off"]);

export function parsePort(value) {
  return Number(value);
}

export function parseTimeout(value) {
  return Number(value);
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
