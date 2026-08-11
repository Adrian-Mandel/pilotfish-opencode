import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePort, parseTimeout } from "../src/config.mjs";

test("parsePort reads a numeric string", () => {
  assert.equal(parsePort("8080"), 8080);
});

test("parsePort rejects zero and negative ports", () => {
  assert.throws(() => parsePort("0"), RangeError);
  assert.throws(() => parsePort("-1"), RangeError);
});

test("parsePort rejects non-integers and garbage", () => {
  assert.throws(() => parsePort("80.5"), RangeError);
  assert.throws(() => parsePort("http"), RangeError);
});

test("parseTimeout reads a numeric string", () => {
  assert.equal(parseTimeout("500"), 500);
});

test("parseTimeout rejects negative and non-integer values", () => {
  assert.throws(() => parseTimeout("-5"), RangeError);
  assert.throws(() => parseTimeout("1.5"), RangeError);
});
