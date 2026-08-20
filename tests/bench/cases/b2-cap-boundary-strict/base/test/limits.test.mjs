import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampToCap,
  describeCap,
  percentUsed,
  remaining,
  totalUsed,
  withinCap,
} from "../src/limits.mjs";

test("withinCap accepts a usage at or below the cap", () => {
  assert.equal(withinCap(10, 10), true);
  assert.equal(withinCap(11, 10), false);
});

test("remaining never goes negative", () => {
  assert.equal(remaining(12, 10), 0);
  assert.equal(remaining(4, 10), 6);
});

test("clampToCap caps the reported usage", () => {
  assert.equal(clampToCap(12, 10), 10);
});

test("totalUsed sums item sizes", () => {
  assert.equal(totalUsed([{ size: 3 }, { size: 4 }]), 7);
});

test("percentUsed rounds to whole percent", () => {
  assert.equal(percentUsed(1, 3), 33);
});

test("describeCap renders usage and percentage", () => {
  assert.equal(describeCap(5, 10), "5/10 bytes (50%)");
});
