# Pilotfish for OpenCode: Design Rationale

## Purpose

Pilotfish routes coding work by role so a capable primary model can spend its context on planning and judgment while less expensive workers handle volume. This document explains how that idea maps onto OpenCode without turning Pilotfish into a runtime orchestrator.

## Configuration, Not Runtime

Original Pilotfish is three kinds of configuration layered over Claude Code. It does not launch models or create worktrees itself. This port preserves that boundary:

```text
Pilotfish defines roles, models, permissions, and policy.
OpenCode creates sessions, calls providers, and executes tools.
```

No Pilotfish plugin, daemon, custom Task tool, or model gateway is installed.

## Three Concerns

| Concern | OpenCode mechanism | Changes when |
|---|---|---|
| Who orchestrates | Opt-in `pilotfish` primary agent | The preferred primary model changes |
| Who performs each role | Eight subagent definitions with model and variant | A preset or role assignment changes |
| How delegation behaves | Model-neutral prompt files | Workflow policy changes |

The global config stores the agent graph. Plain prompt files store behavior. Source preset fragments store only model and variant overlays.

## Why an Opt-In Primary

Original Pilotfish puts orchestration instructions in global `CLAUDE.md`, so every main session and custom worker sees them. Workers need instructions telling them to ignore the global routing policy.

OpenCode supports custom primary agents. Attaching the orchestration prompt only to `pilotfish` gives cleaner scoping:

- Built-in Build and Plan remain unchanged.
- Workers receive only their own role prompt.
- Users choose when orchestration overhead is worthwhile.
- The installer does not change `default_agent` or the global model.

## Why These Roles

| Role | Design reason |
|---|---|
| `scout` | Narrow fact finding is frequent, cheap, and safe to constrain to read/search tools |
| `Explore` | Broad codebase or accessible project-local artifact reconnaissance needs a larger search budget but still no write access |
| `plan-verifier` | A material Plan benefits from fresh-context challenge before approval, with repository reads but no command or write capability |
| `security-reviewer` | Pre-approval security evidence needs high-capability judgment and a read-only tool boundary |
| `mech-executor` | A complete specification has already supplied the judgment; the worker should execute rather than redesign |
| `executor` | Real implementation needs local decisions and stronger code reasoning |
| `verifier` | Post-implementation fresh-context refutation catches unchecked claims and context blindness better than implementer self-review |
| `security-executor` | Approved security implementation deserves explicit routing, assumptions, abuse-case testing, and a high-capability model |

The original names are preserved. Pilotfish supplies `scout`, while uppercase `Explore` coexists with OpenCode's lowercase built-in `explore` because OpenCode agent names are case-sensitive.

## Permission-Controlled Agent Graph

The `pilotfish` primary may invoke only the eight Pilotfish workers. Each worker has Task denied, making it a leaf agent.

Read-only roles start with a deny-all rule and then allow only explicit evidence tools. Environment files remain denied. `security-reviewer` additionally allows web fetches; the verifier denies file-edit tools and Task while retaining bash so it can reproduce tests after implementation.

Permissions provide stronger guarantees than prompts alone, but they are not a complete sandbox. In particular, arbitrary shell commands can write files. The verifier prompt and focused bash denials preserve the read-and-run contract where OpenCode cannot express it perfectly.

## Model Presets

OpenCode models are identified as `provider/model-id`; there is no portable alias layer equivalent to Claude's `best`, `opus`, `sonnet`, and `haiku`.

Version `0.1.0` therefore ships two explicit, tested mappings:

- ChatGPT through the OpenAI provider.
- AntiGravity through model IDs exposed by the user's existing Google integration.

Model and variant are configured together because reasoning controls differ by provider. The policy prompt names roles, not models, so model assignments can change without rewriting workflow rules.

## Quality Controls

Pilotfish protects delegated quality structurally:

1. Discovery receives a bounded evidence contract; the primary synthesizes one Plan.
2. Material Plans may receive a fresh, read-only `plan-verifier` challenge before approval.
3. Writing roles receive stable, authorized contracts with scope, ownership, constraints, and done criteria.
4. A role gets two attempts before escalation or primary takeover.
5. Non-trivial implementation receives a fresh `verifier` child session.
6. Reconnaissance is treated as evidence to check rather than an authoritative conclusion.
7. Workers are prevented from recursively delegating.

Both verification roles are independent but not free. Small work may skip them when a second context cannot reasonably protect enough value.

## Phase-Specific Dispatch Brakes

Role eligibility does not make delegation mandatory. Small, local, stable work remains in the primary session. Larger work moves through Discovery, Plan, Approval when required, Execution, and Verification. Discovery can begin before the implementation outcome is known, but only under a stable question, evidence format, scope, and stop condition. Plan synthesis, integration, and final judgment remain primary-session responsibilities.

Delegation is blocked when workers would repeatedly depend on evolving primary-session evidence, ownership overlaps, or synthesis and verification cost exceed the likely benefit. One unknown bug therefore keeps diagnosis, first minimal fix, and live verification in one reasoning chain instead of becoming a sequential scout-to-executor pipeline.

## Parallelism

Read-only searches may run concurrently because they cannot conflict in the worktree.

Writing workers are serialized in `0.1.0`. OpenCode contains experimental worktree APIs, but its stable Task schema does not expose Claude Code's `isolation: "worktree"` behavior or automatic result harvesting. Depending on experimental APIs would violate the release's configuration-only and stable-surface goals.

Leaf roles never detach long-running commands. If a command cannot finish within the host tool timeout, the worker returns its exact command and execution context to the primary. Stable OpenCode configuration does not guarantee persistent background shell tracking, so Pilotfish reports that limitation instead of promising Claude-specific process behavior.

## Fallback

OpenCode's current agent schema accepts one model per agent and has no general ordered fallback list. Pilotfish does not approximate automatic failover with hidden agents because a failed worker may already have produced side effects, and the primary model cannot rescue itself when its own request fails.

Fallback design remains a tracked limitation. Any future solution must preserve clear cost boundaries, handle partial writes, and avoid requiring a Pilotfish runtime engine.

## Configuration Check

The primary prompt asks OpenCode to inspect `opencode debug agent pilotfish` once per new session. It warns without blocking when the resolved primary model and variant do not match a tested preset.

This is a compatibility warning, not a visibility gate. The `pilotfish` agent remains selectable with any model configuration.

## Deliberately Left Out

| Feature | Reason |
|---|---|
| Runtime plugin | Original Pilotfish is configuration-only; OpenCode remains the execution engine |
| Per-project installation | A global opt-in primary provides one personal source of truth |
| Arbitrary installer model picker | `0.1.0` tests two bounded mappings; advanced users can edit config directly |
| Mixed-provider preset | Deferred until single-provider behavior is proven |
| Local Qwen preset | Planned for later OMLX evaluation, including missing context/output metadata |
| Automatic fallback | No stable native OpenCode mechanism |
| Parallel writers | No stable Task-level worktree isolation |
| Enforcement hooks | Policy and permissions are sufficient for the first experimental release |

## Evolution Rule

Pilotfish may adopt new behavior when OpenCode exposes it through stable configuration. It should not grow a parallel orchestration runtime merely to imitate another host's features.

Upstream Pilotfish changes are reviewed through the [semantic sync workflow](./upstream-sync.md). The [upstream deviations ledger](./upstream-deviations.md) is the authoritative current record of intentional differences from the reviewed baseline. The recorded upstream commit advances only after each change has been adopted, adapted, deferred, or marked inapplicable for OpenCode.
