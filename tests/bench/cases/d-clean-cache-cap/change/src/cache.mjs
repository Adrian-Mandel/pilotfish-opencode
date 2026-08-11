// Memoization cache for resolved manifest entries.
//
// Bounded least-recently-used: Map preserves insertion order, so re-inserting
// a key on every use keeps the least recently used key first.

export class Cache {
  constructor({ maxEntries = 128 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`maxEntries must be a positive integer: ${maxEntries}`);
    }
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  get size() {
    return this.entries.size;
  }
}
