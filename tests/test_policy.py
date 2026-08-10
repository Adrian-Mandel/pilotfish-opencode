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

    def test_profiles_are_canonical_and_complete(self) -> None:
        self.assertEqual(self.profiles["publicRoles"], list(AGENTS))
        expected_primary = {
            "sol": ("openai/gpt-5.6-sol", "high"),
            "terra": ("openai/gpt-5.6-terra", "high"),
            "luna": ("openai/gpt-5.6-luna", "max"),
            "opus": ("google/antigravity-claude-opus-4-6-thinking", "max"),
            "pro": ("google/antigravity-gemini-3.1-pro", "high"),
            "flash": ("google/antigravity-gemini-3.6-flash", "high"),
        }
        for profile, primary in expected_primary.items():
            actual = self.profiles["profiles"][profile]
            self.assertEqual((actual["primary"]["model"], actual["primary"]["variant"]), primary)
            self.assertEqual(set(actual["workers"]), set(WORKERS))
        self.assertEqual(
            self.profiles["presets"],
            {"chatgpt": ["sol", "terra", "luna"], "antigravity": ["opus", "pro", "flash"]},
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
        for binding in self.profiles["profiles"]["opus"]["workers"].values():
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
    def test_presets_cover_every_public_agent(self) -> None:
        for name in ("chatgpt", "antigravity"):
            preset = json.loads(text(f"templates/presets/{name}.jsonc"))
            self.assertEqual(set(preset["agent"]), set(AGENTS))

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
        self.assertIn("Do not ask for a preset, present a write plan, or write any file", installer)
        self.assertIn("Never replace an existing entry during an update", installer)

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
            "sol": {
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
            "terra": {
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
            "luna": {
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
            "opus": {
                "primary": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "scout": ("google/antigravity-gemini-3.6-flash", "low"),
                "Explore": ("google/antigravity-gemini-3.6-flash", "medium"),
                "plan-verifier": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "mech-executor": ("google/antigravity-gemini-3.6-flash", "low"),
                "executor": ("google/antigravity-gemini-3.1-pro", "high"),
                "verifier": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "security-executor": ("google/antigravity-claude-opus-4-6-thinking", "max"),
            },
            "pro": {
                "primary": ("google/antigravity-gemini-3.1-pro", "high"),
                "scout": ("google/antigravity-gemini-3.6-flash", "low"),
                "Explore": ("google/antigravity-gemini-3.6-flash", "medium"),
                "plan-verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "max"),
                "mech-executor": ("google/antigravity-gemini-3.6-flash", "low"),
                "executor": ("google/antigravity-gemini-3.1-pro", "high"),
                "verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-executor": ("google/antigravity-claude-opus-4-6-thinking", "low"),
            },
            "flash": {
                "primary": ("google/antigravity-gemini-3.6-flash", "high"),
                "scout": ("google/antigravity-gemini-3.6-flash", "minimal"),
                "Explore": ("google/antigravity-gemini-3.6-flash", "low"),
                "plan-verifier": ("google/antigravity-gemini-3.1-pro", "high"),
                "security-reviewer": ("google/antigravity-claude-opus-4-6-thinking", "low"),
                "mech-executor": ("google/antigravity-gemini-3.6-flash", "minimal"),
                "executor": ("google/antigravity-gemini-3.6-flash", "high"),
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
        for binding in (
            "`openai/gpt-5.6-sol` with variant `high`",
            "`openai/gpt-5.6-terra` with variant `high`",
            "`openai/gpt-5.6-luna` with variant `max`",
        ):
            self.assertIn(binding, prompt)

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
        ):
            self.assertIn(phrase, release)


if __name__ == "__main__":
    unittest.main()
