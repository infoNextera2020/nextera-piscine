# Piscine UI 002 — Challenge, Checkpoint, Result and Evidence

Scope: these four surfaces only, inside the accepted production AppShell. UI_001 architecture and behavior remain accepted. The catalog remains **CANDIDATE**. Changes remain unstaged and uncommitted.

## A. Implementation summary

Implemented the approved V5 learning flow using the existing Next.js routes and scoped UI_001 learning primitives. The shell, Command Center and Roadmap retain their approved design; the shell only gains a working learner-only Progress & Evidence navigation entry and its active state. Nothing moves into `packages/ui`.

Challenge provides the five required keyboard tabs, authorized subject and submission rules, local file intake, live safe submission history and stored Roadmap context. Resources and Discussion explicitly explain the absence of a connected source/service rather than displaying prototype material. File validation, uploading, accepted/pending and recoverable error states are explicit. Queued, running, passed, failed, compile_error, runtime_error, timeout and system_error remain distinct safe server verdicts. A returned passed verdict does not make the browser declare mastery.

Checkpoint presents the four frozen checkpoint tasks, authoritative pass/reservation fields, trusted deadline and a display-only elapsed-performance countdown. Selection is unrestricted. Start, task submission and irreversible confirmed finish retain their existing intake routes. The confirmation uses a native modal with an explicit keyboard focus cycle, safe initial focus, Escape and focus restoration. Expired-but-not-finalized and evaluating states explain that accepted work continues.

Result has three separate server-rendered outcomes: PASS, LEARNER FAIL and INFRASTRUCTURE BLOCKED. An outcome identity is required before showing a final result. Historical outcomes can be selected only from the learner's returned history. Scores come directly from stored outcome points. An actual server refresh control handles pending results. PASS shows current stored progression without inferring a new unlock. FAIL does not offer a retake unless the server presentation confirms it. Infrastructure recovery has its own purple treatment and never grants replacement eligibility.

Evidence separates durable mastery, checkpoint outcomes, learner failures, unlock records and infrastructure records with a filterable timeline and current-mastery panel. Duplicate submission identities shared by the overview and checkpoint reads are collapsed, preferring the more specific checkpoint task projection. The audit figure is explicitly a metaphor; it does not claim that an unavailable receipt/event graph has been verified.

The supplied frontend skill guided implementation. All four supplied skills were installed into the personal Codex skills directory. The two user-selected Hairline figures are restricted to the checkpoint gate/recovery and Evidence audit chain; there is no illustration on ordinary Challenge panels. Their engine and standalone bench remain unchanged; the embedding component applies NextEra styling and hides bench controls. No autoplay tour runs in the product.

## B. Component tree

```text
Authorized server pages
├─ existing AppShell / scoped learning primitives
├─ Challenge page
│  ├─ Breadcrumbs / WorkspaceHero / Subject
│  └─ Challenge (tab selection and safe history refresh)
│     ├─ Overview / Tasks / Submissions / Resources / Discussion
│     ├─ SubmissionForm
│     └─ stored Roadmap context
├─ Checkpoint page
│  ├─ WorkspaceHero
│  └─ Checkpoint
│     ├─ four-task selector / authorized subject / safe task history
│     ├─ local file intake
│     ├─ Hairline gate / display-only timer / policy
│     ├─ irreversible finish dialog
│     └─ attempt history / authoritative result link
├─ Result page
│  └─ CheckpointResult (server)
│     ├─ PASS | LEARNER FAIL | INFRASTRUCTURE BLOCKED
│     ├─ stored task evidence / outcome and attempt identities
│     ├─ current stored progression or recovery/retake explanation
│     └─ RefreshLearning (read-only server refresh)
└─ Evidence page / authorized cohort chooser
   ├─ WorkspaceHero
   └─ Evidence (category selection only)
      ├─ evidence timeline
      ├─ current mastery
      └─ Hairline receipt plates / audit-chain explanation

Shared within apps/web only:
workspace-parts, workspace-denied, workspace.module.css, HairlineFigure,
existing StatusBadge and LearningLoading; existing safe app error boundary.
```

## C. Route mapping

| Surface                 | Route                                                          | Behavior                                                                                         |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Challenge/project       | `/app/cohorts/[cohortId]/challenges/[nodeKey]`                 | Existing authorized subject/intake route; allowlisted `?tab=` display selection                  |
| Checkpoint              | `/app/cohorts/[cohortId]/checkpoints/[nodeKey]`                | Existing learner-only checkpoint route                                                           |
| Result                  | `/app/cohorts/[cohortId]/checkpoints/[nodeKey]/result`         | Latest attempt by default; optional `?attempt=` must match authorized history                    |
| Evidence                | `/app/cohorts/[cohortId]/evidence`                             | Learner/cohort-scoped projections; allowlisted category display filter                           |
| Evidence entry          | `/app/evidence`                                                | Redirect for one authorized cohort, chooser for several, genuine enrollment empty state for none |
| Ordinary intake/history | Existing `/api/submissions` and `/api/submissions/history`     | Existing identity-only intake headers and safe read                                              |
| Checkpoint intake/read  | Existing `/api/checkpoints` and `/api/checkpoints/submissions` | Existing mutation behavior; GET adds server-derived presentation hints                           |

Challenge rejects checkpoint-kind subjects on the ordinary subject route. No parallel assessment pipeline or illustrative prototype route is introduced.

## D. Server data dependencies

| Existing trusted read                                      | Use                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authorizeCohortPage` / active domain identity             | Current role, cohort and membership access                                                                                                                                           |
| `readAccessibleSubject`                                    | Authorized published challenge title, kind, Markdown and submission rules                                                                                                            |
| `submissionContext`                                        | Server-side availability of ordinary runnable intake                                                                                                                                 |
| `readSubmissions`                                          | Existing bounded safe verdict, feedback, submission identity and timestamp projection                                                                                                |
| `readLearningOverview` / node and prerequisite projections | Existing shell context, quest/skill metadata and stored progression                                                                                                                  |
| `readCheckpoint`                                           | Server time, eligibility projection, attempt identity/status/deadline, task pass/reservation fields, safe task history, outcome points/identities and replacement grant availability |
| `listCohorts`                                              | Authorized Evidence chooser                                                                                                                                                          |

`CheckpointView` now types timestamps and outcome IDs already returned by the existing read function; its SQL and grants are unchanged. Checkpoint display hints are assembled only on the server from the existing trusted read. They gate presentation, while every mutation is still rechecked by the existing PostgreSQL operation. These hints do not aggregate outcomes or write state.

The browser receives no source snapshots, private evaluation identities, hidden test data, raw Judge output, worker/lease credentials or private paths. Checkpoint reads are batched four at a time when Evidence needs multiple histories.

## E. Authorization boundaries

Authorization precedes protected loading boundaries. Direct URLs preserve HTTP 404 denials for foreign cohorts, locked subjects, unsupported preview access and unknown attempt identities. Inactive current membership denies Challenge, Checkpoint, Result, Evidence and checkpoint polling. Explicit safe denied views reveal no cohort/subject detail. Existing root identity redirects and safe retry errors remain in place.

Operator/admin subject access remains a labeled read-only preview. Their preview does not acquire personal learner Evidence or checkpoint-attempt access. The Evidence navigation entry is enabled for learners only.

No migrations, database grants, result application, checkpoint policy, Runner/Judge/sandbox implementation, real curriculum or catalog data changed. Checkpoint POST and task intake semantics are unchanged. Page visits, filters, search and figure interactions never reconcile or finalize assessment. Browser state is limited to selection, modal/form state, display countdown and authorized refreshes.

The existing restricted web connection is used throughout. No elevated database connection was added to the app to obtain extra Evidence. Durable mastery/unlocks use stored progress timestamps. Checkpoint outcome receipts use the existing authorized outcome IDs. Ordinary application receipts and unrestricted activity-event payloads are intentionally absent because the accepted web permissions do not expose them.

## F. Foundation 006 state mapping

| Trusted state/field                                      | UI mapping                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| No attempt, eligible projection                          | Closed gate; start action only when the server presentation makes it available; task prompts remain hidden until legitimate start      |
| Locked eligibility                                       | Closed muted gate and explanation; no invented start access                                                                            |
| `active` before trusted deadline                         | Four tasks, server pass/reservation fields, gold gate latch, display-only timer and server-presented intake actions                    |
| Active status after trusted deadline                     | Explicit expired/awaiting-finalization state; server presentation closes intake; no browser finalization                               |
| `evaluating`                                             | Closed intake; accepted pre-deadline/pre-finish work remains valid; refreshable pending result                                         |
| Stored task `passed`                                     | Permanent task credit display; later history cannot regress that flag                                                                  |
| `queued` / `running`                                     | Separate pending safe history states; no inferred learner outcome                                                                      |
| `failed` / `compile_error` / `runtime_error` / `timeout` | Distinct learner verdicts; no inferred checkpoint score or mastery                                                                     |
| `system_error`                                           | Purple system retry/history; existing server reservation count is displayed unchanged; no learner-quota charge computed by the browser |
| Outcome `passed` with receipt identity                   | PASS and stored `points / 4`; stored checkpoint mastery/current progression only                                                       |
| Outcome `failed` with receipt identity                   | LEARNER FAIL; no gated-unlock claim; no retake action without server confirmation                                                      |
| Outcome `infrastructure_blocked` with receipt identity   | INFRASTRUCTURE BLOCKED; purple recovery gate; no learner fail or invented replacement eligibility                                      |
| `replacement_available`                                  | Recorded grant explanation; current server-authorized start still required                                                             |
| `retake_at` / normal slot                                | Earliest policy timestamp is explanatory; server presentation controls the action, PostgreSQL enforces it                              |

The policy stays exactly four checkpoint-specific tasks, 90 trusted minutes, pass threshold 3/4, up to three learner-result submissions per task and no learner quota consumed by system_error. Accepted pre-deadline work is never discarded because evaluation finishes late. Normal attempts, cooldowns, fair-opportunity semantics and infrastructure replacements remain Foundation 006's responsibility.

## G. Visual deviations and limitations

- Reused the V5 content hierarchy, two-column workspace, policy/timer side rail, distinct result summaries and Evidence layout with the accepted production shell and Poppins.
- The supplied Challenge/Checkpoint raster banners contain baked prototype labels and a false sample timer. This pass uses restrained navy surfaces instead of displaying those labels. Hairline supplies the meaningful gate/audit metaphors without redecorating the shell or ordinary panels.
- Real authorized metadata replaces prototype weeks, languages, fabricated requirements, task percentages, course names and conversations. Challenge has no invented scored subtasks. Resources/Discussion explain the unavailable data/service.
- Result has no user-operated state switch. Each variant comes from a genuine stored outcome. The result circle displays the authoritative task count and has no mastery percentage.
- PASS labels the current stored available progression. It does not claim a particular node was newly unlocked by this result when the exposed projections cannot establish that causal event.
- Evidence is honest about projection coverage: up to 50 safe submissions per node, retained checkpoint outcomes and up to 100 task submissions for each latest checkpoint attempt. Historical outcomes remain selectable; private historical task detail is not invented. This is not an unrestricted activity-event or receipt export.
- Text is larger than the compact prototype. Tablet retains usable workspace columns where they fit; mobile stacks panels and keeps timer, result state and intake usable. All meaningful labels remain DOM content.
- The user explicitly requested subtle pointer motion. Hairline's thumbnail-motion metric reports small movement (gate 4%, receipts 35%); the figure/console/frame checks pass. This is intentional rather than increasing the motion to meet the standalone showcase's stronger-motion preference.

## H. Tests / validation

Validation uses the pinned Node 24.19.0 / pnpm 11.22.0 runtime and a production build. Browser fixtures live only in disposable `foundation_test_ui001_*` databases with genuine local Supabase Auth and restricted web logins.

| Check                                        | Result                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Type checks                                  | Pass                                                                                                                         |
| ESLint                                       | Pass                                                                                                                         |
| Unit tests                                   | 113 passed, including seven checkpoint presentation cases and five Evidence authority/deduplication cases                    |
| Curriculum validation                        | Pass; real two-node draft and publication guard unchanged                                                                    |
| Production build                             | Pass                                                                                                                         |
| UI 002 browser suite                         | 10 passed                                                                                                                    |
| Accepted UI_001 browser suite                | 7 passed                                                                                                                     |
| Identity and cohort browser suite            | 20 passed                                                                                                                    |
| Formatting                                   | Pass                                                                                                                         |
| Publication/catalog audit                    | No real publication or production cohort; catalog CANDIDATE                                                                  |
| Protected implementation / staged-file audit | No changed Runner, domain policy, migrations, result/checkpoint operations, real curriculum or catalog files; nothing staged |

UI 002 browser coverage includes five keyboard tabs and URL persistence; distinct safe verdicts; real four-task state and unchanged server quota; display-only time; confirmation focus containment/Escape/restoration; the three authoritative result variants; stored progression; Evidence category separation and deduplication; foreign/locked/unknown-attempt and inactive-membership denial; safe read errors; no fabricated replacement/retake access; local file validation; and desktop/tablet/mobile layout without horizontal overflow.

The browser suite fingerprints progress, submissions, checkpoint attempts/outcomes and events before/after its read-only navigation/figure checks. Its final separate test performs a genuine explicit early finish in the disposable fixture and verifies closed intake after reload. Ordinary upload presentation is tested with a stubbed safe receipt; that case is not a claim of a new live Storage/Runner execution test. Fixture outcomes are prepared through existing intake, Judge-record and product-application operations without executing learner code. A bounded fixture-only retry tolerates a transient local clock rollback while preserving the production timestamp constraint.

The original cohort browser assertions now open the Tasks tab for requirements. Protected Judge/checkpoint browser selectors are aligned with safe verdict attributes and the accessible confirmation dialog; their backend assertions are unchanged. The protected native Runner/Judge execution and database policy suites were not repeated for this visual pass. Their accepted Foundation 004–006 evidence remains separate. The new browser checks run Chromium; this pass does not claim a fresh Safari/Firefox or independent WCAG audit.

Both Hairline sources pass the supplied static validator with intact kernel/bench. Their eight-shot looks pass frame, read-out, console and settled-motion checks. Standalone light/dark, 240px thumbnails, edge poses and motion strips were visually reviewed; product captures use NextEra palette overrides. Screenshot checks wait for the embedded figures to initialize, including the case where iframe load precedes React hydration.

## I. Desktop / tablet / mobile screenshots

Captures use isolated authorized fixtures, not production learner data. Viewports are desktop 1600 × 1000, tablet 1024 × 900 and mobile 390 × 844; full-page capture heights vary. Reduced motion is enabled. The approved V5 HTML/CSS was inspected alongside the production captures; no pixel-identical sample-content claim is made.

| Surface                         | Desktop                                                 | Tablet                                                | Mobile                                                |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Challenge                       | [Desktop](design/review/ui002/challenge-desktop.png)    | [Tablet](design/review/ui002/challenge-tablet.png)    | [Mobile](design/review/ui002/challenge-mobile.png)    |
| Checkpoint                      | [Desktop](design/review/ui002/checkpoint-desktop.png)   | [Tablet](design/review/ui002/checkpoint-tablet.png)   | [Mobile](design/review/ui002/checkpoint-mobile.png)   |
| Result — PASS                   | [Desktop](design/review/ui002/result-pass-desktop.png)  | [Tablet](design/review/ui002/result-pass-tablet.png)  | [Mobile](design/review/ui002/result-pass-mobile.png)  |
| Result — LEARNER FAIL           | [Desktop](design/review/ui002/result-fail-desktop.png)  | [Tablet](design/review/ui002/result-fail-tablet.png)  | [Mobile](design/review/ui002/result-fail-mobile.png)  |
| Result — INFRASTRUCTURE BLOCKED | [Desktop](design/review/ui002/result-infra-desktop.png) | [Tablet](design/review/ui002/result-infra-tablet.png) | [Mobile](design/review/ui002/result-infra-mobile.png) |
| Evidence                        | [Desktop](design/review/ui002/evidence-desktop.png)     | [Tablet](design/review/ui002/evidence-tablet.png)     | [Mobile](design/review/ui002/evidence-mobile.png)     |

Additional desktop captures: [safe Challenge history](design/review/ui002/challenge-history-desktop.png), [checkpoint gate before start](design/review/ui002/checkpoint-gate-desktop.png).

## J. Resulting tree and suggested commit message

```text
apps/web/
  app/api/checkpoints/route.ts                 # GET presentation only
  app/app/
    cohorts/[cohortId]/
      challenges/[nodeKey]/
        page.tsx
        not-found.tsx
      checkpoints/[nodeKey]/
        page.tsx
        not-found.tsx
        result/page.tsx
      evidence/
        page.tsx
        not-found.tsx
    evidence/page.tsx
  components/learning/
    app-shell.tsx                             # enable learner Evidence entry
    challenge.tsx
    checkpoint-result.tsx
    evidence.tsx
    hairline-figure.tsx
    refresh-learning.tsx
    workspace-parts.tsx
    workspace-denied.tsx
    workspace.module.css
  lib/
    checkpoints/checkpoint.tsx
    submissions/form.tsx
    learning/
      checkpoint-presentation.ts
      checkpoint-presentation.test.ts
      checkpoint-server.ts
      evidence.ts
      evidence.test.ts
  public/
    ASSETS.md
    piscine/hairline/
      gate.js
      receipts.js
      hairline-gate.html
      hairline-receipts.html
packages/db/queries/checkpoints.ts             # types for already-returned fields only
scripts/test-learning-ui.ts                    # optional assessment fixtures/config
playwright.assessment.config.ts
playwright.config.ts                           # isolate UI suite
package.json                                   # test:assessment-ui
.prettierignore                                # preserve generated Hairline bench
.github/workflows/checks.yml                    # run isolated UI 002 suite
README.md
tests/
  fixtures/learning.ts                         # optional authoritative result scenarios
  e2e/
    assessment-surfaces.spec.ts
    cohort-enrollment.spec.ts                  # Tasks-tab assertion
    checkpoint-execution.spec.ts               # confirmation/history selectors
    judge-execution.spec.ts                    # safe history selectors
docs/
  PISCINE_UI_002_REPORT.md
  design/review/ui002/                         # 20 product captures
```

Suggested commit message:

`feat(ui): implement challenge, checkpoint, result and evidence workspaces`

The checkout already contained accepted UI_001 and PostgreSQL-driver work when UI 002 began. Those changes are preserved. This report describes only UI 002's additions; no files have been staged or committed.
