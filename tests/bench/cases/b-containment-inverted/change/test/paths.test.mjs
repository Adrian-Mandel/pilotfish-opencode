import assert from "node:assert/strict";
import { test } from "node:test";

import { joinUnderRoot } from "../src/paths.mjs";

test("joinUnderRoot joins a plain relative path under the root", () => {
  assert.equal(joinUnderRoot("/srv/data", "a/b.txt"), "/srv/data/a/b.txt");
});

test("joinUnderRoot throws on a path that resolves outside the root", () => {
  assert.throws(() => joinUnderRoot("/srv/data", "../etc/passwd"));
});
