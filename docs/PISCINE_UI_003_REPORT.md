# Piscine UI_003 — visual polish

Presentation-only refinement of the accepted Challenge, Checkpoint, Result and
Evidence workspaces. The AppShell, Command Center and Roadmap remain unchanged.

- Submission, attempt and outcome IDs now sit in native, keyboard-accessible
  **Record details** disclosures. Challenge curriculum versions moved into
  **Technical details**. Titles, timestamps and meaningful statuses stay visible.
- Success-green remains on the PASS result action. Failure and infrastructure
  result navigation, challenge submission and checkpoint intake actions use teal.
- Challenge tabs retain all five sections with non-shrinking scrollable targets,
  a mobile scroll hint, and focused-tab scrolling for Arrow/Home/End navigation.
- Markdown gets consistent heading, paragraph, list, inline-code and code-block
  spacing. Subject content and Markdown sanitization are unchanged.
- The pre-start gate grows from a 340 × 215 frame to 520 × 300, centered with its
  action. Active-state figures keep their original restrained size and gesture.
- Checkpoint badges use readable labels, including **System retry**. The policy
  says “Infrastructure errors do not use one of your attempts.”
- Evidence coverage limits, record sources and audit implementation notes remain
  available in secondary disclosures. Evidence categories and data stay intact.

## Before / after

The before images are the accepted UI_002 captures. After images use the same
viewport sizes: desktop 1600 × 1000, tablet 1024 × 900, mobile 390 × 844, full-page,
Chromium with reduced motion. Separate isolated fixtures produce different IDs,
timestamps and timer values; these are visual comparisons, not pixel-diff baselines.

| Surface                | Before (desktop)                                          | After desktop                                              | After tablet                                             | After mobile                                             |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Challenge              | [Before](design/review/ui002/challenge-desktop.png)       | [Desktop](design/review/ui003/challenge-desktop.png)       | [Tablet](design/review/ui003/challenge-tablet.png)       | [Mobile](design/review/ui003/challenge-mobile.png)       |
| Checkpoint available   | [Before](design/review/ui002/checkpoint-gate-desktop.png) | [Desktop](design/review/ui003/checkpoint-gate-desktop.png) | [Tablet](design/review/ui003/checkpoint-gate-tablet.png) | [Mobile](design/review/ui003/checkpoint-gate-mobile.png) |
| Checkpoint active      | [Before](design/review/ui002/checkpoint-desktop.png)      | [Desktop](design/review/ui003/checkpoint-desktop.png)      | [Tablet](design/review/ui003/checkpoint-tablet.png)      | [Mobile](design/review/ui003/checkpoint-mobile.png)      |
| PASS                   | [Before](design/review/ui002/result-pass-desktop.png)     | [Desktop](design/review/ui003/result-pass-desktop.png)     | [Tablet](design/review/ui003/result-pass-tablet.png)     | [Mobile](design/review/ui003/result-pass-mobile.png)     |
| LEARNER FAIL           | [Before](design/review/ui002/result-fail-desktop.png)     | [Desktop](design/review/ui003/result-fail-desktop.png)     | [Tablet](design/review/ui003/result-fail-tablet.png)     | [Mobile](design/review/ui003/result-fail-mobile.png)     |
| INFRASTRUCTURE BLOCKED | [Before](design/review/ui002/result-infra-desktop.png)    | [Desktop](design/review/ui003/result-infra-desktop.png)    | [Tablet](design/review/ui003/result-infra-tablet.png)    | [Mobile](design/review/ui003/result-infra-mobile.png)    |
| Evidence               | [Before](design/review/ui002/evidence-desktop.png)        | [Desktop](design/review/ui003/evidence-desktop.png)        | [Tablet](design/review/ui003/evidence-tablet.png)        | [Mobile](design/review/ui003/evidence-mobile.png)        |

Side-by-side comparisons: [Challenge mobile](design/review/ui003/comparison-challenge-mobile.png),
[available gate](design/review/ui003/comparison-checkpoint-gate-desktop.png),
[learner failure](design/review/ui003/comparison-result-fail-desktop.png),
[Evidence](design/review/ui003/comparison-evidence-desktop.png).
Additional [Challenge history capture](design/review/ui003/challenge-history-desktop.png).

## Validation and boundaries

- Type checks, ESLint, 113 unit tests and production build passed.
- Assessment browser suite: 10 passed. Covers hidden/open record details,
  Evidence coverage disclosure, mobile keyboard tab visibility, result action
  colors, responsive overflow, existing authorization denials, read errors,
  display-only time and explicit irreversible finish.
- Accepted UI_001 browser suite: 7 passed.
- All seven requested states reviewed at all three sizes; no page-level horizontal
  overflow. No new cross-browser or independent accessibility audit is claimed.
- Existing database fingerprint check confirms read-only navigation and figures
  do not mutate assessment/progression data. Mutating test cases use disposable
  isolated test fixtures only.
- No backend APIs, routes, data models, authorization, migrations, Judge/Runner
  behavior or checkpoint policy changed. No client-side outcome, eligibility,
  quota or unlock decisions added. Catalog remains **CANDIDATE**.
- Changes remain unstaged and uncommitted. The earlier local-demo script,
  package commands and guide are pre-existing work from the previous request;
  they are not part of UI_003.
