// Summarizes a transfer manifest.

import { parseBytes } from "./bytes.mjs";

export function totalBytes(manifest) {
  return manifest.reduce((sum, entry) => sum + parseBytes(entry.size), 0);
}
