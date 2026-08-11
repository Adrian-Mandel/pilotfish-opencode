// Memoization cache for resolved manifest entries.

export class Cache {
  constructor() {
    this.entries = new Map();
  }

  get(key) {
    return this.entries.get(key);
  }

  set(key, value) {
    this.entries.set(key, value);
  }

  get size() {
    return this.entries.size;
  }
}
