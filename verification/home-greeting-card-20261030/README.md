# Actual Home and GreetingCard visual review — 30 October 2026

Historical no-autoplay snapshot: the owner subsequently approved automatic looping. See verification/artwork-motion-20261030 for the source correction and current verification limits. The original observations below are retained unchanged.

This is an application-component fixture, not a live learner trial. No Auth, database, Runner, publication or progress changes were enabled.

## Implemented

- The fixture uses the same `CommandCenter` option 1 presentation and approved stationary-base `HomeMotionArtwork` as the application Home route. Its current task is a synthetic GreetingCard node; no published curriculum was replaced.
- The real authorized challenge route defaults the canonical `greeting-card` challenge to the focused presentation (other challenge opt-in behavior remains). The focused `Challenge` controller renders the approved Quest 2 F1 brief and supplied card/heart figure for the exact `greeting-card` key. Other challenges and the Journey geometry are unchanged. Intake remains unavailable until real access and a runnable published evaluation exist.
- Figure geometry and the reviewed kernel retain their supplied bytes. The isolated host contains no preview toolbar, labels, autoplay/tour call or author build/check scripts. A CSP denies network connections; the iframe has only `allow-scripts`.
- A 400×320 static SVG is rendered from the original rest geometry, with opaque black occlusion faces. Fine-pointer interaction mounts only while visible, without reduced motion, and while the document is visible. Coarse-pointer, reduced-motion, hidden/offscreen and JavaScript-free states retain the static figure. The host destroys and replaces previous SVG roots when resetting.

## Verified browser evidence

Chrome extension browser accessed the approved loopback preview through the documented CUA APIs. Both page routes and the SVG/host returned HTTP 200. At actual desktop width 1440, Home's action navigated to the focused GreetingCard controller; the approved output text, static artwork, disclosures, read-only state and no file input were present. The document had no horizontal overflow. The supplied rest figure was visually inspected; the Home capture was saved as a JPEG. No console warnings/errors were returned before the browser interruption. No video source elements were mounted before play was requested.

The browser reported `hover: hover and pointer: fine = false`, so interactive pointer motion was not verified. A requested 390px viewport override changed screenshot dimensions while page metrics stayed 1440/1280px; those cropped captures are **not mobile QA**. A documented reset restored normal sizing. Computer Use then stopped because it could not confidently determine the Windows browser URL. No further browser actions, security changes, alternate automation route or screenshot captures were attempted. Mobile 768/390/320, keyboard, reduced-motion emulation and live pointer behavior remain unverified.

## Review URLs and process

- Home: `http://127.0.0.1:3118/app?fixture=week1-review`
- GreetingCard: `http://127.0.0.1:3118/app/cohorts/ui-verification-cohort/challenges/greeting-card?fixture=week1-review&view=focused`
- Index: `http://127.0.0.1:3118/review`

The existing task-owned fixture listener was verified before its bounded restart. Last verified PID: 90255, loopback 127.0.0.1:3118 only. To stop later, first recheck the PID command/cwd and listener; send SIGTERM only if it still matches `implementation/latest-piscine-review.cjs`. Do not blindly kill a reused PID.

## Delivery boundary

`artifacts/greetingcard-20261030/screenshots/home-desktop.jpg` on the Windows task workspace is the verified saved capture (97,855 bytes; SHA256 `89daa93cb79cd2eaffd73c6c535c338931455f338eef7387d13c5d2a7fa70d53`). GreetingCard was viewed in the browser, but its full-page save timed out, so no saved GreetingCard screenshot is claimed.

The unchanged official batch helper stopped at local authentication preflight in WSL, before a Library write, because Codex auth was not available there. No credentials were copied or provisioned. The documented single-file native host API subsequently saved the same Linux screenshot through its Windows UNC path; the official metadata helper successfully applied identity to that same native file. Confirmed Library ID: `libfile_aaa433a30f948191b7cfb4f1b7d68bb9`, filename `01-coding-home-greeting-card-desktop.jpg`, version 0, 97,855 bytes. No duplicate upload is required.

## Remaining Sunday gates

The invitation SQL rehearsal separately passed 14/14 genuine PostgreSQL assertions and was shut down. That evidence does not prove live Auth activation, browser invitations, a published GreetingCard grader, official Checkpoint evaluation or the complete Week 1 learner journey. Rehearsal authority is closed and was not reused here.

## Source checks

- 72 Vitest files / 1,186 source tests passed on the final code.
- Full typecheck, ESLint, whole-tree format check and production build passed; after the final route/lifecycle changes, the full tests, build, ESLint, test TypeScript and affected-file format checks also passed.
- All four pre-existing unrelated dirty file hashes were rechecked unchanged.
- Browser checks remain partial as documented above; no live Auth/DB/Runner test was performed for this artwork slice.
