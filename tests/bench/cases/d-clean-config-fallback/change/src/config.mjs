// Reads the application config file.
//
// A missing file is the one read error with a defined answer -- an unconfigured
// install is expected, and its answer is the defaults. Every other errno means
// the file exists and could not be read (a directory, a permission failure, an
// I/O error), which is not the same situation and must not be silently
// answered with defaults. Only the read is guarded; parsing stays outside, so
// a present-but-malformed file still throws rather than being mistaken for an
// absent one.

import { readFileSync } from "node:fs";

export const DEFAULTS = { retries: 3, timeoutMs: 5000 };

export function readConfig(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULTS };
    throw error;
  }
  return { ...DEFAULTS, ...JSON.parse(text) };
}
