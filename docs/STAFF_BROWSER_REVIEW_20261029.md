# Staff browser review — 29 October 2026

The existing fixture listener (PID 52589, `127.0.0.1:3118`) was verified before use and left running without restart. Its bundle was refreshed with actual `StaffShell`, `MentorOverview`, `AdminOverview`, `StaffRaidQueue` and `StaffRaidReviewDetail` components. Only queue/detail data and transport were simulated. No Auth, database, Storage, Runner, role grant or real review decision was enabled. Production route guards remain covered by source tests rather than this fixture.

The supported connected Chrome extension opened a new localhost tab after inventory verified the target. No prior denied headless route, browser security setting or uncertain native zoom action was retried. Temporary viewport overrides were reset afterward.

## Checked

Mentor overview, exact Raid detail and admin overview were inspected at 1440×900, 768×1024, 390×844 and 320×740. All twelve cases have document scroll width equal to client width; loaded artwork and settled header bounds were checked. Fourteen local JPEG captures include desktop/mobile screens, narrow feedback controls and access removal. The capture manifest records dimensions, bytes and SHA256. The first full-page capture timed out; regular viewport captures succeeded. Early unsettled image captures were replaced after network-idle and image-load confirmation.

Keyboard skip-link activation focused the main workspace. A narrow form's Request changes button had a visible focus outline and remained within the viewport. Expanded metadata, team and criteria disclosures at 320 pixels produced no horizontal overflow. Review buttons measured at least 45 CSS pixels high in the desktop measurement; this is not a complete accessibility audit.

Observed states include uncertain review retry with feedback preserved; repeated click showing disabled busy controls; failed refresh preserving feedback while effective decision controls and artifact link remain unavailable; access denial removing protected history, fields and links; admin preview without approval/download controls; distinct empty versus unavailable queues; and working queue/detail back-forward navigation. No fixture action was presented as a persisted approval. Console warn/error capture returned no entries. Request-count instrumentation was unavailable, so idempotency proof remains source-test evidence.

## Review URLs

- Mentor: `http://127.0.0.1:3118/operator?state=raid-mentor`
- Raid detail: `http://127.0.0.1:3118/operator/raids?team=33333333-3333-4333-8333-333333333333&state=raid-mentor`
- Admin: `http://127.0.0.1:3118/operator?state=raid-owner`

All three fixture URLs returned HTTP 200. Production staff pages are not authenticated by this preview. The fixture omits actual admin assignment submission and cannot prove DB/RLS, provider sessions, downloads or complete Sunday readiness. Zoom, screen readers and reduced-motion emulation were not changed/tested.

## Delivery boundary

Screenshots are saved under `C:/Users/lap/Documents/Codex/2026-10-24/task/verification/staff-browser-20261029/`. Automatic approval review rejected adding the Library upload helper because authority to upload these staff screenshots to the private Library was not explicit. No helper file or upload was created; no alternative route was attempted. Local delivery is complete. A specific approval to save the selected synthetic screenshots to the user's private ChatGPT Library is needed before that delivery action can resume.
