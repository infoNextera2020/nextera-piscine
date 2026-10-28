# Auth artwork aspect refinement

## Verified responsive follow-up

See [the actual 34-case responsive report](../verification/auth-responsive-20261028/REPORT.md). The stale running fixture was refreshed and the reported 1280×631 issue reproduced then corrected. Browser-tested range refinements also cover 1024×768 and 1702×640. Four unsupported aspect combinations still letterbox and await the owner's form-only/art-direction decision. Actual zoom and viewport reset remain unverified after Computer Use stopped on native Chrome URL-confidence policy. No security settings or old headless-denial workaround was used. The earlier sections below are historical source/static evidence, not a substitute for this browser report.

## Current square-asset integration

The subsequently authorized native Blender square render is now integrated in the shared login/signup picture. Library source: `libfile_018056f486a48191a557e2faa6f0d389`. Its identity and bytes were verified on the consuming Ubuntu filesystem using the current official Library helper; the earlier Windows helper failure (`os.setxattr` unavailable) was resolved without changing browser or network security settings. The square render and upper-ratio supplied crop were visually inspected as local image files, not application screenshots.

The square WebP candidates are 600/900/1280 pixels wide and 14,620/34,206/94,624 bytes; the matching 1280 PNG is the non-WebP fallback. Source geometry/material/light preservation and projected subject bounds are recorded in `apps/web/public/piscine/auth/SQUARE_ASSET_PROVENANCE.json`. Original portrait and all prior artwork files remain unchanged.

A conservative viewport media range 1.61–2.65 chooses square art for the approximately half-width panel. Actual size-container queries allow centered cover only for panel width/height 0.80–1.3296875. The measured 639×631 user panel is within that range. A reduced visual viewport cannot force cover beyond those bounds. Narrower panels retain the original portrait, with cover restricted to its inspected range; unsupported container queries and unverified ratios use contain. Mobile art remains hidden. This does not claim seamless full bleed at every extreme aspect ratio.

No form layout, controls, Auth behavior, viewport-height handling, page overflow rule or keyboard behavior changed. The image remains decorative and static, including reduced motion. Four supplied source-crop cases and twelve static viewport/keyboard-height cases were checked, alongside exact file hashes and PNG dimensions. These are not rendered browser/scroll/accessibility checks. The existing localhost browser denial was not retried; no new browser screenshot or Library screenshot ID is claimed.

## Historical portrait-only CSS slice

The supplied screenshot (`libfile_010b2919aaf481918f9d5728632e80ed`) and approved artwork were inspected. `object-fit: contain` creates side bands when the image canvas is narrower than the visual panel. The image's studio and floor edges vary in color, so a uniform CSS background cannot hide them accurately.

The bounded CSS change uses proportional `cover` only for desktop viewport ratios from 10/7 through 1.78, where static geometry inspection retains the important metal composition. Portrait and wider/shorter ratios keep the original `contain`; mobile keeps the existing hidden-art breakpoint. No artwork pixels, forms, logo, markup or account behavior changed. Clipping applies only to the decorative artwork panel, never the account form or page.

**The user's shown ratio of approximately 2.03 remains fallback and is not fixed by this CSS slice.** Its 639×631 panel needs matching art of about 1278×1262 at 2×, or about 1702×1680 to preserve the current master's vertical resolution. That is approximately 502 pixels of additional horizontal studio coverage. A new matching render/background extension requires separate approval; no art was improvised.

Ten UI source tests, CSS compilation, formatting, artwork hashes and nine static geometry cases passed. Existing sample listener PID 23617 and HTTP 200 route/CSS checks were confirmed. Actual Chrome/Playwright navigation to `http://127.0.0.1:3118/review/auth/login` returned `net::ERR_NETWORK_ACCESS_DENIED` before rendering. The underlying browser/network cause is unconfirmed; this was not an application HTTP response. The browser action stopped without retry, alternate URL or security changes. Zero rendered checks and zero new screenshots completed, so no after-screenshot Library IDs exist.

Evidence is retained in the selected executor's `verification/auth-fullbleed-20261028/`, including the source report, static geometry, edge samples and browser failure receipt. Actual desktop/mobile visual, keyboard and scroll regression remain unverified for this CSS change. The earlier auth viewport tests remain historical evidence for the preceding source version.
