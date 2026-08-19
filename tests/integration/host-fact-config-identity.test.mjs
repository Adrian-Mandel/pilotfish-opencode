// Live re-verification of host fact H11 of docs/profile-router-contract.md:
//
//   "One process serves several project directories from one global config,
//    rebuilding `config.agent` per instance while passing every instance the
//    SAME nested `permission.task` object."
//
// The load-bearing half is reference identity, and reference identity cannot be
// shown by comparing content — a fresh deep copy of the global config is
// content-equal on every instance. It can only be shown by mutation
// visibility: write through the reference on one instance, then look for the
// write on the next.
//
// So this file starts ONE `opencode serve` process against an isolated fixture
// carrying host-fact-config-probe.mjs, then asks that one process for the
// resolved config of three DIFFERENT project directories via
// `GET /config?directory=…`. The probe's `config` hook runs once per instance
// and records what it can already see of its earlier writes.
//
// This lives beside host-facts.test.mjs rather than inside it because it is a
// different kind of test: no model, no network, no credentials, and driven by
// the HTTP server rather than by `opencode run`. Folding it in would gate a
// deterministic offline check behind several minutes of live model turns.
//
// Requires the `opencode` binary. No provider request is made.
//
//   node --test tests/integration/host-fact-config-identity.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createFixture, destroyFixture, fixtureEnv } from "./fixture.mjs";

const PROBE = fileURLToPath(new URL("./host-fact-config-probe.mjs", import.meta.url));

// Must match host-fact-config-probe.mjs.
const TRACE_KEY = "__pilotfish_probe_trace";

// Cold start of the host plus three instance builds. Generous, but bounded:
// exceeding it fails the test rather than hanging the suite.
const SERVE_TIMEOUT_MS = 120_000;

let fixture = null;
let server = null;

// `opencode serve --port 0` picks a free port and announces it. Parsing the
// announcement is also the readiness signal, so no sleep is needed and a host
// that never comes up fails loudly on the timeout instead of on a flaky race.
function startServer(current) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("opencode", ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
      cwd: current.project,
      env: fixtureEnv(current),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(`opencode serve never announced a port in ${SERVE_TIMEOUT_MS}ms: ${output}`));
    }, SERVE_TIMEOUT_MS);

    const onChunk = (chunk) => {
      output += chunk;
      const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ child, port: Number(match[1]), output: () => output });
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`opencode serve exited with ${code} before listening: ${output}`));
    });
  });
}

function stopServer(handle) {
  if (!handle?.child || handle.child.exitCode !== null) return;
  handle.child.kill("SIGKILL");
}

function readProbe(current) {
  const path = current.env.PILOTFISH_CONFIG_PROBE_LOG;
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("OpenCode host fact H11", () => {
  // One entry per `config` hook invocation, in order.
  let records = [];
  // The three project directories, in the order they were requested.
  let directories = [];

  before(async () => {
    fixture = createFixture({
      preset: "chatgpt",
      auth: false,
      // A host fact: the router's own hooks would only add noise, and its
      // `config` hook would compete with the probe's.
      plugin: false,
      extraPlugins: ["./host-fact-config-probe.mjs"],
    });
    fixture.env.PILOTFISH_CONFIG_PROBE_LOG = join(fixture.root, "config-probe.jsonl");
    cpSync(PROBE, join(fixture.configDir, "host-fact-config-probe.mjs"));

    // Three sibling directories under one fixture root, so all three resolve
    // the same global config and differ only in project directory.
    directories = ["project", "project-b", "project-c"].map((name) => join(fixture.root, name));
    for (const directory of directories) mkdirSync(directory, { recursive: true });

    server = await startServer(fixture);

    // Sequential on purpose: the claim is about what instance N sees of
    // instance N-1, which only has meaning if they are ordered.
    for (const directory of directories) {
      const url = `http://127.0.0.1:${server.port}/config?directory=${encodeURIComponent(directory)}`;
      const response = await fetch(url);
      const body = await response.text();
      assert.equal(response.status, 200, `GET /config for ${directory} failed: ${body}`);
      JSON.parse(body);
    }

    records = readProbe(fixture);
  });

  after(() => {
    stopServer(server);
    if (fixture) destroyFixture(fixture);
  });

  // Without this the rest is vacuous: a probe that never ran, or a host that
  // built one instance and reused it for all three directories, would leave
  // too few records and every identity assertion below would hold trivially.
  test("one config hook invocation per project directory", () => {
    assert.equal(
      records.length,
      directories.length,
      `expected one config hook per directory: ${JSON.stringify(records)}`,
    );
    for (const record of records) {
      assert.equal(record.error, undefined, record.error);
      assert.ok(record.agent, `the probe found no agent carrying permission.task: ${JSON.stringify(record)}`);
    }
  });

  // H11, first half. Never content equality: the assertion is that a `.push()`
  // performed by instance N-1 is visible to instance N. Only a shared reference
  // can carry a mutation across instances that way.
  test("every instance receives the same nested permission.task object", () => {
    const [first, second, third] = records;

    assert.equal(
      first.traceOnEntry,
      null,
      `the first instance already carried a trace, so the log is not clean: ${JSON.stringify(first)}`,
    );
    assert.deepEqual(
      second.traceOnEntry,
      [first.token],
      "the second instance did not see the first instance's push, so permission.task was copied",
    );
    assert.deepEqual(
      third.traceOnEntry,
      [first.token, second.token],
      "the trace array did not accumulate across all three instances",
    );
  });

  // H11, second half, and the contrast that gives the first half its meaning.
  // If everything were shared, "the nested object is shared" would be an
  // unremarkable restatement of "the config is shared". It is not: the config
  // root and the `agent` map are freshly built for every instance, and a write
  // to either is gone by the next one.
  test("the config root and the agent map are rebuilt per instance", () => {
    for (const record of records) {
      assert.equal(
        record.rootMarkerOnEntry,
        null,
        `a write to the config root survived into a later instance: ${JSON.stringify(record)}`,
      );
      assert.equal(
        record.agentMapMarkerOnEntry,
        null,
        `a write to config.agent survived into a later instance: ${JSON.stringify(record)}`,
      );
    }
    // Same agent every time, so the surviving trace and the discarded markers
    // were reached by the same path and differ only in depth.
    const names = new Set(records.map((record) => record.agent));
    assert.equal(names.size, 1, `the probe wrote to different agents: ${JSON.stringify([...names])}`);
  });

  // Where the boundary actually falls, pinned so a host change moves it
  // loudly. `config.agent` is rebuilt, but the agent record it points at — and
  // therefore everything under it, `permission.task` included — is carried over
  // from the previous instance rather than rebuilt with it.
  test("the rebuilt agent map points back at the previous instance's agent record", () => {
    const [first, ...rest] = records;
    assert.equal(first.agentMarkerOnEntry, null, "the first instance saw a marker it could not have written");
    for (const [index, record] of rest.entries()) {
      assert.equal(
        record.agentMarkerOnEntry,
        records[index].token,
        `the agent record was rebuilt between instances: ${JSON.stringify(record)}`,
      );
      assert.equal(
        record.taskMarkerOnEntry,
        records[index].token,
        `permission.task was rebuilt between instances: ${JSON.stringify(record)}`,
      );
    }
  });

  // The consequence the contract draws from H11: a plugin that writes into
  // `permission.task` writes into every project directory this process serves.
  test("the shared object is the one the host keeps, not a probe-local copy", () => {
    const last = records.at(-1);
    assert.ok(
      Array.isArray(last.traceOnEntry) && last.traceOnEntry.length === records.length - 1,
      `the trace lost writes between instances: ${JSON.stringify(records)}`,
    );
    assert.equal(
      new Set(last.traceOnEntry).size,
      last.traceOnEntry.length,
      `${TRACE_KEY} recorded a duplicate token, so instances are not distinct`,
    );
  });
});
