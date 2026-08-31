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
//
// OpenCode's free tier rotates its roster. `opencode/deepseek-v4-flash-free`
// was retired from it, and a pinned model that no longer resolves never emits a
// tool call, so every scenario below fails INCONCLUSIVE and H7 fails its
// persistence assertion -- collateral of the missing model, not a host change.
// Pinned to a model confirmed present on the tier (nemotron-3-ultra, which
// passed all six host-fact scenarios on OpenCode 1.18.22). Re-pin when this one
// rotates out in turn; `opencode models | grep '^opencode/'` lists the current
// free roster.
const MODEL = "opencode/nemotron-3-ultra-free";

// Live turns on a small free model; the host also pays a cold start per run.
//
// Two caps, because the three tool-observation scenarios and the two H7 turns
// need opposite things from a timeout.
//
// The tool scenarios only need the host to *reach* the call. Everything their
// assertions read — the before-hook, the child's `session.created`, the child's
// `chat.message`, and the call's terminal record — lands in one burst a few
// seconds in, and the probe writes with `appendFileSync`, so every one of those
// records is already on disk when the run is killed. What runs long afterwards
// is the free model looping on `task` with the assertions already satisfied.
//
// Measured 2026-08-20 over 12 runs (macOS, `opencode 1.18.16`, canonical
// fixture root), timing the last record any assertion reads:
//
//   H3(a)/H4  5.6  6.0  6.2  8.1     H3(b)  4.7  4.8  6.4  20.4
//   H6        4.6  4.7  4.8  5.6
//
// Whole runs over the same 12: 6.3s to 56s, plus one that was still calling
// `task` at a 120s cap — 32 calls — having produced its last asserted record at
// 6.2s. That run is the case this cap exists for, and it is also the proof that
// cutting it loses nothing.
//
// 90s is a 4.4x margin over the slowest evidence ever observed and ~15x over
// the median, and it takes the worst case for these three from 15 minutes to
// 4.5. Truncation is not a silent risk here either: `absence()` below turns any
// record missing from a capped run into an inconclusive verdict rather than a
// refutation, so the cost of picking this too low is a repeated run, never a
// false block.
const TOOL_RUN_TIMEOUT_MS = 90_000;
// H7 is the opposite case and keeps the original generous cap. Its second turn
// asserts `persistedCount === 2`, so turn one has to genuinely finish and
// persist its assistant reply before turn two can read it: there is no early
// burst to wait for, and a turn killed mid-reply fails the test for a reason
// that is not about the host. The measured pair completes in 6.5–8.0s, so this
// is not a cap the scenario is expected to approach — it is headroom against a
// provider stalling a turn that has to run to completion, which is exactly the
// risk the tool scenarios do not carry.
const TURN_RUN_TIMEOUT_MS = 300_000;

// A failure that must not be read as a host change. Marked failures mean the
// scenario's precondition was never reached, so the host claim went untested in
// either direction; those are repeated rather than treated as a finding.
// Anything unmarked is a real refutation. The prefix is the machine-readable
// half of that taxonomy: a
// releaser can grep for it instead of judging each message.
const INCONCLUSIVE = "INCONCLUSIVE:";

// A record that never appeared refutes a host claim only if the run ended on
// its own. Killed at its cap, the same absence may just mean the host had not
// got there yet — so under a cap the identical assertion is inconclusive. This
// is what keeps the shorter cap above from converting into false blocks.
function absence(run, message) {
  return run?.timedOut ? `${INCONCLUSIVE} run killed at its cap, so ${message}` : message;
}

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

function prompt(fixture, args, timeoutMs = TOOL_RUN_TIMEOUT_MS) {
  return runOpencode(fixture, ["run", ...args, "--agent", "pilotfish"], { timeoutMs });
}

// Every scenario asserts this first. A weak model that simply never emitted the
// tool call must fail the run loudly rather than pass an empty log.
function requireBefore(records, tool) {
  const found = records.filter((entry) => entry.hook === "tool.execute.before" && entry.tool === tool);
  assert.ok(
    found.length > 0,
    `${INCONCLUSIVE} the model never called \`${tool}\`, so nothing was observed: ${JSON.stringify(records)}`,
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
    `${INCONCLUSIVE} the model never called \`task\` with the role the prompt asked for, so the hook was ` +
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
  // Whether each scenario's host process ended on its own or was killed at its
  // cap, which is what decides whether a missing record refutes anything.
  const runs = {};

  before(async () => {
    const rewrite = {
      PILOTFISH_PROBE_REWRITE_FROM: BOGUS_ROLE,
      PILOTFISH_PROBE_REWRITE_TO: REWRITE_TO,
    };

    const inPlaceFixture = startProbe(rewrite);
    runs.inPlace = await prompt(inPlaceFixture, [TASK_PROMPT]);
    inPlace = readProbe(inPlaceFixture);

    const reassignFixture = startProbe({ ...rewrite, PILOTFISH_PROBE_REASSIGN: "1" });
    runs.reassigned = await prompt(reassignFixture, [TASK_PROMPT]);
    reassigned = readProbe(reassignFixture);

    const throwFixture = startProbe();
    runs.thrown = await prompt(throwFixture, [readPrompt(throwFixture)]);
    thrown = readProbe(throwFixture);

    const turnsFixture = startProbe();
    const first = await prompt(turnsFixture, ["Reply with the single word: alpha"], TURN_RUN_TIMEOUT_MS);
    const second = await prompt(
      turnsFixture,
      ["--continue", "Reply with the single word: beta"],
      TURN_RUN_TIMEOUT_MS,
    );
    // Either turn hitting the cap can leave the other's evidence unwritten.
    runs.twoTurns = { timedOut: first.timedOut || second.timedOut };
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
    assert.ok(
      child,
      absence(runs.inPlace, `no child session was created: ${JSON.stringify(taskCallWindow(inPlace, task))}`),
    );
    const childMessage = inPlace.find(
      (entry) => entry.hook === "chat.message" && entry.sessionID === child.sessionID,
    );
    assert.ok(childMessage, absence(runs.inPlace, "the child session never received a message"));
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
      absence(
        runs.reassigned,
        `the bogus call never reached a terminal state: ${JSON.stringify(taskCallWindow(reassigned, task))}`,
      ),
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
      // Inconclusive rather than a refutation: some other refusal reached the
      // call first, so execute never saw the role and nothing was learned about
      // whether a reassignment would have propagated.
      `${INCONCLUSIVE} the bogus call failed for some reason other than its role: ${terminal.error}`,
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
    assert.ok(
      child,
      absence(runs.inPlace, "no child session named the before-hook sessionID as its parent"),
    );
    assert.notEqual(child.sessionID, task.sessionID);

    // Asserting the child appears after this call's hook would restate itself,
    // because `childOf` only ever looks after it. The claim worth checking is
    // that the child did not exist *at all* when the hook ran, which is why the
    // hook has no id to pass: nothing before the hook mentions that session.
    // A host that pre-created the child and announced it later would fail here.
    assert.equal(
      inPlace.slice(0, inPlace.indexOf(task)).find((entry) => entry.sessionID === child.sessionID),
      undefined,
      `child ${child.sessionID} already existed when the before-hook ran, so the host could have passed its id`,
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
      `${INCONCLUSIVE} expected exactly one read of ${MISSING_FILE}: ${JSON.stringify(thrown.filter((e) => e.tool === "read"))}`,
    );
    const [read] = reads;

    // The evidence that execute ran: `File not found: …` is raised by the read
    // tool's own body, after the host has already asked permission and handed
    // control over. A refusal never reaches it.
    const failure = thrown.find(
      (entry) => entry.hook === "part" && entry.type === "tool.error" && entry.callID === read.callID,
    );
    assert.ok(
      failure,
      absence(runs.thrown, `the read call never reached a terminal error state: ${JSON.stringify(thrown)}`),
    );
    // The three ways the host can refuse before execute, named so that any of
    // them silently replacing the execution error fails loudly here rather than
    // passing as an untested H6. The guard is unchanged and deliberately not
    // relaxed; what #39 settled is what its firing *means*.
    //
    // A refusal is inconclusive, not a refutation, and for the same reason the
    // other inconclusive shapes are: the host never called execute, so H6's
    // claim about what happens when execute throws was not exercised in either
    // direction. Blocking a release on it would report a host change the run
    // has no evidence for; passing it would report a guarantee the run never
    // checked. Repeat is the only honest verdict, and #39 found the cause of
    // every observed instance outside the host entirely — an uncanonical
    // fixture root made the host read an in-project path as `external_directory`
    // (see the `realpathSync` note in fixture.mjs). If this fires again, suspect
    // the fixture's path handling before the contract.
    assert.doesNotMatch(
      failure.error,
      /rejected permission|permission denied|resolves outside the working directory/i,
      `${INCONCLUSIVE} the call was refused before execute, so H6 was never exercised: ${failure.error}`,
    );
    assert.deepEqual(
      thrown.filter(
        (entry) => entry.hook === "permission" && entry.type === "permission.asked" && entry.callID === read.callID,
      ),
      [],
      `${INCONCLUSIVE} the host asked permission for this call before execute, so the failure may predate execute`,
    );
    // Ordered after the refusal guards on purpose: a refusal also fails this
    // one, and the classification a releaser acts on has to be the specific
    // reason rather than the generic mismatch.
    assert.match(
      failure.error,
      /file not found/i,
      `the read failed for some reason other than the missing file: ${failure.error}`,
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
      absence(runs.inPlace, "a successful call must still produce an after-hook, or this test proves nothing"),
    );
  });

  // H7. Read from inside the hook rather than after it: the claim is about what
  // is visible *at hook time*.
  test("chat.message runs before the current message is persisted", () => {
    const messages = twoTurns.filter((entry) => entry.hook === "chat.message");
    assert.equal(
      messages.length,
      2,
      absence(runs.twoTurns, `expected one chat.message per turn: ${JSON.stringify(messages)}`),
    );
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
    // Guarded rather than destructured straight into the assertions: a turn that
    // never reached its hook would otherwise fail as a TypeError, which carries
    // no classification at all.
    assert.ok(
      first && second,
      absence(runs.twoTurns, `both turns must reach chat.message: ${JSON.stringify(twoTurns)}`),
    );
    assert.equal(first.sessionID, second.sessionID, "both turns must share one session");
    assert.equal(first.persistedCount, 0, "the first turn has no history to read");
    // The first turn's user message and its assistant reply.
    // The one place the generous H7 cap earns itself: a turn one killed before
    // its assistant reply persisted lands here with a count of 1.
    assert.equal(
      second.persistedCount,
      2,
      absence(runs.twoTurns, `unexpected history: ${JSON.stringify(second.persistedIDs)}`),
    );
    assert.ok(
      second.persistedIDs.includes(first.messageID),
      "the previous turn's message was not readable from the next turn's hook",
    );
  });
});
