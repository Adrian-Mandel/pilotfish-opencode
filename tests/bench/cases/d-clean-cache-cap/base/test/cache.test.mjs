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
