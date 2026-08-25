import assert from "node:assert/strict";
import { test } from "node:test";

import {
  depthUnder,
  ensureExtension,
  isHidden,
  joinUnderRoot,
  relativeTo,
  splitSegments,
} from "../src/paths.mjs";

test("joinUnderRoot joins a plain relative path under the root", () => {
  assert.equal(joinUnderRoot("/srv/data", "a/b.txt"), "/srv/data/a/b.txt");
});

test("joinUnderRoot throws on a path that resolves outside the root", () => {
  assert.throws(() => joinUnderRoot("/srv/data", "../etc/passwd"));
});

test("joinUnderRoot tolerates a trailing separator on the root", () => {
  assert.equal(joinUnderRoot("/srv/data/", "a/b.txt"), "/srv/data/a/b.txt");
});

test("relativeTo strips the root, or reports null", () => {
  assert.equal(relativeTo("/srv/data", "/srv/data/a/b.txt"), "a/b.txt");
  assert.equal(relativeTo("/srv/data/", "/srv/data/a/b.txt"), "a/b.txt");
  assert.equal(relativeTo("/srv/data", "/etc/passwd"), null);
});

test("splitSegments drops empty segments", () => {
  assert.deepEqual(splitSegments("/a//b/"), ["a", "b"]);
});

test("ensureExtension appends only when needed", () => {
  assert.equal(ensureExtension("notes", ".md"), "notes.md");
  assert.equal(ensureExtension("notes.md", ".md"), "notes.md");
});

test("isHidden finds a dot segment anywhere in the path", () => {
  assert.equal(isHidden("/srv/data/.git/config"), true);
  assert.equal(isHidden("/srv/data/a/b.txt"), false);
});

test("depthUnder counts segments below the root", () => {
  assert.equal(depthUnder("/srv/data", "/srv/data/a/b.txt"), 2);
  assert.equal(depthUnder("/srv/data", "/etc/passwd"), -1);
});
