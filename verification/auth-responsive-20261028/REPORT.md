# Auth responsive browser verification — 28 October 2026

## Cause and running-preview correction

The new user screenshot was inspected at approximately 1280×631. The user's existing Chrome tab at `http://127.0.0.1:3118/login` was still serving a portrait-only picture, old `/auth-review/ui.css` and `object-fit: contain`; the running fixture lacked square-image routes. Thus committing source alone had not updated that review surface. The actual component fixture was rebuilt, its exact asset allowlist updated, auth bundles marked no-store, and only verified old fixture PID 23617 was stopped. The replacement fixture PID 49451 remains bound to 127.0.0.1:3118, with no real Auth/DB/Runner.

The reproduced panel now uses the approved square WebP with cover and no letterboxing. Real responsive checks also exposed two coverage gaps: 1024×768 can safely use the original portrait cover; 1702×640 can use the square within its verified upper ratio. The source media/container ranges were refined without editing the artwork or clipping the protected metal/glass bounds.

## Actual browser evidence

**34 settled cases**: login and signup across 17 width/height combinations, including 320px mobile, 761/768px intermediates, 1024×768, the reported 1280×631, 1440×900, 1702×640, 1920×640 and 2560×1440. All had zero horizontal/vertical document overflow and no missing visible images. **16 keyboard focus checks** at 320×568 and 390×844 kept the focused control inside the visible viewport with no document scroll. Short signup views legitimately use accessible inner-panel scrolling; this is not a claim that every field fits without scrolling at every height.

Remaining letterboxing on both pages: **768×1024, 761×760, 1280×480, 1920×640**. Full bleed there cannot be promised while preserving the current complete sculpture. The parent has asked about extending the existing form-only layout to these ranges; that choice is pending and was not implemented. No invented art or arbitrary metal cropping was used.

The initial measurement pass observed unsettled resize timing; a corrected settled pass supplies the final `browser-matrix.json`. Signup measurement was also corrected to select only the decorative main-level aside, excluding its invitation notice. Invalid/intermediate captures are retained in the native evidence directory, not counted as final passes.

## Browser route and stop boundary

The earlier shell-launched headless Chrome `ERR_NETWORK_ACCESS_DENIED` was not retried or bypassed, and its cause is still unconfirmed. The supported browser extension could read the user's already-open Chrome tab (browser 3, tab 906734722) without navigation. Responsive overrides, reload after the fixture refresh and normal visible fixture links were used there under the explicit testing request. No new browser, alternate host, proxy, browser flag or security change was introduced.

Before any zoom action, selecting the native Chrome window caused Computer Use to stop because it could not determine the current browser URL with sufficient confidence to enforce policy. All browser actions then stopped. **Actual zoom and viewport reset are unverified**; the last explicit override was 390×844. Do not retry that stopped UI action in this turn or claim the old headless restriction was lifted.

## Source checks and retained work

**1,075 source tests, typecheck, lint, formatting and production build passed.** The four original unrelated dirty-file hashes are unchanged. This remains fixture/browser evidence, not authenticated-provider integration. Native screenshots and logs live at `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\auth-responsive-20261028`; Library delivery is a separate pending non-browser step.

Provisioning-harness preparation was paused for this priority bug. Registered SQL 0006 still requires 5,400 seconds; no ten-minute exam, excluded migration, runtime stack or credentials were introduced. Q2 content is also untouched pending the exact latest reviewed artifact.
