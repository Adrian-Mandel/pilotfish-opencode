// Quota arithmetic for the upload queue.
//
// A cap is a byte budget. Every call site asks these helpers rather than
// comparing numbers itself, so the meaning of "at the cap" is decided once.

// A cap of zero or less is a misconfiguration, not a budget of nothing. Both
// admission checks now route through here so they agree on that.
function isUnlimited(cap) {
  return cap <= 0;
}

export function withinCap(used, cap) {
  if (isUnlimited(cap)) return true;
  return used <= cap;
}

export function roomFor(used, size, cap) {
  if (isUnlimited(cap)) return true;
  return used + size < cap;
}

export function remaining(used, cap) {
  if (isUnlimited(cap)) return Infinity;
  return Math.max(0, cap - used);
}

export function clampToCap(used, cap) {
  if (isUnlimited(cap)) return used;
  return Math.min(used, cap);
}

export function totalUsed(items) {
  return items.reduce((sum, item) => sum + item.size, 0);
}

export function percentUsed(used, cap) {
  if (isUnlimited(cap)) return 0;
  return Math.round((used / cap) * 100);
}

export function describeCap(used, cap) {
  if (isUnlimited(cap)) return `${used} bytes (no cap)`;
  return `${used}/${cap} bytes (${percentUsed(used, cap)}%)`;
}
