import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import profileRouterPlugin from "../templates/pilotfish/profile-router.mjs";

const profiles = JSON.parse(
  readFileSync(new URL("../templates/pilotfish/profiles.json", import.meta.url), "utf8"),
);
// Profile names are the primary model identifiers; aliased here for readability.
const SOL = "openai/gpt-5.6-sol";
const TERRA = "openai/gpt-5.6-terra";
const LUNA = "openai/gpt-5.6-luna";
const OPUS = "google/antigravity-claude-opus-4-6-thinking";
const PRO = "google/antigravity-gemini-3.1-pro";
const FLASH = "google/antigravity-gemini-3-flash";
const QWEN = "openrouter/qwen3.6-27b";
const DEEPSEEK = "openrouter/deepseek-v4-pro";

const workers = profiles.publicRoles.slice(1);
const AG_PRIMARY = profiles.profiles[OPUS].primary.model;

function clone(value) {
  return structuredClone(value);
}

function internalAgentName(profile, role) {
  return `pilotfish-profile-${profile.replaceAll("/", "--")}-${role}`;
}

function historyClient({
  historyBySession = {},
  failure,
  resultError,
  onMessages,
  sessionsByID = {},
  getFailure,
  getResultError,
  onGet,
  updateFailure,
  updateResultError,
  onUpdate,
} = {}) {
  const calls = [];
  const getCalls = [];
  const updateCalls = [];
  return {
    calls,
    getCalls,
    updateCalls,
    client: {
      session: {
        async messages(request) {
          calls.push(request);
          if (failure) throw failure;
          if (resultError !== undefined) return { error: resultError };
          if (onMessages) return onMessages(request);
          return { data: historyBySession[request.path.id] ?? [] };
        },
        async get(request) {
          getCalls.push(request);
          if (getFailure) throw getFailure;
          if (getResultError !== undefined) return { error: getResultError };
          if (onGet) return onGet(request);
          return { data: sessionsByID[request.path.id] };
        },
        async update(request) {
          updateCalls.push(request);
          if (updateFailure) throw updateFailure;
          if (updateResultError !== undefined) return { error: updateResultError };
          if (onUpdate) return onUpdate(request);
          const session = sessionsByID[request.path.id];
          if (!session) return { data: undefined };
          Object.assign(session, request.body);
          return { data: session };
        },
      },
    },
  };
}

function router(options, client = historyClient().client) {
  return profileRouterPlugin({ client }, options);
}

function chatgptConfig() {
  const base = JSON.parse(
    readFileSync(new URL("../templates/opencode.base.jsonc", import.meta.url), "utf8"),
  );
  const preset = JSON.parse(
    readFileSync(new URL("../templates/presets/chatgpt.jsonc", import.meta.url), "utf8"),
  );
  for (const [name, binding] of Object.entries(preset.agent)) {
    Object.assign(base.agent[name], binding);
  }
  return base;
}

function openrouterConfig() {
  const base = JSON.parse(
    readFileSync(new URL("../templates/opencode.base.jsonc", import.meta.url), "utf8"),
  );
  const preset = JSON.parse(
    readFileSync(new URL("../templates/presets/openrouter.jsonc", import.meta.url), "utf8"),
  );
  for (const [name, binding] of Object.entries(preset.agent)) {
    Object.assign(base.agent[name], binding);
  }
  return base;
}

function antigravityConfig() {
  const config = JSON.parse(
    readFileSync(new URL("../templates/opencode.base.jsonc", import.meta.url), "utf8"),
  );
  const preset = JSON.parse(
    readFileSync(new URL("../templates/presets/antigravity.jsonc", import.meta.url), "utf8"),
  );
  for (const [name, binding] of Object.entries(preset.agent)) {
    Object.assign(config.agent[name], binding);
  }
  return config;
}

function message(sessionID, model, variant = "high") {
  const [providerID, modelID] = model.split("/");
  return { sessionID, agent: "pilotfish", model: { providerID, modelID }, variant };
}

function resolvedMessage(agent, model, variant = "high") {
  const [providerID, modelID] = model.split("/");
  return { message: { agent, model: { providerID, modelID }, variant } };
}

function persistedMessage(model, created, agent = "pilotfish") {
  const [providerID, modelID] = model.split("/");
  return {
    info: {
      role: "user",
      agent,
      model: { providerID, modelID },
      time: { created },
    },
    parts: [],
  };
}

function fakeTiming(start = 1_000) {
  let current = start;
  let nextID = 1;
  const timers = new Map();
  return {
    options: {
      ttl: 30,
      now: () => current,
      setTimeout(callback, delay) {
        const id = nextID++;
        timers.set(id, { callback, due: current + delay });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    async advance(milliseconds) {
      current += milliseconds;
      const callbacks = [];
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.due > current) continue;
        timers.delete(id);
        callbacks.push(timer.callback());
      }
      await Promise.all(callbacks);
    },
    pending: () => timers.size,
  };
}

async function assertDirectInvocationRejected(hooks, sessionID, subagentType) {
  const task = {
    args: { subagent_type: subagentType, task_id: `resume-${sessionID}`, prompt: "work" },
  };
  const before = clone(task.args);
  await assert.rejects(
    hooks["tool.execute.before"]({ tool: "task", sessionID }, task),
    /internal profile agents cannot be invoked directly.*public Pilotfish worker role/i,
  );
  assert.deepEqual(task.args, before);
}

async function assertDirectChatRejected(hooks, input, output) {
  await assert.rejects(
    hooks["chat.message"](input, output),
    /internal profile agents cannot be invoked directly through chat.*public pilotfish agent/i,
  );
}

async function authorizeTask(hooks, sessionID, callID, publicRole = "executor") {
  const task = {
    args: { description: `task ${callID}`, prompt: "work", subagent_type: publicRole },
  };
  await hooks["tool.execute.before"]({ tool: "task", sessionID, callID }, task);
  return task;
}

async function emitSessionCreated(hooks, session, created = Date.now()) {
  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { ...session, time: { created } } },
    },
  });
}

async function assertChatGPTConfigurationRejected(config, expectedError) {
  const before = clone(config);
  const hooks = await router({ preset: "chatgpt" });
  hooks.config(config);
  assert.deepEqual(config, before);
  assert.equal(
    Object.keys(config.agent).some((name) => name.startsWith("pilotfish-profile-")),
    false,
  );
  await assert.rejects(
    hooks["chat.message"](message("invalid-config", "openai/gpt-5.6-sol")),
    expectedError,
  );
  await assert.doesNotReject(
    hooks["chat.message"]({
      ...message("non-pilotfish", "openai/gpt-5.6-sol"),
      agent: "build",
    }),
  );
}

test("profile-router exposes only the default OpenCode plugin export", async () => {
  const module = await import("../templates/pilotfish/profile-router.mjs");
  assert.deepEqual(Object.keys(module), ["default"]);
  assert.equal(module.default, profileRouterPlugin);
});

test("ChatGPT configuration creates exact hidden profile clones without mutating public bindings", async () => {
  const config = chatgptConfig();
  const publicBindings = Object.fromEntries(
    profiles.publicRoles.map((role) => [
      role,
      { model: config.agent[role].model, variant: config.agent[role].variant },
    ]),
  );
  const hooks = await router({ preset: "chatgpt" });

  hooks.config(config);

  for (const role of profiles.publicRoles) {
    assert.deepEqual(
      { model: config.agent[role].model, variant: config.agent[role].variant },
      publicBindings[role],
    );
  }
  for (const profile of profiles.presets.chatgpt) {
    const mapping = profiles.profiles[profile];
    for (const role of workers) {
      const name = internalAgentName(profile, role);
      const expected = clone(config.agent[role]);
      Object.assign(expected, { hidden: true, ...mapping.workers[role] });
      assert.deepEqual(config.agent[name], expected);
      assert.equal(config.agent[name].mode, "subagent");
      assert.equal(config.agent.pilotfish.permission.task[name], "allow");
    }
  }
  for (const profile of profiles.presets.antigravity) {
    for (const role of workers) {
      assert.equal(config.agent[internalAgentName(profile, role)], undefined);
    }
  }
  for (const role of workers) assert.equal(config.agent[role].mode, "subagent");
  assert.equal(config.agent.pilotfish.model, "openai/gpt-5.6-sol");
  assert.equal(config.agent.pilotfish.variant, "high");
});

test("ChatGPT configuration rejects every non-subagent public worker mode atomically", async () => {
  for (const mode of ["primary", "all", undefined, 42, null]) {
    const config = chatgptConfig();
    if (mode === undefined) delete config.agent.executor.mode;
    else config.agent.executor.mode = mode;
    await assertChatGPTConfigurationRejected(
      config,
      /configuration failed.*public worker agent "executor".*mode "subagent".*refusing to clone or route/i,
    );
  }
});

test("AntiGravity configuration also rejects non-subagent public workers atomically", async () => {
  const config = antigravityConfig();
  config.agent.executor.mode = "primary";
  const before = clone(config);
  const hooks = await router({ preset: "antigravity" });

  hooks.config(config);

  assert.deepEqual(config, before);
  await assert.rejects(
    hooks["chat.message"](message("invalid-ag-mode", AG_PRIMARY)),
    /configuration failed.*public worker agent "executor".*mode "subagent"/i,
  );
});

test("ChatGPT configuration preserves unrelated custom Task allow and deny rules", async () => {
  const config = chatgptConfig();
  const task = config.agent.pilotfish.permission.task;
  task["custom-agent"] = "allow";
  task["custom.agent+*"] = "deny";
  task["custom-agent?"] = "deny";
  task["pilotfish-profile-sol\\executo?"] = "deny";
  task["pilotfish-profile-sol-executor.?"] = "deny";
  const hooks = await router({ preset: "chatgpt" });

  hooks.config(config);

  assert.equal(task["custom-agent"], "allow");
  assert.equal(task["custom.agent+*"], "deny");
  assert.equal(task["custom-agent?"], "deny");
  assert.equal(task["pilotfish-profile-sol\\executo?"], "deny");
  assert.equal(task["pilotfish-profile-sol-executor.?"], "deny");
  assert.equal(task[internalAgentName(SOL, "executor")], "allow");
});

test("ChatGPT configuration rejects Task rules that can match internal profile agents atomically", async () => {
  for (const [pattern, action] of [
    ["pilotfish-profile-*", "deny"],
    ["pilotfish-*", "allow"],
    [`${internalAgentName(SOL, "executor").slice(0, -1)}?`, "deny"],
    ["pilotfish-profile-*-executo?", "allow"],
    [`${internalAgentName(SOL, "executor")} *`, "deny"],
  ]) {
    const config = chatgptConfig();
    config.agent.pilotfish.permission.task[pattern] = action;
    await assertChatGPTConfigurationRejected(
      config,
      new RegExp(
        `configuration failed.*Task rule.*${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*can match internal profile agent`,
        "i",
      ),
    );
  }
});

// One OpenCode process serves several project directories from one global
// config, and it rebuilds `config.agent` per instance while handing every
// instance the SAME nested `permission.task` object. extendTaskPermission
// writes the clone entries into that shared object, so from the second
// instance onward the router meets its own prior writes. Those are idempotent
// self-state, not foreign customization: the guard must let them through, or
// every project after the first dies in the config hook before any provider
// call is made. Regression test for that crash.
test("configuration is idempotent when the host shares one permission.task object across instances", async () => {
  const sharedTask = chatgptConfig().agent.pilotfish.permission.task;

  for (const instance of [1, 2, 3]) {
    const config = chatgptConfig();
    config.agent.pilotfish.permission.task = sharedTask;
    const hooks = await router({ preset: "chatgpt" });

    hooks.config(config);

    for (const profile of [SOL, TERRA, LUNA]) {
      for (const role of workers) {
        const name = internalAgentName(profile, role);
        assert.ok(
          config.agent[name],
          `instance ${instance} must still configure clone agent ${name}`,
        );
        assert.equal(sharedTask[name], "allow", `instance ${instance} Task rule for ${name}`);
      }
    }
    await assert.doesNotReject(
      hooks["chat.message"](message(`shared-${instance}`, SOL)),
      `instance ${instance} must not raise a stored configuration error`,
    );
  }
});

// The exact clone key carrying anything other than "allow" was not written by
// this router, so it stays a refusal.
test("configuration rejects a clone's own Task key when it does not resolve to allow", async () => {
  const executorClone = internalAgentName(SOL, "executor");
  const config = chatgptConfig();
  config.agent.pilotfish.permission.task[executorClone] = "deny";

  await assertChatGPTConfigurationRejected(
    config,
    new RegExp(
      `configuration failed.*internal profile agent "${executorClone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*already has a customized Task rule \\("deny"\\)`,
      "i",
    ),
  );
});


test("ChatGPT Task pattern matching follows platform case behavior", async () => {
  const config = chatgptConfig();
  const pattern = internalAgentName(SOL, "executor").toUpperCase();
  config.agent.pilotfish.permission.task[pattern] = "deny";

  if (process.platform === "win32") {
    await assertChatGPTConfigurationRejected(
      config,
      /configuration failed.*Task rule.*can match internal profile agent/i,
    );
    return;
  }

  const hooks = await router({ preset: "chatgpt" });
  hooks.config(config);
  assert.equal(config.agent.pilotfish.permission.task[pattern], "deny");
  assert.equal(
    config.agent.pilotfish.permission.task[internalAgentName(SOL, "executor")],
    "allow",
  );
});

test("ChatGPT configuration requires base wildcard ordering and explicit public-role resolution", async () => {
  const reordered = chatgptConfig();
  const { "*": baseWildcard, ...publicRules } = reordered.agent.pilotfish.permission.task;
  reordered.agent.pilotfish.permission.task = { ...publicRules, "*": baseWildcard };
  await assertChatGPTConfigurationRejected(
    reordered,
    /configuration failed.*first Task rule.*every public worker.*refusing to weaken/i,
  );

  const overridden = chatgptConfig();
  overridden.agent.pilotfish.permission.task["sc*"] = "deny";
  await assertChatGPTConfigurationRejected(
    overridden,
    /configuration failed.*every public worker.*explicit "allow" entry.*refusing to weaken/i,
  );
});

test("ChatGPT sessions pin their primary profile, allow variant changes, and preserve task arguments", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](message("sol", "openai/gpt-5.6-sol", "high"));
  await hooks["chat.message"](message("sol", "openai/gpt-5.6-sol", "xhigh"));
  await hooks["chat.message"](message("terra", "openai/gpt-5.6-terra"));

  const task = {
    args: { description: "execute work", subagent_type: "executor", prompt: "work" },
  };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "sol", callID: "sol-task" }, task);
  assert.equal(task.args.subagent_type, internalAgentName(SOL, "executor"));
  assert.match(task.args.description, /^execute work \[pilotfish-task:[a-f0-9]{64}\]$/);
  assert.equal(task.args.prompt, "work");

  const other = { args: { description: "other work", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "terra", callID: "terra-task" },
    other,
  );
  assert.equal(other.args.subagent_type, internalAgentName(TERRA, "executor"));
  await assert.rejects(
    hooks["chat.message"](message("sol", "openai/gpt-5.6-terra")),
    /model changed.*new session/i,
  );
});

// Switching profiles is the deliverable, and OpenRouter is the first preset
// whose model IDs carry two slashes (`openrouter/qwen/qwen3.6-27b`). The router
// rebuilds the key as `${providerID}/${modelID}` without assuming a segment
// count, so the provider reports `openrouter` plus `qwen/qwen3.6-27b` and the
// join round-trips -- this test fails if that ever stops being true.
function openRouterMessage(sessionID, model) {
  const slash = model.indexOf("/");
  return {
    sessionID,
    agent: "pilotfish",
    model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) },
    variant: undefined,
  };
}

test("OpenRouter sessions select their profile from the primary model alone", async () => {
  const hooks = await router({ preset: "openrouter" });
  await hooks["chat.message"](openRouterMessage("q", "openrouter/qwen/qwen3.6-27b"));
  await hooks["chat.message"](openRouterMessage("d", "openrouter/deepseek/deepseek-v4-pro"));

  // The same public role, dispatched from two sessions, lands on two different
  // models with no configuration change between them.
  const fromQwen = { args: { description: "verify", subagent_type: "verifier", prompt: "work" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "q", callID: "q-1" }, fromQwen);
  assert.equal(fromQwen.args.subagent_type, internalAgentName(QWEN, "verifier"));

  const fromDeepSeek = { args: { description: "verify", subagent_type: "verifier" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "d", callID: "d-1" }, fromDeepSeek);
  assert.equal(fromDeepSeek.args.subagent_type, internalAgentName(DEEPSEEK, "verifier"));

  // Cheap roles route to the cheap model in the same session.
  const recon = { args: { description: "scout", subagent_type: "scout" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "q", callID: "q-2" }, recon);
  assert.equal(recon.args.subagent_type, internalAgentName(QWEN, "scout"));

  // A session stays pinned to the profile it started on.
  await assert.rejects(
    hooks["chat.message"](openRouterMessage("q", "openrouter/deepseek/deepseek-v4-pro")),
    /model changed.*new session/i,
  );
});

test("OpenRouter configuration creates both profiles' clones without variants", async () => {
  const config = openrouterConfig();
  const hooks = await router({ preset: "openrouter" });
  hooks.config(config);
  for (const profile of profiles.presets.openrouter) {
    for (const role of Object.keys(profiles.profiles[profile].workers)) {
      const clone = config.agent[internalAgentName(profile, role)];
      assert.ok(clone, `missing ${profile}/${role}`);
      assert.equal(clone.model, profiles.profiles[profile].workers[role].model);
      assert.equal(clone.variant, undefined, `${profile}/${role} must carry no variant`);
      assert.equal(clone.hidden, true);
    }
  }
});

test("resolved Pilotfish default Sol pins and remaps when the raw model is omitted", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](
    { sessionID: "resolved-sol", agent: "pilotfish" },
    resolvedMessage("pilotfish", "openai/gpt-5.6-sol"),
  );

  const task = { args: { description: "sol default", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "resolved-sol", callID: "resolved-sol-task" },
    task,
  );
  assert.equal(task.args.subagent_type, internalAgentName(SOL, "executor"));
});

test("resolved Pilotfish agent pins when the raw agent is omitted", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](
    { sessionID: "resolved-agent", model: "openai/gpt-5.6-terra" },
    resolvedMessage("pilotfish", "openai/gpt-5.6-terra"),
  );

  const task = { args: { description: "agent default", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "resolved-agent", callID: "resolved-agent-task" },
    task,
  );
  assert.equal(task.args.subagent_type, internalAgentName(TERRA, "executor"));
});

test("resolved Pilotfish messages pin when both raw routing fields are omitted", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](
    { sessionID: "resolved-luna" },
    resolvedMessage("pilotfish", "openai/gpt-5.6-luna", "max"),
  );

  const task = { args: { description: "both default", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "resolved-luna", callID: "resolved-luna-task" },
    task,
  );
  assert.equal(task.args.subagent_type, internalAgentName(LUNA, "executor"));
});

test("resolved non-Pilotfish messages are no-ops when the raw agent is omitted", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](
    { sessionID: "resolved-other", model: "openai/gpt-5.6-sol" },
    resolvedMessage("other", "openai/gpt-5.6-sol"),
  );

  const task = { args: { subagent_type: "executor", task_id: "other-default" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "resolved-other" }, task);
  assert.equal(task.args.subagent_type, "executor");
});

test("resolved chat routing fields override conflicting raw prompt fields", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](
    { sessionID: "resolved-wins", agent: "other", model: "openai/gpt-5.6-sol" },
    resolvedMessage("pilotfish", "openai/gpt-5.6-terra"),
  );

  const task = { args: { description: "resolved wins", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "resolved-wins", callID: "resolved-wins-task" },
    task,
  );
  assert.equal(task.args.subagent_type, internalAgentName(TERRA, "executor"));
});

test("unrelated calls and unpinned sessions are no-ops", async () => {
  const hooks = await router({ preset: "chatgpt" });
  const absent = { args: { subagent_type: "executor", task_id: "absent" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "missing" }, absent);
  assert.equal(absent.args.subagent_type, "executor");

  await hooks["chat.message"]({ ...message("not-pilotfish", "openai/gpt-5.6-sol"), agent: "build" });
  const unrelated = { args: { subagent_type: "custom", task_id: "custom" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "not-pilotfish" }, unrelated);
  await hooks["tool.execute.before"]({ tool: "bash", sessionID: "not-pilotfish" }, unrelated);
  assert.deepEqual(unrelated.args, { subagent_type: "custom", task_id: "custom" });

  const nonTaskInternal = {
    args: { subagent_type: internalAgentName(SOL, "executor"), task_id: "not-a-task" },
  };
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID: "not-pilotfish" },
    nonTaskInternal,
  );
  assert.deepEqual(nonTaskInternal.args, {
    subagent_type: internalAgentName(SOL, "executor"),
    task_id: "not-a-task",
  });

  await hooks["tool.execute.before"]({ tool: "task", sessionID: "missing" }, { args: {} });
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "missing" }, {});
});

test("direct internal profile requests fail closed before routing in every session state", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](message("luna", "openai/gpt-5.6-luna", "max"));
  await hooks["chat.message"]({
    ...message("not-pilotfish", "openai/gpt-5.6-sol"),
    agent: "build",
  });

  for (const [sessionID, subagentType] of [
    ["luna", internalAgentName(LUNA, "executor")],
    ["luna", internalAgentName(SOL, "security-executor")],
    ["luna", internalAgentName(TERRA, "Explore")],
    ["missing", internalAgentName(SOL, "scout")],
    ["not-pilotfish", internalAgentName(TERRA, "verifier")],
  ]) {
    await assertDirectInvocationRejected(hooks, sessionID, subagentType);
  }
});

test("direct internal profile chat requests fail closed for absent and mapped sessions in both presets", async () => {
  const chatgpt = await router({ preset: "chatgpt" });
  await assertDirectChatRejected(chatgpt, {
    ...message("chatgpt-absent", "openai/gpt-5.6-sol"),
    agent: internalAgentName(SOL, "executor"),
  });
  await chatgpt["chat.message"](message("chatgpt-mapped", "openai/gpt-5.6-luna", "max"));
  await assertDirectChatRejected(chatgpt, {
    ...message("chatgpt-mapped", "openai/gpt-5.6-luna", "max"),
    agent: internalAgentName(LUNA, "executor"),
  });

  const antigravity = await router({ preset: "antigravity" });
  await assertDirectChatRejected(antigravity, {
    ...message("ag-absent", AG_PRIMARY),
    agent: internalAgentName(SOL, "scout"),
  });
  await antigravity["chat.message"](message("ag-mapped", AG_PRIMARY));
  await assertDirectChatRejected(antigravity, {
    ...message("ag-mapped", AG_PRIMARY),
    agent: internalAgentName(TERRA, "verifier"),
  });
});

test("raw and resolved internal chat identities reject independently of routing precedence", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await assertDirectChatRejected(
    hooks,
    { ...message("resolved-internal", "openai/gpt-5.6-sol"), agent: "build" },
    resolvedMessage(internalAgentName(SOL, "executor"), "openai/gpt-5.6-sol"),
  );
  await assertDirectChatRejected(
    hooks,
    {
      ...message("raw-internal", "openai/gpt-5.6-sol"),
      agent: internalAgentName(SOL, "executor"),
    },
    resolvedMessage("build", "openai/gpt-5.6-sol"),
  );
});

test("invalid preset initialization resolves to atomic fail-closed protective hooks", async () => {
  const hooks = await router({ preset: "invalid" });
  for (const protective of [hooks]) {
    const config = chatgptConfig();
    const before = clone(config);
    protective.config(config);
    assert.deepEqual(config, before);
    await assert.rejects(
      protective["chat.message"](message("missing-or-invalid", "openai/gpt-5.6-sol")),
      /profile router initialization failed.*Fix.*restart OpenCode/i,
    );
  }

  for (const [input, output] of [
    [message("raw-pilotfish", "openai/gpt-5.6-sol"), resolvedMessage("build", "openai/gpt-5.6-sol")],
    [
      { ...message("resolved-pilotfish", "openai/gpt-5.6-sol"), agent: "build" },
      resolvedMessage("pilotfish", "openai/gpt-5.6-sol"),
    ],
  ]) {
    await assert.rejects(
      hooks["chat.message"](input, output),
      /profile router initialization failed.*Fix.*restart OpenCode/i,
    );
  }

  await assert.doesNotReject(
    hooks["chat.message"](
      { ...message("unrelated", "openai/gpt-5.6-sol"), agent: "build" },
      resolvedMessage("build", "openai/gpt-5.6-sol"),
    ),
  );
  await assertDirectChatRejected(
    hooks,
    {
      ...message("protective-internal", "openai/gpt-5.6-sol"),
      agent: internalAgentName(SOL, "executor"),
    },
    resolvedMessage("build", "openai/gpt-5.6-sol"),
  );

  await assertDirectInvocationRejected(
    hooks,
    "protective-task",
    internalAgentName(TERRA, "executor"),
  );
  const publicTask = { args: { subagent_type: "executor", task_id: "blocked-session" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "raw-pilotfish" }, publicTask);
  assert.deepEqual(publicTask.args, { subagent_type: "executor", task_id: "blocked-session" });
});

test("Pilotfish Task routing deactivates for Build while preserving and reactivating the pin", async () => {
  const hooks = await router({ preset: "chatgpt" });
  const sessionID = "agent-transition";
  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol"));

  await hooks["chat.message"](
    { ...message(sessionID, "openai/gpt-5.6-sol"), agent: "pilotfish" },
    resolvedMessage("build", "openai/gpt-5.6-sol"),
  );
  const buildTask = { args: { subagent_type: "executor", task_id: "build-task" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID }, buildTask);
  assert.equal(buildTask.args.subagent_type, "executor");

  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol", "xhigh"));
  const reactivatedTask = {
    args: { description: "pilotfish task", subagent_type: "executor" },
  };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "reactivated-task" },
    reactivatedTask,
  );
  assert.equal(reactivatedTask.args.subagent_type, internalAgentName(SOL, "executor"));

  await hooks["chat.message"]({ ...message(sessionID, "openai/gpt-5.6-sol"), agent: "build" });
  await assert.rejects(
    hooks["chat.message"](message(sessionID, "openai/gpt-5.6-terra")),
    /model changed.*new session/i,
  );
  const rejectedTask = { args: { subagent_type: "executor", task_id: "rejected-task" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID }, rejectedTask);
  assert.equal(rejectedTask.args.subagent_type, "executor");
});

test("a restarted router stays inactive for Build-first and later recovers the Pilotfish pin", async () => {
  const sessionID = "restart-build-first";
  const history = historyClient({
    historyBySession: {
      [sessionID]: [persistedMessage("openai/gpt-5.6-terra", 1)],
    },
  });
  const hooks = await router({ preset: "chatgpt" }, history.client);

  await hooks["chat.message"]({ ...message(sessionID, "openai/gpt-5.6-terra"), agent: "build" });
  const buildTask = { args: { subagent_type: "executor" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID }, buildTask);
  assert.equal(buildTask.args.subagent_type, "executor");
  assert.equal(history.calls.length, 0);

  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-terra"));
  const pilotfishTask = { args: { description: "restart task", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "restart-pilotfish-task" },
    pilotfishTask,
  );
  assert.equal(pilotfishTask.args.subagent_type, internalAgentName(TERRA, "executor"));
  assert.equal(history.calls.length, 1);
});

test("a failed Pilotfish chat leaves Task routing inactive", async () => {
  const sessionID = "failed-pilotfish-inactive";
  const hooks = await router(
    { preset: "chatgpt" },
    historyClient({ failure: new Error("offline") }).client,
  );

  await assert.rejects(
    hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
    /could not recover.*offline/i,
  );
  const task = { args: { subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "history-order-task" },
    task,
  );
  assert.equal(task.args.subagent_type, "executor");
});

test("a later Build chat supersedes pending Pilotfish recovery without deleting its pin", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const sessionID = "recovery-superseded-by-build";
  const history = historyClient({
    onMessages: async () => {
      await waiting;
      return { data: [persistedMessage("openai/gpt-5.6-sol", 1)] };
    },
  });
  const hooks = await router({ preset: "chatgpt" }, history.client);
  const pending = hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol"));
  await hooks["chat.message"]({ ...message(sessionID, "openai/gpt-5.6-sol"), agent: "build" });
  release();
  await assert.doesNotReject(pending);

  const buildTask = { args: { subagent_type: "executor" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID }, buildTask);
  assert.equal(buildTask.args.subagent_type, "executor");

  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol"));
  const reactivatedTask = {
    args: { description: "recovered task", subagent_type: "executor" },
  };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "recovery-reactivated-task" },
    reactivatedTask,
  );
  assert.equal(reactivatedTask.args.subagent_type, internalAgentName(SOL, "executor"));
  assert.equal(history.calls.length, 1);
});

test("AntiGravity remaps Tasks only while Pilotfish is the active agent", async () => {
  const hooks = await router({ preset: "antigravity" });
  const sessionID = "antigravity-transition";
  await hooks["chat.message"](message(sessionID, AG_PRIMARY));

  await hooks["chat.message"]({ ...message(sessionID, AG_PRIMARY), agent: "build" });
  const buildTask = { args: { subagent_type: "executor", description: "build task" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID, callID: "ag-build" }, buildTask);
  assert.equal(buildTask.args.subagent_type, "executor");

  await hooks["chat.message"](message(sessionID, AG_PRIMARY, "low"));
  const pilotfishTask = { args: { subagent_type: "executor", description: "routed task" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID, callID: "ag-routed" }, pilotfishTask);
  assert.equal(pilotfishTask.args.subagent_type, internalAgentName(OPUS, "executor"));

  await hooks["chat.message"]({ ...message(sessionID, AG_PRIMARY), agent: "build" });
  await assert.rejects(
    hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
    /model changed.*new session/i,
  );
});

test("foreground Task authorization allows one exact internal child before tool after", async () => {
  const parentID = "authorized-parent";
  const childID = "authorized-child";
  const secondChildID = "authorized-second-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = {
    [childID]: { id: childID, parentID, agent: expectedAgent },
    [secondChildID]: {
      id: secondChildID,
      parentID,
      agent: expectedAgent,
      title: `task authorized-call (@${expectedAgent} subagent)`,
    },
  };
  const host = historyClient({ sessionsByID });
  const hooks = await router({ preset: "chatgpt" }, host.client);
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));

  const task = await authorizeTask(hooks, parentID, "authorized-call");
  assert.equal(task.args.subagent_type, expectedAgent);
  assert.match(task.args.description, /^task authorized-call \[pilotfish-task:[a-f0-9]{64}\]$/);
  sessionsByID[childID].title = `${task.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[secondChildID].title = `${task.args.description} (@${expectedAgent} subagent)`;

  await assertDirectChatRejected(
    hooks,
    { sessionID: secondChildID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await emitSessionCreated(hooks, sessionsByID[childID]);
  await assert.doesNotReject(
    hooks["chat.message"](
      { sessionID: childID, agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
  );
  assert.equal(sessionsByID[childID].title, `task authorized-call (@${expectedAgent} subagent)`);
  const afterOutput = {
    title: task.args.description,
    output: "done",
    metadata: { sessionId: childID },
  };
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "authorized-call", args: task.args },
    afterOutput,
  );
  assert.equal(task.args.description, "task authorized-call");
  assert.equal(afterOutput.title, "task authorized-call");
  assert.deepEqual(host.getCalls.slice(0, 2), [
    { path: { id: secondChildID } },
    { path: { id: childID } },
  ]);
  assert.deepEqual(host.updateCalls[0], {
    path: { id: childID },
    body: { title: `task authorized-call (@${expectedAgent} subagent)` },
  });

  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  const cleanupTask = await authorizeTask(hooks, parentID, "cleanup-call", "scout");
  const cleanupAgent = internalAgentName(SOL, "scout");
  assert.equal(cleanupTask.args.subagent_type, cleanupAgent);
  sessionsByID[secondChildID].title = `${cleanupTask.args.description} (@${cleanupAgent} subagent)`;
  sessionsByID[secondChildID].agent = cleanupAgent;
  await emitSessionCreated(hooks, sessionsByID[secondChildID]);
  const cleanupOutput = {
    title: cleanupTask.args.description,
    output: "background",
    metadata: { sessionId: secondChildID },
  };
  await hooks["tool.execute.after"](
    {
      tool: "task",
      sessionID: parentID,
      callID: "cleanup-call",
      args: cleanupTask.args,
    },
    cleanupOutput,
  );
  assert.equal(cleanupTask.args.description, "task cleanup-call");
  assert.equal(cleanupOutput.title, "task cleanup-call");
  assert.equal(sessionsByID[secondChildID].title, `task cleanup-call (@${cleanupAgent} subagent)`);
  await assertDirectChatRejected(
    hooks,
    { sessionID: secondChildID, agent: cleanupAgent },
    resolvedMessage(cleanupAgent, "openai/gpt-5.6-luna"),
  );
});

test("concurrent same-role Tasks bind to their own collision-resistant child markers", async () => {
  const parentID = "concurrent-task-parent";
  const firstChildID = "concurrent-task-child-one";
  const secondChildID = "concurrent-task-child-two";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = {
    [firstChildID]: { id: firstChildID, parentID, agent: expectedAgent },
    [secondChildID]: { id: secondChildID, parentID, agent: expectedAgent },
  };
  const host = historyClient({ sessionsByID });
  const hooks = await router({ preset: "chatgpt" }, host.client);
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));

  const first = {
    args: { description: "parallel first", prompt: "one", subagent_type: "executor" },
  };
  const second = {
    args: { description: "parallel second", prompt: "two", subagent_type: "executor" },
  };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: parentID, callID: "call/.*[one]?" },
    first,
  );
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: parentID, callID: "call+$^{two}" },
    second,
  );
  assert.notEqual(first.args.description, second.args.description);
  assert.match(first.args.description, /^parallel first \[pilotfish-task:[a-f0-9]{64}\]$/);
  assert.match(second.args.description, /^parallel second \[pilotfish-task:[a-f0-9]{64}\]$/);
  sessionsByID[firstChildID].title = `${first.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[secondChildID].title = `${second.args.description} (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[firstChildID]);
  await emitSessionCreated(hooks, sessionsByID[secondChildID]);

  await Promise.all([
    hooks["chat.message"](
      { sessionID: firstChildID, agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
    hooks["chat.message"](
      { sessionID: secondChildID, agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
  ]);
  assert.equal(sessionsByID[firstChildID].title, `parallel first (@${expectedAgent} subagent)`);
  assert.equal(sessionsByID[secondChildID].title, `parallel second (@${expectedAgent} subagent)`);

  const firstOutput = { title: first.args.description, output: "one", metadata: { sessionId: firstChildID } };
  const secondOutput = { title: second.args.description, output: "two", metadata: { sessionId: secondChildID } };
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "call/.*[one]?", args: first.args },
    firstOutput,
  );
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "call+$^{two}", args: second.args },
    secondOutput,
  );
  assert.equal(first.args.description, "parallel first");
  assert.equal(second.args.description, "parallel second");
  assert.equal(firstOutput.title, "parallel first");
  assert.equal(secondOutput.title, "parallel second");
});

test("session.created binds only a matching post-authorization child event", async () => {
  const timing = fakeTiming();
  const parentID = "created-event-parent";
  const childID = "created-event-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "created-event-call");
  sessionsByID[childID].title = `${task.args.description} (@${expectedAgent} subagent)`;

  await emitSessionCreated(hooks, sessionsByID[childID], 999);
  await emitSessionCreated(
    hooks,
    { ...sessionsByID[childID], title: `${task.args.description}x (@${expectedAgent} subagent)` },
    1_001,
  );
  assert.equal(timing.pending(), 1);

  await emitSessionCreated(hooks, sessionsByID[childID], 1_001);
  await emitSessionCreated(hooks, sessionsByID[childID], 1_002);
  await assert.doesNotReject(
    hooks["chat.message"](
      { sessionID: childID, agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
  );
  assert.equal(timing.pending(), 0);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("stale authorization expires without tool after and cannot bind later", async () => {
  const timing = fakeTiming();
  const parentID = "expired-parent";
  const childID = "expired-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "expired-call");
  const markedDescription = task.args.description;
  sessionsByID[childID].title = `${markedDescription} (@${expectedAgent} subagent)`;
  assert.equal(timing.pending(), 1);

  await timing.advance(31);
  assert.equal(timing.pending(), 0);
  assert.equal(task.args.description, "task expired-call");
  assert.equal(host.updateCalls.length, 0);
  assert.equal(sessionsByID[childID].title, `${markedDescription} (@${expectedAgent} subagent)`);
  await emitSessionCreated(hooks, sessionsByID[childID], 1_031);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("bound child title is restored when Task fails before child chat and after is skipped", async () => {
  const timing = fakeTiming();
  const parentID = "bound-expiry-parent";
  const childID = "bound-expiry-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "bound-expiry-call");
  const markedTitle = `${task.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[childID].title = markedTitle;
  await emitSessionCreated(hooks, sessionsByID[childID], 1_001);

  await timing.advance(31);

  assert.equal(timing.pending(), 0);
  assert.equal(task.args.description, "task bound-expiry-call");
  assert.equal(sessionsByID[childID].title, `task bound-expiry-call (@${expectedAgent} subagent)`);
  assert.equal(host.updateCalls.length, 1);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("expiry update failure still revokes without rejecting its timer callback", async () => {
  const timing = fakeTiming();
  const parentID = "failed-expiry-parent";
  const childID = "failed-expiry-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({
    sessionsByID,
    updateFailure: new Error("title store unavailable"),
  });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "failed-expiry-call");
  const markedTitle = `${task.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[childID].title = markedTitle;
  await emitSessionCreated(hooks, sessionsByID[childID], 1_001);

  await assert.doesNotReject(timing.advance(31));

  assert.equal(timing.pending(), 0);
  assert.equal(task.args.description, "task failed-expiry-call");
  assert.equal(sessionsByID[childID].title, markedTitle);
  assert.equal(host.updateCalls.length, 1);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "failed-expiry-call", args: task.args },
    { title: markedTitle, output: "failed", metadata: { sessionId: childID } },
  );
  assert.equal(host.updateCalls.length, 1);
});

test("expiry atomically wins races with child chat and tool after", async () => {
  const timing = fakeTiming();
  const parentID = "expiry-race-parent";
  const childID = "expiry-race-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  let releaseUpdate;
  const updateGate = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  const host = historyClient({
    sessionsByID,
    onUpdate: async (request) => {
      await updateGate;
      Object.assign(sessionsByID[request.path.id], request.body);
      return { data: sessionsByID[request.path.id] };
    },
  });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "expiry-race-call");
  const markedTitle = `${task.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[childID].title = markedTitle;
  await emitSessionCreated(hooks, sessionsByID[childID], 1_001);

  const expiry = timing.advance(31);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.updateCalls.length, 1);
  const childChat = hooks["chat.message"](
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  const output = { title: markedTitle, output: "failed", metadata: { sessionId: childID } };
  const after = hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "expiry-race-call", args: task.args },
    output,
  );

  await assert.rejects(childChat, /no matching parent Task authorization exists/i);
  assert.notEqual(task.args.description, "task expiry-race-call");
  releaseUpdate();
  await Promise.all([expiry, after]);

  assert.equal(host.updateCalls.length, 1);
  assert.equal(sessionsByID[childID].title, `task expiry-race-call (@${expectedAgent} subagent)`);
  assert.equal(task.args.description, "task expiry-race-call");
  assert.equal(output.title, "task expiry-race-call");
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("child title restoration failure blocks execution and remains safely cleanable", async () => {
  const parentID = "restoration-parent";
  const childID = "restoration-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  let updateAttempts = 0;
  const host = historyClient({
    sessionsByID,
    onUpdate: async (request) => {
      updateAttempts++;
      if (updateAttempts === 1) throw new Error("storage unavailable");
      Object.assign(sessionsByID[request.path.id], request.body);
      return { data: sessionsByID[request.path.id] };
    },
  });
  const hooks = await router({ preset: "chatgpt" }, host.client);
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "restoration-call");
  sessionsByID[childID].title = `${task.args.description} (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[childID]);

  await assert.rejects(
    hooks["chat.message"](
      { sessionID: childID, agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
    /title restoration failed.*storage unavailable/i,
  );
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );

  const output = { title: task.args.description, output: "error", metadata: { sessionId: childID } };
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "restoration-call", args: task.args },
    output,
  );
  assert.equal(updateAttempts, 2);
  assert.equal(task.args.description, "task restoration-call");
  assert.equal(output.title, "task restoration-call");
  assert.equal(sessionsByID[childID].title, `task restoration-call (@${expectedAgent} subagent)`);
});

test("resumed Tasks authorize only the exact suitable child without marker mutation", async () => {
  const parentID = "resume-parent";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = {
    "resume-good": {
      id: "resume-good",
      parentID,
      agent: expectedAgent,
      title: `existing work (@${expectedAgent} subagent)`,
    },
    "resume-wrong-parent": {
      id: "resume-wrong-parent",
      parentID: "other-parent",
      agent: expectedAgent,
    },
    "resume-wrong-agent": {
      id: "resume-wrong-agent",
      parentID,
      agent: internalAgentName(TERRA, "executor"),
    },
    "resume-wrong-id": {
      id: "different-id",
      parentID,
      agent: expectedAgent,
    },
  };
  const host = historyClient({ sessionsByID });
  const hooks = await router({ preset: "chatgpt" }, host.client);
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));

  const resumed = {
    args: {
      description: "continue existing",
      prompt: "more work",
      subagent_type: "executor",
      task_id: "resume-good",
    },
  };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: parentID, callID: "resume-call" },
    resumed,
  );
  assert.equal(resumed.args.description, "continue existing");
  assert.equal(resumed.args.task_id, "resume-good");
  assert.equal(resumed.args.subagent_type, expectedAgent);
  await assert.doesNotReject(
    hooks["chat.message"](
      { sessionID: "resume-good", agent: expectedAgent },
      resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
    ),
  );
  assert.equal(host.updateCalls.length, 0);
  await assertDirectChatRejected(
    hooks,
    { sessionID: "resume-good", agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parentID, callID: "resume-call", args: resumed.args },
    { title: "continue existing", output: "done", metadata: { sessionId: "resume-good" } },
  );

  for (const taskID of [
    "resume-wrong-parent",
    "resume-wrong-agent",
    "resume-wrong-id",
    "resume-missing",
    null,
  ]) {
    const task = {
      args: {
        description: "invalid resume",
        subagent_type: "executor",
        task_id: taskID,
      },
    };
    const before = clone(task.args);
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "task", sessionID: parentID, callID: `invalid-${String(taskID)}` },
        task,
      ),
      /cannot authorize resumed Task/i,
    );
    assert.deepEqual(task.args, before);
  }
});

test("resumed Task authorization expires independently without mutating description", async () => {
  const timing = fakeTiming();
  const parentID = "expired-resume-parent";
  const childID = "expired-resume-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = {
    [childID]: { id: childID, parentID, agent: expectedAgent, title: "existing child" },
  };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = {
    args: {
      description: "resume without marker",
      subagent_type: "executor",
      task_id: childID,
    },
  };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: parentID, callID: "expired-resume-call" },
    task,
  );
  assert.equal(task.args.description, "resume without marker");
  assert.equal(timing.pending(), 1);
  await timing.advance(31);
  assert.equal(timing.pending(), 0);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("internal child authorization rejects malformed Task and child identities", async () => {
  const parentID = "authorization-failures";
  const childID = "authorization-child";
  const wrongParentChildID = "wrong-parent-child";
  const rootID = "root-internal";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = {
    [childID]: { id: childID, parentID, agent: expectedAgent },
    [wrongParentChildID]: {
      id: wrongParentChildID,
      parentID: "other-parent",
      agent: expectedAgent,
    },
    [rootID]: { id: rootID, agent: expectedAgent },
  };
  const host = historyClient({ sessionsByID });
  const hooks = await router({ preset: "chatgpt" }, host.client);
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));

  for (const callID of [undefined, "   "]) {
    const missingCallID = { args: { subagent_type: "executor", task_id: "missing-call" } };
    const missingBefore = clone(missingCallID.args);
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "task", sessionID: parentID, callID },
        missingCallID,
      ),
      /no usable callID.*refusing to rewrite/i,
    );
    assert.deepEqual(missingCallID.args, missingBefore);
  }
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "task", sessionID: parentID, callID: "direct-internal" },
      { args: { subagent_type: expectedAgent } },
    ),
    /internal profile agents cannot be invoked directly/i,
  );
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );

  const wrongMarkerTask = await authorizeTask(hooks, parentID, "wrong-marker");
  sessionsByID[childID].title = `${wrongMarkerTask.args.description}x (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[childID]);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await hooks["tool.execute.after"]({
    tool: "task",
    sessionID: parentID,
    callID: "wrong-marker",
  });

  for (const [callID, attemptedAgent, attemptedChild] of [
    ["wrong-profile", internalAgentName(TERRA, "executor"), childID],
    ["wrong-role", internalAgentName(SOL, "scout"), childID],
    ["wrong-parent", expectedAgent, wrongParentChildID],
    ["root", expectedAgent, rootID],
  ]) {
    const task = await authorizeTask(hooks, parentID, callID);
    const attemptedSession = sessionsByID[attemptedChild];
    if (attemptedSession) {
      attemptedSession.title = `${task.args.description} (@${expectedAgent} subagent)`;
      attemptedSession.agent = attemptedAgent;
      await emitSessionCreated(hooks, attemptedSession);
    }
    await assertDirectChatRejected(
      hooks,
      { sessionID: attemptedChild, agent: attemptedAgent },
      resolvedMessage(attemptedAgent, "openai/gpt-5.6-terra"),
    );
    await hooks["tool.execute.after"]({ tool: "task", sessionID: parentID, callID });
  }

  const conflictTask = await authorizeTask(hooks, parentID, "identity-conflict");
  sessionsByID[childID].title = `${conflictTask.args.description} (@${expectedAgent} subagent)`;
  sessionsByID[childID].agent = expectedAgent;
  await emitSessionCreated(hooks, sessionsByID[childID]);
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: internalAgentName(SOL, "scout") },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await hooks["tool.execute.after"]({
    tool: "task",
    sessionID: parentID,
    callID: "identity-conflict",
  });

  const deactivatedTask = await authorizeTask(hooks, parentID, "deactivated-parent");
  sessionsByID[childID].title = `${deactivatedTask.args.description} (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[childID]);
  await hooks["chat.message"]({ ...message(parentID, "openai/gpt-5.6-sol"), agent: "build" });
  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
  await hooks["tool.execute.after"]({
    tool: "task",
    sessionID: parentID,
    callID: "deactivated-parent",
  });
});

test("internal child authorization rejects session lookup failures", async () => {
  const cases = [
    {
      name: "missing-get",
      client: { session: { messages: async () => ({ data: [] }) } },
      error: /client\.session\.get is unavailable/i,
    },
    {
      name: "get-throws",
      client: historyClient({ getFailure: new Error("offline") }).client,
      error: /child session lookup failed.*offline/i,
    },
    {
      name: "get-error",
      client: historyClient({ getResultError: { message: "denied" } }).client,
      error: /returned an error while reading the child session/i,
    },
    {
      name: "malformed-get",
      client: historyClient({ onGet: async () => ({ data: null }) }).client,
      error: /malformed child session data/i,
    },
  ];

  for (const entry of cases) {
    const parentID = `parent-${entry.name}`;
    const childID = `child-${entry.name}`;
    const hooks = await router({ preset: "chatgpt" }, entry.client);
    await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
    const task = await authorizeTask(hooks, parentID, `call-${entry.name}`);
    const expectedAgent = internalAgentName(SOL, "executor");
    await emitSessionCreated(hooks, {
      id: childID,
      parentID,
      agent: expectedAgent,
      title: `${task.args.description} (@${expectedAgent} subagent)`,
    });
    await assert.rejects(
      hooks["chat.message"](
        { sessionID: childID, agent: expectedAgent },
        resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
      ),
      entry.error,
    );
    await hooks.event({
      event: { type: "session.deleted", properties: { info: { id: parentID } } },
    });
  }
});

test("parent session deletion clears unconsumed internal child authorization", async () => {
  const timing = fakeTiming();
  const parentID = "deleted-authorization-parent";
  const childID = "deleted-authorization-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "deleted-authorization-call");
  sessionsByID[childID].title = `${task.args.description} (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[childID]);
  assert.equal(timing.pending(), 1);
  await hooks.event({
    event: { type: "session.deleted", properties: { info: { id: parentID } } },
  });
  assert.equal(timing.pending(), 0);
  assert.equal(task.args.description, "task deleted-authorization-call");
  assert.equal(
    sessionsByID[childID].title,
    `task deleted-authorization-call (@${expectedAgent} subagent)`,
  );
  assert.equal(host.updateCalls.length, 1);

  await assertDirectChatRejected(
    hooks,
    { sessionID: childID, agent: expectedAgent },
    resolvedMessage(expectedAgent, "openai/gpt-5.6-terra"),
  );
});

test("router disposal clears authorization timers and restores transient descriptions", async () => {
  const timing = fakeTiming();
  const parentID = "disposed-parent";
  const childID = "disposed-child";
  const expectedAgent = internalAgentName(SOL, "executor");
  const sessionsByID = { [childID]: { id: childID, parentID, agent: expectedAgent } };
  const host = historyClient({ sessionsByID });
  const hooks = await router(
    { preset: "chatgpt", __testTiming: timing.options },
    host.client,
  );
  await hooks["chat.message"](message(parentID, "openai/gpt-5.6-sol"));
  const task = await authorizeTask(hooks, parentID, "disposed-call");
  sessionsByID[childID].title = `${task.args.description} (@${expectedAgent} subagent)`;
  await emitSessionCreated(hooks, sessionsByID[childID], 1_001);
  assert.notEqual(task.args.description, "task disposed-call");
  assert.equal(timing.pending(), 1);

  await hooks.dispose();

  assert.equal(timing.pending(), 0);
  assert.equal(task.args.description, "task disposed-call");
  assert.equal(sessionsByID[childID].title, `task disposed-call (@${expectedAgent} subagent)`);
  assert.equal(host.updateCalls.length, 1);
});

test("session deletion only cleans the deleted session", async () => {
  const hooks = await router({ preset: "chatgpt" });
  await hooks["chat.message"](message("one", "openai/gpt-5.6-sol"));
  await hooks["chat.message"](message("two", "openai/gpt-5.6-terra"));
  await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "one" } } } });

  const one = { args: { subagent_type: "executor" } };
  const two = { args: { description: "session two", subagent_type: "executor" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "one" }, one);
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: "two", callID: "session-two-task" },
    two,
  );
  assert.equal(one.args.subagent_type, "executor");
  assert.equal(two.args.subagent_type, internalAgentName(TERRA, "executor"));
});

test("cross-preset primary models fail before routing", async () => {
  const chatgpt = await router({ preset: "chatgpt" });
  await assert.rejects(
    chatgpt["chat.message"](message("wrong-chatgpt", AG_PRIMARY, "max")),
    /does not support/i,
  );

  const antigravity = await router({ preset: "antigravity" });
  await assert.rejects(
    antigravity["chat.message"](message("wrong-antigravity", "openai/gpt-5.6-sol")),
    /does not support/i,
  );
});

test("each preset activates only its own profiles", async () => {
  const config = antigravityConfig();
  const hooks = await router({ preset: "antigravity" });
  hooks.config(config);

  for (const profile of profiles.presets.antigravity) {
    for (const role of workers) {
      const generated = config.agent[internalAgentName(profile, role)];
      assert.ok(generated, `missing clone for ${profile}/${role}`);
      assert.equal(generated.hidden, true);
      assert.equal(generated.model, profiles.profiles[profile].workers[role].model);
      assert.equal(generated.variant, profiles.profiles[profile].workers[role].variant);
    }
  }
  for (const profile of profiles.presets.chatgpt) {
    for (const role of workers) {
      const name = internalAgentName(profile, role);
      assert.equal(config.agent[name], undefined);
      assert.equal(config.agent.pilotfish.permission.task[name], undefined);
    }
  }

  await hooks["chat.message"](message("ag", AG_PRIMARY, "max"));
  const task = { args: { subagent_type: "executor", description: "routed" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "ag", callID: "ag-only" }, task);
  assert.equal(task.args.subagent_type, internalAgentName(OPUS, "executor"));

  await assertDirectInvocationRejected(
    hooks,
    "ag",
    internalAgentName(LUNA, "security-reviewer"),
  );
});

test("configuration errors are deferred without partial mutation and spare non-Pilotfish sessions", async () => {
  const collision = chatgptConfig();
  collision.agent[internalAgentName(SOL, "executor")] = {};
  const collisionBefore = clone(collision);
  const collisionHooks = await router({ preset: "chatgpt" });
  collisionHooks.config(collision);
  assert.deepEqual(collision, collisionBefore);
  await assert.rejects(
    collisionHooks["chat.message"](message("collision", "openai/gpt-5.6-sol")),
    /configuration failed.*internal agent collision/i,
  );
  await assert.doesNotReject(
    collisionHooks["chat.message"]({ ...message("other", "openai/gpt-5.6-sol"), agent: "other" }),
  );

  const incompatible = chatgptConfig();
  incompatible.agent.pilotfish.permission.task.executor = "deny";
  await assertChatGPTConfigurationRejected(
    incompatible,
    /configuration failed.*refusing to weaken customized Task permission/i,
  );

  const customizedAntigravity = antigravityConfig();
  customizedAntigravity.agent.executor.variant = "max";
  const antigravityHooks = await router({ preset: "antigravity" });
  antigravityHooks.config(customizedAntigravity);
  await assert.doesNotReject(
    antigravityHooks["chat.message"](message("customized-ag", AG_PRIMARY, "max")),
  );
  assert.equal(customizedAntigravity.agent.executor.variant, "max");
  assert.equal(
    customizedAntigravity.agent[internalAgentName(OPUS, "executor")].variant,
    profiles.profiles[OPUS].workers.executor.variant,
  );
});

test("a restarted ChatGPT router recovers the first persisted Pilotfish model", async () => {
  const sessionID = "restart-sol";
  const firstProcess = await router({ preset: "chatgpt" });
  await firstProcess["chat.message"](message(sessionID, "openai/gpt-5.6-sol"));

  const history = historyClient({
    historyBySession: {
      [sessionID]: [persistedMessage("openai/gpt-5.6-sol", 100)],
    },
  });
  const restarted = await router({ preset: "chatgpt" }, history.client);
  await restarted["chat.message"](message(sessionID, "openai/gpt-5.6-sol", "xhigh"));
  const task = { args: { description: "restarted task", subagent_type: "executor" } };
  await restarted["tool.execute.before"](
    { tool: "task", sessionID, callID: "restarted-task" },
    task,
  );

  assert.equal(history.calls.length, 1);
  assert.deepEqual(history.calls[0], { path: { id: sessionID } });
  assert.equal(task.args.subagent_type, internalAgentName(SOL, "executor"));
});

test("recovered profiles reject model changes but allow effort changes", async () => {
  const sessionID = "recovered-terra";
  const history = historyClient({
    historyBySession: {
      [sessionID]: [persistedMessage("openai/gpt-5.6-terra", 100)],
    },
  });
  const hooks = await router({ preset: "chatgpt" }, history.client);

  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-terra", "low"));
  await assert.rejects(
    hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
    /model changed.*new session/i,
  );
  assert.equal(history.calls.length, 1);
});

test("recovery orders history by creation time and ignores non-Pilotfish messages", async () => {
  const sessionID = "forked-history";
  const history = historyClient({
    historyBySession: {
      [sessionID]: [
        persistedMessage("openai/gpt-5.6-sol", 300),
        persistedMessage("openai/gpt-5.6-luna", 1, "build"),
        persistedMessage("openai/gpt-5.6-terra", 100),
        persistedMessage("openai/gpt-5.6-luna", 100),
      ],
    },
  });
  const hooks = await router({ preset: "chatgpt" }, history.client);

  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-luna"));
  const task = { args: { description: "history order", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "history-order-task" },
    task,
  );

  assert.equal(task.args.subagent_type, internalAgentName(LUNA, "executor"));
});

test("recovery fails closed for malformed history and history API failures", async () => {
  const malformedResult = await router(
    { preset: "chatgpt" },
    historyClient({ onMessages: async () => ({ data: {} }) }).client,
  );
  await assert.rejects(
    malformedResult["chat.message"](message("malformed-result", "openai/gpt-5.6-sol")),
    /could not recover.*malformed session history.*Do not continue this session/i,
  );

  const malformed = await router(
    { preset: "chatgpt" },
    historyClient({
      historyBySession: {
        malformed: [{ info: { role: "user", agent: "pilotfish", time: { created: 1 } }, parts: [] }],
      },
    }).client,
  );
  await assert.rejects(
    malformed["chat.message"](message("malformed", "openai/gpt-5.6-sol")),
    /could not recover.*malformed model data.*Do not continue this session/i,
  );

  const throws = await router(
    { preset: "chatgpt" },
    historyClient({ failure: new Error("offline") }).client,
  );
  await assert.rejects(
    throws["chat.message"](message("throws", "openai/gpt-5.6-sol")),
    /could not recover.*retrieval failed.*offline/i,
  );

  const resultError = await router(
    { preset: "chatgpt" },
    historyClient({ resultError: { message: "denied" } }).client,
  );
  await assert.rejects(
    resultError["chat.message"](message("result-error", "openai/gpt-5.6-sol")),
    /could not recover.*returned an error/i,
  );
});

test("recovery rejects malformed Pilotfish roles while ignoring valid assistant records", async () => {
  for (const [sessionID, role] of [
    ["missing-pilotfish-role", undefined],
    ["unknown-pilotfish-role", "system"],
  ]) {
    const hooks = await router(
      { preset: "chatgpt" },
      historyClient({
        historyBySession: { [sessionID]: [{ info: { agent: "pilotfish", role }, parts: [] }] },
      }).client,
    );
    await assert.rejects(
      hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
      /could not recover.*Pilotfish-tagged history record has a malformed role/i,
    );
  }

  const sessionID = "assistant-before-user";
  const hooks = await router(
    { preset: "chatgpt" },
    historyClient({
      historyBySession: {
        [sessionID]: [
          { info: { role: "assistant", agent: "pilotfish" }, parts: [] },
          persistedMessage("openai/gpt-5.6-terra", 2),
        ],
      },
    }).client,
  );
  await hooks["chat.message"](message(sessionID, "openai/gpt-5.6-terra"));
  const task = { args: { description: "assistant history", subagent_type: "executor" } };
  await hooks["tool.execute.before"](
    { tool: "task", sessionID, callID: "assistant-history-task" },
    task,
  );
  assert.equal(task.args.subagent_type, internalAgentName(TERRA, "executor"));
});

test("recovery validates Pilotfish user time and ignores unrelated malformed records", async () => {
  const missingTime = await router(
    { preset: "chatgpt" },
    historyClient({
      historyBySession: {
        "missing-user-time": [
          { info: { role: "user", agent: "pilotfish", model: { providerID: "openai", modelID: "gpt-5.6-sol" } } },
        ],
      },
    }).client,
  );
  await assert.rejects(
    missingTime["chat.message"](message("missing-user-time", "openai/gpt-5.6-sol")),
    /could not recover.*no usable creation time/i,
  );

  const sessionID = "unrelated-malformed";
  const unrelated = await router(
    { preset: "chatgpt" },
    historyClient({
      historyBySession: {
        [sessionID]: [null, {}, { info: null }, { info: { agent: "build", role: null } }],
      },
    }).client,
  );
  await assert.doesNotReject(
    unrelated["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
  );
});

test("concurrent cache misses share recovery and recheck the session pin", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const history = historyClient({
    onMessages: async () => {
      await waiting;
      return { data: [persistedMessage("openai/gpt-5.6-sol", 1)] };
    },
  });
  const hooks = await router({ preset: "chatgpt" }, history.client);
  const first = hooks["chat.message"](message("concurrent", "openai/gpt-5.6-sol"));
  const second = hooks["chat.message"](message("concurrent", "openai/gpt-5.6-terra"));
  release();

  await assert.doesNotReject(first);
  await assert.rejects(second, /model changed.*new session/i);
  assert.equal(history.calls.length, 1);
});

test("session deletion clears a pending recovery before it can pin the session", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const hooks = await router(
    { preset: "chatgpt" },
    historyClient({
      onMessages: async () => {
        await waiting;
        return { data: [persistedMessage("openai/gpt-5.6-sol", 1)] };
      },
    }).client,
  );
  const pending = hooks["chat.message"](message("deleted-pending", "openai/gpt-5.6-sol"));
  await hooks.event({
    event: { type: "session.deleted", properties: { info: { id: "deleted-pending" } } },
  });
  release();

  await assert.rejects(pending, /could not recover.*session was deleted/i);
});

test("a restarted AntiGravity router recovers its persisted profile", async () => {
  const sessionID = "restart-antigravity";
  const history = historyClient({
    historyBySession: {
      [sessionID]: [
        persistedMessage("openai/gpt-5.6-sol", 1, "build"),
        persistedMessage(AG_PRIMARY, 100),
      ],
    },
  });
  const hooks = await router({ preset: "antigravity" }, history.client);

  await hooks["chat.message"](message(sessionID, AG_PRIMARY, "low"));
  await assert.rejects(
    hooks["chat.message"](message(sessionID, "openai/gpt-5.6-sol")),
    /model changed.*new session/i,
  );
});

test("the default plugin path fails closed when OpenCode supplies no client", async () => {
  const hooks = await profileRouterPlugin({}, { preset: "chatgpt" });
  await assert.rejects(
    hooks["chat.message"](message("no-client", "openai/gpt-5.6-sol")),
    /could not recover.*client\.session\.messages is unavailable.*Do not continue this session/i,
  );
});

test("an omitted preset activates every defined profile", async () => {
  const config = chatgptConfig();
  const hooks = await router();
  hooks.config(config);

  for (const profile of Object.keys(profiles.profiles)) {
    for (const role of workers) {
      assert.ok(config.agent[internalAgentName(profile, role)], `missing ${profile}/${role}`);
    }
  }

  const sessionID = "every-profile";
  await hooks["chat.message"](message(sessionID, AG_PRIMARY, "max"));
  const task = { args: { subagent_type: "scout", description: "routed" } };
  await hooks["tool.execute.before"]({ tool: "task", sessionID, callID: "all" }, task);
  assert.equal(task.args.subagent_type, internalAgentName(OPUS, "scout"));
});
