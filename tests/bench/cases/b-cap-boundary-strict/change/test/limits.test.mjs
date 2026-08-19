import assert from "node:assert/strict";
import { test } from "node:test";

import { roomFor, withinCap } from "../src/limits.mjs";

test("withinCap treats a non-positive cap as unlimited", () => {
  assert.equal(withinCap(100, 0), true);
  assert.equal(withinCap(100, -1), true);
});

test("withinCap still enforces a positive cap", () => {
  assert.equal(withinCap(5, 10), true);
  assert.equal(withinCap(20, 10), false);
});

test("roomFor allows an item with space to spare", () => {
  assert.equal(roomFor(2, 3, 10), true);
});
