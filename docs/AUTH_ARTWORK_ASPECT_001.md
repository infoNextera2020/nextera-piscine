# Auth artwork aspect refinement

The supplied screenshot (`libfile_010b2919aaf481918f9d5728632e80ed`) and approved artwork were inspected. `object-fit: contain` creates side bands when the image canvas is narrower than the visual panel. The image's studio and floor edges vary in color, so a uniform CSS background cannot hide them accurately.

The bounded CSS change uses proportional `cover` only for desktop viewport ratios from 10/7 through 1.78, where static geometry inspection retains the important metal composition. Portrait and wider/shorter ratios keep the original `contain`; mobile keeps the existing hidden-art breakpoint. No artwork pixels, forms, logo, markup or account behavior changed. Clipping applies only to the decorative artwork panel, never the account form or page.

**The user's shown ratio of approximately 2.03 remains fallback and is not fixed by this CSS slice.** Its 639×631 panel needs matching art of about 1278×1262 at 2×, or about 1702×1680 to preserve the current master's vertical resolution. That is approximately 502 pixels of additional horizontal studio coverage. A new matching render/background extension requires separate approval; no art was improvised.

Ten UI source tests, CSS compilation, formatting, artwork hashes and nine static geometry cases passed. Existing sample listener PID 23617 and HTTP 200 route/CSS checks were confirmed. Actual Chrome/Playwright navigation to `http://127.0.0.1:3118/review/auth/login` returned `net::ERR_NETWORK_ACCESS_DENIED` before rendering. The underlying browser/network cause is unconfirmed; this was not an application HTTP response. The browser action stopped without retry, alternate URL or security changes. Zero rendered checks and zero new screenshots completed, so no after-screenshot Library IDs exist.

Evidence is retained in the selected executor's `verification/auth-fullbleed-20261028/`, including the source report, static geometry, edge samples and browser failure receipt. Actual desktop/mobile visual, keyboard and scroll regression remain unverified for this CSS change. The earlier auth viewport tests remain historical evidence for the preceding source version.
