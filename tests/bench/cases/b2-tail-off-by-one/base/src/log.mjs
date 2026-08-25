// Slicing and formatting helpers for the daemon's status log.
//
// The daemon writes one entry per line. Everything downstream — the CLI's
// `status` command, the crash reporter, the support bundle — reads through
// these helpers rather than splitting the text itself, so the line handling
// stays in one place.

const LEVELS = ["debug", "info", "warn", "error"];

const SECRET_PATTERNS = [
  /(?<=token=)[A-Za-z0-9._-]+/g,
  /(?<=password=)\S+/g,
  /(?<=authorization: bearer )\S+/gi,
];

export function headLines(text, n) {
  return text.split("\n").slice(0, n).join("\n");
}

export function tailLines(text, n) {
  const lines = text.split("\n");
  return lines.slice(lines.length - n).join("\n");
}

export function parseLevel(line) {
  const match = /^\[(\w+)\]/.exec(line);
  if (!match) return null;
  const lvl = match[1].toLowerCase();
  return LEVELS.includes(lvl) ? lvl : null;
}

export function filterByLevel(text, minimum) {
  const floor = LEVELS.indexOf(minimum);
  if (floor < 0) throw new RangeError(`unknown level: ${minimum}`);
  return text
    .split("\n")
    .filter((line) => {
      const lvl = parseLevel(line);
      return lvl !== null && LEVELS.indexOf(lvl) >= floor;
    })
    .join("\n");
}

export function redactSecrets(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function formatEntry(level, message, at) {
  return `[${level}] ${at.toISOString()} ${message}`;
}

export function countByLevel(text) {
  const counts = Object.fromEntries(LEVELS.map((name) => [name, 0]));
  for (const line of text.split("\n")) {
    const lvl = parseLevel(line);
    if (lvl) counts[lvl] += 1;
  }
  return counts;
}
