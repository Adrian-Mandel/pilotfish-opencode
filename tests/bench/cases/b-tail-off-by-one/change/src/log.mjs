// Slicing helpers for the daemon's status log.

export function headLines(text, n) {
  const count = Math.max(0, n);
  return text.split("\n").slice(0, count).join("\n");
}

export function tailLines(text, n) {
  const lines = text.split("\n");
  return lines.slice(lines.length - n + 1).join("\n");
}
