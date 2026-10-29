# Beginner ATM curriculum review source package

Draft v1 — 29 October 2026

Editable Markdown source for owner review before learner release. The approved direction is a beginner project for three people using standard Go, one fake account and the operations show balance, deposit, withdraw and exit. Detailed limits, commands, input contracts and acceptance examples remain proposals.

## Documents

- `learner-en.md` — English learner brief with gradual stages, input contracts, examples and delivery caveats; no full solution.
- `owner-ar.md` — Arabic owner review covering approved scope, proposed details and release decisions.
- `private/mentor-checklist.md` — owner and mentor only; acceptance evidence, rationale and five draft question templates.
- `source-map.md` — provenance and adaptation map from the pinned historical source.

Supporting files are `scaffold/input.go`, `scaffold/README.md`, `input-demo/main.go` and `input-demo/input.go`. They are not a full ATM solution. The input demonstration must remain a separate program from the ATM. Final source layout, commands and upload packaging require engineering confirmation.

`private/verification.md` and `private/input_adapter_test.go` support engineering review. No Go compiler run was completed in the authoring environment. Manual checks and fixture arithmetic do not establish that the Go files compile or that an ATM implementation passes.

## Content boundaries

The project follows Q1 through Q3 and Exam 1. Scheduled project availability is independent of Exam 1 submission or pass status. No scores, deadlines, pass thresholds or retry policy are established here.

No transfers, PIN changes, files, databases or real financial data. Maps, structs and concurrency are not required. State exists only for a single program run. The historical term persistence refers to the repeated menu, not storing account data.

The platform delivery path is source-file upload. This package does not establish that an interactive CLI runner exists. If it is unavailable, a mentor needs a local demonstration of the exact uploaded attempt. Attempt-specific mentor approval is intended behavior, not a verified implementation claim.

## Distribution

Keep this development package private to the owner until reviewed. The learner ZIP excludes the `private` directory and the Arabic owner review. The mentor ZIP contains private material only; owner review and source documents can be delivered separately. Publish only approved learner-facing material. A private label in a filename does not enforce access control.

The source repository has not been edited. No production project, assessment, approval flow or runner is created by these documents. See the source map for the pinned baseline and proposed changes.

## Release review

Before release, approve the concrete input and balance contracts, confirm the helper and commands in the target Go environment, verify source-upload packaging, and establish how mentors identify the exact demonstrated attempt. Review the learner examples and private prompts together so they do not drift.

