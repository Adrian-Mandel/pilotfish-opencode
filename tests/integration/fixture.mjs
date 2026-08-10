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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const REAL_AUTH = join(homedir(), ".local/share/opencode/auth.json");

// The templates are .jsonc; OpenCode accepts comments, JSON.parse does not.
function parseJsonc(source) {
  const stripped = source.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function readTemplate(relativePath) {
  return parseJsonc(readFileSync(join(REPO_ROOT, relativePath), "utf8"));
}

function mergeAgents(base, preset) {
  const merged = structuredClone(base);
  for (const [name, overlay] of Object.entries(preset.agent ?? {})) {
    merged.agent[name] = { ...(merged.agent[name] ?? {}), ...overlay };
  }
  return merged;
}

export function createFixture({ preset = "chatgpt", auth = true, plugin = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pilotfish-fixture-"));
  const configHome = join(root, "config");
  const dataHome = join(root, "data");
  const configDir = join(configHome, "opencode");
  const project = join(root, "project");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(dataHome, "opencode"), { recursive: true });
  mkdirSync(project, { recursive: true });

  const config = mergeAgents(
    readTemplate("templates/opencode.base.jsonc"),
    readTemplate(`templates/presets/${preset}.jsonc`),
  );
  if (plugin) {
    config.plugin = [["./pilotfish/profile-router.mjs", { preset }]];
  }
  writeFileSync(join(configDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`);

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

export function runOpencode(fixture, args, { cwd = fixture.project, timeoutMs = 180_000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn("opencode", args, {
      cwd,
      env: fixtureEnv(fixture),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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
    const fixture = createFixture({ preset, auth: !rest.includes("--no-auth") });
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
    process.exit(result.code ?? 1);
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
