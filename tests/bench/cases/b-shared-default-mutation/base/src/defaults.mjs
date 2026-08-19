// Default runtime options and user-override merging.

export function defaultOptions() {
  return { retries: 3, tags: ["core"] };
}

export function withOverrides(user) {
  return { ...defaultOptions(), ...user };
}
