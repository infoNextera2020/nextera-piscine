# Sunday source milestone — 30 October 2026

This receipt records source and fixture evidence. It does not establish a live learner journey.

## Implemented

- Both installed guides, `emil-design-eng` and `apple-hig-review`, inform shared hierarchy, typography, spacing, controls, focus and restrained motion. Provenance and the earlier audit remain in `DESIGN_AUDIT_003_BOTH_SKILLS.md`.
- The adopted calm surface now wraps the existing Home, Journey, focused challenges, invitation/login forms, Checkpoint editor/result and project/staff review components. Existing actions, routing and server-owned contracts are retained.
- Hairline challenge illustrations rest by default, respond only to a hover-capable fine mouse, and return to rest on leave. Reduced motion, hidden/offscreen and unsupported-input states use a static figure. This supersedes earlier challenge-tour guidance; the original assets and opaque occlusion geometry remain intact.
- GreetingCard and the verified SignLabel asset use one reusable artwork host. No supplied preview toolbar or author script is integrated.
- Home retains the approved automatically looping rendered video and its explicit pause/static controls. Its canvas token is `--learning-canvas: #000`, RGB `(0, 0, 0)`. The frame is transparent. The opaque studio background still differs visibly; a cloud-owned replacement is pending, not represented as fixed here.
- Source commits `050e446` and `e8a36d1` respectively add verified grading-phase teardown and a bounded invitation browser lifecycle. These do not enable live grading or Auth.

## Source checks

All 1,304 tests across 77 files passed. Full typecheck, lint, formatting and production build passed. The unchanged supplier SignLabel source has an exact-file, exact-symbol exception for its unused `rrect` drawing helper; its verified bytes are preserved. Logs are retained outside the repository in the task's `artifacts/calm-refinement-20261030` directory.

The Runner source also passed 83 Go tests/subtests across seven packages and `go vet`; actual-engine integration was explicitly disabled. The invitation lifecycle passed 50 fake-transport tests and an independent review. No live provider, database or executor was used by these source checks.

## Actual fixture browser evidence

- Home, GreetingCard, SignLabel, code-only Checkpoint, project, mentor queue/detail and the heart reference were measured at 1440, 390 and 320 CSS pixels. No horizontal document overflow was observed. The heart retained full viewport fit, including height.
- Login and valid invitation signup were measured at 1440×900, 390×844, 320×740, 768×1024, 1280×480 and 1920×640. Normal document dimensions did not overflow. The approved form-only fallback was selected for incompatible image ratios. Keyboard focus reached the lower short-height form navigation through the inner scroll surface.
- Invalid, expired, used, existing-account and unavailable invitation states rendered without password inputs. A mismatched confirmation displayed associated validation and focused the confirmation field. These are UI fixtures, not provider activation.
- Visible Home playback advanced 1.3098 → 4.0593 → 1.791 seconds in a five-second video with `loop=true` and `paused=false`, demonstrating a loop wrap.
- The connected browser reports `(hover:hover)=false` and `(pointer:fine)=false`, including after the viewport override was reset. It correctly rendered static Hairline fallback. Real mouse response and a browser-level reduced-motion preference change remain unverified in this context; source tests cover their policies. No input or security settings were changed to force a pass.
- Native screenshots and JSON measurements are saved in the task artifact directory. Library delivery is currently blocked by the official helper's tool-discovery mismatch; no upload identity has been claimed.

## Remaining real integration gates

1. Bind the new invitation lifecycle to the mounted signup UI and real approved Auth adapter. Resolve whether the ledger's accepted name or the reviewed editable full-name field supplies the activation name. Keep email/cohort binding and single-use acceptance authoritative. Review an exact new runtime controller before requesting credentials or accounts.
2. Join the selected immutable challenge content, web intake, durable grading/reconciliation and isolated Runner in one fresh approved environment. Final verified teardown does not solve detached descendants surviving between test cases. Per-case isolation and its aggregate budget require a concrete source/runtime review. No new public Run execution is enabled.
3. Complete genuine authenticated Checkpoint bootstrap/save/reload/conflict/revocation in the browser. Earlier private SQL proofs remain separate. The current UI is a code-only editor; the approved eight-question Exam 1 includes trace/reason and debug formats, whose essential answer UI still needs review rather than an invented layout.
4. Configure the approved three-person project and assigned mentor flow against the exact submitted revision. Current project/mentor screenshots have synthetic verdicts and preconfigured roles; no real approval was recorded. The approved ATM content is not thereby published as a runnable grading pack.
5. Rehearse the joined ordinary learner and assigned mentor flow. The Sunday target is not yet verified and is not inferred from these fixtures.

No fresh runtime approval is requested by this receipt. All earlier isolated runtime approvals are closed. No Auth/DB/Runner services, credentials, live invitation, account, SQL application, external message, push or deployment were introduced by this milestone. The four original unrelated dirty files were hash-verified and retained.
