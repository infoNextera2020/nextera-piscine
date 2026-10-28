# Auth viewport and 01 coding branding

The user approved replacing portal-facing NextEra branding with `01 coding`, using only the supplied X01 mark in visible headers and at the existing heart START position. Internal package identifiers, storage keys and authored immutable curriculum examples are preserved. The original SVG and the official CODING-text-removed derivative are retained with provenance under `apps/web/public/branding/01-coding/`. No logo path, gradient or geometry was recreated; removing the supplied live text removes its font dependency. The mark wrapper is transparent.

Login and invitation-only signup use a viewport-bound auth surface. Desktop retains the approved wrapped-metal illustration; mobile prioritizes form controls. Normal tested viewports have neither horizontal nor vertical page scrolling. On short viewports and simulated keyboard resizing, only the account panel can scroll, so focused fields and actions remain reachable. Page-level overflow hiding is not used. The VisualViewport listener is scoped to the auth surface and cleaned up on unmount. Pinch signals are not double-scaled.

Invitation policy, auth calls, password policy and activation semantics are unchanged. The preview's valid/expired/invalid/used/existing/unavailable states are labeled sample UI and create no account or invitation. Existing production invitation capabilities remain fail-closed when unconfigured.

Chrome fixture verification passed 135 assertions across 64 combinations of eight auth states and eight viewports, including 320px width, short landscape, field focus/validation, repeated clicks, back navigation and fixed invite email. No page errors or failed asset responses occurred. Keyboard and pinch VisualViewport signals were simulated separately; physical mobile keyboards, iOS/Android and native browser zoom remain unverified.

Heart placement was checked at 1440/768/390/320: loaded SVG hash matches the supplied mark, map fits the viewport without page scroll, node keyboard access works, and the route polyline is identical across sizes. The existing logo box and all heart/node geometry are retained. The logo has a square SVG viewBox but is contained within the original wide START slot; its natural CSS-image size is not the PNG's 1080px raster size.

Evidence: selected-executor `verification/auth-viewport-20261028/`, `verification/branding-placement-20261028/` and `verification/ui-integration-20261028/`. Real auth, DB and Runner testing are not claimed by these UI checks. The previously authorized real first slice and its completed cleanup remain documented independently in `SUNDAY_FIRST_SLICE_2026_10_28.md`.

Manual review: `/review/auth/login`, `/review/auth/signup?state=valid` (also expired, invalid, used, existing, unavailable), and `/app/cohorts/ui-verification-cohort?fixture=heart-reference` on the loopback sample preview at port 3118. Use fictional values only. The preview is deliberately separate from the real learner environment.
