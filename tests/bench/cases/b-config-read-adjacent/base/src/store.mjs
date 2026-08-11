// On-disk persistence for the daemon's configuration file.

import { readFileSync, writeFileSync } from "node:fs";

export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // A config that does not exist yet is an empty config. Anything else --
    // unreadable, malformed -- is a real failure and must not be hidden.
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function writeConfig(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
