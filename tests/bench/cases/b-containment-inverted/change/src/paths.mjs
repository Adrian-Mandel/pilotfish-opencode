// Path helpers that keep sync operations confined to a single root directory.

import { normalize, resolve } from "node:path";

export function joinUnderRoot(root, relative) {
  const joined = normalize(`${root}/${relative}`);
  // Compare resolved paths so a relative root ("." or "work") is treated the
  // same way an absolute one is.
  const base = resolve(root);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const target = resolve(root, relative);
  if (target !== base && !target.startsWith(prefix)) {
    throw new Error(`path escapes root: ${relative}`);
  }
  return joined;
}

export function isUnderRoot(root, path) {
  return !path.startsWith(root);
}
