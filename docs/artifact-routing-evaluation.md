# Artifact-Routing Evaluation

## Purpose

Record sanitized observations about routing repeated, context-heavy accessible project-local artifact reconnaissance to a fresh Explore worker. This is an evaluation note, not runtime logging or a transcript archive.

## Review Criteria

- The worker is new rather than resumed, read-only, and stays within existing project/read permissions.
- Delegation is reserved for context-heavy work and does not delay or complicate small direct reviews.
- Findings are concise, distinguish confirmed observations from uncertainty, and cite exact artifact references.
- The primary retains synthesis, selectively reviews decision-critical evidence, and does not reload the full artifact set without cause.

## Sanitized Observations

| Date | Preset and invocation | Artifacts and result | Boundary observation |
|---|---|---|---|
| 2026-07-26 | ChatGPT Explore (`openai/gpt-5.6-luna`, medium), fresh Task child | Correctly inspected a project-local 12-frame PNG contact sheet, 5-page PDF, and 1000-line log; returned exact frame, page, and line references with uncertainties. | The child Task was denied an external path. |
| 2026-07-26 | AntiGravity Explore (`google/antigravity-gemini-3-flash`, low), temporary direct Explore run using the same prompt, permissions, and model assignment | Correctly inspected the same project-local artifact set; returned exact frame, page, and line references with uncertainties. | The CLI could not directly launch a subagent, so this is not child-session coverage. |

These controlled runs establish artifact-reading capability, not end-to-end routing success. Routing appropriateness, duplicate primary reads, and workflow impact remain subjects for real-session check-ins.

## Access and Media Boundary

The external-path denial occurred on the ChatGPT child Task. The worker reports a denied path and does not request broader access; this evaluation does not imply URL or arbitrary external-path support. Generated frame sheets are images. **No native video claim:** the configured models do not report video input, and native video decoding or extraction is out of scope.

## Decision, 2026-08-20

The routing rule is kept as shipped. Four weeks after the controlled runs above, no field observations were recorded, so this decision rests on capability evidence alone rather than on demonstrated end-to-end routing success. Recording the decision here is what issue #9's completion criterion asks for, and leaving that issue open longer would not have produced the observations: none arrived in the interval it was open.

What the evidence settles, and what it does not:

- **Established.** The configured Explore seats read project-local contact sheets, multi-page PDFs, and large logs, and return exact frame, page, and line references with stated uncertainty. External paths stay denied. No native video claim.
- **Not established.** Whether delegation is in practice reserved for context-heavy work, whether the primary avoids reloading the delegated artifact set, and whether routing adds delay to otherwise small reviews. Those were the point of the field check-ins and remain unmeasured.

The regression triggers recorded in issue #9 stand as written. Any one of them observed in a real session is grounds to narrow or revert the rule; cite this section in a fresh issue, or reopen #9.

One check-in criterion drifted while this sat. "Whether a new child session was used instead of resuming an old one" was written before `templates/pilotfish/prompts/pilotfish.md:35` began encouraging `task_id` resumption in general. The artifact-specific prohibition survives that change at `:36`, which still requires a new, not resumed, reconnaissance worker for this case. A future observation should therefore record the artifact case specifically rather than resumption generally.

## Future Check-Ins

Append only sanitized observations: preset, artifact class and scale, routing appropriateness, reference quality, uncertainty handling, duplicate primary reads, access outcome, and workflow impact. Do not append transcripts, private paths, secrets, or runtime logs. This document does not require runtime telemetry or logging.
