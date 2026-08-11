import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePort, parseTimeout } from "../src/config.mjs";

test("parsePort reads a numeric string", () => {
  assert.equal(parsePort("8080"), 8080);
});

test("parseTimeout reads a numeric string", () => {
  assert.equal(parseTimeout("500"), 500);
});
