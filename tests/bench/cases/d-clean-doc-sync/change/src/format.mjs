// Formats a duration for display.

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) {
    const shown = (ms / 1000).toFixed(1);
    // 59999 ms rounds to "60.0", which belongs in the minute row rather than
    // printing a duration of sixty seconds; fall through to the minute branch.
    if (shown !== "60.0") return `${shown}s`;
  }
  let minutes = Math.floor(ms / 60000);
  let seconds = Math.round((ms % 60000) / 1000);
  // The same rounding carries at every minute boundary: 119999 ms is 2m.
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}
