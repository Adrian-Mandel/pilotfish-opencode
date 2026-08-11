// Seeded-defect cases for the issue #15 verifier-correctness slice.
//
// A case is a two-commit git repository plus a claim about the second commit,
// and machine-readable ground truth about the defect seeded in it. The classes
// come from the slice scope: A is a defect inside the stated claim, B is one in
// a file the change touched but outside the claim, C is documentation drift on
// a trivial edit, D is a clean change and measures the false-REFUTED floor.
//
// The repository is built here rather than committed as a nested checkout: a
// `.git` directory inside this repository cannot be tracked, and the whole
// point of class B is that the *diff* touches two things while the claim names
// one, which only exists once the commits do.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));

export const CLASSES = ["A", "B", "C", "D"];

// Commits are made with explicit identity so a run never depends on, or picks
// up, whatever `user.email` the host happens to have configured.
const GIT_IDENTITY = [
  "-c", "user.name=Pilotfish Bench",
  "-c", "user.email=bench@pilotfish.invalid",
  "-c", "commit.gpgsign=false",
  "-c", "core.hooksPath=/dev/null",
];

function git(cwd, ...args) {
  return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
}

export function loadCases({ ids = null, classes = null } = {}) {
  const cases = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadCase(entry.name))
    .sort((a, b) => a.id.localeCompare(b.id));

  const selected = cases.filter(
    (item) =>
      (!ids || ids.includes(item.id)) && (!classes || classes.includes(item.defectClass)),
  );
  if (ids) {
    for (const id of ids) {
      if (!selected.some((item) => item.id === id)) throw new Error(`no such case: ${id}`);
    }
  }
  return selected;
}

export function loadCase(id) {
  const dir = join(CASES_DIR, id);
  const definition = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  const parsed = {
    ...definition,
    id,
    defectClass: definition.class,
    dir,
  };
  validateCase(parsed);
  return parsed;
}

// Validation is not ceremony here. A case whose markers can never match scores
// every run as a false CONFIRMED, which is exactly the result that would make
// us revert #16 — so a malformed case is worse than a missing one.
function validateCase(item) {
  const fail = (message) => {
    throw new Error(`case ${item.id}: ${message}`);
  };
  if (!CLASSES.includes(item.defectClass)) fail(`unknown class ${item.defectClass}`);
  if (typeof item.claim !== "string" || item.claim.length < 20) fail("missing claim");
  if (!existsSync(join(item.dir, "base"))) fail("missing base/");
  if (!existsSync(join(item.dir, "change"))) fail("missing change/");

  if (item.defectClass === "D") {
    if (item.defect) fail("class D must seed no defect");
    return;
  }
  if (!item.defect) fail(`class ${item.defectClass} must seed a defect`);
  const { file, summary, markers } = item.defect;
  if (!file || !summary) fail("defect needs file and summary");
  if (!Array.isArray(markers?.all) || !Array.isArray(markers?.any) || markers.any.length === 0) {
    fail("defect needs markers.all and a non-empty markers.any");
  }
  // `markers.any` carries the discrimination: `all` may legitimately name
  // something the claim already names (class A's defect is inside the claim, so
  // its function is), but a discriminator that appears in the brief matches
  // whenever the verifier quotes the brief back, scoring a miss as a catch.
  const claim = item.claim.toLowerCase();
  for (const marker of markers.any) {
    if (claim.includes(marker.toLowerCase())) fail(`discriminator "${marker}" is in the claim`);
  }
}

// Two commits: the state before the change, then the change itself. The
// verifier is pointed at HEAD, so `git show HEAD` is exactly the diff the claim
// is about, and class B's "touched but unclaimed" file is visibly in it.
export function materializeCase(item, targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  cpSync(join(item.dir, "base"), targetDir, { recursive: true });
  git(targetDir, "init", "-b", "main", "-q");
  git(targetDir, "add", "-A");
  git(targetDir, "commit", "-q", "-m", item.baseCommitMessage ?? "chore: initial state");

  cpSync(join(item.dir, "change"), targetDir, { recursive: true });
  for (const relative of item.delete ?? []) {
    rmSync(join(targetDir, relative), { recursive: true, force: true });
  }
  git(targetDir, "add", "-A");
  git(targetDir, "commit", "-q", "-m", item.changeCommitMessage ?? item.claim.split("\n")[0]);

  return { head: git(targetDir, "rev-parse", "HEAD").trim() };
}

// The brief handed to `pilotfish`. It forces the completion gate to fire but
// says nothing about how to verify, which files matter, or that anything is
// wrong: shaping the verification would measure the brief, not the prompt under
// test. "Run your completion gate" is the one deliberate deviation from a
// natural request, and it exists because a run where the primary decides the
// change is small enough to skip verification produces no verdict at all.
export function briefFor(item) {
  return [
    "An executor has finished work in this repository and reports this outcome:",
    "",
    `  ${item.claim.replaceAll("\n", "\n  ")}`,
    "",
    "The work is the most recent commit; `git show HEAD` is the whole change and",
    "`HEAD~1` is the state before it. Treat it as complete work I am about to merge.",
    "",
    "Run your completion gate on this claim and report the verdict you get back,",
    "including anything reported alongside it. Do not edit, fix, or commit anything.",
  ].join("\n");
}
