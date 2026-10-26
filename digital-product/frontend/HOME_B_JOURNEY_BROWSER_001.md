# Home B and Journey — browser follow-up

Follow-up to `81d0b74`. Checkpoint source-only contracts are separately committed in `c925f6a`.

## Actual fixture verification

The approved component harness was started once on **127.0.0.1:3118**, with in-memory sample records and no Auth/database/Runner. Windows HTTP read returned 200. The restricted command context first rejected its loopback read; the normal approved execution context succeeded without changing any network/security setting.

Installed Chrome was used headlessly with its sandbox enabled and reduced motion emulated. Final results: **78 checks passed, zero failed, zero page/console errors** at 1440×1000, 768×1024, 390×844 and 320×740.

Checked actual rendered components: Home font loading, single eligible CTA and touch size, mobile dock bounds, long-content overflow, Challenge navigation, feedback/history destination, Journey navigation, native Browse dialog/Escape/focus restoration, locked requirements, dialog-to-inspector transition and mobile inspector focus. The full reference heart has 19 explicitly illustrative nodes; its actual rendered targets fit onscreen, meet the 24px floor, and have a full-title dialog alternative. No page scrolling is needed to see the full heart at the tested sizes.

Initial run: 59 checks passed and one tablet-label check failed. Screenshot inspection also found a desktop label clipped by the drawing frame. The follow-up CSS keeps the unchanged heart geometry, lets labels extend beyond the drawing frame within the bounded viewport, and switches compact/short map containers to markers plus existing full-title Browse navigation. No data/order/status/href or progression change was made.

One expanded browser run was interrupted by a Chrome navigation-protocol error before completing. Its task-owned test process was cleaned up and navigation waits were made explicit. It is not a passing run. The subsequent completed 78-check run is the final browser evidence.

Screenshots were visually inspected against original Home B and the accepted heart framing. Existing shell branding/width and actual source-provided text remain; this is not a claim of pixel-identical art or authenticated/live execution. Full-page screenshots composite the fixed Home dock at the viewport edge; the dock remains fixed during scrolling.

## Evidence

`C:\Users\lap\Documents\Codex\2026-10-24\task\verification\home-b-journey-browser` contains `browser-report.json`, preserved `browser-report-initial.json`, initial tablet screenshot, final `home-1440/768/390/320.png`, `journey-1440/768/390/320.png`, source check logs and `preview-process.txt`. Test driver: `implementation\verify-home-b-journey.cjs` in the same task folder. The fixture harness is outside the product repo and is not imported by the app.

## Manual review — preview intentionally left running

- Home: <http://localhost:3118/app?state=failed>
- Connected component Journey: <http://localhost:3118/app/cohorts/ui-verification-cohort?state=failed>
- Full heart visual fixture: <http://localhost:3118/app/cohorts/ui-verification-cohort?fixture=heart-reference>
- Long-content Home: <http://localhost:3118/app?state=long-content>

Expected manual results:

1. Home shows one next action, latest feedback and current location. Continue opens the existing Challenge; Review feedback opens its submissions tab. These records are sample data.
2. Resize to narrow mobile and scroll Home. The CTA stays usable at the bottom; feedback, Journey and milestone links remain reachable without horizontal page scrolling.
3. The full-heart fixture fits the viewport without scrolling to find its top/bottom. Tablet/mobile use compact markers. Browse opens all full titles; Escape closes it and returns focus. Tab/Enter can reach actions.
4. In connected component Journey, an available destination opens its existing route. A locked item shows requirements, never a fabricated unlock. Browser Back should return to the prior page.
5. Pending is still pending. A fixture upload, if tried, creates only an in-memory queued receipt. It does not run code or award progress. The newly modeled Checkpoint internal editor/Run/autosave are not wired or live yet.

Remaining checks: actual touch/device precision, virtual keyboard, native mobile Safari, zoom/short landscape edge cases beyond the stated viewports, broader state matrix, authenticated Home and real backend E2E. This pass is not a full accessibility audit or production readiness gate.

## Process and cleanup

Verified fixture PID **527** in WSL Ubuntu, command `/home/anas/nextera-piscine/.tools/node-v24.19.0-linux-x64/bin/node /mnt/c/Users/lap/Documents/Codex/2026-10-24/task/implementation/home-b-journey-review.cjs`, bound to 127.0.0.1:3118. It is intentionally left running for the user's requested manual test. No second listener was started.

After review, verify that PID 527 still belongs to that exact command, then stop only that process:

```powershell
wsl -d Ubuntu -- ps -p 527 -o pid=,args=
wsl -d Ubuntu -- kill -TERM 527
wsl -d Ubuntu -- ss -ltnp 'sport = :3118'
```

If the process was restarted, inspect the current listener and use its verified PID instead. Do not kill unrelated ports/processes or run any DB reset. Screenshots and logs remain for evidence.

Final source verification after the CSS change: **338 tests across 35 files passed**, plus full typecheck, lint, formatting and production build. No retained database, credential, Judge, catalog or authentication change was performed. The four original dirty files remain byte-identical and excluded.
