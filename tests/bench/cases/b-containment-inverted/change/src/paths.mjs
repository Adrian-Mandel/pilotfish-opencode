// Path helpers that keep sync operations confined to a single root directory.

import { normalize } from "node:path";

export function joinUnderRoot(root, relative) {
  const resolved = normalize(`${root}/${relative}`);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`path escapes root: ${relative}`);
  }
  return resolved;
}

export function isUnderRoot(root, path) {
  return !path.startsWith(root);
}
