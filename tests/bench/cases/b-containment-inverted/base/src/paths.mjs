// Path helpers that keep sync operations confined to a single root directory.

export function joinUnderRoot(root, relative) {
  return `${root}/${relative}`;
}

export function isUnderRoot(root, path) {
  return path.startsWith(root);
}
