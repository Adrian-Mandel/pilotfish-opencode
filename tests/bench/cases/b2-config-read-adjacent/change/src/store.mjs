// On-disk configuration store for the sync agent.
//
// Profiles live as JSON files in one directory. Nothing outside this module
// reads or writes them, so the file layout and the failure rules live here.

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const PROFILE_SUFFIX = ".json";

// The profile path was assembled in two places with the suffix spelled out
// each time. One accessor instead, so the layout is stated once.
function profilePath(directory, name) {
  return `${directory}/${name}${PROFILE_SUFFIX}`;
}

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

export function backupConfig(path) {
  if (!existsSync(path)) return null;
  const backup = `${path}.bak`;
  writeFileSync(backup, readFileSync(path));
  return backup;
}

export function listProfiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(PROFILE_SUFFIX))
    .map((name) => name.slice(0, -PROFILE_SUFFIX.length))
    .sort();
}

export function deleteProfile(directory, name) {
  const path = profilePath(directory, name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function readProfile(directory, name) {
  return readConfig(profilePath(directory, name));
}

export function describeProfiles(directory) {
  const names = listProfiles(directory);
  return names.length ? names.join(", ") : "(none)";
}
