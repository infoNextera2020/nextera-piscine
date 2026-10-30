# Shared challenge artwork host

Current owner decision: Hairline challenge figures rest without automatic motion. They respond only to a mouse over the figure, then return immediately to their original rest pose on leave. No idle tour or automatic resumption is started. This supersedes the earlier Hairline tour direction and its historical motion reports. The separately approved rendered Home video still loops automatically; no Home video source was changed by this milestone.

## Exact reviewed assets

- GreetingCard: existing reviewed `greeting-heart.js` and kernel bytes are unchanged.
- SignLabel: Library `libfile_2e930d3197c88191a5339f9decda6296`, version 0, `SignLabel.zip`, 495,515 bytes, SHA256 `5bc1754ae7448c7bd96d1622e2dc7522a045b3c8733423ae6dfbfe0f640fb26f`. Native WSL materialization verified Library identity/version metadata, archive integrity, safe paths, no symlinks and bounded extracted size. Actual supplied dark 200px and rest pixels were inspected. The supplied figure JS is embedded byte-for-byte in its source HTML. Source theme differs from GreetingCard only in quote formatting; token values match.

Only the supplied kernel, figure and scoped dark theme are incorporated. Author toolbar, bench DOM, build scripts, checks scripts and preview labels are excluded. Original files remain in protected staging. Each asset has a 400x320 / 5:4 SVG viewBox with opaque black occlusion. SignLabel `rest.svg` was generated from the original engine at its actual rest geometry, not redrawn. Per-asset provenance records hashes; source-level checks are not independent browser verification.

## Shared lifecycle and boundaries

`ChallengeArtwork` owns a fixed allowlist of local GreetingCard and SignLabel paths. The existing `GreetingCardArtwork` export remains as a wrapper. `FocusedChallenge` selects artwork only for exact `greeting-card` or `sign-label` keys and preserves the shared LearningSurface, actual brief, submission controller, history and permissions. Unknown keys get no artwork.

`public/piscine/hairline/challenge-figure-host.js` is embedded identically in both isolated HTML hosts. Each script is CSP-hashed; no network, forms, storage or same-origin privilege is enabled. The original engine performs its own hit testing. The host blocks non-mouse input, starts no tour, and resets the figure at pointer leave. A script-local closure avoids collisions with supplied figure globals.

When reduced motion is active, the host copies the exact original rest SVG then disposes engine listeners and scheduled frames. CSS also suppresses input, animations and transitions. The React shell displays a static SSR fallback and mounts the live iframe only while visible, mouse-capable, non-reduced and interaction-enabled. Hidden/offscreen state unmounts it; returning starts at rest. The external keyboard-accessible control enables/disables interaction, not an idle animation. The iframe remains decorative, aria-hidden, unfocusable and sandboxed with allow-scripts only.

## Read-only preview and evidence

The fixture entry reads the exact approved Quest 2 F2 SignLabel English baseline and preserves its proposed-contract wording. It uses `signlabel.go` only as that read-only brief's proposed file and never enables intake or grading. Its route is `/app/cohorts/ui-verification-cohort/challenges/sign-label?view=focused&fixture=week1-review`. The fixture server still needs the integration owner's two static SignLabel asset mappings and bundle refresh; no listener was started or restarted here.

Sixteen focused tests passed: original-engine idle stability, mouse response/hold, immediate rest on leave with no delayed tour, touch denial, reduced-motion input/frame shutdown, hidden/visible rest behavior, exact source/kernel/shared-host/CSP identities, static 5:4 occlusion and controller-owned unavailable intake. Own-file ESLint and formatting passed. Browser motion, actual pointer, viewport, background and reduced-motion checks remain with the integration owner. No real Auth/DB/Runner, credentials, accounts, SQL, publication, push or deployment was performed.

The generated HTML, exact supplied JS/theme, static SVG and embedded shared host must not be independently reformatted: script hashes and original-byte checks bind those bytes. The integration owner maintains the corresponding formatter exclusions. Editing the shared host requires regenerating both inline copies and their CSP hashes together; tests reject drift.
