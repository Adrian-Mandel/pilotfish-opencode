// Size-cap checks for the on-disk cache.

export function withinCap(size, cap) {
  if (cap <= 0) return true;
  return size <= cap;
}

export function roomFor(used, size, cap) {
  return used + size < cap;
}
