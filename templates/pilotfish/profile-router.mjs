// Pilotfish profile router.
//
// Guarantees, host dependencies, accepted risks, and threat model are fixed in
// docs/profile-router-contract.md. Changes outside that contract require
// re-approval before implementation.
//
// This file is installed as a single hash-tracked runtime artifact, so its four
// concerns are separated by section and explicit dependency injection rather
// than by module boundaries:
//
//   1. Shared primitives
//   2. Profile data: loading, validation, and model-to-profile selection
//   3. Permission validation and config generation
//   4. Session recovery across processes
//   5. Child authorization store (state, timers, cleanup)
//   6. User-visible refusal notice
//   7. Composition root and plugin entry

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const PROFILES_URL = new URL("./profiles.json", import.meta.url);
const INTERNAL_PREFIX = "pilotfish-profile-";
const TASK_MARKER_PREFIX = " [pilotfish-task:";
const TASK_MARKER_SUFFIX = "]";
const TASK_AUTHORIZATION_TTL_MS = 30_000;
const NOTICE_TITLE = "Pilotfish refused this request";
const NOTICE_DURATION_MS = 12_000;
const NOTICE_MAX_LENGTH = 480;

// ---------------------------------------------------------------------------
// 1. Shared primitives
// ---------------------------------------------------------------------------

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelName(model) {
  if (typeof model === "string") return model;
  if (!isObject(model)) return undefined;
  if (typeof model.providerID === "string" && typeof model.modelID === "string") {
    return `${model.providerID}/${model.modelID}`;
  }
  return typeof model.model === "string" ? model.model : undefined;
}

function historyTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

// Profile names are model identifiers, so they carry provider slashes. Agent
// names are OpenCode config keys and Task permission patterns, so the slash is
// flattened to "--" rather than left for the host to interpret as a path.
function internalAgentName(profile, role) {
  return `${INTERNAL_PREFIX}${profile.replaceAll("/", "--")}-${role}`;
}

function isInternalAgentName(agent) {
  return typeof agent === "string" && agent.startsWith(INTERNAL_PREFIX);
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

// Guard G6: internal names are never a legal caller-supplied target.
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
  if (isInternalAgentName(output.args.subagent_type)) {
    throw new Error(
      "Pilotfish internal profile agents cannot be invoked directly; request a public Pilotfish worker role instead.",
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Profile data
// ---------------------------------------------------------------------------

function loadProfiles() {
  return JSON.parse(readFileSync(PROFILES_URL, "utf8"));
}

function validateBinding(binding, label) {
  if (!isObject(binding) || typeof binding.model !== "string") {
    throw new Error(`Pilotfish profile data has no model for ${label}.`);
  }
  if (binding.variant !== undefined && typeof binding.variant !== "string") {
    throw new Error(`Pilotfish profile data has an invalid variant for ${label}.`);
  }
}

// Profiles are pure data: adding one is a profiles.json edit, never a code
// change here. A preset is only a named grouping of profile names.
function validateProfiles(data) {
  if (
    !isObject(data) ||
    !Array.isArray(data.publicRoles) ||
    !isObject(data.profiles) ||
    !isObject(data.presets)
  ) {
    throw new Error("Pilotfish profile data must define publicRoles, presets, and profiles.");
  }

  const [primary, ...workers] = data.publicRoles;
  if (primary !== "pilotfish" || workers.length !== 8 || new Set(data.publicRoles).size !== 9) {
    throw new Error("Pilotfish profile data must define pilotfish and exactly eight public workers.");
  }

  const profileNames = Object.keys(data.profiles);
  if (profileNames.length === 0) {
    throw new Error("Pilotfish profile data must define at least one profile.");
  }

  // Selection is keyed by primary model, so two profiles may never claim the
  // same one; that would make routing ambiguous rather than merely wrong.
  const claimedPrimaries = new Map();
  for (const name of profileNames) {
    const mapping = data.profiles[name];
    if (!isObject(mapping) || !isObject(mapping.workers)) {
      throw new Error(`Pilotfish profile data is missing the ${name} mapping.`);
    }
    validateBinding(mapping.primary, `${name} primary`);
    const claimedBy = claimedPrimaries.get(mapping.primary.model);
    if (claimedBy !== undefined) {
      throw new Error(
        `Pilotfish profiles "${claimedBy}" and "${name}" both claim primary model "${mapping.primary.model}"; primary models must select exactly one profile.`,
      );
    }
    claimedPrimaries.set(mapping.primary.model, name);
    if (Object.keys(mapping.workers).length !== workers.length) {
      throw new Error(`Pilotfish profile data has incomplete ${name} worker mappings.`);
    }
    for (const role of workers) {
      validateBinding(mapping.workers[role], `${name} ${role}`);
    }
  }

  const presetNames = Object.keys(data.presets);
  if (presetNames.length === 0) {
    throw new Error("Pilotfish profile data must define at least one preset.");
  }
  for (const name of presetNames) {
    const members = data.presets[name];
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error(`Pilotfish preset "${name}" must list at least one profile.`);
    }
    if (new Set(members).size !== members.length) {
      throw new Error(`Pilotfish preset "${name}" lists a duplicate profile.`);
    }
    for (const member of members) {
      if (!Object.hasOwn(data.profiles, member)) {
        throw new Error(`Pilotfish preset "${name}" refers to unknown profile "${member}".`);
      }
    }
  }

  return data;
}

// An omitted preset activates every profile; a named preset activates only its
// members, which is what keeps one provider's clones out of another's config.
function activeProfileNames(data, preset) {
  if (preset === undefined) return Object.keys(data.profiles);
  if (typeof preset !== "string" || !Object.hasOwn(data.presets, preset)) {
    throw new Error(
      `Pilotfish profile router option "preset" must be omitted or name a defined preset (${Object.keys(data.presets).join(", ")}).`,
    );
  }
  return [...data.presets[preset]];
}

// Guarantee G2/G8: the profile is a pure function of the primary model, and an
// unsupported model fails closed rather than defaulting.
function stateForModel(data, profileNames, model) {
  const match = profileNames.find((name) => data.profiles[name].primary.model === model);
  if (!match) {
    throw new Error(
      `Pilotfish does not support primary model "${model ?? "unknown"}" for the active profiles (${profileNames.join(", ")}).`,
    );
  }
  return { model, profile: match };
}

// ---------------------------------------------------------------------------
// 3. Permission validation and config generation
// ---------------------------------------------------------------------------

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
  // Mirrors OpenCode 1.18.18 packages/core/src/util/wildcard.ts.
  //
  // Host fact H9: the host builds this regex with the flags `si` on every
  // platform — there is no `process.platform` branch upstream. An earlier
  // mirror here enabled `i` only on win32, which made the G9 guard below
  // case-sensitive on posix: a rule such as "PILOTFISH-PROFILE-*" passed the
  // guard while the host still read it as matching every internal clone, so
  // G9 accepted a configuration it promises to refuse. Any platform
  // condition added here re-opens that gap.
  const normalized = agentName.replaceAll("\\", "/");
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
  return new RegExp(`^${escaped}$`, "si").test(normalized);
}

function lastMatchingTaskRule(entries, agentName) {
  let match;
  for (const [pattern, action] of entries) {
    if (taskPatternMatches(pattern, agentName)) match = { pattern, action };
  }
  return match;
}

// Guarantee G9: never widen or override a customized Task permission map.
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

  for (const [pattern, action] of entries.slice(1)) {
    if (cloneNames.includes(pattern)) {
      // Host fact H11: one process serves several project directories from one
      // global config, rebuilding `config.agent` per instance but passing every
      // instance this same nested `permission.task` object. The clone agents
      // therefore look absent while the Task rules this function wrote on a
      // previous instance are still present, so an exact clone key already set
      // to "allow" is this router's own idempotent state, not foreign
      // customization. Only a mismatched action means something else wrote it.
      if (action !== "allow") {
        throw new Error(
          `Pilotfish profile router cannot extend agent.pilotfish.permission.task: internal profile agent "${pattern}" already has a customized Task rule ("${action}") that is not "allow". Remove or narrow that rule before starting Pilotfish; refusing to override customized Task permission.`,
        );
      }
      continue;
    }
    const matchedName = cloneNames.find((name) => taskPatternMatches(pattern, name));
    if (matchedName) {
      throw new Error(
        `Pilotfish profile router cannot extend agent.pilotfish.permission.task: pre-existing Task rule "${pattern}" can match internal profile agent "${matchedName}". Remove or narrow that rule before starting Pilotfish; refusing to override customized Task permission.`,
      );
    }
  }

  for (const name of cloneNames) task[name] = "allow";
}

function requirePilotfishAgents(config) {
  const agents = config?.agent;
  if (!isObject(agents) || !isObject(agents.pilotfish)) {
    throw new Error("Pilotfish profile router requires the public pilotfish agent.");
  }
  return agents;
}

function configureProfiles(config, data, profileNames) {
  const agents = requirePilotfishAgents(config);
  const workers = data.publicRoles.slice(1);
  validatePublicWorkers(agents, workers);

  const cloneNames = [];
  const claimedCloneNames = new Set();
  for (const profile of profileNames) {
    for (const role of workers) {
      const name = internalAgentName(profile, role);
      // Two distinct profile names can only flatten to one agent name if a
      // profile is literally named with "--"; refuse rather than let one
      // profile's clone silently overwrite another's.
      if (claimedCloneNames.has(name)) {
        throw new Error(
          `Pilotfish profile router refuses internal agent collision at "${name}"; two active profiles flatten to the same internal agent name.`,
        );
      }
      claimedCloneNames.add(name);
      cloneNames.push(name);
    }
  }
  for (const name of cloneNames) {
    if (Object.hasOwn(agents, name)) {
      throw new Error(`Pilotfish profile router refuses internal agent collision at "${name}".`);
    }
  }

  const clones = {};
  for (const profile of profileNames) {
    const mapping = data.profiles[profile];
    for (const role of workers) {
      const clone = structuredClone(agents[role]);
      const binding = mapping.workers[role];
      clone.hidden = true;
      clone.model = binding.model;
      // The binding is authoritative in both directions: a profile that
      // declares no variant must clear whatever the public worker inherited
      // from the user's preset, rather than leak one model's effort tier onto
      // a model that exposes none. Remove the key instead of setting it to
      // undefined so the host never sees a present-but-empty variant.
      if (binding.variant === undefined) delete clone.variant;
      else clone.variant = binding.variant;
      clones[internalAgentName(profile, role)] = clone;
    }
  }

  extendTaskPermission(agents.pilotfish, cloneNames, workers);
  Object.assign(agents, clones);
}

// ---------------------------------------------------------------------------
// 4. Session recovery
// ---------------------------------------------------------------------------

function recoveryError(detail) {
  return new Error(
    `Pilotfish could not recover this session's persisted model profile${detail ? `: ${detail}` : ""}. Do not continue this session; restore OpenCode history access or start a new session.`,
  );
}

// Guarantee G10: router state is process-local, so a resumed session recovers
// its pin from the first persisted Pilotfish user message instead of treating
// an empty cache as a new session.
async function recoverPersistedState(client, sessionID, data, profileNames) {
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
    return stateForModel(data, profileNames, first.model);
  } catch {
    throw recoveryError(`the first persisted Pilotfish model is unsupported (${first.model})`);
  }
}

// ---------------------------------------------------------------------------
// 5. Child authorization store
// ---------------------------------------------------------------------------

// Owns every authorization record, its expiry timer, and its child-title
// cleanup. Guarantee G7 lives here. Dependencies are injected so this section
// never reaches into router session state directly.
function createAuthorizationStore({ client, timing, getSessionState, getCurrentAgent }) {
  const authorizations = new Map();
  const { now, setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, ttl } = timing;

  function internalChatError(detail) {
    return new Error(
      `Pilotfish internal profile agents cannot be invoked directly through chat: ${detail}. Only one-time router-authorized Task children are allowed; select the public pilotfish agent instead.`,
    );
  }

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
    const byCall = authorizations.get(parentSessionID);
    if (!byCall || byCall.get(callID) !== authorization) return;
    clearAuthorizationTimer(authorization);
    restoreAuthorizationArgs(authorization);
    byCall.delete(callID);
    if (byCall.size === 0) authorizations.delete(parentSessionID);
  }

  async function updateChildTitle(childSessionID, title) {
    if (typeof client?.session?.update !== "function") {
      throw new Error("OpenCode client.session.update is unavailable");
    }
    let result;
    try {
      result = await client.session.update({
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
    if (typeof client?.session?.get !== "function") {
      throw new Error("OpenCode client.session.get is unavailable for child title cleanup");
    }

    let result;
    try {
      result = await client.session.get({ path: { id: childSessionID } });
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

  // Revocation is synchronous so chat/after races cannot replay it while
  // cleanup is awaited; title restoration is best-effort per the contract.
  function cleanupAuthorization(parentSessionID, callID, authorization) {
    if (authorization.cleanupPromise) return authorization.cleanupPromise;

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

  function authorizationExpired(parentSessionID, callID, authorization) {
    if (authorization.expiresAt > now()) return false;
    void cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {});
    return true;
  }

  function expireParent(parentSessionID) {
    const byCall = authorizations.get(parentSessionID);
    if (!byCall) return;
    for (const [callID, authorization] of [...byCall.entries()]) {
      authorizationExpired(parentSessionID, callID, authorization);
    }
  }

  // Host fact H6: tool.execute.after is skipped when execution throws, so
  // expiry must be driven independently of the after-hook.
  function scheduleAuthorizationExpiry(parentSessionID, callID, authorization) {
    authorization.timer = scheduleTimeout(
      () => cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {}),
      ttl,
    );
    authorization.timer?.unref?.();
  }

  async function clearParent(parentSessionID) {
    const byCall = authorizations.get(parentSessionID);
    if (!byCall) return;
    const cleanups = [];
    for (const [callID, authorization] of [...byCall.entries()]) {
      cleanups.push(cleanupAuthorization(parentSessionID, callID, authorization));
    }
    await Promise.allSettled(cleanups);
  }

  function has(parentSessionID, callID) {
    return authorizations.get(parentSessionID)?.has(callID) === true;
  }

  function register(parentSessionID, callID, authorization, taskArgs) {
    authorization.createdAt = now();
    authorization.expiresAt = authorization.createdAt + ttl;
    authorization.taskArgs = taskArgs;
    let byCall = authorizations.get(parentSessionID);
    if (!byCall) {
      byCall = new Map();
      authorizations.set(parentSessionID, byCall);
    }
    byCall.set(callID, authorization);
    scheduleAuthorizationExpiry(parentSessionID, callID, authorization);
  }

  // Host fact H4: the before-hook never learns the child session ID, so an
  // exact post-authorization session.created event is the only binding source.
  function bindCreatedChild(info) {
    const marker = taskMarkerFromTitle(info.title, info.agent);
    if (!marker) return;
    if (!authorizations.has(info.parentID)) return;
    expireParent(info.parentID);
    const byCall = authorizations.get(info.parentID);
    if (!byCall) return;

    const state = getSessionState(info.parentID);
    const currentAgent = getCurrentAgent(info.parentID);
    const created = historyTimestamp(info.time?.created ?? info.createdAt);
    const matches = [...byCall.entries()].filter(
      ([callID, authorization]) =>
        authorization.resumed !== true &&
        authorization.bound !== true &&
        authorization.consumed !== true &&
        authorization.cleanupStarted !== true &&
        authorization.marker === marker &&
        authorization.marker === taskAuthorizationMarker(callID) &&
        authorization.markedTitle === info.title &&
        authorization.expectedAgent === info.agent &&
        state?.profile === authorization.profile &&
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
  }

  async function readAuthorizedChild(childSessionID, resolvedAgent) {
    if (typeof client?.session?.get !== "function") {
      throw internalChatError("OpenCode client.session.get is unavailable");
    }
    let result;
    try {
      result = await client.session.get({ path: { id: childSessionID } });
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
    if (typeof result.data.parentID !== "string" || result.data.parentID.length === 0) {
      throw internalChatError("the chat session has no parent Task session");
    }
    if (result.data.agent !== resolvedAgent) {
      throw internalChatError("the child session agent does not match the resolved internal agent");
    }
    return result.data;
  }

  // Guarantee G7. Ordering is before -> session.created -> child chat -> after;
  // every race fails closed.
  async function authorizeChildChat(input, output) {
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

    const child = await readAuthorizedChild(childSessionID, resolvedAgent);
    const parentSessionID = child.parentID;

    expireParent(parentSessionID);
    const byCall = authorizations.get(parentSessionID);
    const marker = taskMarkerFromTitle(child.title, resolvedAgent);
    const matches = byCall
      ? [...byCall.entries()].filter(
          ([, authorization]) =>
            authorization.consumed !== true &&
            authorization.cleanupStarted !== true &&
            authorization.expectedAgent === resolvedAgent &&
            (authorization.resumed === true
              ? authorization.childSessionID === childSessionID
              : authorization.bound === true &&
                authorization.boundChildSessionID === childSessionID &&
                authorization.marker === marker &&
                authorization.markedTitle === child.title),
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

    // Guarantee G4: the parent must still be a pinned, active Pilotfish session
    // on the same profile that authorized this child.
    const currentAgent = getCurrentAgent(parentSessionID);
    const state = getSessionState(parentSessionID);
    const expectedAgent = state
      ? internalAgentName(state.profile, authorization.publicRole)
      : undefined;
    if (
      currentAgent?.agent !== "pilotfish" ||
      currentAgent.active !== true ||
      state === undefined ||
      state.profile !== authorization.profile ||
      expectedAgent !== authorization.expectedAgent ||
      resolvedAgent !== authorization.expectedAgent
    ) {
      await cleanupAuthorization(parentSessionID, callID, authorization).catch(() => {});
      throw internalChatError("the parent Pilotfish routing state no longer authorizes this child");
    }

    if (authorization.resumed !== true) {
      const restoration = (async () => {
        await updateChildTitle(authorization.boundChildSessionID, authorization.boundCleanTitle);
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

  async function completeTask(parentSessionID, callID, input, output) {
    const byCall = authorizations.get(parentSessionID);
    if (!byCall) return;
    const authorization = byCall.get(callID);
    if (!authorization) return;

    const restoreArgs = () => {
      if (authorization.resumed === true) return;
      if (isObject(input.args)) input.args.description = authorization.originalDescription;
      if (isObject(output)) output.title = authorization.originalDescription;
    };

    if (authorization.cleanupStarted === true) {
      try {
        await authorization.cleanupPromise.catch(() => {});
      } finally {
        restoreArgs();
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
        await updateChildTitle(authorization.boundChildSessionID, authorization.boundCleanTitle);
        authorization.titleRestored = true;
      }
    })();
    authorization.operationPromise = afterOperation;
    try {
      restoreArgs();
      await afterOperation;
    } finally {
      if (authorization.cleanupStarted !== true) {
        finalizeAuthorization(parentSessionID, callID, authorization);
      }
    }
  }

  async function disposeAll() {
    const cleanups = [];
    for (const parentSessionID of [...authorizations.keys()]) {
      cleanups.push(clearParent(parentSessionID));
    }
    await Promise.allSettled(cleanups);
  }

  return {
    authorizeChildChat,
    bindCreatedChild,
    clearParent,
    completeTask,
    disposeAll,
    has,
    register,
  };
}

// ---------------------------------------------------------------------------
// 6. User-visible refusal notice
// ---------------------------------------------------------------------------

// A guard message is the whole diagnosis, so it is sent verbatim wherever it
// fits. Every path ends by naming --print-logs, because that is the only way
// to read a reason the notice could not carry.
function noticeMessage(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (message.length === 0) {
    return "Pilotfish stopped this request without a reason message. Restart OpenCode with --print-logs to read the router error from the server log.";
  }
  if (message.length <= NOTICE_MAX_LENGTH) return message;
  return `${message.slice(0, NOTICE_MAX_LENGTH).trimEnd()}… (truncated; restart OpenCode with --print-logs for the full reason)`;
}

// Host facts H1 and H10 together mean a raised guard reaches the user as
// silence or as a generic server error, so the more correctly the router
// refuses, the more it reads as a broken provider. Host fact H12 gives the one
// channel out of that: a server plugin's injected client can publish a TUI
// toast. The notice is strictly additive to the throw it accompanies — it is
// never awaited and never rejects, so it cannot alter a fail-closed outcome.
function createRefusalNotice({ client, directory }) {
  return function notify(error) {
    if (typeof client?.tui?.showToast !== "function") return;
    const request = {
      body: {
        title: NOTICE_TITLE,
        message: noticeMessage(error),
        variant: "error",
        duration: NOTICE_DURATION_MS,
      },
    };
    // Host fact H12: the TUI drops a toast whose workspace is not the one it
    // is showing, and host fact H11 means one process serves several
    // directories, so the plugin's own directory has to travel with it.
    if (typeof directory === "string" && directory.length > 0) {
      request.query = { directory };
    }
    try {
      Promise.resolve(client.tui.showToast(request)).catch(() => {});
    } catch {
      // A host with no reachable TUI must never turn a refusal into a crash.
    }
  };
}

// Only the two guard surfaces are wrapped. G8 raises every refusal before any
// assistant or provider request, and those raises all leave through
// `chat.message` or `tool.execute.before`. `config` is excluded because host
// fact H1 already defers its failure to the first Pilotfish message, where it
// is noticed; `tool.execute.after`, `event`, and `dispose` are excluded because
// their throws are the best-effort child-title cleanup the contract already
// records as display metadata, not a refusal the user needs explained.
const NOTICED_HOOKS = ["chat.message", "tool.execute.before"];

function withRefusalNotice(hooks, notify) {
  for (const name of NOTICED_HOOKS) {
    const hook = hooks[name];
    if (typeof hook !== "function") continue;
    hooks[name] = async (...args) => {
      try {
        return await hook(...args);
      } catch (error) {
        notify(error);
        throw error;
      }
    };
  }
  return hooks;
}

// ---------------------------------------------------------------------------
// 7. Composition root and plugin entry
// ---------------------------------------------------------------------------

// Host fact H2: a plugin factory that throws is skipped silently, so
// initialization failure must still install hooks that fail closed.
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

function resolveTiming(options) {
  // Tests may inject deterministic timers; production expiry can only be
  // shortened, never extended.
  const testTiming = isObject(options.__testTiming) ? options.__testTiming : {};
  return {
    ttl:
      typeof testTiming.ttl === "number" && Number.isFinite(testTiming.ttl)
        ? Math.max(1, Math.min(TASK_AUTHORIZATION_TTL_MS, testTiming.ttl))
        : TASK_AUTHORIZATION_TTL_MS,
    now: typeof testTiming.now === "function" ? testTiming.now : Date.now,
    setTimeout:
      typeof testTiming.setTimeout === "function" ? testTiming.setTimeout : setTimeout,
    clearTimeout:
      typeof testTiming.clearTimeout === "function" ? testTiming.clearTimeout : clearTimeout,
  };
}

function createProfileRouter(options = {}) {
  const data = validateProfiles(loadProfiles());
  const profileNames = activeProfileNames(data, options.preset);
  const workerRoles = data.publicRoles.slice(1);
  const sessions = new Map();
  const currentAgents = new Map();
  const pendingRecoveries = new Map();
  let configurationError;

  const authorizationStore = createAuthorizationStore({
    client: options.client,
    timing: resolveTiming(options),
    getSessionState: (sessionID) => sessions.get(sessionID),
    getCurrentAgent: (sessionID) => currentAgents.get(sessionID),
  });

  // Guarantee G3: once pinned, a session's model may not change.
  function assertPinnedModel(state, model) {
    if (state.model !== model) {
      throw new Error("Pilotfish model changed after this session was pinned; start a new session.");
    }
  }

  async function pinSession(input, model, agentMarker) {
    let recovery = pendingRecoveries.get(input.sessionID);
    if (!recovery) {
      recovery = {
        cancelled: false,
        promise: recoverPersistedState(options.client, input.sessionID, data, profileNames),
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

    // Another first message may have completed recovery and pinned this
    // session while this one waited.
    const pinned = sessions.get(input.sessionID);
    if (pinned) {
      assertPinnedModel(pinned, model);
      if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
      return;
    }

    const state = recovered ?? stateForModel(data, profileNames, model);
    sessions.set(input.sessionID, state);
    assertPinnedModel(state, model);
    if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
  }

  async function beginResumedTask(input, taskID, expectedAgent) {
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
    return result.data.title;
  }

  return {
    config(input) {
      // Host fact H1: config-hook errors are logged and ignored, so the failure
      // is stored and raised at the first Pilotfish message instead.
      try {
        configureProfiles(input, data, profileNames);
      } catch (error) {
        configurationError = error;
      }
    },

    async "chat.message"(input, output) {
      const resolved = output?.message;
      if (isInternalAgentName(input?.agent) || isInternalAgentName(resolved?.agent)) {
        await authorizationStore.authorizeChildChat(input, output);
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
      const pinned = sessions.get(input.sessionID);
      if (pinned) {
        assertPinnedModel(pinned, model);
        if (currentAgents.get(input.sessionID) === agentMarker) agentMarker.active = true;
        return;
      }

      await pinSession(input, model, agentMarker);
    },

    async "tool.execute.before"(input, output) {
      rejectDirectInternalTask(input, output);
      if (input.tool !== "task") return;
      if (!isObject(output.args)) return;

      // Guarantee G4/G5: route only for an active, pinned Pilotfish session and
      // only for the public worker roles.
      const requestedRole = output.args.subagent_type;
      const currentAgent = currentAgents.get(input.sessionID);
      if (currentAgent?.agent !== "pilotfish" || currentAgent.active !== true) return;
      const state = sessions.get(input.sessionID);
      if (!state) return;
      if (!workerRoles.includes(requestedRole)) return;

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
      if (authorizationStore.has(input.sessionID, callID)) {
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
      let authorization;
      if (taskID !== undefined) {
        const cleanTitle = await beginResumedTask(input, taskID, expectedAgent);
        authorization = {
          bound: true,
          childSessionID: taskID,
          cleanTitle,
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
      authorizationStore.register(input.sessionID, callID, authorization, output.args);
    },

    async "tool.execute.after"(input, output) {
      if (input?.tool !== "task") return;
      const callID = input.callID;
      if (typeof callID !== "string" || callID.length === 0) return;
      await authorizationStore.completeTask(input.sessionID, callID, input, output);
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
        authorizationStore.bindCreatedChild(info);
        return;
      }

      if (event?.type !== "session.deleted") return;
      const sessionID = event.properties?.info?.id;
      if (typeof sessionID === "string") {
        const cleanup = authorizationStore.clearParent(sessionID);
        currentAgents.delete(sessionID);
        sessions.delete(sessionID);
        const recovery = pendingRecoveries.get(sessionID);
        if (recovery) recovery.cancelled = true;
        pendingRecoveries.delete(sessionID);
        await cleanup;
      }
    },

    async dispose() {
      const cleanup = authorizationStore.disposeAll();
      for (const recovery of pendingRecoveries.values()) recovery.cancelled = true;
      pendingRecoveries.clear();
      currentAgents.clear();
      sessions.clear();
      await cleanup;
    },
  };
}

export default async function profileRouterPlugin(input, options) {
  // Built before the router so an initialization failure — the case with the
  // least other evidence available to the user — is noticed too.
  const notify = createRefusalNotice({
    client: input?.client,
    directory: input?.directory,
  });
  try {
    const router = await createProfileRouter({ ...options, client: input?.client });
    return withRefusalNotice(router, notify);
  } catch {
    return withRefusalNotice(createInitializationFailureHooks(), notify);
  }
}
