import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDuration } from "../src/format.mjs";

test("renders milliseconds below a second", () => {
  assert.equal(formatDuration(250), "250ms");
  assert.equal(formatDuration(999), "999ms");
});

test("renders seconds at a second and above", () => {
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(1500), "1.5s");
});
