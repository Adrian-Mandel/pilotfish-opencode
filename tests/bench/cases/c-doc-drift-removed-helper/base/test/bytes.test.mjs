import assert from "node:assert/strict";
import { test } from "node:test";

import { formatBytes, parseBytes } from "../src/bytes.mjs";
import { totalBytes } from "../src/report.mjs";

test("parseBytes reads a size with a unit", () => {
  assert.equal(parseBytes("12 MiB"), 12 * 1024 * 1024);
  assert.equal(parseBytes("512B"), 512);
});

test("formatBytes picks the largest fitting unit", () => {
  assert.equal(formatBytes(1536), "1.5 KiB");
});

test("totalBytes sums a manifest", () => {
  assert.equal(totalBytes([{ size: "1 KiB" }, { size: "1 KiB" }]), 2048);
});
