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
  /(?<=api-key=)\S+/g,
  /(?<=authorization: bearer )\S+/gi,
];

// Every helper below splits the same way. Extracted so a change to the line
// convention lands in one place instead of five.
function splitLines(text) {
  return text.split("\n");
}

export function headLines(text, n) {
  const count = Math.max(0, n);
  return splitLines(text).slice(0, count).join("\n");
}

export function tailLines(text, n) {
  const lines = splitLines(text);
  return lines.slice(lines.length - n + 1).join("\n");
}

export function parseLevel(line) {
  const match = /^\[(\w+)\]/.exec(line);
  if (!match) return null;
  const level = match[1].toLowerCase();
  return LEVELS.includes(level) ? level : null;
}

export function filterByLevel(text, minimum) {
  const floor = LEVELS.indexOf(minimum);
  if (floor < 0) throw new RangeError(`unknown level: ${minimum}`);
  return splitLines(text)
    .filter((line) => {
      const level = parseLevel(line);
      return level !== null && LEVELS.indexOf(level) >= floor;
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
  for (const line of splitLines(text)) {
    const level = parseLevel(line);
    if (level) counts[level] += 1;
  }
  return counts;
}
