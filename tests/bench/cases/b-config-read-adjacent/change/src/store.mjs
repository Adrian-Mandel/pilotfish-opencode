// On-disk persistence for the daemon's configuration file.

import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(path, data) {
  // Write beside the target and rename: rename is atomic on the same
  // filesystem, so a crash mid-write cannot leave a half-written config.
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, path);
}
