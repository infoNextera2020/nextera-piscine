# Automatic artwork motion correction — 30 October 2026

The owner explicitly superseded the prior no-autoplay direction: visible artwork should loop automatically, while the challenge figure also responds to the pointer. Home remains the same approved rendered video/model, not interactive 3D. The previous screenshots and no-autoplay evidence are historical.

## Cause and source correction

Home previously required explicit Play intent; GreetingCard required a fine hover pointer, and its isolated host deliberately never called the supplied tour. That explains both idle stillness and suppression on devices/browser contexts reporting no fine pointer. The first integration also put the bridge and supplied figure in one classic-script scope with a conflicting global mount function. That could throw before the runtime rendered, leaving the static fallback visible. The bridge now uses a distinct reset lifecycle. Full-engine tests include a negative control that recreates this former collision. These source causes are fixed without changing Home layout, content, video/model, figure geometry or kernel.

Home mounts the muted inline looping video automatically after visibility/accessibility eligibility. Mobile width is no longer a blocker. The existing Play/Pause/Retry control remains; a deliberate pause persists across visibility changes. Offscreen/background and reduced-motion states are static; data-saving still suppresses the video. Browser autoplay refusal uses the existing static/error/retry path.

GreetingCard mounts the original engine on visible non-reduced-motion devices, independent of pointer capability. Its supplied tour starts automatically, yields to pointer movement, and resumes after pointer leave. It stops/destroys on hide and page exit, and resets to rest under reduced motion. An accessible pause/resume control sits outside the geometry and outside aria-hidden content. No preview toolbar or author test/build script was imported.

## Background and geometry boundary

The challenge page is intentionally black in both OS color schemes. The figure frame/control use the existing --focus-bg token; original black opaque SVG occlusion faces remain unchanged, avoiding lines showing through hidden surfaces. The live SVG also paints an opaque plate behind the full drawing, so the static rest fallback cannot show ghost lines through moving empty areas.

The approved Home animation has an opaque studio background. It cannot be made literally transparent by changing a background CSS color. The source correction fits its media canvas to the original 600x660 aspect inside the available slot, then fades only the outside background margins into the existing page. The unchanged stationary base is inside the opaque centre. No new render, model modification, geometry stretch, or fake 3D pointer transform was introduced. Fresh Chrome review confirmed the black challenge background has no separate panel. Home margins now blend into the page; its opaque studio illumination remains visible by design. The stationary base was not clipped in the reviewed captures. This is not a claim of transparent video or all-device visual parity. The separate light artwork comparison remains unchanged; this is not a new light animation.

## Evidence and limitations

Deterministic source tests execute the actual supplied kernel, figure and host bridge with a minimal DOM/clock. They observe SVG path geometry changing over time with no pointer; simulated pointer takeover/hold/leave; automatic resumption; hidden shutdown; and reduced-motion static rest. Only stylesheet injection is stubbed. These are meaningful engine tests, not real browser, hardware pointer, autoplay policy, background-seam or responsive evidence.

At the initial source-only checkpoint, CUA access was stopped because the Windows browser URL could not be established confidently. No blocked browser action was repeated or bypassed. The supported recovery was for the user to foreground the intended localhost preview tab and confirm readiness; reconnect the existing extension only if it reports disconnection. The owner subsequently confirmed readiness, and the exact Chrome localhost URL was reacquired through the existing extension. No security settings, browser routes or iframe protections were weakened. The task tab was selected normally when another tab was foreground. Fresh viewport overrides were verified against actual innerWidth and media queries, resolving the earlier cropped-capture mismatch.

The existing fixture preview can be refreshed in place on 127.0.0.1:3118. The review URLs stay:

- /app?fixture=week1-review
- /app/cohorts/ui-verification-cohort/challenges/greeting-card?fixture=week1-review&view=focused

The initial source checkpoint did not claim new browser screenshots; the follow-up evidence below supersedes that verification gap. Library image libfile_aaa433a30f948191b7cfb4f1b7d68bb9 documents the earlier static version, not this motion correction. Live Auth/DB/Runner remain disabled and all completed SQL rehearsals remain closed.

## Auth preparation checkpoint

Before the artwork priority change, Auth work was read-only inspection; no Auth source edit or runtime action was made. Existing managed-Auth/ledger/admission assembly exists, but a bounded inspection HTTP endpoint, fragment consumption/removal and browser activation orchestration still need source work. Existing /signup, issue and activation routes stay unavailable.

The reviewed UI's editable full-name field conflicts with the service's immutable accepted name. Live registration needs an explicit fixed-name versus authorized name-change decision. Invitation lifetime/rate settings, caller identity transport, password/provider email-confirmation behavior and fresh isolated credential/resource scope also remain explicit setup gates. No implicit second admin approval is needed; issuance is acceptance, email/cohort remain ledger-bound, and account recovery never resets a password.

## Completed source checks

73 Vitest files / 1,189 source tests passed. Full typecheck, build, ESLint and whole-tree formatting passed; final full tests and affected test-type/lint/format checks passed after the final asset and negative-control changes. No browser pass is implied. All four original unrelated dirty file hashes match. The fixture bundle was refreshed in place, with the same verified loopback PID 90255 and no listener restart.

## Actual Chrome follow-up

The live iframe revealed another concrete defect: the host omitted the original engine's `data-hairline` styling hook. SVG paths existed and changed but inherited `stroke: none`, making the moving drawing invisible. The hook is restored before stylesheet injection; CSP hashes and an actual-engine regression assertion were updated. Geometry and the supplied engine remain unchanged.

Fixture browser evidence is saved in `browser-evidence.json`. Home's real five-second video advanced through seven samples and wrapped from 3.8869 seconds to 0.0443 seconds while muted, playing and looped. At 320 pixels it started when scrolled into view. Keyboard Space pauses and Enter resumes both artwork controls. GreetingCard pause removes the live iframe, resume restores it, scrolling offscreen removes it, and returning restores it. Its focused control has a visible solid outline.

Native physical pointer checks confirmed a held pose, changed geometry at another pointer position, then five distinct automatic geometries after leaving the drawing. This is actual pointer evidence, distinct from synthetic event or engine-unit tests.

Both real component pages were captured at 1440x900, 768x1024, 390x844 and 320x740. Actual CSS viewport widths matched the requested widths; document scrollWidth equaled clientWidth in all eight cases. Vertical reading scroll is expected. Full-page desktop/tablet/mobile captures were visually inspected, including the 320-pixel challenge and Home. Viewport overrides were reset. The preview remains loopback-only and fixture-labelled; GreetingCard grading remains unavailable.

No first-party console error was observed. An installed browser extension emitted localStorage errors inside the deliberately sandboxed iframe. The iframe was not granted same-origin access to suppress extension diagnostics.

Remaining browser coverage: reduced-motion emulation is not exposed by the connected browser's advertised capabilities, and native DevTools shortcuts had no visible effect. No OS preference was changed. Reduced-motion and hidden-document behavior have actual-engine/source regression coverage; OS-light preference and background-tab suspension are not claimed as live-browser passes. The approved focused challenge intentionally stays black in both color schemes. The opaque Home video still has its approved studio lighting, not a transparent background.

Auth work remains at the separate read-only checkpoint above. The requested skill-inspired redesign is queued after this correction; it has not replaced the approved layout.

After the live styling-hook correction, all 73 test files / 1,189 source tests passed again, together with full typecheck, build, lint and whole-tree formatting. The four unrelated dirty originals retained their exact hashes. A supplementary 320-pixel temporal frame-locator read timed out despite the drawing being visibly rendered; it is not claimed as additional mobile time-series evidence. Desktop physical motion and eight responsive layouts are verified separately.
