# Raid and login/access presentation integration

This local source slice follows the approved Raid learner, mentor, owner and login/access images in the frozen 26 October package. The actual desktop/mobile reference pixels were inspected before editing. No new design direction, account capability or backend policy was introduced.

## Existing behavior retained

The previous Raid source already separated automated PASS from mentor approval, preserved frozen member history, exposed owner holds, hid learner review actions, and used server-owned can_submit/can_review flags. Existing provisioned email/password authentication, generic credential/logout errors, local sign-out scope, role and cohort guards remain intact. Home no-cohort guidance already reflects actual enrollment; it was left unchanged.

Home B, full-heart Journey and accepted Challenge/Hairline visuals remain unchanged for learners. Quests and Raids still use external editors and raw file uploads. Only nonlearner shared navigation gains the existing Team reviews destination. Its page and API authorization guards remain mandatory.

## Changed presentation and recovery

- Raid learner composition: published brief/external-editor guidance, current team, shared immutable history and revision upload. Mobile retains brief/team/history/upload order. Current assignment is explicitly distinct from a revision's frozen members.
- Latest revision comes from the supplied ordinal; older accepted revisions remain in an accessible disclosure with original roster, digest, source identity and feedback. Nothing is reclassified as mastery from automated PASS.
- Assigned mentors get two explicit review actions on a passing, awaiting-review revision. Request changes is the first/default submit action. An interrupted read disables controls/downloads while retaining the feedback form. Access denial hides protected brief, records and controls; recovery retries the existing authorized read.
- Review feedback requires a valid review receipt. Shared completion wording requires a valid outcome receipt; a review-only receipt does not claim a completed Raid or falsely report a different decision.
- Owner assignment retains exactly three existing learner IDs plus current cohort/node/mentor fields. No people search, account creation or role grant was added. The queue keeps configuration-unavailable, no-assignment and supplied records separate; an assigned mentor label is not invented readiness.
- Login follows the approved black/white/emerald composition with the existing official logo and Hairline Create arrow. It retains native username/current-password autocomplete and validation. Pending sign-in disables repeated form entry and announces confirmation, never success before Auth.
- Access denial and service failure remain separate. Unknown query values are not reflected. Login/workspace error boundaries offer retry without showing protected task data or backend details.

All icons reuse previously validated original Hairline Create rest geometry. The official brand asset is untouched. No additional library or artwork dependency was installed.

## Verification boundaries

Tests are source/injected/static-render verification. Mocked Auth proves local call/redirect wiring only; it is not a real authenticated sign-in test. No SQL0012 test, database, migration, role, account, credential, service, executor or browser listener was started. The old fixture preview stays closed. Live co-resident Raid artifact download, mentor approval and assignment remain separately gated by existing readiness/access setup.

## Exact later browser-verification scope

A separate approval would permit one localhost-only in-memory fixture harness on 127.0.0.1:3118, with actual components and clearly labeled synthetic states, no Auth/DB/Runner. Check at 1440/768/390/320: login form/pending/generic-error layout, access-denied versus service-retry presentation, learner and mentor Raid states, current/frozen team differences, earlier revisions, owner fields, role navigation, keyboard focus and field/feedback retention on simulated failed reads. No fixture action may claim real sign-in, assignment, review or completion. Stop only that harness after user review and verify the listener closes. No listener is authorized or started by this report.

Real browser/Auth/Storage integration would require a distinct approved live setup. This source slice does not authorize credentials, retained database mutations or SQL0012 execution.

## Completed source checks

All 641 tests in 46 files passed. Typecheck, lint, formatting and production build passed. Existing auth actions and role/identity guards are unchanged. Mentor-action regressions assert the actual approval control after the button-label change, rather than an obsolete label. Browser, live Auth and Raid Storage verification remain not run.
