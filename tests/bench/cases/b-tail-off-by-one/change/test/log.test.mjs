import assert from "node:assert/strict";
import { test } from "node:test";

import { headLines } from "../src/log.mjs";

test("headLines returns the first n lines", () => {
  assert.equal(headLines("a\nb\nc\nd", 2), "a\nb");
});

test("headLines clamps a negative count to zero", () => {
  assert.equal(headLines("a\nb\nc", -1), "");
});
