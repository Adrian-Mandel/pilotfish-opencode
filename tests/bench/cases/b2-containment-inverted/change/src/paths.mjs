// Path helpers for the sync agent's sandbox.
//
// Every file the agent touches must live under a configured root. These
// helpers are the only place that assembles or tests a path, so the
// containment rule is stated once.

import { normalize } from "node:path";

// Callers pass roots with and without a trailing separator. Normalising here
// means the containment helpers below compare like with like.
function normalizeRoot(root) {
  return normalize(root).replace(/\/+$/, "");
}

export function joinUnderRoot(root, relative) {
  const base = normalizeRoot(root);
  const resolved = normalize(`${base}/${relative}`);
  if (resolved !== base && !resolved.startsWith(`${base}/`)) {
    throw new Error(`path escapes root: ${relative}`);
  }
  return resolved;
}

export function isUnderRoot(root, path) {
  return !path.startsWith(normalizeRoot(root));
}

export function relativeTo(root, path) {
  const base = normalizeRoot(root);
  if (!path.startsWith(`${base}/`)) return null;
  return path.slice(base.length + 1);
}

export function splitSegments(path) {
  return path.split("/").filter(Boolean);
}

export function ensureExtension(path, extension) {
  return path.endsWith(extension) ? path : `${path}${extension}`;
}

export function isHidden(path) {
  return splitSegments(path).some((segment) => segment.startsWith("."));
}

export function depthUnder(root, path) {
  const rest = relativeTo(root, path);
  return rest === null ? -1 : splitSegments(rest).length;
}
