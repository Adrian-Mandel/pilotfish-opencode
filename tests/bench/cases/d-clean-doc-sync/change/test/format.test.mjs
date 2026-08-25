import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDuration } from "../src/format.mjs";

test("renders milliseconds below a second", () => {
  assert.equal(formatDuration(250), "250ms");
  assert.equal(formatDuration(999), "999ms");
});

test("renders seconds from a second up to a minute", () => {
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(59000), "59.0s");
});

test("renders whole minutes without a seconds part", () => {
  assert.equal(formatDuration(60000), "1m");
  assert.equal(formatDuration(120000), "2m");
});

test("renders minutes with a seconds part", () => {
  assert.equal(formatDuration(90000), "1m30s");
  assert.equal(formatDuration(3600000), "60m");
});

test("a duration that rounds up to a whole minute uses the minute row", () => {
  assert.equal(formatDuration(59999), "1m");
});

test("the seconds part carries at every minute boundary", () => {
  assert.equal(formatDuration(119999), "2m");
});
