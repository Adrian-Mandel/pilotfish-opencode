import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultOptions, withOverrides } from "../src/defaults.mjs";

test("defaultOptions returns the defaults", () => {
  assert.deepEqual(defaultOptions(), { retries: 3, tags: ["core"] });
});

test("withOverrides replaces fields the user sets", () => {
  assert.equal(withOverrides({ retries: 5 }).retries, 5);
});
