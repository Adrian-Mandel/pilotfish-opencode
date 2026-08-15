// Observer plugin for host fact H11: which parts of the config object does one
// host process hand unchanged to every project directory it serves?
//
// Content equality would prove nothing — a fresh deep copy of the global config
// is content-equal on every instance. Reference identity can only be shown by
// mutation visibility: write through the reference on one instance, then look
// for the write on the next.
//
// So on each `config` hook invocation the probe first records what it can
// already see of its earlier writes, then writes again, at four depths:
// the config root, the `agent` map, one agent record, and that agent's nested
// `permission.task`. Recording all four rather than only the last is what makes
// the result meaningful: it says *where* the boundary between rebuilt and
// shared actually falls, instead of asserting a single level in isolation.
//
// The trace at the deepest level is an array appended to with `.push()` only,
// so a shared reference accumulates one token per instance while a copy would
// show nothing.
//
// Every sentinel is non-enumerable. `permission.task` is a map of agent name to
// allow/ask/deny and the config is schema-validated, so an ordinary property
// there risks turning this into a test about validation rather than identity.
//
// Nothing here is shipped; the test copies it into a throwaway fixture config
// directory. Only its own synthetic tokens and the probed agent name are
// logged — no prompt, file content or credential ever reaches the log.

import { appendFileSync } from "node:fs";

const LOG = process.env.PILOTFISH_CONFIG_PROBE_LOG;

// Namespaced so they cannot collide with a real subagent name or agent option.
// Deliberately not exported: OpenCode treats every named export of a plugin
// module as a plugin factory and refuses to load a file whose exports are not
// all functions.
const MARKER_KEY = "__pilotfish_probe_marker";
const TRACE_KEY = "__pilotfish_probe_trace";

let invocation = 0;

function defineHidden(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

// Reads the marker left by an earlier instance, then stamps this one. Returns
// what was there on entry: a token means the very same object came back.
function markerOnEntry(target, token) {
  if (!target || typeof target !== "object") return undefined;
  const seen = target[MARKER_KEY] ?? null;
  defineHidden(target, MARKER_KEY, token);
  return seen;
}

export default async function hostFactConfigProbe() {
  return {
    async config(config) {
      const token = `inv-${invocation++}`;
      const entry = { token };

      // The first agent carrying a nested `permission.task`, picked by shape
      // rather than by name so a change to the template's agent set surfaces as
      // a loud failure instead of a silently empty observation.
      const name = Object.keys(config?.agent ?? {}).find(
        (candidate) =>
          config.agent[candidate]?.permission?.task &&
          typeof config.agent[candidate].permission.task === "object",
      );
      if (!name) {
        entry.error = `no agent exposes permission.task: ${JSON.stringify(Object.keys(config?.agent ?? {}))}`;
        if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
        return;
      }
      entry.agent = name;

      const agent = config.agent[name];
      const task = agent.permission.task;

      entry.rootMarkerOnEntry = markerOnEntry(config, token);
      entry.agentMapMarkerOnEntry = markerOnEntry(config.agent, token);
      entry.agentMarkerOnEntry = markerOnEntry(agent, token);
      entry.taskMarkerOnEntry = markerOnEntry(task, token);

      // Mutated in place, never reassigned: reassigning would land the write on
      // this instance's own `permission` object and prove nothing about what the
      // next instance receives.
      const seen = task[TRACE_KEY];
      entry.traceOnEntry = Array.isArray(seen) ? [...seen] : null;
      if (Array.isArray(seen)) seen.push(token);
      else defineHidden(task, TRACE_KEY, [token]);

      if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
    },
  };
}
