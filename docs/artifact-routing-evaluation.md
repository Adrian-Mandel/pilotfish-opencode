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

## Future Check-Ins

Append only sanitized observations: preset, artifact class and scale, routing appropriateness, reference quality, uncertainty handling, duplicate primary reads, access outcome, and workflow impact. Do not append transcripts, private paths, secrets, or runtime logs. This document does not require runtime telemetry or logging.
