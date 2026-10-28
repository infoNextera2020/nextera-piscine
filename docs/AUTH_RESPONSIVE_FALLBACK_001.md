# Approved auth responsive fallback 001

The full-page login/signup composition now falls back to a single form panel when neither approved artwork can fill its actual available panel safely. This follows the user-approved response to the remaining tall/narrow and short/wide letterboxes. Artwork remains decorative and keeps its original proportions and X01-only branding.

The CSS starts with a full-width form and hidden artwork. It enables two columns only when both the viewport and actual page container fit the inspected portrait or square range. The portrait page range is 1.21 through 1.609; square is 1.61 through 2.659375, with minimum width 761 CSS pixels. Existing image-container crop bounds still apply. Unsupported container queries retain the form-only fallback. Root size is based on the visual viewport hook, so a shorter keyboard viewport does not silently expand a crop outside its approved bounds.

Former incompatible examples 768x1024, 761x760, 1280x480 and 1920x640 select form-only by these source rules; 1280x631 remains in the square-art range. This is source analysis, not a new browser pass. The form panel retains accessible internal overflow rather than clipping controls when short height, errors, keyboard or zoom need it. Normal document overflow and keyboard/focus/zoom still need the resumed browser matrix.

## Verification and limits

The resumed full source run passed 1102 tests, typecheck, ESLint, Prettier and production build. The first default-worker test run had 1099 passes and three file-heavy test timeouts at the unchanged five-second limit; the full rerun with two workers passed all 1102 without changing timeouts or assertions.

The existing loopback-only fixture was rebuilt from the actual auth components and current assets. Its login/signup HTML, CSS and square asset returned HTTP 200. It uses injected sample invitation/auth transport, not managed Auth or a real database. No credentials, invitations or backend features were enabled.

Actual browser verification of this latest fallback is NOT complete: supported CUA documentation recovery timed out, followed by inventory timing out and resetting its session. No new screenshot, focus/zoom action or navigation was performed in this resume. This is a transport timeout, not evidence of a working matrix. The earlier denied headless route and native URL-confidence stop were not retried or bypassed. Reconnect the normal browser extension/session and establish the current URL before resuming the matrix.

Prior screenshots and 34-case browser evidence belong to commit 54edb829 before this fallback. They must not be presented as proof of the new form-only behavior.
