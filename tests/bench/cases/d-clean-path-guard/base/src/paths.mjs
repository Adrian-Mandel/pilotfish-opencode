// Resolve an asset path inside the bundle root.

import { join } from "node:path";

export function assetPath(root, name) {
  return join(root, name);
}
