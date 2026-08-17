// Default runtime options and user-override merging.

const DEFAULTS = { retries: 3, tags: ["core"] };

export function defaultOptions() {
  return DEFAULTS;
}

export function withOverrides(user) {
  const merged = { ...defaultOptions(), ...user };
  merged.tags = [...defaultOptions().tags, ...(user.tags ?? [])];
  return merged;
}
