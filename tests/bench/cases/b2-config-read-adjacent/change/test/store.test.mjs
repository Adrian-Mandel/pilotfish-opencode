import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  backupConfig,
  deleteProfile,
  describeProfiles,
  listProfiles,
  readConfig,
  readProfile,
  writeConfig,
} from "../src/store.mjs";

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
    writeConfig(path, { a: 1 });
    assert.equal(existsSync(`${path}.tmp`), false);
    assert.deepEqual(readConfig(path), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readProfile reads a profile by name", () => {
  const dir = scratch();
  try {
    writeConfig(join(dir, "prod.json"), { host: "prod" });
    assert.deepEqual(readProfile(dir, "prod"), { host: "prod" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backupConfig copies an existing file and reports the path", () => {
  const dir = scratch();
  try {
    const path = join(dir, "config.json");
    writeConfig(path, { a: 1 });
    const backup = backupConfig(path);
    assert.ok(backup && existsSync(backup));
    assert.equal(backupConfig(join(dir, "absent.json")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listProfiles reports sorted profile names", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "b.json"), "{}");
    writeFileSync(join(dir, "a.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "ignored");
    assert.deepEqual(listProfiles(dir), ["a", "b"]);
    assert.equal(describeProfiles(dir), "a, b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteProfile removes a profile and reports whether it existed", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "a.json"), "{}");
    assert.equal(deleteProfile(dir, "a"), true);
    assert.equal(deleteProfile(dir, "a"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
