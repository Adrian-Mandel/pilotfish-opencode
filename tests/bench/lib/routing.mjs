// Which model sits in the verifier seat.
//
// The router selects a profile from the primary model alone, and a profile
// binds all eight workers. So the single `--primary` the suite is given decides
// what the run actually measures, and a result carries that model's name or it
// says nothing: the prompt under test is shared, but a verdict is the model's.
//
// Resolution happens here, before the first run, because the alternative is a
// fail-closed router refusal repeated across every run in a queue that is
// hours long.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePrimary } from "../../integration/fixture.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function loadProfiles() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "templates/pilotfish/profiles.json"), "utf8"));
}

// Returns null for the preset's own default primary, which is what the preset
// template already writes. A non-null result names the profile explicitly so
// the plan, the result file, and the report can all state the routing.
export function resolvePrimary(spec, preset, data = loadProfiles()) {
  const members = data.presets[preset];
  if (!members) {
    throw new Error(`unknown preset "${preset}"; defined: ${Object.keys(data.presets).join(", ")}`);
  }
  if (!spec) return null;

  const requested = parsePrimary(spec);
  const available = members.map((name) => ({ name, ...data.profiles[name] }));
  const profile = available.find((item) => item.primary.model === requested.model);
  if (!profile) {
    throw new Error(
      `primary "${requested.model}" selects no profile in preset "${preset}"; available: ` +
        available.map((item) => item.primary.model).join(", "),
    );
  }
  return {
    model: profile.primary.model,
    // An explicit @variant wins. Otherwise take the profile's own declared
    // primary variant, never the preset default's -- that one belongs to a
    // different model and may not exist on this one.
    variant: requested.variant ?? profile.primary.variant,
    profile: profile.name,
    verifier: profile.workers.verifier,
  };
}
