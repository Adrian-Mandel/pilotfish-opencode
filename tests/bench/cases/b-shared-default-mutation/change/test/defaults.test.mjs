import assert from "node:assert/strict";
import { test } from "node:test";

import { withOverrides } from "../src/defaults.mjs";

test("withOverrides keeps default retries when only tags are given", () => {
  assert.equal(withOverrides({ tags: ["x"] }).retries, 3);
});

test("withOverrides concatenates default and user tags", () => {
  assert.deepEqual(withOverrides({ tags: ["x"] }).tags, ["core", "x"]);
});

test("withOverrides keeps the default tags for an empty override", () => {
  assert.deepEqual(withOverrides({}).tags, ["core"]);
});
