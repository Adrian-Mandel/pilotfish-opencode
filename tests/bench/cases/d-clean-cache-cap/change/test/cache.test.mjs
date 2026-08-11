import assert from "node:assert/strict";
import { test } from "node:test";

import { Cache } from "../src/cache.mjs";

test("stores and returns a value", () => {
  const cache = new Cache();
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});

test("reports its size", () => {
  const cache = new Cache();
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.size, 2);
});

test("never grows past maxEntries", () => {
  const cache = new Cache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), undefined);
});

test("evicts the least recently used key, and get() counts as a use", () => {
  const cache = new Cache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), 3);
});

test("overwriting a key does not grow the cache", () => {
  const cache = new Cache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("a", 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("a"), 2);
});

test("rejects a nonsensical bound", () => {
  assert.throws(() => new Cache({ maxEntries: 0 }), RangeError);
});
