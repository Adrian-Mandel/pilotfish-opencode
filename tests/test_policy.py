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


if __name__ == "__main__":
    unittest.main()
