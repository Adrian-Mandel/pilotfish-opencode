// Path helpers for the sync agent's sandbox.
//
// Every file the agent touches must live under a configured root. These
// helpers are the only place that assembles or tests a path, so the
// containment rule is stated once.

export function joinUnderRoot(root, relative) {
  return `${root}/${relative}`;
}

export function isUnderRoot(root, path) {
  return path.startsWith(root);
}

export function relativeTo(root, path) {
  if (!path.startsWith(`${root}/`)) return null;
  return path.slice(root.length + 1);
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
