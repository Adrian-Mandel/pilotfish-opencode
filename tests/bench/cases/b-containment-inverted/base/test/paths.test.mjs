import assert from "node:assert/strict";
import { test } from "node:test";

import { isUnderRoot, joinUnderRoot } from "../src/paths.mjs";

test("joinUnderRoot joins a relative path under the root", () => {
  assert.equal(joinUnderRoot("/srv/data", "a/b.txt"), "/srv/data/a/b.txt");
});

test("isUnderRoot accepts a contained path and rejects an outside one", () => {
  assert.equal(isUnderRoot("/srv/data", "/srv/data/a"), true);
  assert.equal(isUnderRoot("/srv/data", "/etc/passwd"), false);
});
