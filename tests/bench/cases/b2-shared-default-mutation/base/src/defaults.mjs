// Option defaults for the export job runner.
//
// A job's options are the defaults with the caller's overrides layered on top.
// Every caller goes through this module rather than spelling the defaults out,
// so a new default reaches every job at once.

const KNOWN_KEYS = ["retries", "tags", "timeout"];

export function defaultOptions() {
  return { retries: 3, tags: ["core"] };
}

export function withOverrides(user) {
  return { ...defaultOptions(), ...user };
}

export function optionKeys() {
  return [...KNOWN_KEYS];
}

export function validateOptions(options) {
  for (const key of Object.keys(options)) {
    if (!KNOWN_KEYS.includes(key)) throw new RangeError(`unknown option: ${key}`);
  }
  return options;
}

export function describeOptions(options) {
  return optionKeys()
    .filter((key) => options[key] !== undefined)
    .map((key) => `${key}=${JSON.stringify(options[key])}`)
    .join(" ");
}
