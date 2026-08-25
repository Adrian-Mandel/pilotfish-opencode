import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeConfig,
  mergeConfig,
  parseBoolean,
  parseHost,
  parsePort,
  readEnvConfig,
} from "../src/config.mjs";

test("parsePort reads a numeric string", () => {
  assert.equal(parsePort("8080"), 8080);
});

test("parsePort rejects ports outside the valid range", () => {
  assert.throws(() => parsePort("0"), RangeError);
  assert.throws(() => parsePort("65536"), RangeError);
  assert.throws(() => parsePort("-1"), RangeError);
  assert.throws(() => parsePort("8080.5"), RangeError);
  assert.throws(() => parsePort("http"), RangeError);
});

test("parseHost trims and lowercases", () => {
  assert.equal(parseHost("  Example.COM "), "example.com");
});

test("parseHost rejects an empty host", () => {
  assert.throws(() => parseHost("   "), RangeError);
});

test("parseBoolean accepts the documented words", () => {
  assert.equal(parseBoolean("on"), true);
  assert.equal(parseBoolean("yes"), true);
  assert.equal(parseBoolean("FALSE"), false);
  assert.equal(parseBoolean("no"), false);
  assert.throws(() => parseBoolean("maybe"), RangeError);
});

test("readEnvConfig reads only the keys that are present", () => {
  assert.deepEqual(readEnvConfig({ AGENT_HOST: "Localhost" }), { host: "localhost" });
});

test("mergeConfig lets the override win", () => {
  assert.deepEqual(mergeConfig({ port: 1, host: "a" }, { port: 2 }), { port: 2, host: "a" });
});

test("describeConfig renders sorted key=value pairs", () => {
  assert.equal(describeConfig({ port: 80, host: "a" }), "host=a port=80");
});
