// Slicing helpers for the daemon's status log.

export function headLines(text, n) {
  return text.split("\n").slice(0, n).join("\n");
}

export function tailLines(text, n) {
  const lines = text.split("\n");
  return lines.slice(lines.length - n).join("\n");
}
