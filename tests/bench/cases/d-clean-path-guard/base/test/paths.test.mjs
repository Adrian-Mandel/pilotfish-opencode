import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import { assetPath } from "../src/paths.mjs";

test("joins a name onto the root", () => {
  assert.equal(assetPath("/srv/app", "logo.png"), resolve("/srv/app", "logo.png"));
});

test("joins a nested name", () => {
  assert.equal(assetPath("/srv/app", "img/logo.png"), resolve("/srv/app", "img/logo.png"));
});
