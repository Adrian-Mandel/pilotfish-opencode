// Host-level integration test for the issue #16 P4 budget and permission keys.
//
// These four settings are only meaningful as the host resolves them, not as
// template text: `steps` has no effect unless OpenCode reads it, and both
// `doom_loop` and `question` are written by the host as defaults *before* the
// agent's own rules, so the template value only wins because the resolved rule
// list is last-match-wins. Asserting the templates would prove nothing.
//
// Requires the `opencode` binary. Makes no provider request.
//
//   node --test tests/integration/agent-budgets.test.mjs

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createFixture, destroyFixture, runOpencode } from "./fixture.mjs";

// Backstops, not routine limiters: each is set above the observed maximum for
// that role in ~/.local/share/opencode/opencode.db, so a cap that fires means
// the role is looping, not that the work was large.
const STEPS = {
  pilotfish: 300,
  scout: 15,
  Explore: 30,
  "plan-verifier": 30,
  "security-reviewer": 40,
  "mech-executor": 50,
  executor: 120,
  verifier: 60,
  "security-executor": 250,
};

// An `ask` inside a subagent is a stall: nothing is attached to answer it, so
// the loop it was meant to break just blocks instead. Every subagent carries
// the rule explicitly. The read-only roles could plausibly inherit it from
// their `"*": "deny"`, but that catch-all is both later and less specific than
// the host's own `doom_loop: "ask"`, and the resolved rule list does not say
// which axis wins — so the rule is stated rather than inferred. pilotfish is
// primary and keeps `ask`, where a user is attached to answer it.
const DOOM_LOOP_DENY = Object.keys(STEPS).filter((name) => name !== "pilotfish");

function effective(permission, name) {
  const matched = permission.filter((rule) => rule.permission === name && rule.pattern === "*");
  return matched.at(-1)?.action;
}

describe("resolved agent budgets and permissions", () => {
  let fixture;
  const resolved = {};

  before(async () => {
    fixture = createFixture({ preset: "chatgpt", auth: false });
    for (const name of Object.keys(STEPS)) {
      const result = await runOpencode(fixture, ["debug", "agent", name]);
      assert.equal(result.timedOut, false, `debug agent ${name} timed out`);
      const start = result.stdout.indexOf("{");
      assert.ok(start >= 0, `no JSON for ${name}: ${result.stdout}\n${result.stderr}`);
      resolved[name] = JSON.parse(result.stdout.slice(start));
    }
  });

  after(() => {
    if (fixture) destroyFixture(fixture);
  });

  test("every role resolves its own step backstop", () => {
    for (const [name, steps] of Object.entries(STEPS)) {
      assert.equal(resolved[name].steps, steps, `${name} steps`);
    }
  });

  test("every subagent resolves doom_loop to deny, not the host default ask", () => {
    for (const name of DOOM_LOOP_DENY) {
      assert.equal(effective(resolved[name].permission, "doom_loop"), "deny", `${name} doom_loop`);
    }
  });

  // OpenCode denies `question` globally and re-allows it only for its own
  // built-in primaries, so an installed primary needs the rule to ask anything.
  test("pilotfish can ask the user a question and the workers cannot", () => {
    assert.equal(resolved.pilotfish.tools.question, true, "pilotfish question tool");
    for (const name of Object.keys(STEPS)) {
      if (name === "pilotfish") continue;
      assert.notEqual(resolved[name].tools.question, true, `${name} must not prompt the user`);
    }
  });
});
