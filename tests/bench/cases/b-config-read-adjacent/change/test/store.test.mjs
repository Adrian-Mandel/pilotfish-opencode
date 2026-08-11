import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readConfig, writeConfig } from "../src/store.mjs";

function scratch() {
  return mkdtempSync(join(tmpdir(), "store-test-"));
}

test("writeConfig then readConfig round-trips", () => {
  const dir = scratch();
  try {
    const path = join(dir, "config.json");
    writeConfig(path, { host: "localhost", port: 8080 });
    assert.deepEqual(readConfig(path), { host: "localhost", port: 8080 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readConfig treats a missing file as empty", () => {
  const dir = scratch();
  try {
    assert.deepEqual(readConfig(join(dir, "absent.json")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeConfig leaves no temporary file behind", () => {
  const dir = scratch();
  try {
    const path = join(dir, "config.json");
    writeConfig(path, { host: "localhost" });
    assert.deepEqual(readdirSync(dir), ["config.json"]);
    assert.ok(existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
