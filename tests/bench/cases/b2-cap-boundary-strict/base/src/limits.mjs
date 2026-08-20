// Quota arithmetic for the upload queue.
//
// A cap is a byte budget. Every call site asks these helpers rather than
// comparing numbers itself, so the meaning of "at the cap" is decided once.

export function withinCap(used, cap) {
  return used <= cap;
}

export function roomFor(used, size, cap) {
  return used + size <= cap;
}

export function remaining(used, cap) {
  return Math.max(0, cap - used);
}

export function clampToCap(used, cap) {
  return Math.min(used, cap);
}

export function totalUsed(items) {
  return items.reduce((sum, item) => sum + item.size, 0);
}

export function percentUsed(used, cap) {
  if (cap === 0) return 100;
  return Math.round((used / cap) * 100);
}

export function describeCap(used, cap) {
  return `${used}/${cap} bytes (${percentUsed(used, cap)}%)`;
}
