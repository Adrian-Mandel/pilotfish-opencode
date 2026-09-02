"""Generate tests/bench/data/gate-firing-classification.json.

One classifier pass over the 62 exported historical verifier dispatches, asking
of each: would the skip rule proposed in docs/issue-16-p1-proposal.md have
skipped this dispatch? Judgements are keyed by session index and encoded here so
the artifact is regenerable and checkable rather than hand-typed.
"""
import json

# index -> (dispatchKind, changeSurface, reason)
#
# dispatchKind:
#   "completion-gate"  a claimed implementation is under test
#   "read-only-review" the verifier was used to review a document or repository
#                      state; no claimed change is being gated
#
# changeSurface: what the change touched, as stated in the brief.
# reason: the skip-rule clause that decides it. Every entry resolves to
#   fire, so the reason names why no skip condition applied.
J = {
    0:  ("completion-gate", "code", "Swift app sources, Package.swift, build script"),
    1:  ("completion-gate", "code", "same app after quiet-zone and preview fixes"),
    2:  ("completion-gate", "code+docs", "nine prompts, presets, installer runbook, tests"),
    3:  ("read-only-review", "none", "handoff-readiness audit of repository state; no claimed change"),
    4:  ("read-only-review", "none", "peer review of HANDOFF_HARDENING_PLAN.md; no claimed change"),
    5:  ("completion-gate", "host-consumed-config", "AGENTS.md, plan.md, docs/session-recovery.md — AGENTS.md is injected into every agent"),
    6:  ("read-only-review", "none", "adherence audit of a prior session; no claimed change"),
    7:  ("read-only-review", "none", "forensic reconstruction of an interrupted session"),
    8:  ("completion-gate", "host-consumed-config", "pilotfish.md prompt change plus upstream ledger"),
    9:  ("read-only-review", "none", "checks proposed state claims against HEAD; no claimed change"),
    10: ("completion-gate", "docs-only", "README, local walkthrough, install runbook; brief states no code changed"),
    11: ("completion-gate", "host-consumed-config", "the installed global OpenCode configuration and install-state"),
    12: ("completion-gate", "code+docs", "tools/serve-mz.js port handling plus AGENTS.md/CURRENT_STATE.md"),
    13: ("completion-gate", "code+docs", "same, at a later commit"),
    14: ("completion-gate", "code+docs", "same, plus worktree layout"),
    15: ("completion-gate", "code", "MechBattle.js formation and bounds"),
    16: ("completion-gate", "code", "equipment system, save migration"),
    17: ("completion-gate", "code+docs", "equipment system plus a documentation correction"),
    18: ("completion-gate", "code", "formation, camera clamp, bitmap loading"),
    19: ("completion-gate", "code", "layout, bounds, fieldScale propagation"),
    20: ("completion-gate", "code+docs", "MechBattle.js, presentation-probe.js, CUSTOM_SYSTEMS.md"),
    21: ("completion-gate", "code+docs", "same"),
    22: ("completion-gate", "code+docs", "MechBattle.js intro cue, lifecycle probe"),
    23: ("completion-gate", "code", "unified Action command dispatch"),
    24: ("completion-gate", "code+docs", "Action picker crash fix plus docs"),
    25: ("completion-gate", "code+docs", "package identity, runtime paths, commands, skills"),
    26: ("completion-gate", "code+docs", "temp-file cleanup, privacy docs, regression tests"),
    27: ("completion-gate", "code", "temp directory cleanup via finally, mkdtempSync"),
    28: ("completion-gate", "code", "serialized manifest persistence, race regression test"),
    29: ("completion-gate", "code", "all three manifest writers routed through updateManifest"),
    30: ("completion-gate", "code", "segment extraction into unique temp workspace"),
    31: ("completion-gate", "code", "per-segment extraction directories"),
    32: ("completion-gate", "code", "microsecond timestamp formatting for frame identity"),
    33: ("completion-gate", "code", "centralized MEDIA_TIMESTAMP_REGEX and schemas"),
    34: ("completion-gate", "code", "install/check/dry-run/uninstall CLI"),
    35: ("completion-gate", "code-security", "ownership receipt binding uninstall authority"),
    36: ("completion-gate", "code-security", "journal bound to exclusive lock nonce"),
    37: ("completion-gate", "code-security", "verifyOwned bound to checked-in installer inputs"),
    38: ("completion-gate", "code-security", "canonical payload inventory seal"),
    39: ("completion-gate", "code-security", "re-running the prior forgery attacks"),
    40: ("completion-gate", "code-security", "recovery no longer follows journal paths"),
    41: ("completion-gate", "code-security", "recovery.json included in payload seal"),
    42: ("completion-gate", "code-security", "uninstall rollback ordering"),
    43: ("completion-gate", "code+docs", "profile router, installer runbook, docs, CHANGELOG"),
    44: ("completion-gate", "code-security", "cross-profile hidden-agent bypass closed"),
    45: ("completion-gate", "code-security", "profile pinning contract and worker mappings"),
    46: ("completion-gate", "code-security", "Task permission preservation before clone creation"),
    47: ("completion-gate", "code-security", "permission matcher mirrored against host wildcard.ts"),
    48: ("completion-gate", "code-security", "agent/model derived from resolved message"),
    49: ("completion-gate", "code-security", "history recovery of the persisted profile pin"),
    50: ("completion-gate", "code-security", "role validation in history recovery, fail-closed"),
    51: ("completion-gate", "code+docs", "AntiGravity prerequisites in the walkthrough, policy tests"),
    52: ("completion-gate", "code-security", "subagent-mode requirement, internal-prefix rejection"),
    53: ("completion-gate", "code-security", "protective hooks on catchable initialization failure"),
    54: ("completion-gate", "code-security", "plugin-injected SDK client surface for history recovery"),
    55: ("completion-gate", "code-security", "fail-closed routing before provider execution"),
    56: ("completion-gate", "code-security", "Task remapping scoped to the active resolved agent"),
    57: ("completion-gate", "code-security", "one-time parent authorization for hidden Task children"),
    58: ("completion-gate", "code-security", "exact child binding via transient call marker"),
    59: ("completion-gate", "code-security", "exact-child foreground authorization, live evidence"),
    60: ("completion-gate", "code-security", "independent 30s authorization expiry"),
    61: ("completion-gate", "code-security", "title restoration and cleanup on every failure path"),
}

SKIPPABLE = set()  # deliberately empty; see "result" below

src = json.load(open("tests/bench/data/historical-verifier-sessions.json"))
rows = []
for i, s in enumerate(src["sessions"]):
    kind, surface, why = J[i]
    if kind == "read-only-review":
        clause = "not-a-completion-gate"
        detail = "The firing rule governs the Completion Gate. This dispatch gates no claimed implementation, so the rule never applies to it."
    elif surface == "docs-only":
        clause = "documentation-asserts-behavior"
        detail = "Prose only, but it describes what the installer does, which is behavior code can contradict. The skip rule names this case explicitly and refuses it."
    elif surface == "host-consumed-config":
        clause = "read-by-a-program"
        detail = "Not source, but consumed by the host or by agents at runtime, so it is not text no program reads."
    elif surface == "code-security":
        clause = "security-always-fires"
        detail = "Touches authorization, credentials, or a trust boundary. No skip condition applies to this shape."
    else:
        clause = "read-by-a-program"
        detail = "Executable source under test."
    rows.append({
        "index": i,
        "sessionId": s["sessionId"],
        "verdict": s.get("verdict"),
        "directory": s["directory"].split("/")[-1],
        "dispatchKind": kind,
        "changeSurface": surface,
        "wouldSkip": i in SKIPPABLE,
        "decidingClause": clause,
        "rationale": why,
        "clauseDetail": detail,
    })

gates = [r for r in rows if r["dispatchKind"] == "completion-gate"]
refuted_gates = [r for r in gates if r["verdict"] == "REFUTED"]
out = {
    "derivedAt": "2026-09-01",
    "source": "tests/bench/data/historical-verifier-sessions.json",
    "question": (
        "Would the skip rule proposed in docs/issue-16-p1-proposal.md section 4a have "
        "skipped this verifier dispatch?"
    ),
    "rule": {
        "skipWhen": [
            "the change touches nothing any program in the repository reads, AND asserts nothing about behavior that code could contradict",
            "the change restores an exact prior committed state and git diff against that state is empty",
        ],
        "neverSkip": [
            "authentication, authorization, credentials, identity, privacy, secrets, cryptography, input validation, or a trust boundary",
        ],
        "notSkipConditions": ["cost", "confidence", "size", "the author having already tested it"],
    },
    "method": (
        "One classifier pass over every exported dispatch brief, reading the stated claim "
        "and the paths or subsystems it names. Resolution is the brief, not the diff: the "
        "export carries dispatch text and verdicts, not the changes themselves, so a brief "
        "that understates its own surface would be classified from what it says. Two "
        "categories are recorded separately because they answer different questions - a "
        "read-only review is not a Completion Gate firing at all, and the firing rule does "
        "not govern it."
    ),
    "counts": {
        "sessions": len(rows),
        "completionGates": len(gates),
        "readOnlyReviews": len(rows) - len(gates),
        "wouldSkip": sum(1 for r in rows if r["wouldSkip"]),
        "wouldSkipAmongRefuted": sum(1 for r in refuted_gates if r["wouldSkip"]),
        "byDecidingClause": {
            c: sum(1 for r in rows if r["decidingClause"] == c)
            for c in sorted({r["decidingClause"] for r in rows})
        },
        "bySurface": {
            c: sum(1 for r in rows if r["changeSurface"] == c)
            for c in sorted({r["changeSurface"] for r in rows})
        },
    },
    "result": (
        "Zero of 62 dispatches would have been skipped, and zero of the 44 REFUTED ones. "
        "The rule's saving on this corpus is nil. The single documentation-only completion "
        "gate in the whole sample (index 10) is the case the rule refuses to skip by name, "
        "because the documentation asserts what the installer does."
    ),
    "sessions": rows,
}
print(json.dumps(out, indent=2))
