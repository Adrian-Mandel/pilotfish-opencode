// Live re-verification of the four host facts whose consequence is a timing or
// ordering guarantee: H3, H4, H6 and H7 of docs/profile-router-contract.md.
//
// Reading the router's source cannot prove any of them — each is a claim about
// what the *host* does and in what order. So this file installs a throwaway
// observer plugin (host-fact-probe.mjs) into an isolated fixture, runs real
// prompts through the real binary, and asserts against what the host actually
// invoked. The router itself is deliberately absent: these are host facts, and
// the router's own hooks would only add noise.
//
// When the pinned OpenCode version moves, this file is what fails — instead of
// the contract silently going stale while G6, G7 and G10 rest on it. H11 is
// covered the same way in host-fact-config-identity.test.mjs, which needs a
// server rather than a prompt and so lives beside this file rather than in it.
//
// Requires the `opencode` binary and network access to the free model below.
//
//   node --test tests/integration/host-facts.test.mjs

import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createFixture, destroyFixture, runOpencode } from "./fixture.mjs";

const PROBE = fileURLToPath(new URL("./host-fact-probe.mjs", import.meta.url));

// A free model needs no user credentials, so the fixture stays offline-safe in
// the `auth: false` sense that the other integration tests rely on: nothing is
// spent and no personal account is touched.
const MODEL = "opencode/deepseek-v4-flash-free";

// Live turns on a small free model; the host also pays a cold start per run.
const RUN_TIMEOUT_MS = 300_000;

const openFixtures = new Set();

function startProbe(env = {}) {
  const fixture = createFixture({
    preset: "chatgpt",
    auth: false,
    // The router is not under test here, and its Task rewriting would compete
    // with the probe's own rewrite in the H3 scenarios.
    plugin: false,
    agentModel: MODEL,
    extraPlugins: ["./host-fact-probe.mjs"],
    env,
  });
  openFixtures.add(fixture);
  fixture.env.PILOTFISH_PROBE_LOG = join(fixture.root, "probe.jsonl");
  cpSync(PROBE, join(fixture.configDir, "host-fact-probe.mjs"));
  return fixture;
}

// The probe's `seq` restarts with each host process, so ordering across turns
// comes from file order, which is append-only and therefore chronological.
function readProbe(fixture) {
  const path = fixture.env.PILOTFISH_PROBE_LOG;
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function prompt(fixture, args) {
  return runOpencode(fixture, ["run", ...args, "--agent", "pilotfish"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
}

// Every scenario asserts this first. A weak model that simply never emitted the
// tool call must fail the run loudly rather than pass an empty log.
function requireBefore(records, tool) {
  const found = records.filter((entry) => entry.hook === "tool.execute.before" && entry.tool === tool);
  assert.ok(
    found.length > 0,
    `the model never called \`${tool}\`, so nothing was observed: ${JSON.stringify(records)}`,
  );
  return found;
}

// The Task scenarios ask for a role the host refuses, and a refused tool call is
// something the model can see and react to: in observed runs it retries, often
// many times, sometimes with a role that does resolve. Every such retry creates a
// child session naming the *same* parent, so any assertion that matches a child
// on `parentID` alone will eventually pick up a retry's child and blame it on the
// call under test. Nothing about the host changed when that happens.
//
// So the call under test is identified by its role rather than by being first,
// and everything else is read from the records that lie between its before-hook
// and the start of the next `task` call. Per-call nesting is strict — the child's
// `session.created` and the call's `tool.execute.after` both land inside that
// span — so the window loses nothing a genuine host change would produce.
function requireBogusTask(records) {
  const bogus = requireBefore(records, "task").filter(
    (entry) => entry.args?.subagent_type === BOGUS_ROLE,
  );
  assert.ok(
    bogus.length > 0,
    "the model never called `task` with the role the prompt asked for, so the hook was " +
      `never handed an unresolved role name: ${JSON.stringify(records.filter((e) => e.tool === "task"))}`,
  );
  // The hook must see the model's original, unresolved role name; that this
  // record exists at all is the assertion.
  return bogus[0];
}

function taskCallWindow(records, task) {
  const start = records.indexOf(task);
  const next = records.findIndex(
    (entry, index) => index > start && entry.hook === "tool.execute.before" && entry.tool === "task",
  );
  return records.slice(start + 1, next === -1 ? records.length : next);
}

// The child session a single Task call created, or undefined if it created none.
function childOf(records, task) {
  return taskCallWindow(records, task).find(
    (entry) =>
      entry.hook === "event" && entry.type === "session.created" && entry.parentID === task.sessionID,
  );
}

// How a single Task call ended: an after-hook means execute returned, a tool
// error part means it did not. Both are recorded, and exactly one of them is
// what the H3 scenarios turn on.
function terminalOf(records, task) {
  return taskCallWindow(records, task).find(
    (entry) =>
      entry.callID === task.callID &&
      (entry.hook === "tool.execute.after" || (entry.hook === "part" && entry.type === "tool.error")),
  );
}

// The model is asked for one specific call and told to stop; anything else it
// narrates is irrelevant, because the assertions read the host's hook record.
const BOGUS_ROLE = "bogus-role-does-not-exist";
// The role the probe rewrites the bogus one into. It is a real agent and an
// allowed Task pattern in the base config, so a rewrite that reached execution
// would resolve and run; the bogus one matches no pattern and is refused.
const REWRITE_TO = "scout";
// The instruction has to foreclose the model's own judgement about the call,
// because that judgement is what makes the scenario flaky: a run was observed in
// which the model noticed the role was not a configured subagent type, decided
// the errand was too trivial to delegate, answered "pong" itself and never
// called the tool at all. The observation here is the *attempt*, not its result,
// so the prompt says so. A model that still declines fails the run loudly at
// requireBefore, which is the correct outcome — nothing was observed.
const TASK_PROMPT =
  `Call the task tool exactly once with subagent_type set to the literal string ${BOGUS_ROLE}, ` +
  "description set to probe, and prompt set to 'Reply with the single word pong.' " +
  "Making that call is the entire task: the role name is deliberately not a configured one, " +
  "and the call is expected to be refused. Do not substitute a valid subagent_type, do not " +
  "skip the call because the role looks wrong, and do not answer in its place. Then stop.";
// Deliberately inside the fixture project directory: a path outside it would
// be refused by the host's external_directory check before execute ran, which
// produces the same "before present, after absent" shape H6 is asserting and
// would make the test prove nothing. The name is unique enough that matching on
// it identifies the call without depending on how the model spelled the path —
// the model resolves it to an absolute path about half the time.
const MISSING_FILE = "pilotfish-h6-missing-target.txt";
// Forecloses the model's judgement for the same reason TASK_PROMPT does. This
// scenario is exposed to the identical failure: a model that checks first, sees
// the file is absent and reports that instead of calling `read` observes
// nothing, and the run fails at requireBefore rather than proving H6.
function readPrompt(fixture) {
  const path = `${fixture.project.replaceAll("\\", "/")}/${MISSING_FILE}`;
  return (
    `Call the read tool exactly once with filePath ${path} . ` +
    "Making that call is the entire task: the file deliberately does not exist and the call " +
    "is expected to fail. Do not create it, do not check whether it exists first, do not " +
    "substitute a different path, and do not skip the call because it will fail. Then stop."
  );
}

describe("OpenCode host facts H3, H4, H6 and H7", () => {
  // H3(a) + H4: the probe rewrites the bogus role in place.
  let inPlace;
  // H3(b): the same rewrite by reassigning `output.args` wholesale.
  let reassigned;
  // H6: a tool execution that throws.
  let thrown;
  // H7: two turns in one session.
  let twoTurns;

  before(async () => {
    const rewrite = {
      PILOTFISH_PROBE_REWRITE_FROM: BOGUS_ROLE,
      PILOTFISH_PROBE_REWRITE_TO: REWRITE_TO,
    };

    const inPlaceFixture = startProbe(rewrite);
    await prompt(inPlaceFixture, [TASK_PROMPT]);
    inPlace = readProbe(inPlaceFixture);

    const reassignFixture = startProbe({ ...rewrite, PILOTFISH_PROBE_REASSIGN: "1" });
    await prompt(reassignFixture, [TASK_PROMPT]);
    reassigned = readProbe(reassignFixture);

    const throwFixture = startProbe();
    await prompt(throwFixture, [readPrompt(throwFixture)]);
    thrown = readProbe(throwFixture);

    const turnsFixture = startProbe();
    await prompt(turnsFixture, ["Reply with the single word: alpha"]);
    await prompt(turnsFixture, ["--continue", "Reply with the single word: beta"]);
    twoTurns = readProbe(turnsFixture);
  });

  after(() => {
    for (const fixture of openFixtures) destroyFixture(fixture);
  });

  // H3(a). The model emits an agent name that does not exist and is not in the
  // Task permission map. The probe swaps it for a real one from inside
  // tool.execute.before. If the child then runs as `scout`, the hook provably
  // ran ahead of both permission and agent resolution — the bogus name would
  // have been rejected by either one first.
  test("tool.execute.before runs before Task permission and agent resolution", () => {
    const task = requireBogusTask(inPlace);
    const child = childOf(inPlace, task);
    assert.ok(child, `no child session was created: ${JSON.stringify(taskCallWindow(inPlace, task))}`);
    const childMessage = inPlace.find(
      (entry) => entry.hook === "chat.message" && entry.sessionID === child.sessionID,
    );
    assert.ok(childMessage, "the child session never received a message");
    assert.equal(childMessage.agent, REWRITE_TO, "the rewritten role must be the one that resolved");
  });

  // H3(b). The host hands the hook the same args object it later passes to
  // execute, so only in-place writes survive. Replacing `output.args` outright
  // leaves the original untouched — a trap worth pinning, because the failure
  // is silent: the Task simply runs with the role the model asked for.
  test("wholesale reassignment of output.args does not reach execution", () => {
    const task = requireBogusTask(reassigned);

    // Positive evidence, not merely the absence of a child: the call has to end
    // in a refusal that only the role the *model* sent can produce. Had the
    // reassignment propagated, execute would have seen an allowed, resolvable
    // role instead, and the call would have returned through the after-hook.
    const terminal = terminalOf(reassigned, task);
    assert.ok(
      terminal,
      `the bogus call never reached a terminal state: ${JSON.stringify(taskCallWindow(reassigned, task))}`,
    );
    assert.equal(
      terminal.hook,
      "part",
      `the bogus call returned instead of being refused, so the reassigned role reached execution: ${JSON.stringify(terminal)}`,
    );
    // Either gate is proof: the permission map matches on the role before agent
    // resolution, and agent resolution rejects it after. Both quote the role the
    // hook was handed, never the rewritten one.
    assert.match(
      terminal.error,
      /prevents you from using this specific tool call|unknown agent type/i,
      `the bogus call failed for some reason other than its role: ${terminal.error}`,
    );

    assert.equal(
      childOf(reassigned, task),
      undefined,
      "the reassigned role reached execution, so the host no longer shares the args reference",
    );
  });

  // H4. The exact key set is the point. A child session id appearing here would
  // make G7's description-marker-plus-session.created binding unnecessary, and
  // this test is what should notice.
  test("the before-hook carries the parent session and callID and nothing else", () => {
    const task = requireBogusTask(inPlace);
    assert.deepEqual(task.inputKeys, ["callID", "sessionID", "tool"]);
    assert.deepEqual(task.outputKeys, ["args"]);
    assert.equal(typeof task.callID, "string");

    // `sessionID` is the parent: the child is created later, and names this
    // same id as its own parent.
    const child = childOf(inPlace, task);
    assert.ok(child, "no child session named the before-hook sessionID as its parent");
    assert.notEqual(child.sessionID, task.sessionID);
    assert.ok(
      inPlace.indexOf(child) > inPlace.indexOf(task),
      "the child session must not exist yet when the before-hook runs",
    );
  });

  // H6. A read of a path that does not exist throws inside execute. If the host
  // ran the after-hook in a `finally`, the router could release its
  // authorization there; it does not, which is exactly why G7 needs an
  // independent 30-second expiry timer.
  //
  // The trap this test has to avoid: "before fired, after did not" is also what
  // a call REFUSED BEFORE EXECUTE looks like, because the host asks permission
  // between the two hooks. H6 would then be untested while the test passed. So
  // the failure is classified, not merely counted — the call has to have
  // reached execute and thrown there.
  test("tool.execute.after is skipped when execution throws", () => {
    const reads = requireBefore(thrown, "read").filter((entry) =>
      basename(entry.args?.filePath ?? "").toLowerCase() === MISSING_FILE.toLowerCase(),
    );
    assert.equal(
      reads.length,
      1,
      `expected exactly one read of ${MISSING_FILE}: ${JSON.stringify(thrown.filter((e) => e.tool === "read"))}`,
    );
    const [read] = reads;

    // The evidence that execute ran: `File not found: …` is raised by the read
    // tool's own body, after the host has already asked permission and handed
    // control over. A refusal never reaches it.
    const failure = thrown.find(
      (entry) => entry.hook === "part" && entry.type === "tool.error" && entry.callID === read.callID,
    );
    assert.ok(failure, `the read call never reached a terminal error state: ${JSON.stringify(thrown)}`);
    assert.match(
      failure.error,
      /file not found/i,
      `the read failed for some reason other than the missing file: ${failure.error}`,
    );
    // The two ways the host can refuse before execute, named so that either one
    // silently replacing the execution error fails loudly here rather than
    // passing as an untested H6.
    assert.doesNotMatch(
      failure.error,
      /rejected permission|permission denied|resolves outside the working directory/i,
      `the call was refused before execute, so H6 was never exercised: ${failure.error}`,
    );
    assert.deepEqual(
      thrown.filter(
        (entry) => entry.hook === "permission" && entry.type === "permission.asked" && entry.callID === read.callID,
      ),
      [],
      "the host asked permission for this call before execute, so the failure may predate execute",
    );

    const afters = thrown.filter(
      (entry) => entry.hook === "tool.execute.after" && entry.callID === read.callID,
    );
    assert.deepEqual(afters, [], "the after-hook ran for a call that threw");

    // Not a blanket "after never fires": the successful Task in the H3 scenario
    // does produce one, so a missing record here means skipped, not unwired.
    const task = requireBogusTask(inPlace);
    assert.ok(
      inPlace.some((entry) => entry.hook === "tool.execute.after" && entry.callID === task.callID),
      "a successful call must still produce an after-hook, or this test proves nothing",
    );
  });

  // H7. Read from inside the hook rather than after it: the claim is about what
  // is visible *at hook time*.
  test("chat.message runs before the current message is persisted", () => {
    const messages = twoTurns.filter((entry) => entry.hook === "chat.message");
    assert.equal(messages.length, 2, `expected one chat.message per turn: ${JSON.stringify(messages)}`);
    for (const message of messages) {
      assert.equal(message.messagesError, undefined, "client.session.messages failed inside the hook");
      assert.equal(
        message.currentMessagePersisted,
        false,
        `${message.messageID} was already persisted when chat.message ran`,
      );
    }
  });

  // The second half of H7, and the half G10 actually depends on: after a
  // restart the router rebuilds its state from history, which only works if
  // earlier turns are already readable when the hook fires.
  test("prior turns are readable from client.session.messages inside the hook", () => {
    const [first, second] = twoTurns.filter((entry) => entry.hook === "chat.message");
    assert.equal(first.sessionID, second.sessionID, "both turns must share one session");
    assert.equal(first.persistedCount, 0, "the first turn has no history to read");
    // The first turn's user message and its assistant reply.
    assert.equal(second.persistedCount, 2, `unexpected history: ${JSON.stringify(second.persistedIDs)}`);
    assert.ok(
      second.persistedIDs.includes(first.messageID),
      "the previous turn's message was not readable from the next turn's hook",
    );
  });
});
