// Prompt variants for the A/B.
//
// A variant is a set of prompt files replaced inside the fixture's config
// directory before the run. It pins each file one of two ways: `prompts` names
// a git ref and reads the file out of it, and `edits` replaces one exact
// passage inside the working-tree copy. The ref form is the reproducible one
// and is what both measured variants use; the edit form exists for a variant
// whose text was written for the experiment and so has no ref to be recovered
// from.
//
// The repository working tree and the installed configuration at
// ~/.config/opencode are never touched, which matters twice over: the #16
// measurement sample restarts on any prompt edit, and a variant that leaked
// into the real install would poison it silently.

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

// The commit at which severity-triggered became the working-tree prompt. Every
// stored result labelled `current` before this ref was produced under the older
// scope paragraph, so reproducing one means `pre-severity`, not `current`.
const PRE_SEVERITY = "5e36476";

// The paragraph `severity-triggered` replaces, quoted exactly as it stands in
// the working tree. Anchoring on the text rather than on a line number means a
// reordered prompt fails the resolve instead of silently patching the wrong
// paragraph.
// The scope paragraph as it stood before severity-triggered shipped. No longer
// present in the working tree, so nothing can anchor an edit on it -- kept only
// to name what `pre-severity` below reproduces from a ref.
const PRE_SEVERITY_SCOPE_FOR_THE_RECORD = `Verify the claim you were given. Your verdict is about that claim, not about the general health of the surrounding code. If you notice a defect outside the claim, report it below the verdict as a separate, clearly labelled observation; do not refute work that did what it said. That observation is information for the primary session to scope, and folding it into the verdict restarts a fix-and-reverify round for work nobody claimed.`;

// The replacement, derived in docs/issue-53-phase1-trigger-derivation.md from
// the 44 historical REFUTED sessions. The bar it draws is reachability and
// demonstrability, not severity: the derivation found the severity dimension
// unusable, because the third-largest shape in the sample (documentation
// contradicting code, 7/44) is low-severity by any bar and the smallest
// (local logic inside one function, 2/44) is what a severity list would keep.
// A list broad enough to cover the sample is not a filter, so the filter moved
// to what the verifier can show rather than to what kind of defect it is. The
// scope bound in the second paragraph is the other half: it is what keeps this
// from becoming the open-ended audit that produced the 19-run chains.
const SEVERITY_TRIGGERED_SCOPE = `Verify the claim you were given. Your verdict is about that claim, and about defects this change introduced even where the claim is silent about them. Refute when you can demonstrate one: it is reachable from code the change touched -- that file, or an immediate caller of what changed in it -- and you have a concrete counterexample with inputs, expected behavior, and actual behavior. No shape of defect is too small to refute on once you can show it failing: a documented behavior the code contradicts counts, and so does a wrong result at a single boundary value.

Report as an observation below the verdict what you can only assert: a defect you suspect but did not exercise, anything in code this change did not touch, and design you would have written differently. Do not audit the surrounding module for defects that predate this commit -- an open-ended audit has no termination condition and is not what you were asked for. That the test suite passes is not grounds to file a demonstrated defect as an observation; a suite exercises what it was written for, and the defect it does not cover is still a defect.`;

// Phase 1b. v1 scored 26/30 on class B2; all four non-catches detected the
// defect, described it, and then filed it beneath a CONFIRMED. Three of the
// four gave a reason, and the reasons are what this text closes:
//
//   "not refutations of the bounded claim"                  -> claim silence
//   "the claim makes no assertion about parseTimeout ...
//    so this is an observation only"                        -> claim silence
//   "Unrelated behavior change in the same commit"          -> relatedness
//
// v1 answers both already, but as a description of scope ("your verdict is
// about ... defects this change introduced even where the claim is silent"),
// and under a B2-sized diff a description loses to the older habit. v2 keeps
// that sentence and adds the same content as refusal conditions -- named
// reasons that do not license a downgrade -- because the failure is not that
// the verifier disagreed about scope, it is that it reached for a category the
// prompt never offered it.
//
// The fourth non-catch ("no reachable defect exists in this repo") is the
// reachability clause working as designed and is deliberately untouched.
//
// This is a NEW variant rather than an edit to severity-triggered: v1 is what
// phase1-probe-b.json and phase1-probe-b2.json measured, and editing it in
// place would silently redefine those stored results -- the same trap the
// working-tree prompts pose for `current`.
const SEVERITY_TRIGGERED_V2_SCOPE = `Verify the claim you were given. Your verdict is about that claim, and about defects this change introduced even where the claim is silent about them. Refute when you can demonstrate one: it is reachable from code the change touched -- that file, or an immediate caller of what changed in it -- and you have a concrete counterexample with inputs, expected behavior, and actual behavior. No shape of defect is too small to refute on once you can show it failing: a documented behavior the code contradicts counts, and so does a wrong result at a single boundary value.

Once reachability and a counterexample both hold, refute. The following are not grounds to downgrade a demonstrated defect to an observation, and none of them is a fact about the defect:

- that the claim does not mention it, or that the claim is literally true about the part it does describe;
- that it is unrelated to the claim, to the commit message, or to the change's stated purpose -- the change touched it, and that is the only relatedness this verdict turns on;
- that the test suite passes; a suite exercises what it was written for, and the defect it does not cover is still a defect.

Report as an observation below the verdict what you can only assert: a defect you suspect but did not exercise, anything in code this change did not touch, and design you would have written differently. Do not audit the surrounding module for defects that predate this commit -- an open-ended audit has no termination condition and is not what you were asked for.`;

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
  // #53 Phase 1's third arm. Defined as a patch against the working tree
  // rather than as a stored copy so that it keeps substituting for exactly
  // the one scope paragraph as the rest of the prompt changes -- a stored
  // copy would quietly accumulate every other difference and stop being the
  // contrast the A/B is trying to isolate. The replacement is two paragraphs;
  // the passage it replaces is one.
  // `severity-triggered` is gone from this table because it shipped: as of
  // PRE_SEVERITY, `current` *is* it, byte for byte. Re-running that arm means
  // running `current`. The contrast it was measured against has not
  // disappeared -- it moved to `pre-severity`, which pins the prompt every
  // stored `current` result was produced under.
  "pre-severity": {
    description: `verifier.md from ${PRE_SEVERITY}, before severity-triggered shipped`,
    prompts: { "verifier.md": PRE_SEVERITY },
  },
  // Phase 1b. Same anchor, same reachability bar; adds the refusal conditions
  // the v1 non-catches reached past. Kept separate from `severity-triggered`
  // so the B/B2 results already stored against v1 keep meaning what they say.
  "severity-triggered-v2": {
    description: "current verifier.md, scope paragraph replaced by the derived bar plus refusal conditions",
    edits: { "verifier.md": { replace: SEVERITY_TRIGGERED_SCOPE, with: SEVERITY_TRIGGERED_V2_SCOPE } },
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

// Fails when the anchor is missing or appears twice, which is the point: a
// moved or duplicated anchor means the prompt is no longer the one the variant
// was described against, and a run that patched the wrong paragraph would
// still look like a clean result.
function promptWithEdit(name, { replace, with: replacement }) {
  const text = readFileSync(join(REPO_ROOT, PROMPT_DIR, name), "utf8");
  const at = text.indexOf(replace);
  if (at === -1) throw new Error(`variant anchor not found in ${name}: ${replace.slice(0, 60)}...`);
  if (text.indexOf(replace, at + 1) !== -1) {
    throw new Error(`variant anchor is not unique in ${name}`);
  }

  // The replacement is written with bare newlines; the file it lands in is
  // whatever the checkout produced. Reject a file that already carries both
  // endings rather than guessing which one this paragraph wants: a prompt
  // with mixed endings is reproducible from no ref, and `promptDigests` would
  // record the difference as if the wording had changed.
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1;
  if (crlf > 0 && crlf !== lf) throw new Error(`mixed line endings in ${name}`);
  const patched = crlf > 0 ? replacement.replaceAll("\n", "\r\n") : replacement;
  return text.slice(0, at) + patched + text.slice(at + replace.length);
}

// Resolve every prompt this variant pins, and fail before any provider request
// if a ref has gone missing. Digests of all nine resolved prompts go into the
// result record so two result files can be compared for what the agents were
// actually told, not for what the variant was called.
export function resolveVariant(name) {
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown variant: ${name}`);
  const overrides = {};
  for (const [file, ref] of Object.entries(variant.prompts ?? {})) {
    overrides[file] = promptAtRef(ref, file);
  }
  for (const [file, edit] of Object.entries(variant.edits ?? {})) {
    overrides[file] = promptWithEdit(file, edit);
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
