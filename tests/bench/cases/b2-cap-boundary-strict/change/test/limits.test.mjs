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

test("withinCap treats a cap of zero or less as unlimited", () => {
  assert.equal(withinCap(999, 0), true);
  assert.equal(withinCap(999, -1), true);
});

test("remaining never goes negative, and is unbounded with no cap", () => {
  assert.equal(remaining(12, 10), 0);
  assert.equal(remaining(4, 10), 6);
  assert.equal(remaining(4, 0), Infinity);
});

test("clampToCap caps the reported usage", () => {
  assert.equal(clampToCap(12, 10), 10);
  assert.equal(clampToCap(12, 0), 12);
});

test("totalUsed sums item sizes", () => {
  assert.equal(totalUsed([{ size: 3 }, { size: 4 }]), 7);
});

test("percentUsed rounds to whole percent", () => {
  assert.equal(percentUsed(1, 3), 33);
  assert.equal(percentUsed(1, 0), 0);
});

test("describeCap renders usage and percentage", () => {
  assert.equal(describeCap(5, 10), "5/10 bytes (50%)");
  assert.equal(describeCap(5, 0), "5 bytes (no cap)");
});
