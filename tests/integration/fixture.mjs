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

// `extraPlugins` appends plugin entries after the router's, `agentModel` binds
// every agent to one model, and `env` reaches the spawned host through
// fixtureEnv. Host-fact probes need all three: an observer plugin, a model that
// costs no credentials, and a path to write observations to.
export function createFixture({
  preset = "chatgpt",
  auth = true,
  plugin = true,
  inheritGlobal = false,
  extraPlugins = [],
  agentModel = null,
  env = {},
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
  const config = {
    ...inherited,
    ...pilotfish,
    agent: { ...(inherited.agent ?? {}), ...pilotfish.agent },
  };
  // Provider auth plugins must load before the router so its models exist.
  const providerPlugins = auth ? realProviderPlugins() : [];
  config.plugin = [
    ...providerPlugins,
    ...(plugin ? [["./pilotfish/profile-router.mjs", { preset }]] : []),
    ...extraPlugins,
  ];
  if (agentModel) {
    config.model = agentModel;
    for (const name of Object.keys(config.agent ?? {})) {
      config.agent[name] = { ...config.agent[name], model: agentModel };
    }
  }
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

  return { root, configHome, dataHome, configDir, project, env };
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
    ...(fixture.env ?? {}),
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
    const fixture = createFixture({
      preset,
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
