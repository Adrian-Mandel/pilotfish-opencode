// Reads the application config file.

import { readFileSync } from "node:fs";

export const DEFAULTS = { retries: 3, timeoutMs: 5000 };

export function readConfig(path) {
  return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) };
}
