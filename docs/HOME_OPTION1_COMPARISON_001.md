# Home option 1 comparison — review ready, not adopted

This is the isolated comparison requested by Anas. It does not replace the adopted Home. CommandCenter accepts an explicit `focus-review` presentation and artwork slot while its default desk presentation, source data, eligibility checks, state messages and destinations stay unchanged. The actual HomeNextAction and latest-feedback markup are reused. Heart Journey source, geometry and viewport behavior are untouched. Login, signup, checkpoint exit and backend contracts are outside this slice.

## Source and assets

The 27 October supplied handoff and Home/palette PNGs were inspected. No screenshot cards or cropped reference art were used as UI. The root Blender worker supplied four original refined renders, dark/light by base/floating, in Library asset pack `libfile_42effd89a0b081918b8ac232ea799bdf`. All sixteen image derivatives were checked against the pack's byte counts, SHA256, dimensions and transparency. The full shared 1164 by 1280 canvas is preserved with object-fit contain. Real WebP widths are 436, 728 and 1164, corresponding to heights 480, 800 and 1280. The original Blender scene remains separate and unchanged; no new 3D runtime or dependency was installed here.

HomeRenderedArtwork uses native picture/Next Image with explicit dimensions, WebP srcset widths, eager async decoding and a full PNG fallback. It has no animation, parallax, canvas or runtime 3D. Reduced motion retains exactly the same static image. These rendered assets cannot refract live page content behind them.

## Review surface

The external fixture entry extends the already authorized loopback preview at `http://localhost:3118/review/home-option1?theme=dark&variant=base`. Use `theme=light` and `variant=no-base` for the other combinations. The review toolbar labels synthetic sample data and provides comparison switches. Palette overrides are scoped to this wrapper; they do not add production theme behavior. The original `/app?state=failed` and heart Journey routes are preserved.

Desktop follows the supplied dominant challenge/smaller feedback composition. Mobile retains challenge, decorative image, feedback, location and milestone order. Existing location and conditional milestone information remain available rather than being discarded to mimic a screenshot. Current filename is not invented when the existing overview lacks it. The final image variant and adoption remain with Anas.

## Verification

717 source tests, typecheck, lint, formatting and production build passed. Final Chrome fixture checks passed 180 assertions across all eight 1440/390 theme/variant combinations, both palettes at 320px, and missing/locked/pending/infrastructure-error states. Checks cover real action destinations, eligibility, keyboard focus, primary contrast/target size, overflow, explicit image dimensions, full-canvas ratio, modern-format selection, no missing responses and static reduced-motion behavior. No unexpected console or page errors were recorded. Neutral screenshots were captured after keyboard focus checks; the skip link remains available when focused.

At DPR1, all eight page loads selected one 480h WebP and made no full PNG request. Dark base/floating payloads were 22,162/19,250 bytes; light base/floating were 23,392/18,960 bytes. These are measured local fixture requests, not production or Lighthouse scores. Responsive higher-resolution derivatives remain available through srcset. Browser metrics, screenshots, integrity report and contact sheet are in the task verification folder `home-option1-comparison`.

## Boundaries and cleanup

Assets and comparison harness remain outside the repository, pending user selection. The four original dirty files are preserved. No Auth, database, Runner, credential, SQL, public upload, push or deployment was introduced. These are component/fixture checks, not authenticated full-stack evidence. The original production Home remains the default.

The sample preview is left running for manual review on `127.0.0.1:3118`. Task `verification/home-option1-comparison/process.json` records process identity; `implementation/stop-home-option1-preview.py` validates command, owner, start time and listener before stopping only that preview. Do not use a stale PID directly.
