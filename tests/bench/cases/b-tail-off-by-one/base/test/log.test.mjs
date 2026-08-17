import assert from "node:assert/strict";
import { test } from "node:test";

import { headLines, tailLines } from "../src/log.mjs";

test("headLines returns the first n lines", () => {
  assert.equal(headLines("a\nb\nc\nd", 2), "a\nb");
});

test("tailLines returns the last n lines", () => {
  assert.equal(tailLines("a\nb\nc\nd", 2), "c\nd");
});
