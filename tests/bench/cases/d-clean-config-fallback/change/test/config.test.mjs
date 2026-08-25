import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readConfig, DEFAULTS } from "../src/config.mjs";

function fixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), "app-config-"));
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  return path;
}

function emptyDir() {
  return mkdtempSync(join(tmpdir(), "app-config-"));
}

test("merges the file over the defaults", () => {
  const path = fixture(JSON.stringify({ retries: 7 }));
  assert.deepEqual(readConfig(path), { retries: 7, timeoutMs: 5000 });
});

test("an empty object yields the defaults", () => {
  const path = fixture("{}");
  assert.deepEqual(readConfig(path), { retries: 3, timeoutMs: 5000 });
});

test("an absent file yields the defaults", () => {
  const path = join(emptyDir(), "does-not-exist.json");
  assert.deepEqual(readConfig(path), { retries: 3, timeoutMs: 5000 });
});

test("the defaults returned for an absent file are a fresh object", () => {
  const path = join(emptyDir(), "does-not-exist.json");
  const first = readConfig(path);
  first.retries = 99;
  assert.equal(readConfig(path).retries, 3);
  assert.equal(DEFAULTS.retries, 3);
});

test("a read error that is not ENOENT is rethrown, not answered with defaults", () => {
  const path = emptyDir();
  assert.throws(() => readConfig(path), (error) => error.code !== "ENOENT");
});

test("a present but malformed file still throws", () => {
  const path = fixture("{ not json");
  assert.throws(() => readConfig(path), SyntaxError);
});
