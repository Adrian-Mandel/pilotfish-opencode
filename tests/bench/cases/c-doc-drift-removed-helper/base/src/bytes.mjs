// Byte-size helpers used by the transfer report.

const UNITS = ["B", "KiB", "MiB", "GiB"];

export function parseBytes(text) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMG]?i?B)$/.exec(text.trim());
  if (!match) throw new TypeError(`unparseable size: ${text}`);
  const index = UNITS.indexOf(match[2]);
  if (index < 0) throw new TypeError(`unknown unit: ${match[2]}`);
  return Math.round(Number(match[1]) * 1024 ** index);
}

export function formatBytes(bytes) {
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${Math.round(value * 10) / 10} ${UNITS[index]}`;
}
