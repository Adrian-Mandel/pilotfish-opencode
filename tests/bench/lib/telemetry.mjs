// Reads what actually happened out of a fixture run's own OpenCode database.
//
// The fixture points XDG_DATA_HOME inside its root, so every run gets a private
// opencode.db holding exactly one orchestrated run. That is what makes the
// verdict readable without correlating anything: every verifier session in the
// file belongs to this run. It is also why these numbers must never be pooled
// with ~/.local/share/opencode/opencode.db -- that database is the #16
// measurement sample, and benchmark runs are not part of it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function databasePath(fixture) {
  return join(fixture.dataHome, "opencode", "opencode.db");
}

// Not `-readonly`: OpenCode leaves its database in WAL mode, and a read-only
// connection that cannot create the `-shm` sidecar fails outright with
// SQLITE_CANTOPEN. The database being opened here is the fixture's own, created
// by this run and deleted at the end of it, so a shared-memory file is
// harmless. What keeps this safe is the path, not the flag: it is derived from
// `fixture.dataHome` and nothing else, which `scoring.test.mjs` asserts.
function query(dbPath, sql) {
  const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : [];
}

// The router rewrites `subagent_type` to a hidden per-profile clone, so the
// session's agent is `pilotfish-profile-<profile>-verifier` when routing is
// active and plain `verifier` when it is not. Both are the same role. The
// `plan-verifier` exclusion is not paranoia: it matches every suffix test here.
const VERIFIER_PREDICATE = `(
  s.agent = 'verifier'
  OR (s.agent LIKE 'pilotfish-profile-%-verifier' AND s.agent NOT LIKE '%plan-verifier')
)`;

const LAST_TEXT = `(
  SELECT json_extract(p.data, '$.text') FROM part p
  WHERE p.session_id = s.id AND json_extract(p.data, '$.type') = 'text'
  ORDER BY p.time_created DESC, p.id DESC LIMIT 1
)`;

function sqlQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

// `outside` is a path that must not appear in this run's transcript -- the
// repository the harness was launched from. See the drift note below.
export function readRunTelemetry(fixture, { outside = null } = {}) {
  const dbPath = databasePath(fixture);
  if (!existsSync(dbPath)) {
    return {
      present: false,
      verifierRuns: [],
      sessions: [],
      errors: [],
      cwdResets: 0,
      foreignPathMentions: 0,
    };
  }

  const sessions = query(
    dbPath,
    `SELECT id, parent_id AS parentId, agent, title, time_created AS created,
            cost, tokens_input AS tokensInput, tokens_output AS tokensOutput,
            tokens_reasoning AS tokensReasoning, tokens_cache_read AS tokensCacheRead,
            tokens_cache_write AS tokensCacheWrite
     FROM session ORDER BY time_created;`,
  );

  const verifierRuns = query(
    dbPath,
    `SELECT s.id AS sessionId, s.agent, s.title, s.time_created AS created,
            s.cost, s.tokens_input AS tokensInput, s.tokens_output AS tokensOutput,
            s.tokens_reasoning AS tokensReasoning,
            ${LAST_TEXT} AS verdictText
     FROM session s WHERE ${VERIFIER_PREDICATE} ORDER BY s.time_created;`,
  );

  // What the primary actually briefed each verifier with. The task tool records
  // the child session id in its metadata, which is the only reliable join --
  // titles are model-authored and dispatch order is not guaranteed.
  const dispatches = query(
    dbPath,
    `SELECT json_extract(p.data, '$.state.metadata.sessionId') AS sessionId,
            json_extract(p.data, '$.state.input.description') AS description,
            json_extract(p.data, '$.state.input.prompt') AS prompt,
            json_extract(p.data, '$.state.input.subagent_type') AS requestedRole
     FROM part p
     WHERE json_extract(p.data, '$.type') = 'tool'
       AND json_extract(p.data, '$.tool') = 'task'
       AND json_extract(p.data, '$.state.metadata.sessionId') IS NOT NULL;`,
  );
  const byChild = new Map(dispatches.map((row) => [row.sessionId, row]));

  const errors = query(
    dbPath,
    `SELECT m.session_id AS sessionId, s.agent,
            json_extract(m.data, '$.error.name') AS name,
            json_extract(m.data, '$.error.data.message') AS message
     FROM message m LEFT JOIN session s ON s.id = m.session_id
     WHERE json_extract(m.data, '$.error') IS NOT NULL;`,
  );

  // OpenCode's persistent shell can reset its working directory out from under
  // an agent: the notice appears 4 times across the 351 sessions in the real
  // database. A probe confirmed `pwd` resolves inside the fixture project on a
  // normal run, so this does not invalidate anything by itself -- but a command
  // that lands elsewhere would quietly make the verdict about the wrong code.
  // `foreignPathMentions` is the sharper check of the two: the harness's own
  // repository must never appear in a run's transcript.
  const foreign = outside ? sqlQuote(outside) : null;
  const [drift] = query(
    dbPath,
    `SELECT
       sum(p.data LIKE '%Shell cwd was reset%') AS cwdResets
       ${foreign ? `, sum(p.data LIKE '%' || ${foreign} || '%') AS foreignPathMentions` : ""}
     FROM part p;`,
  );

  return {
    present: true,
    sessions,
    errors,
    cwdResets: drift?.cwdResets ?? 0,
    foreignPathMentions: drift?.foreignPathMentions ?? 0,
    verifierRuns: verifierRuns.map((run, index) => ({
      ...run,
      index,
      dispatch: byChild.get(run.sessionId) ?? null,
    })),
  };
}

// Quota and throttling are confounds, not results: a variant benchmarked while
// the subscription is throttled looks worse for a reason that has nothing to do
// with its prompt. Runs flagged here are invalid and re-runnable.
const THROTTLE_PATTERN =
  /rate.?limit|\b429\b|quota|too many requests|overloaded|capacity|insufficient_quota|usage limit/i;

// An entitlement refusal is not a throttle. Observed on 2026-08-14: once the
// AntiGravity soft quota guard tripped, the backend stopped reporting quota and
// began returning `403 IAM_PERMISSION_DENIED` for
// `cloudaicompanion.instances.completeTask` instead. Both mean the same thing
// for a suite -- this account cannot run right now -- but only the first
// matched, so 120 runs were classified as generic failures and retried.
const DENIED_PATTERN =
  /IAM_PERMISSION_DENIED|PERMISSION_DENIED|\b403\b|forbidden|lacks the required IAM permission/i;

export function classifyRunHealth({ telemetry, stderr = "", stdout = "", timedOut = false, exitCode = 0 }) {
  const reasons = [];
  const haystack = [
    stderr,
    stdout,
    ...telemetry.errors.map((e) => `${e.name}: ${e.message ?? ""}`),
  ].join("\n");

  if (THROTTLE_PATTERN.test(haystack)) reasons.push("throttled-or-quota");
  if (DENIED_PATTERN.test(haystack)) reasons.push("provider-denied");
  if (telemetry.errors.some((e) => e.name === "ProviderAuthError")) reasons.push("provider-auth");
  if (telemetry.errors.some((e) => e.name === "MessageAbortedError")) reasons.push("aborted");
  if (timedOut) reasons.push("timeout");
  if (!timedOut && exitCode !== 0) reasons.push(`exit-${exitCode}`);
  if (!telemetry.present) reasons.push("no-database");

  // Warnings do not invalidate a run. They mark it for human audit, which is
  // the honest response to a confound that is real but not shown to change the
  // verdict: silently dropping these runs would bias the sample by whatever
  // makes a session long enough to hit a shell reset.
  const warnings = [];
  if (telemetry.cwdResets > 0) warnings.push("host-cwd-reset");
  if (telemetry.foreignPathMentions > 0) warnings.push("foreign-path-mentioned");

  return { valid: reasons.length === 0, reasons, warnings };
}

// Reasons that mean the account cannot run right now, as opposed to a run that
// happened to fail. Retrying these buys nothing: the 2026-08-14 suite re-queued
// 92 runs into an exhausted quota whose reset was 73 hours away, and every one
// of them failed the same way.
const STANDING_FAILURE = new Set(["throttled-or-quota", "provider-denied", "provider-auth"]);

export function isStandingFailure(reasons = []) {
  return reasons.some((reason) => STANDING_FAILURE.has(reason));
}
