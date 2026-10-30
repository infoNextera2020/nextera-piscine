# Automatic artwork motion correction — 30 October 2026

The owner explicitly superseded the prior no-autoplay direction: visible artwork should loop automatically, while the challenge figure also responds to the pointer. Home remains the same approved rendered video/model, not interactive 3D. The previous screenshots and no-autoplay evidence are historical.

## Cause and source correction

Home previously required explicit Play intent; GreetingCard required a fine hover pointer, and its isolated host deliberately never called the supplied tour. That explains both idle stillness and suppression on devices/browser contexts reporting no fine pointer. The first integration also put the bridge and supplied figure in one classic-script scope with a conflicting global mount function. That could throw before the runtime rendered, leaving the static fallback visible. The bridge now uses a distinct reset lifecycle. Full-engine tests include a negative control that recreates this former collision. These source causes are fixed without changing Home layout, content, video/model, figure geometry or kernel.

Home mounts the muted inline looping video automatically after visibility/accessibility eligibility. Mobile width is no longer a blocker. The existing Play/Pause/Retry control remains; a deliberate pause persists across visibility changes. Offscreen/background and reduced-motion states are static; data-saving still suppresses the video. Browser autoplay refusal uses the existing static/error/retry path.

GreetingCard mounts the original engine on visible non-reduced-motion devices, independent of pointer capability. Its supplied tour starts automatically, yields to pointer movement, and resumes after pointer leave. It stops/destroys on hide and page exit, and resets to rest under reduced motion. An accessible pause/resume control sits outside the geometry and outside aria-hidden content. No preview toolbar or author test/build script was imported.

## Background and geometry boundary

The challenge page is intentionally black in both OS color schemes. The figure frame/control use the existing --focus-bg token; original black opaque SVG occlusion faces remain unchanged, avoiding lines showing through hidden surfaces. The live SVG also paints an opaque plate behind the full drawing, so the static rest fallback cannot show ghost lines through moving empty areas.

The approved Home animation has an opaque studio background. It cannot be made literally transparent by changing a background CSS color. The source correction fits its media canvas to the original 600x660 aspect inside the available slot, then fades only the outside background margins into the existing page. The unchanged stationary base is inside the opaque centre. No new render, model modification, geometry stretch, or fake 3D pointer transform was introduced. Actual seam appearance and clearance through the whole loop still need browser review. The separate light artwork comparison remains unchanged; this is not a new light animation.

## Evidence and limitations

Deterministic source tests execute the actual supplied kernel, figure and host bridge with a minimal DOM/clock. They observe SVG path geometry changing over time with no pointer; simulated pointer takeover/hold/leave; automatic resumption; hidden shutdown; and reduced-motion static rest. Only stylesheet injection is stubbed. These are meaningful engine tests, not real browser, hardware pointer, autoplay policy, background-seam or responsive evidence.

Current CUA access is stopped because the Windows browser URL could not be established confidently. No blocked browser action was repeated or bypassed. The smallest supported next user action is to foreground the intended localhost preview tab and confirm readiness; reconnect the existing extension only if it reports disconnection. A subsequent permitted turn must first verify URL/context. The viewport override mismatch is a separate unresolved tooling issue; cropped captures are not mobile QA.

The existing fixture preview can be refreshed in place on 127.0.0.1:3118. The review URLs stay:

- /app?fixture=week1-review
- /app/cohorts/ui-verification-cohort/challenges/greeting-card?fixture=week1-review&view=focused

No new browser screenshots are claimed. Library image libfile_aaa433a30f948191b7cfb4f1b7d68bb9 documents the earlier static version, not this motion correction. Live Auth/DB/Runner remain disabled and all completed SQL rehearsals remain closed.

## Auth preparation checkpoint

Before the artwork priority change, Auth work was read-only inspection; no Auth source edit or runtime action was made. Existing managed-Auth/ledger/admission assembly exists, but a bounded inspection HTTP endpoint, fragment consumption/removal and browser activation orchestration still need source work. Existing /signup, issue and activation routes stay unavailable.

The reviewed UI's editable full-name field conflicts with the service's immutable accepted name. Live registration needs an explicit fixed-name versus authorized name-change decision. Invitation lifetime/rate settings, caller identity transport, password/provider email-confirmation behavior and fresh isolated credential/resource scope also remain explicit setup gates. No implicit second admin approval is needed; issuance is acceptance, email/cohort remain ledger-bound, and account recovery never resets a password.

## Completed source checks

73 Vitest files / 1,189 source tests passed. Full typecheck, build, ESLint and whole-tree formatting passed; final full tests and affected test-type/lint/format checks passed after the final asset and negative-control changes. No browser pass is implied. All four original unrelated dirty file hashes match. The fixture bundle was refreshed in place, with the same verified loopback PID 90255 and no listener restart.
