# Home B and full-heart Journey — implementation slice 001

Date: 26 October 2026. Base: `07677f4c81e624a23b2415d45b332aeb07bc85a0`, branch `main`.

Status: application source implemented and source checks passed; application browser acceptance remains pending. No running preview or live verification is claimed.

## Approved design and boundaries

Implement the original Home B, not the optional Quixel comparison. Keep the accepted heart silhouette and transparent START logo, remove surrounding Journey copy, and fit the whole heart into the available shell viewport. Do not infer curriculum, learner progress, prerequisites or unlocks from illustrative art.

The durable approved decision and route snapshot is [APPROVED_DESIGN_HANDOFF_20261026.json](./APPROVED_DESIGN_HANDOFF_20261026.json). The four byte-preserved visual references are:

- [Home B desktop](./references/20261026/Home-B-Desktop.png): `libfile_759f004f00fc8191aed1670353c595b4`, version 0.
- [Home B mobile](./references/20261026/Home-B-Mobile.png): `libfile_5a06e38bca28819191e12977e5668249`, version 0.
- [Journey desktop framing](./references/20261026/Journey-Fit-Desktop.png): `libfile_14a437aa1c188191afd3dd92b93de00e`, version 0.
- [Journey mobile framing](./references/20261026/Journey-Fit-Mobile.png): `libfile_d127042bfdd081919834688fa6ac1ac1`, version 0.

Frozen Library package replacements succeeded under the same identities at version 4: HTML `libfile_aff617ea6c6481918013464fa86afdc5`; JSON `libfile_8fc72429b8188191bbe8919c1dba52d0`; delivery registry `libfile_d3d168bf90c88191a4270ef555827818`; ZIP `libfile_33d43b1407788191806a05190d4d2cac`. Version metadata was applied successfully. These are design-artifact checks, not application browser checks.

## Implemented source

- `/app`: current authorized action dominates the left card; latest safe submission feedback and location occupy the right column; an actual next milestone appears below only when supplied. The same eligible primary link becomes the mobile bottom action. There is no fabricated required filename or new metric, and existing no-action, empty, pending, failure, infrastructure and access branches remain.
- `/app/cohorts/[cohortId]`: existing heart geometry and authoritative source order remain unchanged. ResizeObserver fits the route uniformly; narrow viewports crop unused drawing margins. The heading remains accessible but visually hidden. Full-title navigation and map key move into an on-demand native dialog; requirements stay available through the inspector. Existing authorized destinations are retained.
- Local Poppins and neutral/emerald semantic tokens apply to these surfaces. Existing Hairline drawings are reused; no new library or generated icon pack is introduced.
- Accepted Challenge/Hairline, backend contracts, authentication, Judge, catalog, deadlines, quotas, progression and database migrations are unchanged.

## Verification

Pinned installed runtime: Node `v24.19.0`, pnpm `11.22.0`. No installation was performed.

- Focused regression run: 61 tests across 7 files passed, including 10 new viewport-fit cases.
- Full unit suite: **288 tests across 34 files passed**.
- Full typecheck, lint, formatting check and production build: **passed**.
- `git diff --check`: passed before documentation finalization; repeated before commit.
- Four original unrelated dirty files: SHA-256 matched their recorded baseline after checks; repeated before commit. They are excluded from this slice.

Evidence is retained on Halawany at `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\home-b-journey-implementation`: `source-checks.json`, `unit.log`, `typecheck.log`, `lint.log`, `format.log`, `build.log`. Fit tests validate geometry bounds and invalid dimensions; they are not visual QA.

**Not run:** application Chrome screenshots/comparison at 1440/768/390/320, keyboard dialog/focus/navigation, reduced motion, actual mobile action-dock overlap, browser history, authenticated Home, database/Judge E2E. Earlier screenshots and earlier real isolated E2E are historical evidence for earlier code, not passes for this revision. Static design-package rendering does not establish application visual fidelity.

Review risks: fixed-size map targets/labels in a fitted narrow map, tablet label spacing, native-dialog focus restoration, inspector overlays, mobile safe-area/action-dock overlap and zoom/short-height behavior. Uniform route fitting does not prove every label remains legible or every browser is overflow-free.

## Proposed bounded browser verification — approval needed before startup

The retained component harness is `C:\Users\lap\Documents\Codex\2026-10-24\task\implementation\home-b-journey-review.cjs`. It imports real application components, substitutes Next navigation and uses explicit in-memory fixture data. Its HTTP server binds **127.0.0.1 only**. It does not start Auth, Postgres, Docker or Runner. Fixture POST creates only an in-memory queued receipt; it is never real evaluation or mastery. Checkpoint writes are rejected.

Proposed command from PowerShell, only after checking that port 3118 is unused and receiving startup approval:

```powershell
wsl -d Ubuntu -- env NEXTERA_UI_REVIEW_PORT=3118 /home/anas/nextera-piscine/.tools/node-v24.19.0-linux-x64/bin/node /mnt/c/Users/lap/Documents/Codex/2026-10-24/task/implementation/home-b-journey-review.cjs
```

Expected review locations after a verified startup: `http://localhost:3118/app?state=failed` and `http://localhost:3118/app/cohorts/ui-verification-cohort?fixture=heart-reference`. These are proposed fixture URLs, not claims that a server is running. A separate source-only harness includes the new token stylesheet and allowlisted local font assets, while preserving the original harness. Its build-only mode was checked without starting a listener. Browser rendering still requires the separately approved startup.

Cleanup: Ctrl+C in that exact foreground process, verify that its 127.0.0.1:3118 listener is closed, retain screenshots/logs and fixture bundle for evidence. Do not kill unrelated processes or reset any database. Do not run `test:learning` or `test:assessment-ui` under this boundary: their fixture preparation mutates Auth/database state.

## Next authorized independent source slice

Prepare the Checkpoint editor contract/types and pure regression cases before wiring the exam UI: free dynamic question navigation; visible-example Run ungraded and not consuming graded attempts; official Submit evaluates an immutable source snapshot; per-question draft save states and access/time-gated offline resync. Quests/Raids keep external-editor submissions.

No draft-autosave or visible-example Run API currently exists. Choose bounded version/conflict and retention settings explicitly; never silently overwrite newer drafts, expose hidden tests, turn autosave into Submit or auto-submit at expiry. Per-exam pass threshold is a publication gate, not a global pass-three default. Safe code and migration drafts may proceed; applying migrations, retained database mutation, services, credentials/accounts/roles/tokens, production awards, push and deployment remain outside current authorization.
