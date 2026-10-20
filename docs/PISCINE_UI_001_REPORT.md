# Piscine UI 001 — Design Freeze v1 production pass

Review scope: **App Shell, Command Center and Roadmap only**. Foundation 006 baseline: `95fcd7e`. Changes remain unstaged and uncommitted. Challenge, Checkpoint, Result and Evidence redesigns await review of this pass.

## A. Implementation summary

Rebuilt the approved V5 shell and Command Center, and the approved V4 Roadmap language, natively in the existing Next.js application. The scenic elements are decorative; navigation, node cards, branch connections, status badges, counts, search, tabs and actions remain live DOM.

The shell provides the 228px desktop sidebar, top bar, curriculum search, account/sign-out menu, recent-update entry point, keyboard skip link and mobile navigation. Search covers only the selected authorized cohort's node titles and skills. Recent updates summarize stored submission and progress history; they do not introduce an unread-notification system.

Command Center shows the actual cohort/version/start date, node completion counts, mastered challenges/checkpoints, current work, available nodes, current authorized work, checkpoint summary, quest preview, recent activity, active submissions and a small evidence snapshot.

Roadmap retains the left summary/program/milestones column, central vertical progression spine with quest cards and challenge/project branches, checkpoint gates and selectable right detail panel. Tablet places details below the center and collapses navigation. Mobile uses a structured single-column progression list.

Loading appears inside the authorized page boundary. Empty states distinguish unassigned learners and empty curricula. Errors expose a safe retry message without raw database or Judge output. No global loading boundary precedes authorization: denied routes retain their accepted HTTP 404 behavior.

## B. Component tree

```text
AppPage / CohortPage / Roadmap chooser (server authorization)
└─ AppShell (navigation, account, updates, search and native dialogs)
   ├─ CommandCenter (server-rendered authorized overview)
   │  ├─ hero and stored-state count cards
   │  ├─ current work / checkpoint / quest preview
   │  └─ recent activity / active submissions / evidence snapshot
   ├─ Roadmap (client selection, filtering and keyboard tabs only)
   │  ├─ summary / program structure / milestones
   │  ├─ quest cards / challenge-project branches / checkpoint gates
   │  └─ selected quest-node details / skills / existing route links
   └─ CohortLinks or cohort chooser
Local shared parts: Icon, Panel, EmptyState, StatusBadge,
ProgressRing, ProgressBar, LearningLoading and safe error boundary.
```

Components and scoped tokens stay under `apps/web`. The reserved `packages/ui` folders remain empty.

## C. Route mapping

| Surface                                     | Route and behavior                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command Center                              | `/app`, with optional authorized `?cohort=<uuid>`; defaults to the first accessible cohort                                                                |
| Roadmap                                     | Existing `/app/cohorts/[cohortId]` canonical implementation                                                                                               |
| Roadmap entry                               | `/app/roadmap` redirects when exactly one cohort is available; otherwise presents the authorized chooser/empty state, preserving the selected kind filter |
| Challenges / Checkpoints navigation         | Kind filters on the same Roadmap; no duplicate progression route                                                                                          |
| Search / node selection links               | Canonical Roadmap with a validated node query                                                                                                             |
| Challenge / project reading and intake      | Existing `/app/cohorts/[cohortId]/challenges/[nodeKey]`, unchanged                                                                                        |
| Checkpoint entry / attempts                 | Existing `/app/cohorts/[cohortId]/checkpoints/[nodeKey]` and attempt routes, unchanged                                                                    |
| Progress & Evidence / Community / Resources | Explicit disabled “Soon” entries; no fake links or new surfaces                                                                                           |
| Operator access                             | Existing `/operator`, shown only for the authorized database role                                                                                         |

The current account menu exposes actual identity, role and sign-out; it does not invent profile/settings persistence.

## D. Server data dependencies

`readLearningOverview` is server-only. It uses the existing restricted web database connection and authorized reads:

| Input                                 | Display use                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Auth `getUser` and active domain user | Identity and trusted role                                                                                  |
| `listCohorts` / `findCohort`          | Current authorized cohort context                                                                          |
| `readCohortNodes`                     | Immutable node/quest metadata, skills and stored progress                                                  |
| `readPrerequisites`                   | Explanatory prerequisite titles and locked reasons                                                         |
| `readAccessibleSubject`               | Short excerpt for the already accessible ordinary current node                                             |
| `readSubmissions`                     | Existing safe history projection, at most 50 per node; reads batched four at a time                        |
| `readCheckpoint`                      | Stored attempt status for each unmastered checkpoint, batched four at a time; no start/reconcile operation |

The only database query changes project already granted columns: cohort start/end timestamps, stable quest keys, skills and stored progress timestamps. Scope predicates, grants and migrations are unchanged.

Overall progress is an explicit **mastered-node count**, not a grade, percentage mastery model or checkpoint task score. Ring/bar fill is a visual proportion of those stored counts. A quest's “complete” display means all of its stored nodes are mastered; it creates no new quest mastery evidence. The display never resolves prerequisite edges into unlocks. Only stored progression determines accessible links.

Current work is a server-selected pointer to stored in-progress/available work. There are no invented weeks, deadlines, hours, streaks, lessons or skills ratings. Checkpoint policy summaries repeat the accepted four-task / 90-minute / three-task-pass policy; this UI computes neither eligibility nor outcomes.

## E. Authorization boundaries

Every page checks the existing server authorization before loading its protected overview. Cohort/query selection is restricted to the returned authorized list. Direct subject/attempt routes retain their independent authorization. Operators see an explicitly labeled read-only curriculum preview without personal learner progress.

Browser state controls only selection, tabs, search and navigation. It cannot change verdicts, mastery, unlocks, timing, quota, score, retakes or access. No result reconciliation runs on these reads. Hidden tests, evaluation identities, snapshot payloads, private paths, raw Judge output and learner source do not enter the new view models.

The new browser suite runs the production build with a restricted web login against its own disposable local database, plus genuine local Supabase sessions. Forged Auth role metadata remains powerless. It checks foreign-cohort denial, locked-subject denial and current membership deactivation. A before/after fingerprint covers progress, submissions, jobs, checkpoint attempts/outcomes and events across navigation/search/filter/selection.

Historical deactivation, checkpoint fair-quota policy, accepted result application and progression transactions are unchanged. No Runner protocol/image, sandbox, test pack, catalog, real curriculum or production cohort changes are included. Publication remains blocked and the catalog remains **CANDIDATE**.

## F. Visual deviations and source coverage

- The supplied local V5 HTML/CSS and approved V4 Roadmap are the visual reference. The handoff is retained in [Design Freeze v1](design/PISCINE_DESIGN_FREEZE_V1_HANDOFF.md). The separate design book was not present in the supplied folder; this pass uses the handoff's explicit brand palette/type rules.
- Live quest/node counts and actual curriculum names replace the prototype's sample weeks, lessons, scores, streak, hours and dates. Current data may be sparse; empty states remain real.
- Readable typography and focusable controls take precedence over the prototype's unusually small text. Poppins is self-hosted with its OFL license. The sidebar stays 228px; Roadmap columns use responsive widths rather than forcing the prototype's fixed widths.
- Artwork is cropped/masked to suppress embedded sample interface labels. The Roadmap hero uses the supplied mountain scenery; the central progression is DOM cards/spine, without the old map-heavy composition.
- The progression spine is neutral. Actual node state supplies card/badge colors; no fixed decorative completion fraction implies progress.
- Native search/navigation dialogs provide focus containment and Escape behavior. Keyboard tabs support arrows/Home/End. Motion respects reduced-motion preferences.
- Future navigation is visibly unavailable. Notifications expose safe recent updates without pretending an unread-count service exists.
- Existing cohort-scoped URLs take precedence over the handoff's illustrative routes. Existing Challenge/Checkpoint pages are intentionally outside this visual rewrite.
- Content is top-aligned and reflows on tablet/mobile. No prototype business logic was copied.

## G. Test coverage

Verified locally on 2026-10-20 using the pinned Node 24.19.0 / pnpm 11.22.0 runtime and the production Next.js build:

| Check                                       | Result                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Formatting                                  | Pass                                                                                                                           |
| Type checks                                 | Pass                                                                                                                           |
| ESLint                                      | Pass                                                                                                                           |
| Unit tests                                  | **101/101**, including eight new presentation cases                                                                            |
| Curriculum validation                       | Pass; existing two-node draft unchanged, publication still requires approved metadata                                          |
| Production build                            | Pass                                                                                                                           |
| New UI browser suite                        | **7/7**                                                                                                                        |
| Existing identity and cohort browser suites | **20/20**                                                                                                                      |
| Protected-file / credential audit           | Accepted assessment, Runner, sandbox, catalog and curriculum files unchanged; no generated fixture credentials in review files |
| Publication guard                           | Zero real published curricula; zero production cohorts; catalog CANDIDATE                                                      |

All 27 browser cases pass, including direct-URL HTTP 404 denials, session renewal, sign-out/cookie removal, restricted-role reads, operator/admin preview, responsive layout, keyboard interaction and the unchanged-data fingerprint. The local Auth fixtures are cleaned up and disposable database logins disabled.

The native PostgreSQL assessment, Runner and sandbox suites were not repeated for this UI pass: their implementation, schemas, images and artifacts are unchanged. Foundation 006's accepted report retains that separate verification evidence.

The new eight unit cases check stored-state authority, checkpoint-node counts, operator preview, stable quest grouping, current-work ordering, missing learner progress rejection, unsupported kind rejection and empty curriculum behavior.

The seven new browser cases cover real data bindings and separate learner/infrastructure states; canonical Roadmap and locked reads; keyboard search, filters and tabs; foreign/inactive authorization; genuine empty states; desktop/tablet/mobile controls and layout; and unchanged assessment/progression fingerprints.

The isolated UI fixture uses existing intake, Judge record and product-application operations to prepare safe passed/failed/system-error/pending history. It does **not** execute learner code or claim a new Runner/Judge E2E result. Test-only non-runnable evaluation fixtures never enter the real curriculum/catalog. Random credentials live outside the checkout in a restricted temporary file. Cleanup disables fixture logins and removes its Auth accounts; assessment history is preserved.

The existing identity/cohort browser suites are also required for this pass. Only the existing logout test's menu-opening interaction changes; security assertions remain intact.

## H. Screenshots and verification notes

Review captures use the disposable local fixture, not production learner data:

| Screen         | Viewport    | Capture                                                   |
| -------------- | ----------- | --------------------------------------------------------- |
| Command Center | 1600 × 1000 | [Desktop](design/review/ui001/command-center-desktop.png) |
| Roadmap        | 1600 × 1000 | [Desktop](design/review/ui001/roadmap-desktop.png)        |
| Roadmap        | 1024 × 900  | [Tablet](design/review/ui001/roadmap-tablet.png)          |
| Roadmap        | 390 × 844   | [Mobile](design/review/ui001/roadmap-mobile.png)          |
| Command Center | 390 × 844   | [Mobile](design/review/ui001/command-center-mobile.png)   |

Full-page screenshots extend beyond viewport height. Comparison focuses on shell proportions, hero/card hierarchy, three-column Roadmap structure, semantic status colors and responsive stacking, with the explicit live-data adaptations above. Screenshots are review evidence, not a claim of pixel-identical sample content.

## I. Resulting tree

```text
apps/web/
  app/app/
    page.tsx
    error.tsx
    roadmap/page.tsx
    cohorts/[cohortId]/page.tsx
  components/learning/
    app-shell.tsx
    command-center.tsx
    roadmap.tsx
    icon.tsx
    primitives.tsx
    loading.tsx
    learning.module.css
  lib/learning/
    server.ts
    projection.ts
    projection.test.ts
    display.ts
    types.ts
  public/
    ASSETS.md
    fonts/poppins/ (four fonts and OFL.txt)
    piscine/ (two supplied decorative images)
packages/db/queries/cohorts.ts (read-only projection fields)
tests/
  fixtures/learning.ts
  e2e/learning-surfaces.spec.ts
  e2e/identity-access.spec.ts (account menu interaction)
scripts/test-learning-ui.ts
playwright.learning.config.ts
playwright.config.ts (separate isolated UI suite)
vitest.config.ts
tsconfig.test.json
package.json
.github/workflows/checks.yml
README.md
docs/
  PISCINE_UI_001_REPORT.md
  design/PISCINE_DESIGN_FREEZE_V1_HANDOFF.md
  design/review/ui001/ (five reviewed captures)
```

No dependency, lockfile, schema, migration, accepted assessment implementation or shared UI package changes.

## J. Suggested commit message

`feat(ui): implement Piscine shell, command center and roadmap`

Stop here for review of these three surfaces. Do not continue to the Challenge/Checkpoint redesign until that review.
