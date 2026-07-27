from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENTS = (
    "pilotfish",
    "scout",
    "Explore",
    "plan-verifier",
    "security-reviewer",
    "mech-executor",
    "executor",
    "verifier",
    "security-executor",
)
WORKERS = AGENTS[1:]
READ_ONLY = ("scout", "Explore", "plan-verifier", "security-reviewer")
WRITERS = ("mech-executor", "executor", "security-executor")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class PolicyContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = load_json(ROOT / "templates" / "opencode.base.jsonc")
        self.policy = (
            ROOT / "templates" / "pilotfish" / "prompts" / "pilotfish.md"
        ).read_text(encoding="utf-8")
        self.explore = (
            ROOT / "templates" / "pilotfish" / "prompts" / "Explore.md"
        ).read_text(encoding="utf-8")

    def test_agent_graph_and_prompts_match(self) -> None:
        self.assertEqual(set(self.base["agent"]), set(AGENTS))
        prompts = ROOT / "templates" / "pilotfish" / "prompts"
        self.assertEqual({path.stem for path in prompts.glob("*.md")}, set(AGENTS))

        task = self.base["agent"]["pilotfish"]["permission"]["task"]
        self.assertEqual(task["*"], "deny")
        self.assertEqual({name for name, value in task.items() if value == "allow"}, set(WORKERS))

    def test_presets_cover_every_agent(self) -> None:
        for name in ("chatgpt", "antigravity"):
            preset = load_json(ROOT / "templates" / "presets" / f"{name}.jsonc")
            self.assertEqual(set(preset["agent"]), set(AGENTS))
            for agent in AGENTS:
                self.assertTrue(preset["agent"][agent]["model"])

    def test_read_only_roles_are_capability_enforced(self) -> None:
        for name in READ_ONLY:
            permission = self.base["agent"][name]["permission"]
            self.assertEqual(permission["*"], "deny")
            self.assertNotIn("bash", permission)
            self.assertNotIn("edit", permission)
            self.assertNotIn("task", permission)

        security = self.base["agent"]["security-reviewer"]["permission"]
        self.assertEqual(security["webfetch"], "allow")
        for name in ("scout", "Explore", "plan-verifier"):
            self.assertNotIn("webfetch", self.base["agent"][name]["permission"])

    def test_leaf_roles_cannot_delegate(self) -> None:
        for name in WRITERS:
            self.assertEqual(self.base["agent"][name]["permission"]["task"], "deny")
        self.assertEqual(self.base["agent"]["verifier"]["permission"]["task"], "deny")

    def test_plan_and_outcome_verdicts_are_separate(self) -> None:
        prompt_dir = ROOT / "templates" / "pilotfish" / "prompts"
        plan = (prompt_dir / "plan-verifier.md").read_text(encoding="utf-8")
        outcome = (prompt_dir / "verifier.md").read_text(encoding="utf-8")

        self.assertIn("`READY`", plan)
        self.assertIn("`REVISE`", plan)
        self.assertNotIn("CONFIRMED", plan)
        self.assertNotIn("REFUTED", plan)
        self.assertIn("`CONFIRMED`", outcome)
        self.assertIn("`REFUTED`", outcome)
        self.assertNotIn("READY", outcome)
        self.assertNotIn("REVISE", outcome)

    def test_policy_enforces_phase_and_approval_gates(self) -> None:
        for phrase in (
            "| Discovery |",
            "| Plan |",
            "| Approval |",
            "| Execution |",
            "| Verification |",
            "A broad initial request is not approval",
            "No source edits or implementation briefs before required approval",
            "stable research contract",
            "stable execution contract",
            "Block fan-out",
            "one unknown bug",
        ):
            self.assertIn(phrase, self.policy)

    def test_artifact_reconnaissance_uses_a_fresh_read_only_worker(self) -> None:
        for phrase in (
            "Small, local, already-stable work should be completed directly",
            "new, not resumed, read-only reconnaissance worker session",
            "collections of screenshots or generated frame sheets",
            "many PDF pages, or large logs",
            "Treat reconnaissance as evidence, not authority. Recheck any single scouted fact that carries an important decision.",
            "exact references and uncertainties",
            "retain primary synthesis",
            "selectively inspect decision-critical evidence",
        ):
            self.assertIn(phrase, self.policy)

    def test_explore_artifact_contract_preserves_access_boundary(self) -> None:
        for phrase in (
            "accessible project-local artifact reconnaissance",
            "separate confirmed observations from uncertainty",
            "path, page, frame, or log-range references",
            "report the blocked path instead of requesting broader access",
            "Never modify files",
            "design review",
        ):
            self.assertIn(phrase, self.explore)

        description = self.base["agent"]["Explore"]["description"]
        self.assertIn("accessible project-local artifact reconnaissance", description)
        self.assertIn("exact references", description)
        self.assertIn("uncertainties", description)

    def test_deviation_ledger_and_release_gate_are_linked(self) -> None:
        ledger = (ROOT / "docs" / "upstream-deviations.md").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "| Difference | Upstream behavior | OpenCode behavior | Rationale / revisit condition | Source |",
            ledger,
        )
        self.assertIn("| Fresh artifact-routing reconnaissance |", ledger)
        for path in (
            ROOT / "README.md",
            ROOT / "docs" / "design.md",
            ROOT / "docs" / "upstream-sync.md",
        ):
            self.assertIn("upstream-deviations.md", path.read_text(encoding="utf-8"))

        releasing = (ROOT / "RELEASING.md").read_text(encoding="utf-8")
        self.assertIn("docs/upstream-deviations.md", releasing)
        self.assertIn("no row may have `Pending` in Source at release", releasing)

    def test_artifact_capability_docs_do_not_claim_native_video_support(self) -> None:
        research = (ROOT / "docs" / "research.md").read_text(encoding="utf-8")
        evaluation = (ROOT / "docs" / "artifact-routing-evaluation.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("accept image and PDF input", research)
        self.assertIn("do not report video input", research)
        self.assertIn("does not perform native video decoding or extraction", research)
        self.assertIn("No native video claim", evaluation)
        self.assertIn("fresh Task child", evaluation)
        self.assertIn("temporary direct Explore run", evaluation)
        self.assertIn("external-path denial occurred on the ChatGPT child Task", evaluation)
        self.assertIn("not end-to-end routing success", evaluation)
        self.assertIn("routing appropriateness", evaluation)
        self.assertIn("duplicate primary reads", evaluation)
        self.assertIn("workflow impact", evaluation)
        self.assertNotIn("native video support", research + evaluation)

    def test_security_roles_preserve_approval_boundary(self) -> None:
        prompt_dir = ROOT / "templates" / "pilotfish" / "prompts"
        reviewer = (prompt_dir / "security-reviewer.md").read_text(encoding="utf-8")
        executor = (prompt_dir / "security-executor.md").read_text(encoding="utf-8")

        self.assertIn("pre-approval boundary is enforced by capability", reviewer)
        self.assertIn("approved, stable execution contract", executor)
        self.assertIn("belongs to `security-reviewer`", executor)
        self.assertIn("Route pre-approval security analysis", self.policy)

    def test_bash_capable_workers_never_detach(self) -> None:
        prompt_dir = ROOT / "templates" / "pilotfish" / "prompts"
        for name in (*WRITERS, "verifier"):
            prompt = (prompt_dir / f"{name}.md").read_text(encoding="utf-8")
            self.assertIn("never detach", prompt)
            self.assertIn("absolute working directory", prompt)
            self.assertIn("required environment variables", prompt)
            self.assertNotIn("launch it detached", prompt)

        self.assertIn("Long-running processes remain owned by this primary session", self.policy)
        self.assertIn("does not guarantee persistent background shell execution", self.policy)

    def test_installer_tracks_nine_agents_and_eight_workers(self) -> None:
        installer = (ROOT / "install" / "OPENCODE-INSTALL.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("one primary agent and eight worker definitions", installer)
        self.assertIn("all nine agent keys and all nine prompt filenames", installer)
        self.assertIn("Task access to the eight Pilotfish worker roles", installer)
        self.assertIn("treat only that name as newly touched", installer)
        self.assertIn("first-touch migration is required", installer)
        self.assertIn("before changing config or prompts, extend the maps", installer)
        for name in AGENTS:
            self.assertIn(f"`{name}`", installer)

    def test_installer_update_and_uninstall_lifecycle_contract(self) -> None:
        installer = (ROOT / "install" / "OPENCODE-INSTALL.md").read_text(
            encoding="utf-8"
        )

        for phrase in (
            "An update is an idempotent re-run",
            "this checkout's `VERSION` and `CHANGELOG.md` from the same pinned ref",
            "report that Pilotfish is up to date and stop",
            "Do not ask for a preset, present a write plan, or write any file",
            "Keep the recorded preset by default",
            "Current and desired are identical",
            "Current matches the prior managed `installedAgents[name]`, but desired changed",
            "Treat it as a customization: show the diff and ask",
            "Do not claim that old prompt hashes exist",
            "Preserved custom agents remain the installed values",
            "Preserve every existing entry in `previousAgents` and `previousPrompts` from the first managed install",
            "Never replace an existing entry during an update",
            "write `install-state.json` as the final installation step",
            "If validation fails, restore the target config backup, prompts, and previous install state",
            "If writing state fails, roll back the config and prompts",
        ):
            self.assertIn(phrase, installer)

        for heading in (
            "### Phase 1: Inspect and classify (read-only)",
            "### Phase 2: Present one restoration plan and get approval",
            "### Phase 3: Back up before writes",
            "### Phase 4: Restore or remove agents",
            "### Phase 5: Restore or remove prompts",
            "### Phase 6: Validate, roll back, and clean up",
        ):
            self.assertIn(heading, installer)

        self.assertLess(
            installer.index("### Phase 2: Present one restoration plan and get approval"),
            installer.index("### Phase 3: Back up before writes"),
        )
        self.assertLess(
            installer.index("### Phase 4: Restore or remove agents"),
            installer.index("### Phase 5: Restore or remove prompts"),
        )
        for phrase in (
            "overwritten pre-install values cannot be reconstructed without state",
            "Keep these backups after a successful uninstall",
            "Never auto-delete the global config",
            "classify a difference only as potentially customized",
            "potentially customized prompt",
        ):
            self.assertIn(phrase, installer)

    def test_update_and_uninstall_docs_are_actionable(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        local_install = (ROOT / "docs" / "local-install.md").read_text(
            encoding="utf-8"
        )

        for phrase in (
            "Updating means rerunning the installer",
            "all from the same ref",
            "git clone --branch <RELEASE_TAG>",
            "cd pilotfish-opencode",
            "opencode",
            "Read install/OPENCODE-INSTALL.md and update my existing Pilotfish installation",
            "stops without writing",
            "unchanged agents and prompts are skipped",
            "customization is diffed",
            "Raw `main` remains mutable",
            "one exact restoration plan",
            "overwritten pre-install values cannot be reconstructed",
        ):
            self.assertIn(phrase, readme)

        for phrase in (
            "same pinned ref",
            "Updating is simply rerunning install",
            "Read install/OPENCODE-INSTALL.md and update my existing Pilotfish installation",
            "stops without asking for a preset or writing anything",
            "identical agents and prompts skip",
            "changed custom content is shown as a diff",
            "one exact restoration plan",
            "overwritten pre-install values cannot be reconstructed",
        ):
            self.assertIn(phrase, local_install)

    def test_upstream_installer_adaptation_is_reproducible(self) -> None:
        sync = (ROOT / "docs" / "upstream-sync.md").read_text(encoding="utf-8")

        self.assertIn("install/AGENT-INSTALL.md", sync)
        self.assertIn("f10f9f332fd22d4487f7d29c2f7b084d4579385b", sync)
        self.assertIn("see the installer lifecycle adaptation row", sync)
        self.assertNotIn("see the Pending lifecycle row", sync)


if __name__ == "__main__":
    unittest.main()
