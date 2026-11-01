# Piscine UI asset provenance

## Home v2 next-action pilot (M1A)

`piscine/official-logo.svg` is copied byte-for-byte from the supplied Home v2
review pack, `assets/official-logo.svg` (SHA-256
`0fde8181d16ceb17ac55e6d52e8cab523c3f75976a9aaa81b8695942c7336e54`).
The inline decorative path illustration in `HomeNextAction` preserves the
Home v2 `template.html` path-scene geometry; its unused checkpoint gate is omitted.
The verified standalone reference HTML has SHA-256
`c85727be66f42a8ee3274127cca3326258027e6e68f8c81100efa1b82308920b`.
No illustration geometry or logo was generated for this pilot.

The UI uses decorative artwork supplied with the approved V5 prototype and self-hosted Poppins. These assets contain no application state. All live labels, counts, statuses and controls are HTML.

## Approved prototype artwork

Source: the user's local `nextera_piscine_ui_v5/assets/` folder, supplied for Design Freeze v1. Files were copied byte-for-byte; CSS controls cropping and masking. Prototype artwork includes baked sample labels, so it must never replace live interface elements. The home/sidebar masks hide those labels.

| File                           | SHA-256                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| piscine/home-hero.webp         | 14ce2a226b205b2f081ad6588dc6c5213fa98bf91fdc0bc14ceba94b4f81ef97 |
| piscine/sidebar-mountains.webp | 084e6c4fa030b377f1de0e945f1590e50bb81c0b5b6552ec019a3d32826f3fa9 |

No external rights beyond the supplied project assets are asserted.

## Poppins

Source: [Google Fonts' official Poppins directory](https://github.com/google/fonts/tree/main/ofl/poppins). Downloaded the four static fonts and license from that directory on 2026-10-19. The retained `fonts/poppins/OFL.txt` governs redistribution.

Loaded by `next/font/local`; builds and browser rendering require no Google Fonts requests.

| File under fonts/poppins/ | SHA-256                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| Poppins-Regular.ttf       | 7e65201e9b79159e2300267cc885e16c8dcef2424cdfa09a29bfb0980a94a7ba |
| Poppins-Medium.ttf        | 90373e7d838d32468438fc3e152dca0bdb12edcab99ea639f158790b1ba1fd05 |
| Poppins-SemiBold.ttf      | d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286 |
| Poppins-Bold.ttf          | 983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c |
| OFL.txt                   | 6be04893d770899a015649c7aa3b582f871b272f8747a92b78b17c3e5c8b2573 |

## Hairline figures (UI 002)

The user supplied `/home/anas/.agents/skills/hairline-create` and selected two original figures: a checkpoint latch gate and three linked receipt plates. Sources live in `piscine/hairline/gate.js` and `receipts.js`; their self-contained `hairline-*.html` outputs are assembled by the supplied `build.mjs`. They retain the supplied engine and bench unchanged. The engine header identifies SHA-256 `346b48bdef2cdfafd5343eba01494255cf75f9c078e6fcd1aafc62bab62980a1`.

`HairlineFigure` adds the production palette and hides standalone bench controls from the embedding document, without editing the supplied engine/bench. The gate pose is selected from the displayed server status. Pointer movement nudges only the latch; the receipt figure lifts a selected plate. Neither figure computes score, quota, eligibility, verdict, mastery, unlocks or replacement access. Both are decorative, have adjacent semantic text and use the engine's reduced-motion and visibility handling. No autoplay tour runs in the product.

These are user-supplied tooling assets; no additional third-party redistribution rights are asserted here. No remote scripts, fonts or image requests are required by the figures.

## Challenge identity slice (24 October 2026)

`piscine/official-coding-logo.svg` is the user-supplied official vector, retained byte-for-byte from Library `libfile_6da34a99f9448191be31c59aba291dd7`. It is displayed intact on a light field; no geometry, gradients or mark were modified. The earlier Home v2 logo and pilot are preserved.

The first Challenge slice used an original inline engineering line illustration authored for this interface; the supplied Hairline scene below now replaces it. It is not a bundled or adapted `@lucasmarkes/hairline` figure. Its decorative SVG is hidden from assistive technology and remains static under reduced motion.

The user-selected visual reference is Library `libfile_7edaf0cb40788191a12fea99c600f4c0`, inspected as pixels before implementation. All brief text, file requirements, availability and history remain supplied by the existing server-authorized route.

## Supplied Hairline terminal (24 October 2026)

- `nextera-terminal.js` — user-supplied custom figure, Library `libfile_6f57a81f1c3081918687ffe81d66d3f7` (6,237 bytes).
- `hairline-nextera-terminal.html` — user-supplied self-contained preview, Library `libfile_f33643b22c9881919c6e8251640ab192` (42,393 bytes).

Both originals are retained byte-for-byte under `piscine/hairline/`. The embedded drawing matches the separate JavaScript. The embedded kernel matches the installed `hairline-create` kernel (marker `346b48bdef2cdfafd5343eba01494255cf75f9c078e6fcd1aafc62bab62980a1`), and the installed validator confirmed the kernel and bench are intact. This is the user's custom Hairline-format figure, not a stock figure or the earlier original SVG. No separate license declaration was included in these two supplied files.

`nextera-terminal-rest.svg` preserves the actual rendered rest-pose geometry, captured from the supplied scene. It has a scoped neutral/emerald stroke palette and no scripts. The application wrapper applies the same public Hairline theme variables to the unchanged animated page. Mobile/coarse-pointer, reduced-motion, Save-Data and unhydrated states retain the static drawing. The iframe mounts only while visible in an active tab and unmounts offscreen or when motion becomes ineligible. It is decorative and hidden from assistive technology and keyboard navigation. On eligible desktop pointers, the unchanged figure selects and spreads its three working plates from pointer proximity/X/Y and returns to its deliberate rest pose on leave. It does not autoplay, and contains no code input or evaluation data.

## Journey transparent wordmark

`piscine/official-nextera-mark.svg` is the original NextEra vector viewport supplied inside `NextEra-Piscine-Map-Concept-v2.svg` (source SHA256 `c1807de999688e4c50e079d7d441763905ca857acdb462070645d7da747b5edd`). It retains the supplied geometry and transparency; no background was added. The existing shell and Coding logo assets are preserved. Used at the approved heart-map START cleft.

## Functional Home Hairline drawings (25 October 2026)

The functional Home follows the user-approved desktop/mobile references `libfile_d5224bf6780c8191bb4773d9994c6297` and `libfile_878004cd987c8191aba1429591357de9`, inspected locally as pixels. Their sample titles and outcomes are not curriculum or learner data.

All Home/shared navigation and control icons are original object drawings made with the installed `hairline-create` skill, its public HL geometry/lifecycle API and unchanged kernel/bench. Sources are under `piscine/hairline/home-icons/`: cabin, atlas, receipts, console, checkpoint, archive, advance, loupe, deskbell, slats, crossbar and exitdoor. Each has a meaningful local mechanism, a deliberate rest pose and no autoplay. The fixed kernel hash and source/output digests are recorded in `provenance.json`.

The twelve self-contained figure pages passed the skill validator. The documented eight poses (rest/answer/240px/240px answer/intensity extremes/light/dark) were checked in installed Chrome without installing the look tool's separate runtime. All settled; no console errors or frame overflow were observed. `hairline-icons.generated.json` contains their actual rendered rest paths. Small UI controls use these static paths with non-scaling thin strokes, no animation/iframe/event loop. This preserves legibility and reduced-motion/offscreen behavior. They are custom Hairline Create figures, not stock icons from a vendor pack.

The current-work card reuses the accepted supplied interactive terminal with its existing pointer, reduced-motion, touch and visibility handling. Official logos remain unmodified brand assets. All personalized titles, feedback, states, counters and links still come from the authorized overview; these drawings contain no business state.
