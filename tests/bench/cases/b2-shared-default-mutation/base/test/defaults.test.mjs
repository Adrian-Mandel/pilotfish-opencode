import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultOptions,
  describeOptions,
  optionKeys,
  validateOptions,
  withOverrides,
} from "../src/defaults.mjs";

test("defaultOptions supplies the documented defaults", () => {
  assert.deepEqual(defaultOptions(), { retries: 3, tags: ["core"] });
});

test("withOverrides lets the caller win", () => {
  assert.equal(withOverrides({ retries: 9 }).retries, 9);
});

test("optionKeys lists the known keys", () => {
  assert.deepEqual(optionKeys(), ["retries", "tags", "timeout"]);
});

test("validateOptions rejects an unknown key", () => {
  assert.throws(() => validateOptions({ nope: 1 }), RangeError);
  assert.deepEqual(validateOptions({ retries: 1 }), { retries: 1 });
});

test("describeOptions renders only the keys that are set", () => {
  assert.equal(describeOptions({ retries: 2 }), "retries=2");
});
