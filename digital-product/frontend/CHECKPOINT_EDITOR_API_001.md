# Checkpoint editor HTTP boundary — slice 001

Status: source-only API plumbing with injectable backend contracts and pure HTTP tests. **Production draft persistence and visible-example execution are not implemented/enabled.** `editor-backends.ts` deliberately supplies null adapters; valid authenticated calls return private, non-cacheable 503 `EDITOR_CAPABILITY_UNAVAILABLE`. There is no memory store, environment-flag enablement, fake save receipt, fake Run result or fallback to graded evaluation.

The running 127.0.0.1:3118 manual Home/Journey fixture was left unchanged. It is not the Next.js API server and must not be used as evidence for these new endpoints.

## Added source

- `apps/web/lib/checkpoints/editor-http.ts`: Node HTTP controllers, bounded raw-source reader, context/window/policy guards and allowlisted responses.
- `editor-backends.ts`: explicit unavailable production adapters. Future adapters must meet the documented atomic storage/execution requirements before enabling the editor.
- `editor-http.test.ts`: injected backend tests, not live integration or a production in-memory implementation.
- `apps/web/app/api/checkpoints/drafts/route.ts`: GET and POST wiring using existing `requireDomainUser` plus the existing learner-only guard.
- `apps/web/app/api/checkpoints/runs/route.ts`: separate GET and POST wiring with the same authenticated learner boundary.

No old Checkpoint route, graded submission transport, Judge worker/protocol, database migration, access role, credential or catalog record was changed.

## Wire contract

Both POST routes require the existing same-origin check and a currently authenticated, active learner. Identity comes from the session/domain mapping. Client learner/cohort/policy/test-pack/filename headers cannot select authority. GET also requires that same active learner; all success/error responses are `private, no-store`, vary by Cookie and use `nosniff`.

Common POST metadata: UUID `x-attempt-id`, authored-key `x-task-key`, SHA-256 `x-definition-digest`, UUID `idempotency-key`; body `application/octet-stream` containing exact UTF-8 source. The server-selected context must match the authenticated domain learner, attempt, question, cohort and immutable definition. Invalid metadata is 400, unauthorized origin/role/context 403, changed definition 412, closed intake 409, unavailable capability/clock 503. No client timestamp extends the window.

| Route                          | Additional input                           | Backend-bound behavior                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/checkpoints/drafts`  | `attempt`, `task`; optional `request` UUID | Read the authorized current draft or the exact original save intent for acknowledgement reconciliation. Unknown record 404; a different returned request ID is rejected.                                                                                                                                                                        |
| POST `/api/checkpoints/drafts` | Nonnegative safe-integer `x-base-version`  | Exact source, server-computed SHA-256/byte count, session actor and authoritative scope go to atomic CAS save. Intentionally empty source can clear a draft. Saved acknowledgement must match source/intent and advance the version. Conflict is 409 with allowlisted authorized current source/version; no overwrite occurs in the controller. |
| GET `/api/checkpoints/runs`    | `attempt`, `task`, `run` UUID              | Read only an authorized matching run. A closed intake can still expose an earlier accepted result when the server explicitly permits reading.                                                                                                                                                                                                   |
| POST `/api/checkpoints/runs`   | Nonempty source                            | Dedicated visible-example acceptance with server-selected filename, visible-example digest and explicit limits. Returns 202 only for a matching run/source acknowledgement. It does not call the graded intake, create an official submission or award progress.                                                                                |

Draft responses include source/version/requestId/definitionDigest. The client adapter must apply them to the captured request scope, not whichever question is currently selected. Run responses contain only id/requestId/sourceDigest/state/bounded output; no grading metadata, private pack reference or arbitrary backend fields are forwarded. A Run state called `passed` is rejected; `completed` only means visible execution completed.

Body intake is capped at the existing 262144-byte transport ceiling and the server's explicit smaller source limit. It also bounds requests without Content-Length, checks declared length consistency, rejects malformed UTF-8 rather than substituting bytes, and preserves BOM/CRLF. Oversized/cancelled streams are cancelled/released; aborted input never becomes an accidental empty-draft save. No source text is logged or executed.

## Backend contract still required

The HTTP controllers are not a substitute for transaction-level authorization. Every future read must recheck ownership/access. Every save/Run acceptance must atomically recheck current membership/access, immutable attempt/question/definition, trusted deadline, idempotency and the action's independent allowances at commit. Backend access/deadline races become 403/409, not successful acknowledgements. A read preflight alone is insufficient.

Draft storage must implement versioned compare-and-swap, immutable save receipts for lost-acknowledgement lookup, identity/attempt/definition isolation, strict source limits and replay rejection when an ID is reused with different bytes. It must preserve both conflict versions without silently choosing a winner. No persistence schema or migration is included/applied in this slice.

Run must use a dedicated visible-example manifest/executor and separate atomic rate/concurrency reservations. The server must positively supply visible-only, ungraded, no-graded-attempt-consumption flags, a valid visible-example digest and all positive resource/rate/concurrency limits. Missing/hidden/graded/unbounded policy fails closed. Run rate limit maps to 429 with a valid optional Retry-After; it creates no graded quota effect. No cancellation, isolation, queue or real compiler execution is claimed by these controllers.

Existing `checkpoint_task_context` verifies ownership and rules but does not supply this new storage/executor policy or perform the complete write-time deadline/version/reservation transaction. It is not enough to enable either adapter. Existing `read_checkpoint` and raw-file official submission remain unchanged; there is no attempt to repurpose private grading packs as public examples.

## Narrow recommendations, not silently approved defaults

- Obtain the immutable visible-example manifest and its declared execution caps from the authored exam configuration; never derive public tests from a private grading pack. Require explicit per-exam Run rate/window/concurrency settings before enabling execution. A single concurrent Run per learner/attempt is a conservative proposal, not an implemented production limit.
- Keep temporary recovery no later than the trusted deadline and purge protected recovery on logout/access removal, subject to the explicit retention/purge specification. Exact retention duration/storage choice is still unset. This HTTP slice makes no local persistence decision.
- Freeze each real exam's question list and passing count before publication. No new four/pass-three default, deadline extension, hidden-test exposure, graded offline queue or automatic submission is introduced.

These decisions do not block the completed source boundary. The next independent source step is the versioned draft repository and transaction tests/migration draft, followed by the explicitly isolated Run executor/policy adapter. Applying retained database changes, provisioning credentials or starting further services remains outside authorization.

## Verification and handoff

Source evidence: `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-editor-api`. Final counts and checks are recorded in the completion result and `source-checks.json`.

Tests exercise real Request/Response handling through injected backend ports: origin/auth/role/scope, malformed metadata, deadline/definition mismatch, bounded exact bytes, conflict and commit-time denial, lost-acknowledgement lookup, response privacy, required visible-only policy and separate rate-limit handling. They do not prove database atomicity, durable drafts, actual resource isolation, live authentication, new editor browser behavior or Run execution.

No new browser verification is needed for this nonvisual source-only slice. The previously verified Home/Journey fixture and its 78-check result remain separate evidence, with its process intentionally left running for manual review.

Final source results: **47 new HTTP cases; 385 total tests across 36 files passed**. Full typecheck, lint, formatting and production build passed, including compilation of both new routes. No live Auth/database/persistence/executor test was run.
