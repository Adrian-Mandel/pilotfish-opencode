import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PROFILES_URL = new URL("./profiles.json", import.meta.url);
const INTERNAL_PREFIX = "pilotfish-profile-";
const TASK_MARKER_PREFIX = " [pilotfish-task:";
const TASK_MARKER_SUFFIX = "]";
const TASK_AUTHORIZATION_TTL_MS = 30_000;

function loadProfiles() {
  return JSON.parse(readFileSync(PROFILES_URL, "utf8"));
}

function internalAgentName(profile, role) {
  return `${INTERNAL_PREFIX}${profile}-${role}`;
}

function taskAuthorizationMarker(callID) {
  return createHash("sha256").update(callID, "utf8").digest("hex");
}

function markedTaskDescription(description, marker) {
  return `${description}${TASK_MARKER_PREFIX}${marker}${TASK_MARKER_SUFFIX}`;
}

function taskChildTitle(description, agent) {
  // Mirrors the child title format in OpenCode v1.18.10 packages/opencode/src/tool/task.ts.
  return `${description} (@${agent} subagent)`;
}

function taskMarkerFromTitle(title, agent) {
  if (typeof title !== "string") return undefined;
  const agentSuffix = ` (@${agent} subagent)`;
  if (!title.endsWith(agentSuffix)) return undefined;
  const description = title.slice(0, -agentSuffix.length);
  const markerStart = description.lastIndexOf(TASK_MARKER_PREFIX);
  if (markerStart < 0 || !description.endsWith(TASK_MARKER_SUFFIX)) return undefined;
  const marker = description.slice(
    markerStart + TASK_MARKER_PREFIX.length,
    -TASK_MARKER_SUFFIX.length,
  );
  return /^[a-f0-9]{64}$/.test(marker) ? marker : undefined;
}

function isInternalAgentName(agent) {
  return typeof agent === "string" && agent.startsWith(INTERNAL_PREFIX);
}

function rejectDirectInternalChat(input, output) {
  for (const agent of [output?.message?.agent, input?.agent]) {
    if (isInternalAgentName(agent)) {
      throw new Error(
        "Pilotfish internal profile agents cannot be invoked directly through chat; select the public pilotfish agent instead.",
      );
    }
  }
}

function rejectDirectInternalTask(input, output) {
  if (input?.tool !== "task" || !isObject(output?.args)) return;
  const requestedRole = output.args.subagent_type;
  if (isInternalAgentName(requestedRole)) {
    throw new Error(
      "Pilotfish internal profile agents cannot be invoked directly; request a public Pilotfish worker role instead.",
    );
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameBinding(actual, expected) {
  return (
    isObject(actual) &&
    actual.model === expected.model &&
    actual.variant === expected.variant
  );
}

function modelName(model) {
  if (typeof model === "string") return model;
  if (!isObject(model)) return undefined;
  if (typeof model.providerID === "string" && typeof model.modelID === "string") {
    return `${model.providerID}/${model.modelID}`;
  }
  return typeof model.model === "string" ? model.model : undefined;
}

function validateBinding(binding, label) {
  if (!isObject(binding) || typeof binding.model !== "string") {
    throw new Error(`Pilotfish profile data has no model for ${label}.`);
  }
  if (binding.variant !== undefined && typeof binding.variant !== "string") {
    throw new Error(`Pilotfish profile data has an invalid variant for ${label}.`);
  }
}

function validateProfiles(data) {
  if (!isObject(data) || !Array.isArray(data.publicRoles) || !isObject(data.profiles)) {
    throw new Error("Pilotfish profile data must define publicRoles and profiles.");
  }

  const [primary, ...workers] = data.publicRoles;
  if (primary !== "pilotfish" || workers.length !== 8 || new Set(data.publicRoles).size !== 9) {
    throw new Error("Pilotfish profile data must define pilotfish and exactly eight public workers.");
  }

  for (const profile of ["sol", "terra", "luna"]) {
    const mapping = data.profiles[profile];
    if (!isObject(mapping) || !isObject(mapping.workers)) {
      throw new Error(`Pilotfish profile data is missing the ${profile} mapping.`);
    }
    validateBinding(mapping.primary, `${profile} primary`);
    if (Object.keys(mapping.workers).length !== workers.length) {
      throw new Error(`Pilotfish profile data has incomplete ${profile} worker mappings.`);
    }
    for (const role of workers) {
      validateBinding(mapping.workers[role], `${profile} ${role}`);
    }
  }

  if (!isObject(data.antigravity) || !isObject(data.antigravity.workers)) {
    throw new Error("Pilotfish profile data is missing the antigravity mapping.");
  }
  validateBinding(data.antigravity.primary, "antigravity primary");
  if (Object.keys(data.antigravity.workers).length !== workers.length) {
    throw new Error("Pilotfish profile data has incomplete antigravity worker mappings.");
  }
  for (const role of workers) {
    validateBinding(data.antigravity.workers[role], `antigravity ${role}`);
  }

  return data;
}

function validatePublicWorkers(agents, workers) {
  for (const role of workers) {
    const worker = agents[role];
    if (!isObject(worker)) {
      throw new Error(`Pilotfish profile router requires public worker agent "${role}".`);
    }
    if (!Object.hasOwn(worker, "mode") || worker.mode !== "subagent") {
      throw new Error(
        `Pilotfish profile router requires public worker agent "${role}" to have mode "subagent"; refusing to clone or route a customized non-subagent worker.`,
      );
    }
  }
}

function taskPatternMatches(pattern, agentName) {
  // Mirrors OpenCode v1.18.10 packages/core/src/util/wildcard.ts.
  const normalized = agentName.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(
    normalized,
  );
}

function lastMatchingTaskRule(entries, agentName) {
  let match;
  for (const [pattern, action] of entries) {
    if (taskPatternMatches(pattern, agentName)) match = { pattern, action };
  }
  return match;
}

function extendTaskPermission(pilotfish, cloneNames, workers) {
  const task = pilotfish?.permission?.task;
  const entries = isObject(task) ? Object.entries(task) : [];
  const compatible =
    entries[0]?.[0] === "*" &&
    entries[0]?.[1] === "deny" &&
    workers.every((role) => {
      const resolved = lastMatchingTaskRule(entries, role);
      return task[role] === "allow" && resolved?.pattern === role && resolved.action === "allow";
    });
  if (!compatible) {
    throw new Error(
      "Pilotfish profile router cannot extend agent.pilotfish.permission.task: expected the first Task rule to be \"*\": \"deny\" and every public worker to resolve through its explicit \"allow\" entry; refusing to weaken customized Task permission.",
    );
  }

  for (const [pattern] of entries.slice(1)) {
    const matchedName = cloneNames.find((name) => taskPatternMatches(pattern, name));
    if (matchedName) {
      throw new Error(
        `Pilotfish profile router cannot extend agent.pilotfish.permission.task: pre-existing Task rule "${pattern}" can match internal profile agent "${matchedName}". Remove or narrow that rule before starting Pilotfish; refusing to override customized Task permission.`,
      );
    }
  }

  for (const name of cloneNames) task[name] = "allow";
}

function configureChatGPT(config, data) {
  const agents = config?.agent;
  if (!isObject(agents) || !isObject(agents.pilotfish)) {
    throw new Error("Pilotfish profile router requires the public pilotfish agent.");
  }

  const workers = data.publicRoles.slice(1);
  validatePublicWorkers(agents, workers);
  const cloneNames = [];
  for (const profile of Object.keys(data.profiles)) {
    for (const role of workers) cloneNames.push(internalAgentName(profile, role));
  }
  for (const name of cloneNames) {
    if (Object.hasOwn(agents, name)) {
      throw new Error(`Pilotfish profile router refuses internal agent collision at "${name}".`);
    }
  }

  const clones = {};
  for (const [profile, mapping] of Object.entries(data.profiles)) {
    for (const role of workers) {
      const clone = structuredClone(agents[role]);
      const binding = mapping.workers[role];
      clone.hidden = true;
      clone.model = binding.model;
      clone.variant = binding.variant;
      clones[internalAgentName(profile, role)] = clone;
    }
  }

  extendTaskPermission(agents.pilotfish, cloneNames, workers);
  Object.assign(agents, clones);
}

function configureAntigravity(config, data) {
  const agents = config?.agent;
  if (!isObject(agents) || !isObject(agents.pilotfish)) {
    throw new Error("Pilotfish profile router requires the public pilotfish agent.");
  }

  const workers = data.publicRoles.slice(1);
  validatePublicWorkers(agents, workers);
  for (const role of workers) {
    if (!sameBinding(agents[role], data.antigravity.workers[role])) {
      throw new Error(
        `Pilotfish AntiGravity passthrough requires public worker "${role}" to match the canonical AntiGravity model and variant.`,
      );
    }
  }
}

function profileForModel(data, model) {
  return Object.entries(data.profiles).find(([, profile]) => profile.primary.model === model);
}

function stateForModel(data, preset, model) {
  if (preset === "chatgpt") {
    const match = profileForModel(data, model);
    if (!match) {
      throw new Error(`Pilotfish ChatGPT profile does not support primary model "${model ?? "unknown"}".`);
    }
    return { kind: "mapped", model, profile: match[0] };
  }

  if (model !== data.antigravity.primary.model) {
    throw new Error(`Pilotfish AntiGravity preset does not support primary model "${model ?? "unknown"}".`);
  }
  return { kind: "passthrough", model };
}

function historyTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

function recoveryError(detail) {
  return new Error(
    `Pilotfish could not recover this session's persisted model profile${detail ? `: ${detail}` : ""}. Do not continue this session; restore OpenCode history access or start a new session.`,
  );
}

function createInitializationFailureHooks() {
  const initializationError = () =>
    new Error(
      "Pilotfish profile router initialization failed. Fix the Pilotfish router preset and managed runtime files, restart OpenCode, and start a new session.",
    );

  return {
    config() {},

    async "chat.message"(input, output) {
      rejectDirectInternalChat(input, output);
      const resolvedAgent = output?.message?.agent;
      const rawAgent = input?.agent;
      if (resolvedAgent === "pilotfish" || rawAgent === "pilotfish") {
        throw initializationError();
      }
    },

    async "tool.execute.before"(input, output) {
      rejectDirectInternalTask(input, output);
    },

    async dispose() {},
  };
}

async function recoverPersistedState(client, sessionID, data, preset) {
  if (typeof client?.session?.messages !== "function") {
    throw recoveryError("OpenCode client.session.messages is unavailable");
  }

  let result;
  try {
    result = await client.session.messages({ path: { id: sessionID } });
  } catch (error) {
    throw recoveryError(`session history retrieval failed (${error?.message ?? "unknown error"})`);
  }
  if (!isObject(result) || (result.error !== undefined && result.error !== null)) {
    throw recoveryError("OpenCode returned an error while reading session history");
  }
  if (!Array.isArray(result.data)) {
    throw recoveryError("OpenCode returned malformed session history");
  }

  const priorPilotfishMessages = [];
  for (const message of result.data) {
    const info = message?.info;
    if (!isObject(info) || info.agent !== "pilotfish") continue;
    if (info.role === "assistant") continue;
    if (info.role !== "user") {
      throw recoveryError("a Pilotfish-tagged history record has a malformed role");
    }
    const model = modelName(info.model);
    if (!model) {
      throw recoveryError("a prior Pilotfish user message has malformed model data");
    }
    const created = historyTimestamp(info.time?.created);
    if (created === undefined) {
      throw recoveryError("a prior Pilotfish user message has no usable creation time");
    }
    priorPilotfishMessages.push({ created, model });
  }

  if (priorPilotfishMessages.length === 0) return undefined;
  priorPilotfishMessages.sort((left, right) =>
    left.created - right.created || left.model.localeCompare(right.model),
  );
  const first = priorPilotfishMessages[0];
  try {
    return stateForModel(data, preset, first.model);
  } catch (error) {
    throw recoveryError(`the first persisted Pilotfish model is unsupported (${first.model})`);
  }
}

function createProfileRouter(options = {}) {
  const preset = options.preset;
  if (preset !== "chatgpt" && preset !== "antigravity") {
    throw new Error('Pilotfish profile router option "preset" must be "chatgpt" or "antigravity".');
  }

  const data = validateProfiles(loadProfiles());
  const sessions = new Map();
  const currentAgents = new Map();
  const pendingRecoveries = new Map();
  const taskAuthorizations = new Map();
  // Tests may inject deterministic timers; production expiry can only be shortened, never extended.
  const testTiming = isObject(options.__testTiming) ? options.__testTiming : {};
  const authorizationTTL =
    typeof testTiming.ttl === "number" && Number.isFinite(testTiming.ttl)
      ? Math.max(1, Math.min(TASK_AUTHORIZATION_TTL_MS, testTiming.ttl))
      : TASK_AUTHORIZATION_TTL_MS;
  const now = typeof testTiming.now === "function" ? testTiming.now : Date.now;
  const scheduleTimeout =
    typeof testTiming.setTimeout === "function" ? testTiming.setTimeout : setTimeout;
  const cancelTimeout =
    typeof testTiming.clearTimeout === "function" ? testTiming.clearTimeout : clearTimeout;
  let configurationError;

  function clearAuthorizationTimer(authorization) {
    if (authorization.timer === undefined) return;
    cancelTimeout(authorization.timer);
    authorization.timer = undefined;
  }

  function restoreAuthorizationArgs(authorization) {
    if (authorization.resumed === true || !isObject(authorization.taskArgs)) return;
    authorization.taskArgs.description = authorization.originalDescription;
  }

  function finalizeAuthorization(parentSessionID, callID, authorization) {
    const byCall = taskAuthorizations.get(parentSessionID);
    if (!byCall || byCall.get(callID) !== authorization) return;
    clearAuthorizationTimer(authorization);
    restoreAuthorizationArgs(authorization);
    byCall.delete(callID);
    if (byCall.size === 0) taskAuthorizations.delete(parentSessionID);
  }

  function authorizationExpired(parentSessionID, callID, authorization) {
    if (authorization.expiresAt > now()) return false;
    void cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {});
    return true;
  }

  function scheduleAuthorizationExpiry(parentSessionID, callID, authorization) {
    authorization.timer = scheduleTimeout(
      () => cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {}),
      authorizationTTL,
    );
    authorization.timer?.unref?.();
  }

  async function restoreMarkedBoundChildTitle(parentSessionID, authorization) {
    if (
      authorization.resumed === true ||
      authorization.bound !== true ||
      authorization.titleRestored === true
    ) {
      return;
    }
    const childSessionID = authorization.boundChildSessionID;
    if (typeof childSessionID !== "string" || childSessionID.length === 0) return;
    if (typeof options.client?.session?.get !== "function") {
      throw new Error("OpenCode client.session.get is unavailable for child title cleanup");
    }

    let result;
    try {
      result = await options.client.session.get({ path: { id: childSessionID } });
    } catch (error) {
      throw new Error(`child title cleanup lookup failed (${error?.message ?? "unknown error"})`);
    }
    if (
      !isObject(result) ||
      (result.error !== undefined && result.error !== null) ||
      !isObject(result.data)
    ) {
      throw new Error("OpenCode returned invalid child data during title cleanup");
    }
    if (
      result.data.id !== childSessionID ||
      result.data.parentID !== parentSessionID ||
      result.data.agent !== authorization.expectedAgent
    ) {
      throw new Error("OpenCode returned a different child during title cleanup");
    }
    if (result.data.title !== authorization.markedTitle) {
      authorization.titleRestored = true;
      return;
    }

    await updateChildTitle(childSessionID, authorization.boundCleanTitle);
    authorization.titleRestored = true;
  }

  function cleanupAuthorization(parentSessionID, callID, authorization) {
    if (authorization.cleanupPromise) return authorization.cleanupPromise;

    // Revocation is synchronous so chat/after races cannot replay it while cleanup is awaited.
    authorization.cleanupStarted = true;
    authorization.revoked = true;
    clearAuthorizationTimer(authorization);
    const priorOperation = authorization.operationPromise;
    authorization.cleanupPromise = (async () => {
      try {
        if (priorOperation) await priorOperation.catch(() => {});
        await restoreMarkedBoundChildTitle(parentSessionID, authorization);
      } finally {
        finalizeAuthorization(parentSessionID, callID, authorization);
      }
    })();
    return authorization.cleanupPromise;
  }

  async function clearParentAuthorizations(parentSessionID) {
    const byCall = taskAuthorizations.get(parentSessionID);
    if (!byCall) return;
    const cleanups = [];
    for (const [callID, authorization] of [...byCall.entries()]) {
      cleanups.push(cleanupAuthorization(parentSessionID, callID, authorization));
    }
    await Promise.allSettled(cleanups);
  }

  function internalChatError(detail) {
    return new Error(
      `Pilotfish internal profile agents cannot be invoked directly through chat: ${detail}. Only one-time router-authorized Task children are allowed; select the public pilotfish agent instead.`,
    );
  }

  async function updateChildTitle(childSessionID, title) {
    if (typeof options.client?.session?.update !== "function") {
      throw new Error("OpenCode client.session.update is unavailable");
    }
    let result;
    try {
      result = await options.client.session.update({
        path: { id: childSessionID },
        body: { title },
      });
    } catch (error) {
      throw new Error(`child title restoration failed (${error?.message ?? "unknown error"})`);
    }
    if (!isObject(result) || (result.error !== undefined && result.error !== null)) {
      throw new Error("OpenCode returned an error while restoring the child title");
    }
    if (!isObject(result.data)) {
      throw new Error("OpenCode returned malformed child data after title restoration");
    }
  }

  async function authorizeInternalChildChat(input, output) {
    const rawAgent = input?.agent;
    const resolvedAgent = output?.message?.agent;
    if (!isInternalAgentName(resolvedAgent)) {
      throw internalChatError("the resolved chat agent is not the requested internal agent");
    }
    if (rawAgent !== undefined && rawAgent !== resolvedAgent) {
      throw internalChatError("the raw and resolved chat agents conflict");
    }
    const childSessionID = input?.sessionID;
    if (typeof childSessionID !== "string" || childSessionID.length === 0) {
      throw internalChatError("the child session ID is missing");
    }
    if (typeof options.client?.session?.get !== "function") {
      throw internalChatError("OpenCode client.session.get is unavailable");
    }

    let result;
    try {
      result = await options.client.session.get({ path: { id: childSessionID } });
    } catch (error) {
      throw internalChatError(`child session lookup failed (${error?.message ?? "unknown error"})`);
    }
    if (!isObject(result) || (result.error !== undefined && result.error !== null)) {
      throw internalChatError("OpenCode returned an error while reading the child session");
    }
    if (!isObject(result.data)) {
      throw internalChatError("OpenCode returned malformed child session data");
    }
    if (result.data.id !== childSessionID) {
      throw internalChatError("OpenCode returned a different child session");
    }
    const parentSessionID = result.data.parentID;
    if (typeof parentSessionID !== "string" || parentSessionID.length === 0) {
      throw internalChatError("the chat session has no parent Task session");
    }
    if (result.data.agent !== resolvedAgent) {
      throw internalChatError("the child session agent does not match the resolved internal agent");
    }

    const byCall = taskAuthorizations.get(parentSessionID);
    const entries = byCall ? [...byCall.entries()] : [];
    for (const [callID, authorization] of entries) {
      authorizationExpired(parentSessionID, callID, authorization);
    }
    const currentByCall = taskAuthorizations.get(parentSessionID);
    const marker = taskMarkerFromTitle(result.data.title, resolvedAgent);
    const matches = currentByCall
      ? [...currentByCall.entries()].filter(
          ([, authorization]) =>
            authorization.consumed !== true &&
            authorization.cleanupStarted !== true &&
            authorization.expectedAgent === resolvedAgent &&
            (authorization.resumed === true
              ? authorization.childSessionID === childSessionID
              : authorization.bound === true &&
                authorization.boundChildSessionID === childSessionID &&
                authorization.marker === marker &&
                authorization.markedTitle === result.data.title),
        )
      : [];
    if (matches.length !== 1) {
      throw internalChatError(
        matches.length === 0
          ? "no matching parent Task authorization exists"
          : "multiple exact child Task authorizations are ambiguous",
      );
    }

    const [callID, authorization] = matches[0];
    authorization.consumed = true;
    authorization.operationOwner = "child-chat";
    clearAuthorizationTimer(authorization);
    restoreAuthorizationArgs(authorization);
    const currentAgent = currentAgents.get(parentSessionID);
    const state = sessions.get(parentSessionID);
    const expectedAgent =
      state?.kind === "mapped"
        ? internalAgentName(state.profile, authorization.publicRole)
        : undefined;
    if (
      currentAgent?.agent !== "pilotfish" ||
      currentAgent.active !== true ||
      state?.kind !== "mapped" ||
      state.profile !== authorization.profile ||
      expectedAgent !== authorization.expectedAgent ||
      resolvedAgent !== authorization.expectedAgent
    ) {
      await cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {});
      throw internalChatError("the parent Pilotfish routing state no longer authorizes this child");
    }

    if (authorization.resumed !== true) {
      const restoration = (async () => {
        await updateChildTitle(
          authorization.boundChildSessionID,
          authorization.boundCleanTitle,
        );
        authorization.titleRestored = true;
      })();
      authorization.operationPromise = restoration;
      try {
        await restoration;
      } catch (error) {
        authorization.restorationFailed = true;
        throw internalChatError(error.message);
      }
    }
  }

  return {
    config(input) {
      try {
        if (preset === "chatgpt") configureChatGPT(input, data);
        else configureAntigravity(input, data);
      } catch (error) {
        configurationError = error;
      }
    },

    async "chat.message"(input, output) {
      const resolved = output?.message;
      if (isInternalAgentName(input?.agent) || isInternalAgentName(resolved?.agent)) {
        await authorizeInternalChildChat(input, output);
        return;
      }
      const agent = resolved?.agent ?? input.agent;
      const agentMarker = { agent, active: false };
      currentAgents.set(input.sessionID, agentMarker);
      if (agent !== "pilotfish") return;
      if (configurationError) {
        throw new Error(
          `Pilotfish profile router configuration failed: ${configurationError.message} Fix the Pilotfish configuration and start a new session.`,
        );
      }
      const model = modelName(resolved?.model ?? input.model);
      let current = sessions.get(input.sessionID);

      if (current) {
        if (current.model !== model) {
          throw new Error("Pilotfish model changed after this session was pinned; start a new session.");
        }
        if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
        return;
      }

      let recovery = pendingRecoveries.get(input.sessionID);
      if (!recovery) {
        recovery = {
          cancelled: false,
          promise: recoverPersistedState(options.client, input.sessionID, data, preset),
        };
        pendingRecoveries.set(input.sessionID, recovery);
      }
      let recovered;
      try {
        recovered = await recovery.promise;
      } finally {
        if (pendingRecoveries.get(input.sessionID) === recovery) {
          pendingRecoveries.delete(input.sessionID);
        }
      }
      if (recovery.cancelled) {
        throw recoveryError("the session was deleted while history was being read");
      }

      // Another first message may have completed recovery and pinned this session while this one waited.
      current = sessions.get(input.sessionID);
      if (current) {
        if (current.model !== model) {
          throw new Error("Pilotfish model changed after this session was pinned; start a new session.");
        }
        if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
        return;
      }

      current = recovered ?? stateForModel(data, preset, model);
      sessions.set(input.sessionID, current);
      if (current.model !== model) {
        throw new Error("Pilotfish model changed after this session was pinned; start a new session.");
      }
      if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
    },

    async "tool.execute.before"(input, output) {
      rejectDirectInternalTask(input, output);
      if (input.tool !== "task") return;
      if (!isObject(output.args)) return;
      const requestedRole = output.args.subagent_type;
      const currentAgent = currentAgents.get(input.sessionID);
      if (currentAgent?.agent !== "pilotfish" || currentAgent.active !== true) return;
      const state = sessions.get(input.sessionID);
      if (!state || state.kind !== "mapped") return;
      if (!data.publicRoles.slice(1).includes(requestedRole)) return;
      if (output.args.background === true) {
        throw new Error(
          "Pilotfish does not authorize experimental background Tasks; use a foreground Task so the internal child starts before tool.execute.after.",
        );
      }
      const callID = input.callID;
      if (typeof callID !== "string" || callID.trim().length === 0) {
        throw new Error(
          "Pilotfish cannot authorize the internal Task child because tool.execute.before supplied no usable callID; refusing to rewrite the public worker role.",
        );
      }
      const existingByCall = taskAuthorizations.get(input.sessionID);
      if (existingByCall?.has(callID)) {
        throw new Error(
          `Pilotfish refuses duplicate Task authorization for callID "${callID}" in this session.`,
        );
      }
      const expectedAgent = internalAgentName(state.profile, requestedRole);
      const originalDescription = output.args.description;
      if (typeof originalDescription !== "string") {
        throw new Error(
          "Pilotfish cannot authorize the internal Task child because Task description is missing or malformed.",
        );
      }
      const taskID = output.args.task_id;
      const resumed = taskID !== undefined;
      let authorization;

      if (resumed) {
        if (typeof taskID !== "string" || taskID.length === 0) {
          throw new Error(
            "Pilotfish cannot authorize resumed Task because task_id is missing or malformed.",
          );
        }
        if (typeof options.client?.session?.get !== "function") {
          throw new Error(
            "Pilotfish cannot authorize resumed Task because OpenCode client.session.get is unavailable.",
          );
        }
        let result;
        try {
          result = await options.client.session.get({ path: { id: taskID } });
        } catch (error) {
          throw new Error(
            `Pilotfish cannot authorize resumed Task because session lookup failed (${error?.message ?? "unknown error"}).`,
          );
        }
        if (
          !isObject(result) ||
          (result.error !== undefined && result.error !== null) ||
          !isObject(result.data)
        ) {
          throw new Error(
            "Pilotfish cannot authorize resumed Task because OpenCode returned invalid session data.",
          );
        }
        if (
          result.data.id !== taskID ||
          result.data.parentID !== input.sessionID ||
          result.data.agent !== expectedAgent
        ) {
          throw new Error(
            "Pilotfish cannot authorize resumed Task because task_id is not the exact matching child session for this parent and internal agent.",
          );
        }
        authorization = {
          bound: true,
          childSessionID: taskID,
          cleanTitle: result.data.title,
          expectedAgent,
          originalDescription,
          profile: state.profile,
          publicRole: requestedRole,
          resumed: true,
        };
      } else {
        const marker = taskAuthorizationMarker(callID);
        const markedDescription = markedTaskDescription(originalDescription, marker);
        authorization = {
          bound: false,
          cleanTitle: taskChildTitle(originalDescription, expectedAgent),
          expectedAgent,
          markedDescription,
          markedTitle: taskChildTitle(markedDescription, expectedAgent),
          marker,
          originalDescription,
          profile: state.profile,
          publicRole: requestedRole,
          resumed: false,
        };
        output.args.description = markedDescription;
      }

      output.args.subagent_type = expectedAgent;
      authorization.createdAt = now();
      authorization.expiresAt = authorization.createdAt + authorizationTTL;
      authorization.taskArgs = output.args;
      let byCall = existingByCall;
      if (!byCall) {
        byCall = new Map();
        taskAuthorizations.set(input.sessionID, byCall);
      }
      byCall.set(callID, authorization);
      scheduleAuthorizationExpiry(input.sessionID, callID, authorization);
    },

    async "tool.execute.after"(input, output) {
      if (input?.tool !== "task") return;
      const callID = input.callID;
      if (typeof callID !== "string" || callID.length === 0) return;
      const byCall = taskAuthorizations.get(input.sessionID);
      if (!byCall) return;
      const authorization = byCall.get(callID);
      if (!authorization) return;
      if (authorization.cleanupStarted === true) {
        try {
          await authorization.cleanupPromise.catch(() => {});
        } finally {
          if (authorization.resumed !== true) {
            if (isObject(input.args)) input.args.description = authorization.originalDescription;
            if (isObject(output)) output.title = authorization.originalDescription;
          }
        }
        return;
      }

      authorization.consumed = true;
      authorization.operationOwner = "tool-after";
      clearAuthorizationTimer(authorization);
      restoreAuthorizationArgs(authorization);
      const priorOperation = authorization.operationPromise;
      const afterOperation = (async () => {
        if (priorOperation) await priorOperation.catch(() => {});
        if (
          authorization.resumed !== true &&
          authorization.bound === true &&
          authorization.titleRestored !== true
        ) {
          await updateChildTitle(
            authorization.boundChildSessionID,
            authorization.boundCleanTitle,
          );
          authorization.titleRestored = true;
        }
      })();
      authorization.operationPromise = afterOperation;
      try {
        if (authorization.resumed !== true) {
          if (isObject(input.args)) input.args.description = authorization.originalDescription;
          if (isObject(output)) output.title = authorization.originalDescription;
        }
        await afterOperation;
      } finally {
        if (authorization.cleanupStarted !== true) {
          finalizeAuthorization(input.sessionID, callID, authorization);
        }
      }
    },

    async event(input) {
      const event = input?.event;
      if (event?.type === "session.created") {
        const info = event.properties?.info;
        if (
          !isObject(info) ||
          typeof info.id !== "string" ||
          typeof info.parentID !== "string" ||
          !isInternalAgentName(info.agent) ||
          typeof info.title !== "string"
        ) {
          return;
        }
        const marker = taskMarkerFromTitle(info.title, info.agent);
        if (!marker) return;
        const byCall = taskAuthorizations.get(info.parentID);
        if (!byCall) return;
        for (const [callID, authorization] of [...byCall.entries()]) {
          authorizationExpired(info.parentID, callID, authorization);
        }
        const currentByCall = taskAuthorizations.get(info.parentID);
        if (!currentByCall) return;
        const state = sessions.get(info.parentID);
        const currentAgent = currentAgents.get(info.parentID);
        const created = historyTimestamp(info.time?.created ?? info.createdAt);
        const matches = [...currentByCall.entries()].filter(
          ([callID, authorization]) =>
            authorization.resumed !== true &&
            authorization.bound !== true &&
            authorization.consumed !== true &&
            authorization.cleanupStarted !== true &&
            authorization.marker === marker &&
            authorization.marker === taskAuthorizationMarker(callID) &&
            authorization.markedTitle === info.title &&
            authorization.expectedAgent === info.agent &&
            state?.kind === "mapped" &&
            state.profile === authorization.profile &&
            currentAgent?.agent === "pilotfish" &&
            currentAgent.active === true &&
            (created === undefined || created >= authorization.createdAt),
        );
        if (matches.length !== 1) return;
        const authorization = matches[0][1];
        authorization.bound = true;
        authorization.childSessionID = info.id;
        authorization.boundChildSessionID = info.id;
        authorization.boundCleanTitle = authorization.cleanTitle;
        return;
      }
      if (event?.type !== "session.deleted") return;
      const sessionID = event.properties?.info?.id;
      if (typeof sessionID === "string") {
        const cleanup = clearParentAuthorizations(sessionID);
        currentAgents.delete(sessionID);
        sessions.delete(sessionID);
        const recovery = pendingRecoveries.get(sessionID);
        if (recovery) recovery.cancelled = true;
        pendingRecoveries.delete(sessionID);
        await cleanup;
      }
    },

    async dispose() {
      const cleanups = [];
      for (const parentSessionID of [...taskAuthorizations.keys()]) {
        cleanups.push(clearParentAuthorizations(parentSessionID));
      }
      for (const recovery of pendingRecoveries.values()) recovery.cancelled = true;
      pendingRecoveries.clear();
      currentAgents.clear();
      sessions.clear();
      await Promise.allSettled(cleanups);
    },

  };
}

export default async function profileRouterPlugin(input, options) {
  try {
    return await createProfileRouter({ ...options, client: input?.client });
  } catch {
    return createInitializationFailureHooks();
  }
}
