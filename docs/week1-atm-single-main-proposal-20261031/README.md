# Approved ATM learner reporting handoff v1

The actual learner handoff is [learner-pack/learner-en.md](learner-pack/learner-en.md), with [one main.go starter](learner-pack/main.go) and a [short pack README](learner-pack/README.md). It contains the complete retained business brief plus the owner-approved supplied `Report(event string, balance *int)` helper and explicit stdout/stderr/terminal-balance obligations. The main function is TODO-only; no full ATM solution is supplied.

The starter includes the original scanner declaration and ReadLine function as one exact 433-byte region. The original 474-byte `scaffold/input.go` remains byte-for-byte unchanged in the baseline; package/import coalescing in the new main.go means that entire file is no longer claimed as a contiguous copy. Report's exact helper hash and the original input region hash are in [the reporting source contract](learner-pack/reporting-contract.json).

The original two-file input demo is copied unchanged into [learner-pack/input-demo](learner-pack/input-demo/main.go). The new [report-only example](learner-pack/report-demo/main.go) uses fixed illustrative values, no input, no parser and no ATM business implementation. Both examples remain separate from the team's submitted main. Human examples are readable stderr messages; stdout contains only the six documented JSON-array event kinds.

The required README information stays in a top-of-main.go comment: actual team, local run command, actual checks and unresolved issues. Nothing is silently waived, no extra attachment feature is needed, and source comments are not trusted evidence of executed checks.

## Preserved source and authorization

The original approved educational baseline at [content/source-baselines/project1-atm-v1](../../content/source-baselines/project1-atm-v1/BASELINE_STATUS.md) is unchanged, including its historical proposed-value/status labels. All business numbers, whole-line input distinctions, task scope, three-person team, schedule independence from Exam 1 and original resources remain intact. The new visible reporting/delivery amendment is separately authorized by owner message `Sentinel_1cbce2e598b88191964a8d4af844e811` on 31 October 2026. This is approval of this limited source contract, not runtime/publication/security authority.

The original hand-in wording is preserved as provenance: “Prepare the source file or files for the project platform's upload path and a short README explaining the proposed local run command, the team members and the checks you performed.” It never mandated a separate README.md filename.

## Verification and integration limits

[The comparison implementation and trusted-capture source contract](../week1-atm-semantic-oracle-proposal-20261031/README.md) compare observed JSON facts to an independent exact-input model. They do not trust helper calls, learner PASS claims, README assertions or stderr as business authority. A missing trusted capture producer stays unavailable. Observation matching is not an academic PASS and does not bypass automated-result or assigned-mentor requirements.

The current immutable content manifest is still development Hello Go and Even or Odd only. No ATM node, published business testpack, required capture/resource binding or progression transition is registered here. [The exact gap inventory](integration-gap.md) records those remaining artifacts. No Auth/compiler/migration/Runner/service or original baseline file is edited by this handoff. No production resource defaults are added.

See verification.json for the exact source pins, starter/example compiler checks, provided input/report helper tests, reference/negative/ambiguity/capture tests and the checks not performed. Full ATM business implementation and real end-to-end grading remain unverified because they are not supplied/enabled here.
