// Prompt variants for the A/B.
//
// A variant is a set of prompt files replaced inside the fixture's config
// directory before the run. The repository working tree and the installed
// configuration at ~/.config/opencode are never touched, which matters twice
// over: the #16 measurement sample restarts on any prompt edit, and a variant
// that leaked into the real install would poison it silently.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROMPT_DIR = "templates/pilotfish/prompts";

// `9332e48~1` is the commit before the verifier scope change landed. The
// installed backup at ~/.config/opencode/pilotfish/backups/20260810-152653/
// holds the same text, but git is the reproducible source.
const PRE_SCOPE = "9332e48~1";

export const VARIANTS = {
  current: {
    description: "the working tree prompts, i.e. #16 as it stands",
    prompts: {},
  },
  "pre-scope": {
    description: `verifier.md from ${PRE_SCOPE}, before the scope change`,
    prompts: { "verifier.md": PRE_SCOPE },
  },
  // Not in the default suite. The scope change touched the primary's Completion
  // Gate as well, so this is the complete revert -- but the same commit also
  // rewrote the recon and dispatch rules, so a difference here is not
  // attributable to verifier scope alone. Use it to confirm a finding, never to
  // produce one.
  "pre-scope-gate": {
    description: `verifier.md and pilotfish.md from ${PRE_SCOPE} (confounded)`,
    prompts: { "verifier.md": PRE_SCOPE, "pilotfish.md": PRE_SCOPE },
    confounded: true,
  },
};

export const DEFAULT_VARIANTS = ["current", "pre-scope"];

function promptAtRef(ref, name) {
  return execFileSync("git", ["show", `${ref}:${PROMPT_DIR}/${name}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

// Resolve every prompt this variant pins, and fail before any provider request
// if a ref has gone missing. Digests of all nine resolved prompts go into the
// result record so two result files can be compared for what the agents were
// actually told, not for what the variant was called.
export function resolveVariant(name) {
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown variant: ${name}`);
  const overrides = {};
  for (const [file, ref] of Object.entries(variant.prompts)) {
    overrides[file] = promptAtRef(ref, file);
  }
  return { name, ...variant, overrides };
}

export function applyVariant(fixture, resolved) {
  const promptDir = join(fixture.configDir, "pilotfish/prompts");
  for (const [file, text] of Object.entries(resolved.overrides)) {
    writeFileSync(join(promptDir, file), text);
  }
  return promptDigests(promptDir);
}

export function promptDigests(promptDir) {
  const digests = {};
  for (const file of ["pilotfish.md", "verifier.md"]) {
    const text = readFileSync(join(promptDir, file), "utf8");
    digests[file] = createHash("sha256").update(text).digest("hex").slice(0, 16);
  }
  return digests;
}
