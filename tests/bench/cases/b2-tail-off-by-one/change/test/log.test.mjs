import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countByLevel,
  filterByLevel,
  formatEntry,
  headLines,
  parseLevel,
  redactSecrets,
} from "../src/log.mjs";

test("headLines returns the first n lines", () => {
  assert.equal(headLines("a\nb\nc\nd", 2), "a\nb");
});

test("headLines clamps a negative count to zero", () => {
  assert.equal(headLines("a\nb\nc", -1), "");
  assert.equal(headLines("a\nb\nc", -4), "");
});

test("parseLevel reads a bracketed level and rejects unknown ones", () => {
  assert.equal(parseLevel("[warn] something"), "warn");
  assert.equal(parseLevel("[bogus] something"), null);
  assert.equal(parseLevel("no level here"), null);
});

test("filterByLevel keeps entries at or above the floor", () => {
  const text = "[debug] a\n[info] b\n[error] c";
  assert.equal(filterByLevel(text, "info"), "[info] b\n[error] c");
});

test("filterByLevel rejects an unknown floor", () => {
  assert.throws(() => filterByLevel("[info] a", "loud"), RangeError);
});

test("redactSecrets removes token, password and api-key values", () => {
  assert.equal(redactSecrets("token=abc123 ok"), "token=[redacted] ok");
  assert.equal(redactSecrets("api-key=zzz ok"), "api-key=[redacted] ok");
});

test("formatEntry renders level, timestamp and message", () => {
  const at = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatEntry("info", "up", at), "[info] 2026-01-01T00:00:00.000Z up");
});

test("countByLevel tallies each level", () => {
  const counts = countByLevel("[info] a\n[info] b\n[error] c");
  assert.equal(counts.info, 2);
  assert.equal(counts.error, 1);
});
