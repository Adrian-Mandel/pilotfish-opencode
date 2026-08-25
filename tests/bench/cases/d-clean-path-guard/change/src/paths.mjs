// Resolve an asset path inside the bundle root.
//
// Containment is decided on the resolved pair via `relative`, which is the
// only form that is correct for all three escapes at once: a `..` segment, an
// absolute name that ignores the root entirely, and a sibling directory that
// merely shares the root's prefix -- "/srv/app-private" is not inside
// "/srv/app", though a plain prefix test says it is.

import { isAbsolute, relative, resolve, sep } from "node:path";

export function assetPath(root, name) {
  const base = resolve(root);
  const target = resolve(base, name);
  const rel = relative(base, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`asset escapes root: ${name}`);
  }
  return target;
}
