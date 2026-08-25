import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readConfig } from "../src/config.mjs";

function fixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), "app-config-"));
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  return path;
}

test("merges the file over the defaults", () => {
  const path = fixture(JSON.stringify({ retries: 7 }));
  assert.deepEqual(readConfig(path), { retries: 7, timeoutMs: 5000 });
});

test("an empty object yields the defaults", () => {
  const path = fixture("{}");
  assert.deepEqual(readConfig(path), { retries: 3, timeoutMs: 5000 });
});
