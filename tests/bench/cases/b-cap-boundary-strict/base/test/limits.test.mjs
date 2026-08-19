import assert from "node:assert/strict";
import { test } from "node:test";

import { roomFor, withinCap } from "../src/limits.mjs";

test("withinCap allows a size at or under the cap", () => {
  assert.equal(withinCap(10, 10), true);
  assert.equal(withinCap(11, 10), false);
});

test("roomFor allows an item that exactly fills the remaining cap", () => {
  assert.equal(roomFor(2, 8, 10), true);
});
