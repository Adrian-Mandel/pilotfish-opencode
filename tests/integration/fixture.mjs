#!/usr/bin/env node
// Isolated OpenCode integration fixture for the Pilotfish profile router.
//
// Builds a throwaway global OpenCode configuration from the repository
// templates and runs the real host against it. Nothing outside the fixture
// root is written: XDG_CONFIG_HOME and XDG_DATA_HOME both point inside it, and
// provider credentials are symlinked rather than copied so no secret is
// duplicated onto disk.
//
// This replaces the ad hoc shell probes used during the first issue #12
// attempt. Scenarios live in scenarios.mjs and reuse this file.
//
//   node tests/integration/fixture.mjs create [--preset chatgpt|antigravity]
//                                             [--primary model[@variant]]
//   node tests/integration/fixture.mjs exec <root> -- run "hello" --agent pilotfish
//   node tests/integration/fixture.mjs destroy <root>

import { spawn } from "node:child_process";
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REAL_CONFIG_DIR = join(homedir(), ".config/opencode");
const REAL_AUTH = join(homedir(), ".local/share/opencode/auth.json");

// Provider models are not built into OpenCode: ChatGPT and AntiGravity model
// IDs are registered by auth plugins in the user's global config. A fixture
// that isolates config therefore has no providers at all unless those plugins
// and their account files come along, and every live run fails with
// ProviderModelNotFoundError.
function realProviderPlugins() {
  for (const name of ["opencode.jsonc", "opencode.json", "config.json"]) {
    const path = join(REAL_CONFIG_DIR, name);
    if (!existsSync(path)) continue;
    try {
      const config = parseJsonc(readFileSync(path, "utf8"));
      const plugins = Array.isArray(config.plugin) ? config.plugin : [];
      return plugins.filter(
        (entry) => typeof entry === "string" && !entry.includes("profile-router"),
      );
    } catch {
      return [];
    }
  }
  return [];
}

function copyProviderAccounts(configDir) {
  for (const name of ["antigravity-accounts.json"]) {
    const source = join(REAL_CONFIG_DIR, name);
    const target = join(configDir, name);
    // inheritGlobal already copied it; do not shadow the copy with a link.
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target);
  }
}

// The templates are .jsonc; OpenCode accepts comments, JSON.parse does not.
function parseJsonc(source) {
  const stripped = source.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function readTemplate(relativePath) {
  return parseJsonc(readFileSync(join(REPO_ROOT, relativePath), "utf8"));
}

// A preset binds agents to models and nothing else. Global keys stay out of
// it deliberately: Pilotfish is opt-in and does not own the user's top-level
// configuration.
function mergeAgents(base, preset) {
  const merged = structuredClone(base);
  for (const [name, overlay] of Object.entries(preset.agent ?? {})) {
    merged.agent[name] = { ...(merged.agent[name] ?? {}), ...overlay };
  }
  return merged;
}

// Provider auth plugins only register their models inside a config directory
// that already carries their installed dependencies and account state. For live
// provider scenarios, clone the user's real global config and overlay Pilotfish
// onto the copy; the real directory is never written to.
function inheritGlobalConfig(configDir) {
  cpSync(REAL_CONFIG_DIR, configDir, {
    recursive: true,
    // Backups and prior install state belong to the real installation only.
    filter: (source) => !source.includes("/pilotfish/backups") && !source.endsWith("install-state.json"),
  });
  for (const name of ["opencode.jsonc", "opencode.json", "config.json"]) {
    const path = join(REAL_CONFIG_DIR, name);
    if (existsSync(path)) {
      const config = parseJsonc(readFileSync(path, "utf8"));
      // MCP servers would launch real external processes from a test run.
      delete config.mcp;
      return config;
    }
  }
  return {};
}

// `provider/model` optionally suffixed `@variant`. Model IDs carry slashes and
// dashes but never `@`, so the split is unambiguous.
export function parsePrimary(spec) {
  if (!spec) return null;
  const at = spec.lastIndexOf("@");
  if (at < 0) return { model: spec };
  const model = spec.slice(0, at);
  const variant = spec.slice(at + 1);
  if (!model || !variant) throw new Error(`malformed primary "${spec}"; expected model[@variant]`);
  return { model, variant };
}

// Promote one role to the only agent in the config, as a primary.
//
// The OpenCode CLI refuses a subagent for `--agent`, so a role cannot be run
// directly while it is defined as a subagent. Rewriting it to a primary in a
// throwaway config is how a harness measures one role's response to a fixed
// input without paying for an orchestration around it.
//
// This is not a router bench mode and deliberately not one: the router is
// removed entirely rather than taught to make an exception, so nothing here can
// weaken a component whose value is failing closed. What it costs is fidelity —
// a solo role is not being dispatched by a real primary — so it measures the
// prompt and the model, not the dispatch.
function soloAgentConfig(agents, role, model) {
  const agent = structuredClone(agents[role]);
  if (!agent) throw new Error(`no agent "${role}" to promote`);
  agent.mode = "primary";
  delete agent.hidden;
  if (model) {
    agent.model = model.model;
    if (model.variant === undefined) delete agent.variant;
    else agent.variant = model.variant;
  }
  // The role's own permissions stay exactly as shipped. A verifier that could
  // suddenly edit, or one that lost `bash` and so could not run the tests it is
  // asked to reproduce, would not be the role under test.
  return { [role]: agent };
}

export function createFixture({
  preset = "chatgpt",
  primary = null,
  soloAgent = null,
  soloModel = null,
  auth = true,
  plugin = true,
  inheritGlobal = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "pilotfish-fixture-"));
  const configHome = join(root, "config");
  const dataHome = join(root, "data");
  const configDir = join(configHome, "opencode");
  const project = join(root, "project");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(dataHome, "opencode"), { recursive: true });
  mkdirSync(project, { recursive: true });

  const inherited = inheritGlobal ? inheritGlobalConfig(configDir) : {};
  const pilotfish = mergeAgents(
    readTemplate("templates/opencode.base.jsonc"),
    readTemplate(`templates/presets/${preset}.jsonc`),
  );
  // A preset ships one default primary, but the router selects the whole worker
  // mapping from the primary model alone. Overriding it here is how a scenario
  // exercises another profile in the same preset without editing a template.
  // The override is authoritative in both directions, for the same reason the
  // router's worker bindings are: a caller that names no variant must clear the
  // preset's, not leak one model's effort tier onto a model that has none.
  if (primary) {
    const agent = { ...pilotfish.agent.pilotfish, model: primary.model };
    if (primary.variant === undefined) delete agent.variant;
    else agent.variant = primary.variant;
    pilotfish.agent.pilotfish = agent;
  }
  const agents = soloAgent
    ? soloAgentConfig(pilotfish.agent, soloAgent, soloModel)
    : { ...(inherited.agent ?? {}), ...pilotfish.agent };
  const config = {
    ...inherited,
    ...pilotfish,
    agent: agents,
  };
  // Provider auth plugins must load before the router so its models exist.
  // A solo role has no Task calls to route, so the router is left out entirely
  // rather than loaded and bypassed.
  const providerPlugins = auth ? realProviderPlugins() : [];
  config.plugin = [
    ...providerPlugins,
    ...(plugin && !soloAgent ? [["./pilotfish/profile-router.mjs", { preset }]] : []),
  ];
  writeFileSync(join(configDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`);
  for (const stale of ["opencode.jsonc", "config.json"]) {
    rmSync(join(configDir, stale), { force: true });
  }

  // Byte-identical runtime artifacts, exactly as the install runbook requires.
  cpSync(join(REPO_ROOT, "templates/pilotfish"), join(configDir, "pilotfish"), {
    recursive: true,
  });

  if (auth) {
    if (!existsSync(REAL_AUTH)) {
      throw new Error(
        `No OpenCode credentials at ${REAL_AUTH}; re-run with { auth: false } for offline scenarios.`,
      );
    }
    symlinkSync(REAL_AUTH, join(dataHome, "opencode", "auth.json"));
    copyProviderAccounts(configDir);
  }

  return { root, configHome, dataHome, configDir, project };
}

export function fixtureEnv(fixture) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: fixture.configHome,
    XDG_DATA_HOME: fixture.dataHome,
    // OpenCode resolves its project directory from PWD, which the spawning
    // shell inherits. Without this override the host binds to the caller's
    // repository instead of the fixture project even though cwd is correct.
    PWD: fixture.project,
    INIT_CWD: fixture.project,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  };
}

// `stdoutFile` captures stdout by redirecting the child's own file descriptor
// instead of reading it through a pipe. Piped output stops at 65530 bytes; the
// same command redirected to a file yields all of it. Anything that can exceed
// 64 KiB — `debug config` resolves every prompt inline, so it does — must use
// this path or it will silently parse a truncated document.
export function runOpencode(
  fixture,
  args,
  { cwd = fixture.project, timeoutMs = 180_000, stdoutFile = null } = {},
) {
  return new Promise((resolvePromise) => {
    const handle = stdoutFile ? openSync(stdoutFile, "w") : null;
    const child = spawn("opencode", args, {
      cwd,
      env: fixtureEnv(fixture),
      stdio: ["ignore", handle ?? "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (handle !== null) {
        closeSync(handle);
        stdout = readFileSync(stdoutFile, "utf8");
      }
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

export function destroyFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}

// Router rejections surface as a generic error on stdout (host fact H10); the
// exact reason is only in the logs.
export function routerReason(result) {
  const match = /Pilotfish[^\n]*/g;
  return [...`${result.stderr}\n${result.stdout}`.matchAll(match)].map((m) => m[0]);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "create") {
    const presetIndex = rest.indexOf("--preset");
    const preset = presetIndex >= 0 ? rest[presetIndex + 1] : "chatgpt";
    const primaryIndex = rest.indexOf("--primary");
    const fixture = createFixture({
      preset,
      primary: primaryIndex >= 0 ? parsePrimary(rest[primaryIndex + 1]) : null,
      auth: !rest.includes("--no-auth"),
      inheritGlobal: rest.includes("--inherit-global"),
    });
    process.stdout.write(`${fixture.root}\n`);
    return;
  }
  if (command === "exec") {
    const root = rest[0];
    const separator = rest.indexOf("--");
    const args = separator >= 0 ? rest.slice(separator + 1) : rest.slice(1);
    const fixture = {
      root,
      configHome: join(root, "config"),
      dataHome: join(root, "data"),
      configDir: join(root, "config/opencode"),
      project: join(root, "project"),
    };
    const result = await runOpencode(fixture, args);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    // process.exit() would discard pending writes and silently truncate large
    // output such as `debug config` at the pipe buffer.
    process.exitCode = result.code ?? 1;
  }
  if (command === "destroy") {
    destroyFixture({ root: rest[0] });
    return;
  }
  process.stderr.write("usage: fixture.mjs create|exec|destroy\n");
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
