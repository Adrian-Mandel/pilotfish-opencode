// Observer plugin for the host-fact integration test. Records the shape of
// every hook invocation the real OpenCode host makes, so the test can assert
// against what the host did rather than against what the contract says.
//
// Nothing here is shipped: the test copies this file into a throwaway fixture
// config directory and registers it in `config.plugin`. Behaviour is driven
// entirely by environment variables so one file covers every scenario.
//
// Only structure and non-sensitive identifiers are recorded — key names,
// sessionID, callID, tool, agent, title. Prompt text, tool results, file
// contents and credentials never reach the log.
//
// The one exception is a failed tool call's error text, truncated, which H6
// needs: "the after-hook did not run" is equally true of a call that threw
// inside execute and of a call the host refused before ever calling execute,
// and only the error itself tells those two apart.

import { appendFileSync } from "node:fs";

const LOG = process.env.PILOTFISH_PROBE_LOG;
// H3(a): rewrite a deliberately bogus subagent_type in place. If the Task then
// resolves, the hook demonstrably ran before agent resolution.
const REWRITE_FROM = process.env.PILOTFISH_PROBE_REWRITE_FROM;
const REWRITE_TO = process.env.PILOTFISH_PROBE_REWRITE_TO;
// H3(b): the same rewrite by wholesale reassignment of `output.args`, which is
// expected NOT to reach execute because the host holds the original reference.
const REASSIGN = process.env.PILOTFISH_PROBE_REASSIGN === "1";

let sequence = 0;

function record(entry) {
  if (!LOG) return;
  appendFileSync(LOG, `${JSON.stringify({ seq: sequence++, ...entry })}\n`);
}

function keys(value) {
  return value && typeof value === "object" ? Object.keys(value).sort() : null;
}

// Values are copied only for the identifier fields; everything else is reduced
// to its key set so no prompt or file content is ever written.
function safeArgs(args) {
  if (!args || typeof args !== "object") return null;
  const safe = { keys: Object.keys(args).sort() };
  for (const name of ["subagent_type", "background", "filePath", "path"]) {
    if (name in args) safe[name] = args[name];
  }
  return safe;
}

export default async function hostFactProbe({ client }) {
  return {
    async "chat.message"(input, output) {
      const entry = {
        hook: "chat.message",
        inputKeys: keys(input),
        outputKeys: keys(output),
        sessionID: input?.sessionID ?? null,
        agent: input?.agent ?? output?.message?.agent ?? null,
        messageID: output?.message?.id ?? null,
      };
      // H7: read the session's persisted history from inside the hook. If the
      // current message id is absent, the hook runs before persistence.
      try {
        const messages = await client.session.messages({
          path: { id: input.sessionID },
        });
        const list = messages?.data ?? messages ?? [];
        const ids = (Array.isArray(list) ? list : []).map(
          (item) => item?.info?.id ?? item?.id ?? null,
        );
        entry.persistedCount = ids.length;
        entry.currentMessagePersisted = ids.includes(entry.messageID);
        entry.persistedIDs = ids;
      } catch (error) {
        entry.messagesError = String(error?.message ?? error);
      }
      record(entry);
    },

    async "tool.execute.before"(input, output) {
      record({
        hook: "tool.execute.before",
        // H4 turns on this exact key set: a child session id appearing here
        // would make the G7 description-marker binding unnecessary.
        inputKeys: keys(input),
        outputKeys: keys(output),
        tool: input?.tool ?? null,
        sessionID: input?.sessionID ?? null,
        callID: input?.callID ?? null,
        args: safeArgs(output?.args),
      });
      if (input?.tool !== "task" || !output?.args) return;
      if (REWRITE_FROM && output.args.subagent_type === REWRITE_FROM) {
        if (REASSIGN) output.args = { ...output.args, subagent_type: REWRITE_TO };
        else output.args.subagent_type = REWRITE_TO;
      }
    },

    async "tool.execute.after"(input, output) {
      record({
        hook: "tool.execute.after",
        inputKeys: keys(input),
        outputKeys: keys(output),
        tool: input?.tool ?? null,
        sessionID: input?.sessionID ?? null,
        callID: input?.callID ?? null,
        title: typeof output?.title === "string" ? output.title : null,
      });
    },

    async event(input) {
      const type = input?.event?.type;

      // H6: the terminal state of a tool call, which is the only place the
      // reason for a failure is visible to a plugin. `tool.execute.after` is
      // skipped on failure — that is the fact under test — so the part state is
      // what distinguishes a throw inside execute from a refusal before it.
      if (type === "message.part.updated") {
        const part = input.event.properties?.part;
        if (part?.type !== "tool" || part.state?.status !== "error") return;
        record({
          hook: "part",
          type: "tool.error",
          tool: part.tool ?? null,
          sessionID: part.sessionID ?? null,
          callID: part.callID ?? null,
          // Truncated: enough to classify the failure, not enough to carry a
          // tool result.
          error: String(part.state.error ?? "").slice(0, 200),
        });
        return;
      }

      // H6 again, from the other side: a call the host refuses before execute
      // asks first, and the ask is an event of its own. None of these appearing
      // for the observed call is corroboration that nothing was refused.
      //
      // "permission.asked" carries the correlating id nested at
      // `properties.tool.callID` (the runtime's own TUI reads the same path:
      // `permission[sessionID]?.at(0)?.tool?.callID`), not at the top level.
      // "permission.replied" carries no callID at all — its schema is
      // `{sessionID, requestID, reply}` — so it is recorded for visibility only
      // and cannot be used to correlate to a specific tool call.
      if (type === "permission.asked" || type === "permission.replied") {
        record({
          hook: "permission",
          type,
          sessionID: input.event.properties?.sessionID ?? null,
          callID: input.event.properties?.tool?.callID ?? null,
          permissionType: input.event.properties?.permission ?? null,
        });
        return;
      }

      if (type !== "session.created" && type !== "session.updated") return;
      record({
        hook: "event",
        type,
        sessionID: input.event.properties?.info?.id ?? null,
        parentID: input.event.properties?.info?.parentID ?? null,
      });
    },
  };
}
