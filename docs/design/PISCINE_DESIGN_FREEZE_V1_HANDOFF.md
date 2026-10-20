# NextEra Piscine — Design Freeze v1 / Production Handoff

Status
Design Freeze Candidate: V5
Core flow: Command Center → Roadmap → Challenge → Checkpoint → Result → Evidence

This document is the visual/UX contract for production implementation in the existing Next.js product.

The prototype is not production code. Codex should rebuild the approved UX natively in the application and connect it to existing server-authorized data from Foundations 001–006.

Do not redesign screens while implementing unless a real product/technical contradiction is found.

## 1. Canonical Prototype Files

Use the V5 prototype as the visual reference:

- /mnt/data/nextera_piscine_ui_v5/index.html
- /mnt/data/nextera_piscine_ui_v5/roadmap.html
- /mnt/data/nextera_piscine_ui_v5/challenge.html
- /mnt/data/nextera_piscine_ui_v5/checkpoint.html
- /mnt/data/nextera_piscine_ui_v5/result.html
- /mnt/data/nextera_piscine_ui_v5/evidence.html
- /mnt/data/nextera_piscine_ui_v5/styles.css
- /mnt/data/nextera_piscine_ui_v5/assets/

Roadmap V4 direction is approved and must remain the roadmap visual language.

## 2. Design Source of Truth

Brand
Use the NextEra design book as the canonical brand source.

Core brand colors:

- Navy: #062438
- Green: #4abc70
- Gold: #e6af00
- Red: #f24f4f
- Orange: #db552c

Typography:

- English: Poppins / Forma DJR
- Arabic: Tajawal / IBM Plex

Production should prefer Poppins for the current English Piscine interface.
Visual Language

- dark navy product shell
- crisp borders
- restrained neon accents
- low-noise premium SaaS composition
- green = mastered/success/progression
- teal/cyan = current/active
- gold = checkpoint/gate attention
- red = learner failure/destructive attention
- purple = infrastructure/system state
- muted blue/gray = locked/inactive
- scenic artwork may be decorative only
- text, scores, nodes, timers, statuses and controls must remain real DOM/UI

Do not flatten screens into screenshots.

## 3. Application Shell

Build a reusable product shell:

- Sidebar
- Top bar
- Search
- User menu
- Notification entry point
- Responsive navigation behavior

Primary learner navigation:

1. Command Center
2. Roadmap
3. Challenges
4. Checkpoints
5. Progress & Evidence
6. Community
7. Resources
8. Profile / Settings

For the first production pass, only the core flow is required.

## 4. Route Contract

Use existing route conventions where possible.

Expected learner surfaces:

- /app

  - Command Center

- /app/roadmap

  - Piscine Roadmap

- /app/challenges/[nodeId]

  - Challenge workspace

- /app/checkpoints/[checkpointId]

  - Checkpoint gate / active attempt

- /app/checkpoints/[checkpointId]/result

  - Checkpoint result

- /app/evidence

  - Progress & Evidence
    Do not invent parallel routes if accepted routes already exist.

## 5. Component Decomposition

Shared

- AppShell
- Sidebar
- TopBar
- SearchBox
- UserMenu
- StatusBadge
- ProgressBar
- ProgressRing
- EmptyState
- LoadingState
- SystemErrorState

Do not populate a global shared packages/ui library merely for this milestone unless reuse is already proven and accepted.

Prefer page-local/components-first organization.

## 6. Command Center

Purpose
Answer immediately:

- Where am I?
- What should I do next?
- Am I on track?
- What just changed?

Required sections

- Greeting / Piscine context
- Overall Piscine progress
- Challenges completed
- Checkpoints passed
- Active projects / current work
- Current streak or momentum if real data exists
- Current Challenge
- Upcoming Checkpoint
- Roadmap Preview
- Recent Activity
- Active Submissions
- Evidence Snapshot

Do not show invented metrics that the backend cannot support.

If a metric is not backed by real accepted data, remove it rather than fabricate it.

## 7. Roadmap

Approved visual direction
Roadmap V4 is the approved direction.

Structure:

- left summary panel

  - overall progress
  - program structure
  - milestones

- center progression spine

  - vertically ordered modules
  - branch cards for challenge/project work
  - checkpoint gate cards
  - completed/current/locked states

- right detail panel

  - selected module
  - overview
  - lessons/challenges/project summary
  - progress
  - next action
    State mapping
    Use real progression state:

- mastered → green
- current / started → teal/cyan
- available → cyan/open
- locked → muted
- checkpoint → gold/red gate treatment depending state

The browser must not calculate unlock eligibility.

Roadmap receives already-authorized progression state from trusted server reads.

## 8. Challenge Workspace

Purpose
Give the learner one focused place to:

- understand the challenge
- inspect requirements
- submit code
- see safe attempt history
- understand current progression context

Required layout

- challenge hero / context
- tabs:

  - Overview
  - Tasks
  - Submissions
  - Resources
  - Discussion

- submission panel
- roadmap context panel

Submission UX states
Support:

- ready
- uploading
- accepted
- queued
- running
- passed
- failed
- compile_error
- runtime_error
- timeout
- system_error

Never collapse system_error into learner failure.

Safe feedback only.

No hidden Judge details.

## 9. Checkpoint UX

Foundation 006 is authoritative.
Policy
Exactly 4 checkpoint-specific tasks.

Duration:

- 90 minutes
- trusted server/PostgreSQL time
- browser timer is display-only

Pass rule:

- 3 of 4 tasks passed

Per task:

- up to 3 learner-result submissions
- system_error does not consume learner quota

Early finish:

- irreversible after confirmation
- closes new submission intake
- accepted pre-finish work continues evaluation

Deadline:

- no new submissions after trusted deadline
- accepted pre-deadline work still counts even if Judge finishes later

Required visual distinctions
Task states:

- passed
- active
- open
- learner failure
- system retry
- locked/closed

Checkpoint states:

- eligible
- active
- evaluating
- passed
- failed
- infrastructure-blocked

Do not invent score percentages.

Use exact task-count semantics.

## 10. Checkpoint Result

The result page must visually separate:
PASS

- checkpoint permanently passed
- checkpoint node mastered
- dependent progression may unlock

LEARNER FAIL

- checkpoint remains unmastered
- no gated unlock
- normal retake eligibility is determined by trusted policy
- 24-hour cooldown after failed normal attempt
- maximum 2 normal attempts

INFRASTRUCTURE BLOCKED

- not learner failure
- no false fail
- may require authorized replacement attempt
- infrastructure replacement does not consume normal retake allowance

The browser must not decide which result state applies.

## 11. Evidence / Progress

Purpose:

Show durable truth, not cosmetic gamification.

Must distinguish:

- mastery proof
- learner failure
- checkpoint result
- unlock event
- system_error / infrastructure event

Sections:

- evidence timeline
- current mastery
- checkpoint history
- audit chain

Avoid numeric skill scoring unless a future accepted product policy adds it.

## 12. Backend Mapping

Foundations 001–002
Use existing:

- auth
- app user resolution
- membership
- cohort
- curriculum version
- progression projection
- authorization

Foundations 003–004
Use existing:

- immutable evaluation snapshot
- submission artifact
- Judge job
- Runner execution
- safe verdict
- job/result history

Foundation 005
Use existing:

- exactly-once result application
- mastery
- unlocks
- activity/evidence events
- reconciliation

Foundation 006
Use existing:

- checkpoint attempt
- authoritative deadline
- task quota
- checkpoint aggregation
- retake policy
- infrastructure-blocked semantics
- checkpoint mastery
- gated progression

Do not duplicate business logic in React.

## 13. Browser Responsibility

The browser may:

- request authorized reads
- start eligible actions through server routes
- render status
- display countdown
- upload learner artifacts
- refresh/poll display state

The browser must not decide:

- verdict
- mastery
- node unlock
- checkpoint eligibility
- checkpoint deadline
- checkpoint score
- checkpoint pass/fail
- retake eligibility
- learner quota consumption

## 14. Motion

Only add motion after semantic state is connected.

Recommended motion:

- current roadmap node pulse
- path transition on newly unlocked module
- subtle page enter transitions
- status badge transition
- result success/failure/infrastructure state transition
- submission state change animation

Avoid:

- excessive parallax
- large floating gradients
- decorative motion that competes with learning content

## 15. Responsive Rules

Desktop is primary for the current Piscine experience.

Tablet:

- collapse sidebar
- move roadmap detail panel below central content
- retain full semantic hierarchy

Mobile:

- use condensed navigation
- roadmap should prefer structured list fallback over forcing a tiny full map
- keep submission/checkpoint controls usable
- never hide critical timer/result/attempt state

## 16. Accessibility

Required:

- keyboard navigation
- visible focus states
- semantic headings
- accessible labels for icons
- status not communicated by color alone
- reduced-motion support
- accessible file input
- timer screen-reader label
- checkpoint confirmation dialog with focus trap

## 17. Production Implementation Order

1. App Shell
2. Command Center
3. Roadmap
4. Challenge
5. Checkpoint
6. Result
7. Evidence
8. Responsive pass
9. Accessibility pass
10. Motion
11. Screenshot comparison / polish

Do not attempt all pages in one unreviewable rewrite.

## 18. Definition of Done

A page is complete only when:

- visual hierarchy matches the approved prototype
- production state comes from trusted server reads
- no browser-only business decision exists
- responsive behavior works
- loading/empty/error states exist
- learner/system failures are visually distinct
- no hidden Judge data is exposed
- tests pass
- screenshots are reviewed

## 19. Hard Constraints

Do not:

- redesign the approved V5 core flow
- replace the roadmap with the old map-heavy design
- introduce new product metrics without backend support
- compute trusted progression in the client
- expose hidden Judge details
- merge system_error into learner failure
- change checkpoint policy
- approve/publish the evaluation catalog as part of UI work
- add Redis/microservices/browser IDE
- create new production business logic in React

## 20. Codex Implementation Prompt

Foundation 006 is approved.

Implement the production Piscine UI using the approved Design Freeze v1.

Read first:

- README.md
- docs/FOUNDATION_001_REPORT.md
- docs/FOUNDATION_002A_REPORT.md
- docs/FOUNDATION_002B_REPORT.md
- docs/FOUNDATION_003_REPORT.md
- docs/FOUNDATION_004_REPORT.md
- docs/FOUNDATION_005_REPORT.md
- docs/FOUNDATION_006_REPORT.md
- the accepted product/architecture docs and ADRs
- this design handoff document
- the approved V5 prototype files

Treat the V5 prototype as a visual and UX contract, not production code.

Rebuild the UI natively in the existing Next.js application.

Do not copy prototype business logic into production.

Bind every trusted state to existing server-authorized backend reads/actions.

Start with:

1. App Shell
2. Command Center
3. Roadmap

Stop after these three screens and return:

A. implementation summary
B. component tree
C. route mapping
D. server data dependencies
E. authorization boundaries
F. visual deviations from prototype
G. test coverage
H. screenshots / verification notes
I. resulting tree
J. suggested commit message

Do not stage or commit files.

Do not modify accepted backend semantics unless a concrete contradiction is found.

Do not continue into Challenge/Checkpoint until the first three production screens are reviewed.
