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

test("rejects a parent-directory escape", () => {
  assert.throws(() => assetPath("/srv/app", "../secret"), /escapes root/);
  assert.throws(() => assetPath("/srv/app", "img/../../secret"), /escapes root/);
});

test("rejects an absolute name", () => {
  assert.throws(() => assetPath("/srv/app", "/etc/passwd"), /escapes root/);
});

test("rejects a sibling that shares the root's prefix", () => {
  assert.throws(() => assetPath("/srv/app", "../app-private/key"), /escapes root/);
});

test("rejects the root itself", () => {
  assert.throws(() => assetPath("/srv/app", ""), /escapes root/);
  assert.throws(() => assetPath("/srv/app", "."), /escapes root/);
});

test("a name containing dots but not escaping is allowed", () => {
  assert.equal(assetPath("/srv/app", "a..b.png"), resolve("/srv/app", "a..b.png"));
  assert.equal(assetPath("/srv/app", "img/../logo.png"), resolve("/srv/app", "logo.png"));
});
