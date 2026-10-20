# Piscine UI asset provenance

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
