// On-disk configuration store for the sync agent.
//
// Profiles live as JSON files in one directory. Nothing outside this module
// reads or writes them, so the file layout and the failure rules live here.

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";

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

export function backupConfig(path) {
  if (!existsSync(path)) return null;
  const backup = `${path}.bak`;
  writeFileSync(backup, readFileSync(path));
  return backup;
}

export function listProfiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function deleteProfile(directory, name) {
  const path = `${directory}/${name}.json`;
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function describeProfiles(directory) {
  const names = listProfiles(directory);
  return names.length ? names.join(", ") : "(none)";
}
