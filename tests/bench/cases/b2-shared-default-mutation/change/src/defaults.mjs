// Option defaults for the export job runner.
//
// A job's options are the defaults with the caller's overrides layered on top.
// Every caller goes through this module rather than spelling the defaults out,
// so a new default reaches every job at once.

const KNOWN_KEYS = ["retries", "tags", "timeout"];

const DEFAULTS = { retries: 3, tags: ["core"] };

// Tag layering is its own rule and read badly inline. Named so the merge
// order -- defaults first, caller's after -- is legible at the call site.
function mergeTags(base, extra) {
  return [...base, ...(extra ?? [])];
}

export function defaultOptions() {
  return DEFAULTS;
}

export function withOverrides(user) {
  const merged = { ...defaultOptions(), ...user };
  merged.tags = mergeTags(defaultOptions().tags, user?.tags);
  return merged;
}

export function optionKeys() {
  return [...KNOWN_KEYS];
}

export function validateOptions(options) {
  for (const key of Object.keys(options)) {
    if (!KNOWN_KEYS.includes(key)) throw new RangeError(`unknown option: ${key}`);
  }
  if (options.retries !== undefined && !Number.isInteger(options.retries)) {
    throw new RangeError(`retries must be a whole number: ${options.retries}`);
  }
  return options;
}

export function describeOptions(options) {
  return optionKeys()
    .filter((key) => options[key] !== undefined)
    .map((key) => `${key}=${JSON.stringify(options[key])}`)
    .join(" ");
}
