# Local Week 1 integration source milestone — 30 October 2026

This is tested source preparation plus a reversible component-fixture design comparison. It does not complete the five real integration gates. No Auth account, invitation capability, credential, SQL application, new service, grading run or publication was created in this milestone. Earlier runtime attempts remain closed.

## Source completed

- Invitation inspection HTTP now shares the existing ledger/admission/managed-Auth assembly. It has bounded same-origin JSON, trusted-caller and ingress checks, safe status/email projection and private/no-store responses. Inspection does not claim, enroll, create an account or consume an invitation. The production inspection, issuance and activation paths remain null-config and unavailable.
- The pure fragment seam removes the fragment/query from the signup URL before releasing a capability to a caller. It accepts only the intended canonical fragment shape, holds no persistent browser state and does not perform transport. A browser activation lifecycle and actual signup integration remain absent; do not infer live registration from this parser.
- Runner ABI v2 explicitly admits a single complete main.go program with stdin_utf8 and stdout_utf8_exact. It preserves v1 contract bytes and function transport, exact source/newlines and fixed workspace paths. It does not copy a private expected-output oracle into the program phase. A shared wall-time/output allowance spans cases. Non-main packages are compile errors; parent cancellation during resource inspection remains infrastructure uncertainty. Source review is accepted after those two regression fixes.
- The new invitation/Auth migration plan validates all 18 current SQL sources, deliberate order, the atomic checkpoint pair, target/actor binding and required permission-proof shape. It always reports runtimeReady:false. Structural receipt flags are not database truth or action-time approval. Existing closed target allowlists are unchanged.

## Verified evidence

Aggregate checks passed:75 Vitest files / 1,246 tests, typecheck, production build, ESLint and whole-tree formatting. Invitation focused coverage is70 tests. Runner source tests/vet passed with73 tests/subtests across7 packages; the actual engine integration test was explicitly skipped. Migration preparation has54 new and180 existing fake tests. These counts describe separate suites, not one end-to-end run.

See verification/parallel-milestone-20261030/source-checks.json. Four original unrelated dirty files retained their exact hashes and are excluded from the commits.

## Five runtime gates still open

| Gate                        | Existing evidence and remaining gap                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation and genuine Auth | Native invitation SQL14/14 previously passed and is closed. Inspection/fragment/assembly source is tested. Browser activation lifecycle, signup binding, explicit accepted-name/password/confirmation/rate/origin policy and private provider/DB clients remain.                |
| Challenge and Runner        | Earlier HelloGo/EvenOrOdd wrong-then-correct proof was real and its environment is closed. New program ABI v2 has no configured/published pack. Platform TypeScript/SQL acceptance, immutable GreetingCard pack, CPU accounting/isolation proof and real execution remain.      |
| Authenticated checkpoint    | Native draft/context/ACL evidence exists in closed rehearsals. The browser save/reload/conflict flow is not integration-proven. Legacy four-task90-minute fixtures do not prove the approved eight-question180-minute Exam1 with mixed answer types and weighted scoring.       |
| Project and mentor          | Existing services bind a three-member roster, immutable exact attempt and assigned operator/admin mentor review. Approved ATM has no runnable published pack and needs a reviewed multi-file/input protocol beyond this single-main ABI. Real multi-actor verification remains. |
| Joined learner journey      | No single genuine session has passed all these gates. A fresh reviewed source/configuration/controller and exact resource/access approval are required before runtime.                                                                                                          |

The old authenticated checkpoint adapter directly creates/enrolls its learners, so it cannot count as invitation proof. It also bypasses the repaired migration-context assembly, targets closed profiles, pins obsolete draft hashes, and lacks invitation-specific clients/configuration/cleanup accounting. Do not update a checksum and replay an old target. Prepare a fresh target-bound bridge/profile and independent revocation accounting before asking to execute.

The signup view currently allows name editing while the service binds the accepted name immutably. That product choice is unresolved. Invitation lifetime, provider password/confirmation behavior and transport/rate settings remain explicit inputs; no silent defaults are enabled. Advanced assignment/exception/admin work stays deferred.

## Reversible design comparison

Only the new DesignExploration wrapper/styles opt into the calm proposal. No production route adopts it. The actual Home/Challenge controllers, content, destinations, state, approved video and Hairline geometry are reused. Fixture navigation preserves design=calm; View current returns to the existing presentation.

Actual Chrome checks covered1440x900,768x1024,390x844 and320x740 for both pages, with document scrollWidth equal to clientWidth. Keyboard pause/resume and Resources disclosure worked. Home video time advanced while playing. Two320-pixel screenshot crops2.1seconds apart show distinct Hairline poses. Viewport overrides were reset. OS reduced-motion emulation and OS-light preference remain unrun; source reduced-motion behavior is tested separately.

The owner still sees the opaque Home video background as a separate surface. This remains unresolved; neither CSS edge fading nor this comparison is claimed as seamless. No new model/render was made. The current intentionally black challenge and opaque occlusion faces remain unchanged.

Review image:libfile_4aaf2b0445e08191a0e6ac3efbc98778 version0,01-coding-current-vs-calm-review-windows.jpg. Screenshots are synthetic component fixtures with no live Auth/DB/Runner. Full captures and browser data are retained outside the repository; hashes are in design-images.json and design-browser.json.

The design used installed Emil design-engineering, Apple-style motion and animate guidance. The separate Dickwu package was not installed in inspected local locations; its rendered public SKILL and selected web-foundation references were reviewed without installing or running repository scripts. This is not an official Apple certification or a full native-HIG audit. See docs/DESIGN_EXPLORATION_001.md for the limited references and comparison rationale.
