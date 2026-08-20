from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENTS = (
    "pilotfish", "scout", "Explore", "plan-verifier", "security-reviewer",
    "mech-executor", "executor", "verifier", "security-executor",
)
WORKERS = AGENTS[1:]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class PolicyContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = json.loads(text("templates/opencode.base.jsonc"))
        self.profiles = json.loads(text("templates/pilotfish/profiles.json"))

    def test_public_agent_graph_remains_nine_roles(self) -> None:
        self.assertEqual(tuple(self.base["agent"]), AGENTS)
        task = self.base["agent"]["pilotfish"]["permission"]["task"]
        self.assertEqual(task["*"], "deny")
        self.assertEqual({role for role, value in task.items() if value == "allow"}, set(WORKERS))

    # The naming rule is fixed in docs/profile-router-contract.md. It is tested
    # rather than merely documented because the failure it prevents is silent: a
    # name that no longer matches its binding still routes correctly and still
    # reads as authoritative, so nothing surfaces the drift.
    def test_profile_names_are_derived_from_their_primary_model(self) -> None:
        for name, mapping in self.profiles["profiles"].items():
            provider, _, model_id = mapping["primary"]["model"].partition("/")
            self.assertTrue(model_id, f"{name} primary model has no provider prefix")
            # Providers such as OpenRouter repeat a vendor inside the model ID;
            # that segment duplicates the provider and carries no routing
            # meaning, so only the final segment names the profile.
            self.assertEqual(name, f"{provider}/{model_id.rsplit('/', 1)[-1]}")

    def test_agent_names_never_carry_profile_slashes(self) -> None:
        router = text("templates/pilotfish/profile-router.mjs")
        self.assertIn('profile.replaceAll("/", "--")', router)
        self.assertIn("flatten to the same internal agent name", router)
        flattened = [name.replace("/", "--") for name in self.profiles["profiles"]]
        self.assertEqual(len(set(flattened)), len(flattened))

    def test_profiles_are_canonical_and_complete(self) -> None:
        self.assertEqual(self.profiles["publicRoles"], list(AGENTS))
        expected_primary = {
            "openai/gpt-5.6-sol": ("openai/gpt-5.6-sol", "high"),
            "openai/gpt-5.6-terra": ("openai/gpt-5.6-terra", "high"),
            "openai/gpt-5.6-luna": ("openai/gpt-5.6-luna", "max"),
            "google/antigravity-claude-opus-4-6-thinking": ("google/antigravity-claude-opus-4-6-thinking", "max"),
            "google/antigravity-gemini-3.1-pro": ("google/antigravity-gemini-3.1-pro", "high"),
            "google/antigravity-gemini-3-flash": ("google/antigravity-gemini-3-flash", "high"),
            # Variant support is per model, not per provider family. The Qwen
            # pair exposes none, so that profile omits them, which the schema
            # allows. Both DeepSeek models expose them, so that profile sets them.
            "openrouter/qwen3.6-27b": ("openrouter/qwen/qwen3.6-27b", None),
            "openrouter/deepseek-v4-pro": ("openrouter/deepseek/deepseek-v4-pro", "high"),
        }
        for profile, primary in expected_primary.items():
            actual = self.profiles["profiles"][profile]
            self.assertEqual(
                (actual["primary"]["model"], actual["primary"].get("variant")), primary
            )
            self.assertEqual(set(actual["workers"]), set(WORKERS))
        self.assertEqual(
            self.profiles["presets"],
            {
                "chatgpt": [
                    "openai/gpt-5.6-sol",
                    "openai/gpt-5.6-terra",
                    "openai/gpt-5.6-luna",
                ],
                "antigravity": [
                    "google/antigravity-claude-opus-4-6-thinking",
                    "google/antigravity-gemini-3.1-pro",
                    "google/antigravity-gemini-3-flash",
                ],
                "openrouter": ["openrouter/qwen3.6-27b", "openrouter/deepseek-v4-pro"],
            },
        )
        for members in self.profiles["presets"].values():
            for name in members:
                self.assertIn(name, self.profiles["profiles"])
        primaries = [p["primary"]["model"] for p in self.profiles["profiles"].values()]
        self.assertEqual(len(primaries), len(set(primaries)))

    def test_router_runtime_artifacts_exist(self) -> None:
        self.assertTrue((ROOT / "templates/pilotfish/profile-router.mjs").is_file())
        self.assertTrue((ROOT / "templates/pilotfish/profiles.json").is_file())
        self.assertTrue((ROOT / "tests/profile-router.test.mjs").is_file())

    def test_installer_declares_plugin_and_runtime_lifecycle(self) -> None:
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "1.18.10", "./pilotfish/profile-router.mjs", "profiles.json",
            "previousPlugin", "installedPlugin", "previousRuntimeFiles",
            "installedRuntimeFiles", "SHA-256", "`0.1.0` first-touch migration",
            "byte-identically", "Write `install-state.json` last",
            "**before** deleting runtime files", "Preserve unrelated entries and their order",
            "24 hidden internal clones", "creates clones only for its own profiles",
            "unsupported or cross-preset models fail before assistant/provider execution",
            "pre-existing sibling retitled to a marker",
            "public workers and hidden clones are subagents",
            "factory initialization errors", "protective hooks", "invalid or missing preset",
            "profile pin persists", "current successfully resolved agent",
            "transient SHA-256 call marker", "raw tool-input events",
            "exact `task_id`", "experimental background timing fail closed",
            "`session.created`", "30-second expiry", "plugin disposal clear timers",
            "manual child-title cleanup", "cannot authorize execution",
        ):
            self.assertIn(phrase.lower(), installer.lower())

    def test_installer_keeps_public_and_global_contracts(self) -> None:
        installer = text("install/OPENCODE-INSTALL.md")
        self.assertIn("only the nine persisted public definitions", installer)
        self.assertIn("never changes global `model`", installer)
        self.assertIn("`default_agent`", installer)
        self.assertIn("restart OpenCode", installer)
        self.assertIn("exact required model **and variant**", installer)

    def test_architecture_docs_describe_runtime_hook_contract(self) -> None:
        combined = "\n".join(text(path) for path in ("README.md", "docs/design.md", "docs/research.md"))
        for phrase in (
            "runtime profile router", "config`, `chat.message`, `tool.execute.before`, `tool.execute.after`, and `session.deleted",
            "before Task permission and agent resolution", "24 hidden", "only its own profiles",
            "logs and ignores plugin configuration errors", "provider-qualified", "no fallback",
            "start a new session", "issue #11", "implementation details",
            "pre-existing sibling", "expired", "replayed internal chat",
            "factory initialization errors", "protective hooks",
            "Unexpected server error", "--print-logs",
            "profile pin persists", "current successfully resolved agent",
            "transient SHA-256", "raw tool-input",
            "background Task timing is unsupported", "`session.created`",
            "30-second expiry", "plugin disposal",
            "atomically revoke", "manual child-title cleanup",
        ):
            self.assertIn(phrase, combined)

    def test_install_and_release_docs_have_required_smoke_gates(self) -> None:
        local = text("docs/local-install.md")
        release = text("RELEASING.md")
        self.assertIn("1.18.10", local)
        self.assertIn("profile-router.mjs", local)
        self.assertIn("restart", local)
        for binding in self.profiles["profiles"]["google/antigravity-claude-opus-4-6-thinking"]["workers"].values():
            self.assertIn(binding["model"], local)
        for phrase in (
            "node --test tests/profile-router.test.mjs", "isolated/neutral OpenCode context",
            "no global writes", "Luna/low", "five-minute", "no retries",
            "release is blocked", "AntiGravity", "before assistant/provider execution",
        ):
            self.assertIn(phrase, release)

    def test_deviation_ledger_records_router_without_pending_source(self) -> None:
        ledger = text("docs/upstream-deviations.md")
        self.assertIn("required runtime profile router", ledger)
        self.assertIn("Issue #12 approved implementation", ledger)
        self.assertNotIn("| Pending", ledger)

    # Retained policy/lifecycle coverage from the pre-router contract.
    def test_presets_bind_only_the_public_primary(self) -> None:
        # A model baked onto a public worker outlives Task remapping, which is
        # active only while Pilotfish is the resolved primary. Under any other
        # primary agent that pin would route the worker to the preset's provider
        # instead of the session's own, spending an unselected quota.
        for name in ("chatgpt", "antigravity", "openrouter"):
            preset = json.loads(text(f"templates/presets/{name}.jsonc"))
            self.assertEqual(set(preset["agent"]), {"pilotfish"})

    def test_public_workers_stay_unbound(self) -> None:
        for role in WORKERS:
            definition = self.base["agent"][role]
            self.assertNotIn("model", definition)
            self.assertNotIn("variant", definition)

    def test_read_only_roles_are_capability_enforced(self) -> None:
        for role in ("scout", "Explore", "plan-verifier", "security-reviewer"):
            permission = self.base["agent"][role]["permission"]
            self.assertEqual(permission["*"], "deny")
            self.assertNotIn("bash", permission)
            self.assertNotIn("edit", permission)

    def test_workers_cannot_delegate(self) -> None:
        for role in WORKERS:
            self.assertEqual(self.base["agent"][role]["permission"].get("task", "deny"), "deny")

    def test_verdict_vocabularies_remain_separate(self) -> None:
        plan = text("templates/pilotfish/prompts/plan-verifier.md")
        outcome = text("templates/pilotfish/prompts/verifier.md")
        self.assertIn("`READY`", plan)
        self.assertIn("`REVISE`", plan)
        self.assertIn("`CONFIRMED`", outcome)
        self.assertIn("`REFUTED`", outcome)

    def test_phase_policy_remains_present(self) -> None:
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        for phase in ("| Discovery |", "| Plan |", "| Approval |", "| Execution |", "| Verification |"):
            self.assertIn(phase, policy)

    def test_artifact_reconnaissance_contract_remains_present(self) -> None:
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        explore = text("templates/pilotfish/prompts/Explore.md")
        self.assertIn("new, not resumed, read-only reconnaissance worker session", policy)
        self.assertIn("accessible project-local artifact reconnaissance", explore)

    def test_bash_capable_workers_never_detach(self) -> None:
        for role in ("mech-executor", "executor", "security-executor", "verifier"):
            prompt = text(f"templates/pilotfish/prompts/{role}.md")
            self.assertIn("never detach", prompt)
            self.assertIn("absolute working directory", prompt)

    def test_installer_retains_update_contract(self) -> None:
        installer = text("install/OPENCODE-INSTALL.md")
        self.assertIn("An update is an idempotent re-run", installer)
        # The stop condition used to be version equality alone, and this test
        # used to pin that sentence unconditionally. It is now pinned together
        # with the condition that guards it, so the skip cannot drift back to
        # firing on anything cheaper than a full content comparison.
        self.assertIn(
            "in that case, and only in that case, do not ask for a preset, present a write plan, "
            "or write any file",
            installer,
        )
        self.assertIn("Never replace an existing entry during an update", installer)

    def test_installer_update_gate_is_content_based_not_version_based(self) -> None:
        # `VERSION` read 0.2.0 unchanged from 2026-08-09 through 69 later
        # commits, 21 of them touching templates/ or install/, so a real install
        # recording 0.2.0 matched a checkout whose content had moved a long way
        # from it. The old rule stopped the update on version equality, and on
        # 2026-08-20 a live install was found still running the pre-#38 router
        # with its Windows-only case-insensitive Task-permission mirror -- a
        # merged security fix undelivered behind a runbook reporting "up to
        # date". This is pinned because the failure is silent and points the
        # reassuring way, and because the tempting repair (bump VERSION every
        # change) still fails anyone tracking main between bumps.
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "Run preflight regardless of the recorded version",
            "Version equality is not a stop condition",
            "It suppresses only the changelog replay; it never suppresses a write",
            "It does not decide the preset question either, which rule 5 owns",
            "A version number cannot detect a change that landed inside an unreleased version",
            "Decide the stop condition from content, not from the version",
            "Report that Pilotfish is up to date and stop only when every one of them is "
            "byte-identical to desired",
            "present a write plan covering only the items that differ",
            "Do not answer this by bumping `VERSION` for every change",
            "Content comparison is the primitive.",
            "pre-#38 `profile-router.mjs`",
            # A content-identical stop leaves the recorded version behind, so
            # the changelog replay repeats cumulatively. That is chosen, not
            # overlooked: a path that promises to write no file must not write
            # `install-state.json` to tidy one field.
            "One consequence of stopping is deliberate",
            "a path promising to write no file must not write `install-state.json` either",
        ):
            self.assertIn(phrase, installer)

    def test_installer_records_installed_prompt_hashes(self) -> None:
        # Without an installed-prompt hash the update table could only say
        # "identical" or "differs", so a merely stale prompt and a hand-edited
        # one asked the user the same keep-or-replace question. Telling them
        # apart by hand required diffing the installed prompt against an older
        # Git ref, which the runbook never prescribed and an installer cannot
        # do. `installedPrompts` mirrors `installedRuntimeFiles`; it is a
        # separate map from `previousPrompts`, which still holds first-install
        # pre-install state and is still never replaced.
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "installedPrompts",
            "The `installedPrompts` first-touch migration follows that same pattern",
            "read the SHA-256 of each managed prompt's exact current installed bytes "
            "before any write, and classify the prompt from that",
            "recording the pre-write hash there would leave the entry describing content that is no longer installed",
            "The first-touch migration is required.",
            "Never infer it from the templates",
            "`installedPrompts` is not `previousPrompts` and never substitutes for it",
            "`installedPrompts` must contain all nine prompt filenames",
            "Current matches the recorded `installedPrompts[filename]` hash and that entry "
            "is not marked preserved",
            "Current differs from the recorded hash, or that entry is marked preserved",
            "compare each managed prompt with both `installedPrompts[filename]` and its "
            "desired template",
            # A preserved prompt is bytes the installer did NOT write. Recording
            # its hash bare makes it indistinguishable from one the installer
            # produced, and every consumer downstream then misreads it: the
            # update table loses the case entirely and uninstall stops diffing
            # it. The marker is what keeps `installedPrompts` honest.
            'record it with `"preserved": true`, because the installer did not write those bytes',
            "`installedPrompts` means what the installer last wrote",
            'Set `"preserved": false` on every entry the installer did write',
            "each mapped to an object carrying the `sha256` of the bytes actually left on disk "
            "and a `preserved` flag",
            # The migrating run has no marker to read, so it must not classify a
            # hand-edited prompt as merely stale in order to acquire the field.
            "The migrating update is the one run that cannot read its own marker",
            'Never write `"preserved": true` from a guess',
            # The schema example is what an installer copies, so the marker has
            # to be visible there and not only described in prose.
            '"scout.md": { "sha256": "<SHA-256>", "preserved": true }',
        ):
            self.assertIn(phrase, installer)
        # The false claim the new field replaces must not survive anywhere.
        for stale in (
            "this state schema does not store them",
            "Prompts have no old-version hash field in the existing schema",
            "Because state stores no installed prompt hashes",
        ):
            self.assertNotIn(stale, installer)

    def test_prompt_table_is_exhaustive_and_uninstall_honors_preservation(self) -> None:
        # The three-row prompt table replaced a two-row one whose second row was
        # a catch-all, so the rewrite could drop a state without anything
        # failing. It did: a prompt preserved on an earlier update matches its
        # recorded hash and differs from the template, which the first draft of
        # the table classified nowhere at all. This table is executed by a human
        # reading it, so an unclassifiable state has no default to fall through
        # to -- it is a stall mid-install. The same marker is what keeps
        # uninstall from restoring or removing deliberately preserved content
        # without ever showing it; the action may be identical, the informed
        # consent is not.
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "Evaluate the rows in order, and keep them exhaustive.",
            "whether current equals desired, whether current equals the recorded "
            "`installedPrompts` hash, and whether that entry is marked preserved",
            "that exhaustiveness is the point of the table rather than a property it "
            "happens to have",
            "it is an unhandled case in the middle of someone's install",
            "Any future edit must leave every combination landing on exactly one row.",
            "Classify it as a customization when the bytes differ from the recorded hash "
            "**or** the entry is marked preserved",
            "content the user deliberately kept would pass through Phase 2 undiffed",
            "what would be lost is the user's chance to decide it",
        ):
            self.assertIn(phrase, installer)

    def test_installer_asserts_installed_content_after_install(self) -> None:
        # An install can resolve its config, load its plugin, and pass every
        # behavioral check while still running a file the update never wrote.
        # That is exactly how the pre-#38 router survived on a live install, so
        # verification now compares bytes against the checkout they came from.
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "Assert that the installed content matches the checkout it came from",
            "compare the SHA-256 of the file now on disk with the SHA-256 of the "
            "corresponding source file in this checkout",
            "Treat any other mismatch as a validation failure and roll back.",
        ):
            self.assertIn(phrase, installer)

    def test_installer_retains_six_uninstall_phases(self) -> None:
        installer = text("install/OPENCODE-INSTALL.md")
        for number in range(1, 7):
            self.assertIn(f"### Phase {number}:", installer)

    def test_update_and_uninstall_docs_remain_actionable(self) -> None:
        self.assertIn("Updating", text("README.md"))
        self.assertIn("Uninstall", text("README.md"))
        self.assertIn("Updating", text("docs/local-install.md"))
        self.assertIn("Uninstall", text("docs/local-install.md"))

    def test_ledger_and_release_gate_remain_linked(self) -> None:
        self.assertIn("upstream-deviations.md", text("README.md"))
        self.assertIn("no row may have `Pending` in Source at release", text("RELEASING.md"))

    def test_canonical_profile_values_are_exact(self) -> None:
        expected = {
            "openai/gpt-5.6-sol": {
                "primary": ("openai/gpt-5.6-sol", "high"),
                "workers": {
                    "scout": ("openai/gpt-5.6-luna", "low"),
                    "Explore": ("openai/gpt-5.6-luna", "medium"),
                    "plan-verifier": ("openai/gpt-5.6-sol", "high"),
                    "security-reviewer": ("openai/gpt-5.6-sol", "xhigh"),
                    "mech-executor": ("openai/gpt-5.6-terra", "low"),
                    "executor": ("openai/gpt-5.6-terra", "high"),
                    "verifier": ("openai/gpt-5.6-sol", "high"),
                    "security-executor": ("openai/gpt-5.6-sol", "xhigh"),
                },
            },
            "openai/gpt-5.6-terra": {
                "primary": ("openai/gpt-5.6-terra", "high"),
                "workers": {
                    "scout": ("openai/gpt-5.6-luna", "low"),
                    "Explore": ("openai/gpt-5.6-luna", "medium"),
                    "plan-verifier": ("openai/gpt-5.6-terra", "high"),
                    "security-reviewer": ("openai/gpt-5.6-sol", "high"),
                    "mech-executor": ("openai/gpt-5.6-luna", "low"),
                    "executor": ("openai/gpt-5.6-terra", "medium"),
                    "verifier": ("openai/gpt-5.6-terra", "high"),
                    "security-executor": ("openai/gpt-5.6-sol", "medium"),
                },
            },
            "openai/gpt-5.6-luna": {
                "primary": ("openai/gpt-5.6-luna", "max"),
                "workers": {
                    "scout": ("openai/gpt-5.6-luna", "low"),
                    "Explore": ("openai/gpt-5.6-luna", "medium"),
                    "plan-verifier": ("openai/gpt-5.6-luna", "high"),
                    "security-reviewer": ("openai/gpt-5.6-sol", "medium"),
                    "mech-executor": ("openai/gpt-5.6-luna", "low"),
                    "executor": ("openai/gpt-5.6-luna", "high"),
                    "verifier": ("openai/gpt-5.6-luna", "high"),
                    "security-executor": ("openai/gpt-5.6-terra", "high"),
                },
            },
        }
        for profile, mapping in expected.items():
            actual = self.profiles["profiles"][profile]
            self.assertEqual(
                (actual["primary"]["model"], actual["primary"]["variant"]),
                mapping["primary"],
            )
            self.assertEqual(
                {
                    role: (binding["model"], binding.get("variant"))
                    for role, binding in actual["workers"].items()
                },
                mapping["workers"],
            )

    def test_antigravity_profile_values_are_exact(self) -> None:
        expected = {
            "google/antigravity-claude-opus-4-6-thinking": {
                "primary": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "scout": ("google/antigravity-gemini-3-flash", "low"),
                "Explore": ("google/antigravity-gemini-3-flash", "medium"),
                "plan-verifier": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "mech-executor": ("google/antigravity-gemini-3-flash", "low"),
                "executor": ("google/antigravity-gemini-3.1-pro", "high"),
                "verifier": ("google/antigravity-claude-sonnet-4-6", None),
                "security-executor": ("google/antigravity-claude-opus-4-6-thinking", "max"),
            },
            "google/antigravity-gemini-3.1-pro": {
                "primary": ("google/antigravity-gemini-3.1-pro", "high"),
                "scout": ("google/antigravity-gemini-3-flash", "low"),
                "Explore": ("google/antigravity-gemini-3-flash", "medium"),
                "plan-verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "mech-executor": ("google/antigravity-gemini-3-flash", "low"),
                "executor": ("google/antigravity-gemini-3.1-pro", "high"),
                "verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-executor": ("google/antigravity-claude-opus-4-6-thinking", "low"),
            },
            "google/antigravity-gemini-3-flash": {
                "primary": ("google/antigravity-gemini-3-flash", "high"),
                "scout": ("google/antigravity-gemini-3-flash", "minimal"),
                "Explore": ("google/antigravity-gemini-3-flash", "low"),
                "plan-verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "low"),
                "mech-executor": ("google/antigravity-gemini-3-flash", "minimal"),
                "executor": ("google/antigravity-gemini-3-flash", "high"),
                "verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-executor": ("google/antigravity-gemini-3.1-pro", "high"),
            },
        }
        for name, mapping in expected.items():
            profile = self.profiles["profiles"][name]
            self.assertEqual(
                (profile["primary"]["model"], profile["primary"]["variant"]),
                mapping["primary"],
                name,
            )
            for role in WORKERS:
                binding = profile["workers"][role]
                self.assertEqual(
                    (binding["model"], binding.get("variant")),
                    mapping[role],
                    f"{name}/{role}",
                )

    # Two models per profile rather than three tiers: a profile is a primary
    # model plus eight worker bindings, and nothing requires the bindings to
    # span more than two models. The strong model takes orchestration, planning
    # challenge, verification, and security; the cheap one takes reconnaissance
    # and execution.
    def test_openrouter_profile_values_are_exact(self) -> None:
        strong_cheap = {
            "openrouter/qwen3.6-27b": ("openrouter/qwen/qwen3.6-27b", "openrouter/qwen/qwen3.6-35b-a3b"),
            "openrouter/deepseek-v4-pro": (
                "openrouter/deepseek/deepseek-v4-pro",
                "openrouter/deepseek/deepseek-v4-flash-0731",
            ),
        }
        strong_roles = {"plan-verifier", "security-reviewer", "verifier", "security-executor"}
        cheap_roles = {"scout", "Explore", "mech-executor", "executor"}
        self.assertEqual(strong_roles | cheap_roles, set(WORKERS))

        # Qwen exposes no variants; DeepSeek exposes high/xhigh on Pro and
        # low/high/max on Flash, so only that profile ladders effort.
        deepseek_variants = {
            "scout": "low", "Explore": "low", "mech-executor": "low",
            "executor": "high", "plan-verifier": "high", "verifier": "high",
            "security-reviewer": "xhigh", "security-executor": "xhigh",
        }
        expected_variants = {
            "openrouter/qwen3.6-27b": (None, {role: None for role in WORKERS}),
            "openrouter/deepseek-v4-pro": ("high", deepseek_variants),
        }

        for name, (strong, cheap) in strong_cheap.items():
            profile = self.profiles["profiles"][name]
            primary_variant, worker_variants = expected_variants[name]
            self.assertEqual(profile["primary"]["model"], strong, name)
            self.assertEqual(
                profile["primary"].get("variant"), primary_variant, f"{name}/primary"
            )
            for role in WORKERS:
                binding = profile["workers"][role]
                expected = strong if role in strong_roles else cheap
                self.assertEqual(binding["model"], expected, f"{name}/{role}")
                self.assertEqual(
                    binding.get("variant"), worker_variants[role], f"{name}/{role}"
                )

    def test_router_source_and_primary_prompt_contracts(self) -> None:
        router = text("templates/pilotfish/profile-router.mjs")
        prompt = text("templates/pilotfish/prompts/pilotfish.md")
        self.assertIn("export default async function profileRouterPlugin", router)
        self.assertNotIn("export {", router)
        for phrase in (
            '"chat.message"', '"tool.execute.before"', '"tool.execute.after"', "session.deleted",
            "internalAgentName", "model changed after this session was pinned",
            "configureProfiles", "activeProfileNames", "configuration failed",
            "internal profile agents cannot be invoked directly",
            'mode "subagent"', "cannot be invoked directly through chat",
            "client.session.messages", "could not recover this session's persisted model profile",
            "Pilotfish-tagged history record has a malformed role",
            "createInitializationFailureHooks", "await createProfileRouter",
            "profile router initialization failed", "validateProfiles(loadProfiles())",
            "createHash", "session.update", "markedTaskDescription",
            "TASK_AUTHORIZATION_TTL_MS", 'event?.type === "session.created"',
            "scheduleAuthorizationExpiry", "createAuthorizationStore", "async dispose()",
            "clearParent(", "cleanupAuthorization", "boundChildSessionID", "Promise.allSettled",
        ):
            self.assertIn(phrase, router)
        # The tested-configuration assertion belongs to the installer, which
        # runs once, rather than to the prompt, which paid a first-turn
        # round-trip on every session to re-derive an install-time fact.
        runbook = text("install/OPENCODE-INSTALL.md")
        for binding in (
            "`openai/gpt-5.6-sol` with variant `high`",
            "`openai/gpt-5.6-terra` with variant `high`",
            "`openai/gpt-5.6-luna` with variant `max`",
            "`google/antigravity-claude-opus-4-6-thinking` with variant `max`",
        ):
            self.assertIn(binding, runbook)
        self.assertNotIn("opencode debug agent pilotfish`. Do this before", prompt)

    def test_historical_permissions_verdicts_and_artifact_contracts(self) -> None:
        security = self.base["agent"]["security-reviewer"]["permission"]
        self.assertEqual(security["webfetch"], "allow")
        for role in ("scout", "Explore", "plan-verifier"):
            self.assertNotIn("webfetch", self.base["agent"][role]["permission"])
        plan = text("templates/pilotfish/prompts/plan-verifier.md")
        outcome = text("templates/pilotfish/prompts/verifier.md")
        self.assertNotIn("CONFIRMED", plan)
        self.assertNotIn("REFUTED", plan)
        self.assertNotIn("READY", outcome)
        self.assertNotIn("REVISE", outcome)
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        explore = text("templates/pilotfish/prompts/Explore.md")
        for phrase in (
            "Small, local, already-stable work should be completed directly",
            "collections of screenshots or generated frame sheets",
            "Treat reconnaissance as evidence, not authority.",
            "exact references and uncertainties",
        ):
            self.assertIn(phrase, policy)
        for phrase in ("path, page, frame, or log-range references", "Never modify files", "design review"):
            self.assertIn(phrase, explore)

    def test_verification_is_bounded_by_a_chain_budget(self) -> None:
        # 72% of historical verifier verdicts were REFUTED and three parent
        # sessions produced 60% of all verifier runs, so the gate's cost is
        # re-verification depth, not gate frequency. See
        # docs/issue-16-evidence.md.
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        outcome = text("templates/pilotfish/prompts/verifier.md")
        for phrase in (
            "After the second `REFUTED` on the same claim",
            "does this claim hold?",
            "its own bounded task with its own stop condition",
        ):
            self.assertIn(phrase, policy)
        for phrase in (
            "do not refute work that did what it said",
            "Do not re-derive the whole surface from scratch",
            "unchanged inputs",
        ):
            self.assertIn(phrase, outcome)

    def test_verification_baseline_is_unreachable_from_writing_workers(self) -> None:
        # Writing roles hold both bash and edit, so every path they can reach is
        # a path they can overwrite. In a 2026-08-18 smoke test an executor
        # copied the edited file over the temp baseline the orchestrator had
        # staged for the verifier; it failed only because that path was not
        # writable from that run's sandbox. This is pinned rather than merely
        # documented because the failure it prevents is silent and points the
        # reassuring way: baseline equal to current makes the diff empty, and an
        # empty diff reads as a clean CONFIRMED on work nobody checked.
        # Phrases are matched against whitespace-flattened text: these prompts
        # are one paragraph per line today, and re-wrapping one must not fail a
        # contract whose subject is the wording, not the line breaks.
        def flat(path: str) -> str:
            return " ".join(text(path).split())

        policy = flat("templates/pilotfish/prompts/pilotfish.md")
        outcome = flat("templates/pilotfish/prompts/verifier.md")
        for phrase in (
            "name for the verifier a pre-edit reference it can re-derive itself from an immutable source",
            "a concrete commit SHA, or content you hold in this session and pass inline in the brief",
            "Never a path on disk.",
            "those are names a worker can move while the object a SHA names cannot change",
            "Never ask a writing worker to create, refresh, or restore that reference",
            "record it as an object before dispatching the writing worker so that a SHA exists",
            "it is the only form of baseline the verifier can check for itself",
            "`git stash create` writes one from the current working tree without changing a file",
            "Reserve inline content for genuinely unversioned or untracked work",
            "rests on your own discipline, which is why it is the fallback and never the default",
            "an empty diff reads as a clean `CONFIRMED` on work nobody checked",
        ):
            self.assertIn(phrase, policy)
        for phrase in (
            "derive the pre-edit reference yourself from the immutable source the brief names",
            "Do not accept a baseline file staged on disk",
            "never one produced by the worker whose work you are checking",
            "report that the comparison is unavailable and say why",
            "read a reported diff the same way you read a reported test result",
            "record in your verdict that the comparison rested on an unverifiable baseline",
            "the fallback was used where the checkable path existed",
            "`cat -A` errors on BSD `cat`",
        ):
            self.assertIn(phrase, outcome)
        forbid_baseline = (
            "Never create, copy, refresh, restore, or delete a snapshot, baseline, or reference copy of the "
            "files you are changing"
        )
        forbid_unrun = "Report only verification you actually ran, with the real command and its real output."
        for role in ("executor", "mech-executor", "security-executor"):
            prompt = flat(f"templates/pilotfish/prompts/{role}.md")
            self.assertIn(forbid_baseline, prompt)
            self.assertIn(forbid_unrun, prompt)
            self.assertIn("if you did not run something, say you did not run it.", prompt)
            # A contract test cannot prove the absence of an instruction to
            # stage a baseline -- any author can reword around a grep. What it
            # can catch is the accident: the flow that actually occurred was a
            # temp-file copy, so a temp path in a writing prompt is the likeliest
            # way this returns. The prohibition itself is asserted against the
            # whole file above, not per line, so hard-wrapping cannot trip it.
            for token in ("$TMPDIR", "/tmp"):
                self.assertNotIn(token, prompt, f"{role} names a temp staging path")
        # Running the project's own tests is not what was removed; only
        # self-verification against the verifier's reference was.
        self.assertIn(
            "Exercise the changed behavior with focused tests or a relevant runtime flow",
            flat("templates/pilotfish/prompts/executor.md"),
        )
        self.assertIn(
            "Verify the result with the focused tests or checks named in the specification",
            flat("templates/pilotfish/prompts/mech-executor.md"),
        )
        self.assertIn(
            "exercise both expected behavior and abuse cases",
            flat("templates/pilotfish/prompts/security-executor.md"),
        )
        # The ad-hoc temp-file flow must not reappear anywhere in the prompts.
        for role in AGENTS:
            self.assertNotIn("pristine", text(f"templates/pilotfish/prompts/{role}.md"))

    def test_read_only_delegation_is_parallel_by_default(self) -> None:
        # Only 21.7% of read-only child sessions ever overlapped another, and
        # the serialization rule is about conflicting edits, which read-only
        # roles cannot have.
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        for phrase in (
            "Serialize writing roles, and only writing roles",
            "which own no files and cannot conflict",
            "Dispatch independent read-only questions together in one turn",
        ):
            self.assertIn(phrase, policy)

    def test_dispatch_is_gated_on_a_writable_brief_not_a_round_trip_count(self) -> None:
        # Upstream's dispatch-brake benchmark cut model input tokens 61.9% on the
        # same fixture with tests and the verifier verdict unchanged, and its
        # positive controls show the saving comes from routing stable, bounded,
        # repetitive work to a cheaper model, not from delegating per se. A
        # round-trip threshold delegated exactly the shapes that lost.
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        for phrase in (
            "a complete, self-contained brief for the work can be written without doing the work first",
            "the assigned role's model is capable of it",
            "Recurrence qualifies through that brief, never through a round-trip count",
            "Keep the work here when specifying it would require solving it first",
            "keep small task-local scans inline however many round-trips they take",
            "decides nothing when workers are free and local",
        ):
            self.assertIn(phrase, policy)
        self.assertNotIn("three search or read round-trips", policy)

    def test_worker_resumption_is_permitted_and_bounded(self) -> None:
        # A session's first request is warm 18% of the time; later requests in
        # the same session are warm 93% of the time. `task_id` was never named
        # in any prompt, so effective policy was "always start fresh".
        policy = text("templates/pilotfish/prompts/pilotfish.md")
        for phrase in (
            "Continue an existing worker by passing its `task_id`",
            "genuinely new or redirected work on the same investigation",
            "never resume merely to collect or restate a result already in hand",
            "Resuming cannot widen a worker's reach",
            "refuses a `task_id` that is not the exact child session of this parent for that same role",
        ):
            self.assertIn(phrase, policy)
        # The artifact-inspection prohibition survives the new positive case.
        self.assertIn("new, not resumed, read-only reconnaissance worker session", policy)

    def test_installer_checks_subagent_depth(self) -> None:
        # Host fact H14: an agent mention skips the Task permission check for a
        # whole turn, and Task resolves mentions in its own prompt argument, so
        # a worker's `task` deny can be bypassed from the parent's prompt text.
        # The host default `subagent_depth` of 1 is what actually holds the
        # worker boundary, and Pilotfish neither sets nor owns it -- so the
        # installer has to say out loud that it is relied upon.
        installer = text("install/OPENCODE-INSTALL.md")
        self.assertIn("### Check `subagent_depth`", installer)
        for phrase in (
            "this step writes nothing",
            "a safety check rather than a preference",
            "a worker session already has a parent",
            "Do not change it, do not block the install over it",
        ):
            self.assertIn(phrase, installer)

    def test_installer_preserves_historical_lifecycle_safeguards(self) -> None:
        installer = text("install/OPENCODE-INSTALL.md")
        for phrase in (
            "one primary agent and eight worker definitions",
            "all nine agent keys and all nine prompt filenames",
            "Task access to the eight Pilotfish worker roles",
            "treat only that name as newly touched",
            "before changing config or prompts, extend the maps",
            "Current matches the prior managed `installedAgents[name]`, but desired changed",
            "Preserved custom agents remain the installed values",
            "write `install-state.json` as the final installation step",
            "If writing state fails, roll back the config and prompts",
            "overwritten pre-install values cannot be reconstructed without state",
            "Keep these backups after a successful uninstall",
            "Never auto-delete the global config",
            "potentially customized prompt",
        ):
            self.assertIn(phrase, installer)

    def test_documentation_retains_provenance_and_separates_required_router(self) -> None:
        research = text("docs/research.md")
        evaluation = text("docs/artifact-routing-evaluation.md")
        self.assertIn("accept image and PDF input", research)
        self.assertIn("do not report video input", research)
        self.assertIn("does not perform native video decoding or extraction", research)
        self.assertIn("500,000", research)
        self.assertIn("`max`", research)
        self.assertIn("No native video claim", evaluation)
        self.assertIn("fresh Task child", evaluation)
        combined = "\n".join(text(path) for path in ("README.md", "docs/design.md", "docs/research.md"))
        self.assertIn("router is required", combined.lower())
        self.assertIn("issue #11", combined.lower())
        self.assertIn("optional", combined.lower())
        self.assertIn("persisted-history recovery", combined.lower())

    def test_release_and_version_contracts(self) -> None:
        self.assertEqual(text("VERSION").strip(), "0.2.0")
        release = text("RELEASING.md")
        for phrase in (
            "node --test tests/profile-router.test.mjs",
            "mandatory isolated smoke", "OPENCODE_DISABLE_PROJECT_CONFIG=1",
            "no global writes", "Luna/low", "five minutes", "no retries",
            "AntiGravity provider smoke", "block the release",
            "no assistant/provider execution",
            "cross-process resume",
            "foreground host sequence", "background Task timing is unsupported",
            "transient marker", "pre-existing sibling", "exact `task_id`", "without marker mutation",
            "`session.created`", "30 seconds", "after is skipped",
            "update-failure revocation without unhandled rejection", "manual child-title cleanup",
            # The host-fact gate's triage taxonomy (issue #39). A releaser acts
            # on the difference between an environmental failure and a moved
            # host guarantee, so the marker word, all three inconclusive shapes,
            # and the standing refusal to relax an assertion are pinned here.
            "INCONCLUSIVE", "three shapes, not one",
            "so nothing was observed",
            "the role the prompt asked for",
            "refused before execute", "run killed at its cap",
            "the host asked permission for this call before execute",
            "the bogus call failed for some reason other than its role",
            "not this list of exemplars",
            "not a host verdict", "external_directory",
            "never relax the assertion instead",
        ):
            self.assertIn(phrase, release)


if __name__ == "__main__":
    unittest.main()
