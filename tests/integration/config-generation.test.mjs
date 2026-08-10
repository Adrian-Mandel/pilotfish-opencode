// Host-level integration test: proves the router's config hook against the
// real OpenCode binary, not a modeled config object.
//
// Requires the `opencode` binary. Makes no provider request, so it is safe to
// run in any environment where OpenCode is installed.
//
//   node --test tests/integration/config-generation.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFixture, destroyFixture, runOpencode } from "./fixture.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROFILES = JSON.parse(
  readFileSync(join(REPO_ROOT, "templates/pilotfish/profiles.json"), "utf8"),
);
const WORKERS = PROFILES.publicRoles.slice(1);
const ACTIVE = PROFILES.presets.chatgpt;

async function resolvedConfig(fixture) {
  // The resolved config inlines all nine prompts and every hidden clone, which
  // puts it over the 64 KiB a pipe delivers. Capture to a file instead, or the
  // parse fails the moment a prompt grows.
  const result = await runOpencode(fixture, ["debug", "config"], {
    stdoutFile: join(fixture.root, "resolved-config.json"),
  });
  assert.equal(result.timedOut, false, "opencode debug config timed out");
  const start = result.stdout.indexOf("{");
  assert.ok(start >= 0, `no JSON in output: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.slice(start));
}

describe("profile router config generation in OpenCode", () => {
  let fixture;
  let config;

  before(async () => {
    fixture = createFixture({ preset: "chatgpt", auth: false });
    config = await resolvedConfig(fixture);
  });

  after(() => {
    if (fixture) destroyFixture(fixture);
  });

  test("the host resolves one visible primary plus every hidden clone", () => {
    const agents = config.agent;
    const clones = Object.keys(agents).filter((name) => name.startsWith("pilotfish-profile-"));
    assert.equal(clones.length, ACTIVE.length * WORKERS.length);
    assert.equal(agents.pilotfish.mode, "primary");
    for (const name of clones) {
      assert.equal(agents[name].hidden, true, `${name} must be hidden`);
      assert.equal(agents[name].mode, "subagent", `${name} must stay a subagent`);
    }
  });

  test("every generated clone carries its approved model and variant", () => {
    for (const profile of ACTIVE) {
      const mapping = PROFILES.profiles[profile];
      for (const role of WORKERS) {
        const clone = config.agent[`pilotfish-profile-${profile}-${role}`];
        assert.ok(clone, `missing clone for ${profile}/${role}`);
        assert.equal(clone.model, mapping.workers[role].model, `${profile}/${role} model`);
        assert.equal(clone.variant, mapping.workers[role].variant, `${profile}/${role} variant`);
      }
    }
  });

  test("public worker bindings are left under user control", () => {
    const preset = JSON.parse(
      readFileSync(join(REPO_ROOT, "templates/presets/chatgpt.jsonc"), "utf8")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    for (const role of WORKERS) {
      assert.equal(config.agent[role].model, preset.agent[role].model, `${role} model`);
      assert.equal(config.agent[role].variant, preset.agent[role].variant, `${role} variant`);
      assert.notEqual(config.agent[role].hidden, true, `${role} must stay visible`);
    }
  });

  // Presets carry provider-specific top-level keys, not only agent bindings.
  // `small_model` is dropped silently if the merge only walks `agent`, and the
  // failure is invisible: the install still works, it just keeps paying for
  // title generation and compaction on the selected primary.
  test("the host resolves the preset's small_model", () => {
    const preset = JSON.parse(
      readFileSync(join(REPO_ROOT, "templates/presets/chatgpt.jsonc"), "utf8")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    assert.ok(preset.small_model, "a preset must declare a small_model");
    assert.equal(config.small_model, preset.small_model);
    assert.notEqual(
      config.small_model,
      config.agent.pilotfish.model,
      "small_model exists to keep compaction off the primary",
    );
  });

  test("Task permission admits the clones without widening the public map", () => {
    const task = config.agent.pilotfish.permission.task;
    const entries = Object.entries(task);
    assert.deepEqual(entries[0], ["*", "deny"], "the deny-all rule must stay first");
    for (const role of WORKERS) assert.equal(task[role], "allow", `${role} must stay allowed`);
    for (const profile of ACTIVE) {
      for (const role of WORKERS) {
        assert.equal(task[`pilotfish-profile-${profile}-${role}`], "allow");
      }
    }
    const unexpected = entries
      .map(([pattern]) => pattern)
      .filter(
        (pattern) =>
          pattern !== "*" && !WORKERS.includes(pattern) && !pattern.startsWith("pilotfish-profile-"),
      );
    assert.deepEqual(unexpected, [], "no other Task rule may be introduced");
  });
});
