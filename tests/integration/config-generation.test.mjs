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

// Mirrors the router: profile names are model identifiers, so provider slashes
// are flattened before they become agent names.
function internalAgentName(profile, role) {
  return `pilotfish-profile-${profile.replaceAll("/", "--")}-${role}`;
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
        const clone = config.agent[internalAgentName(profile, role)];
        assert.ok(clone, `missing clone for ${profile}/${role}`);
        assert.equal(clone.model, mapping.workers[role].model, `${profile}/${role} model`);
        assert.equal(clone.variant, mapping.workers[role].variant, `${profile}/${role} variant`);
      }
    }
  });

  test("public workers stay unbound so they inherit the invoking primary", () => {
    // A preset must bind the public primary and nothing else. A model baked onto
    // a public worker outlives Task remapping, which is active only while
    // Pilotfish is the resolved primary agent: under any other primary the
    // worker would run on the preset's provider instead of the session's own,
    // spending a quota the session never selected.
    const preset = JSON.parse(
      readFileSync(join(REPO_ROOT, "templates/presets/chatgpt.jsonc"), "utf8")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    assert.deepEqual(
      Object.keys(preset.agent),
      ["pilotfish"],
      "a preset may bind only the public primary",
    );
    for (const role of WORKERS) {
      assert.equal(config.agent[role].model, undefined, `${role} must carry no model`);
      assert.equal(config.agent[role].variant, undefined, `${role} must carry no variant`);
      assert.notEqual(config.agent[role].hidden, true, `${role} must stay visible`);
    }
  });

  test("Task permission admits the clones without widening the public map", () => {
    const task = config.agent.pilotfish.permission.task;
    const entries = Object.entries(task);
    assert.deepEqual(entries[0], ["*", "deny"], "the deny-all rule must stay first");
    for (const role of WORKERS) assert.equal(task[role], "allow", `${role} must stay allowed`);
    for (const profile of ACTIVE) {
      for (const role of WORKERS) {
        assert.equal(task[internalAgentName(profile, role)], "allow");
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

// A benchmark run on a provider the user still has quota for is only meaningful
// if the model it names is the model the host actually resolves. That is the
// whole claim behind `createFixture({ primary })`, so it is checked against the
// real binary rather than the file the fixture wrote.
describe("a primary override selects the profile it names", () => {
  const PRESET = "antigravity";
  const PROFILE = "google/antigravity-gemini-3.1-pro";
  let fixture;
  let config;

  before(async () => {
    fixture = createFixture({
      preset: PRESET,
      primary: { model: PROFILE, variant: PROFILES.profiles[PROFILE].primary.variant },
      auth: false,
    });
    config = await resolvedConfig(fixture);
  });

  after(() => {
    if (fixture) destroyFixture(fixture);
  });

  test("the host resolves the overridden primary, not the preset default", () => {
    const preset = JSON.parse(
      readFileSync(join(REPO_ROOT, `templates/presets/${PRESET}.jsonc`), "utf8")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    assert.notEqual(preset.agent.pilotfish.model, PROFILE, "the fixture must differ from the preset");
    assert.equal(config.agent.pilotfish.model, PROFILE);
  });

  // The seat the benchmark measures. If this reads the preset default's
  // verifier, every result is attributed to the wrong model.
  test("the verifier seat follows the overridden primary's profile", () => {
    const binding = PROFILES.profiles[PROFILE].workers.verifier;
    const clone = config.agent[internalAgentName(PROFILE, "verifier")];
    assert.ok(clone, "no verifier clone for the overridden profile");
    assert.equal(clone.model, binding.model);
    assert.equal(clone.variant, binding.variant);
  });

  test("an override naming no variant clears the preset's rather than leaking it", () => {
    const bare = createFixture({ preset: PRESET, primary: { model: PROFILE }, auth: false });
    try {
      const written = JSON.parse(
        readFileSync(join(bare.configDir, "opencode.json"), "utf8"),
      );
      assert.equal(written.agent.pilotfish.model, PROFILE);
      assert.ok(
        !Object.hasOwn(written.agent.pilotfish, "variant"),
        "the preset default's variant survived onto another model",
      );
    } finally {
      destroyFixture(bare);
    }
  });
});
