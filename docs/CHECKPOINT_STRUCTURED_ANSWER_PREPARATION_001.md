# Structured Checkpoint answers — source preparation

Status: source and injected/static tests only, 30 October 2026. No SQL was parsed or executed, no database was connected, and no Auth, Runner, account, token or service was created. All earlier runtime leases remain closed.

## Implemented boundary

The approved eight-question Exam1 remains five coding answers, two trace-with-reason answers and one debug answer. This slice adds separate trace/debug server contracts to the existing mixed-answer UI. It does not reinterpret a structured answer as Go source or expose hidden grading material.

- `answer-server-contract.ts` binds the application learner, cohort, attempt, task, frozen definition and versioned answer contract. Canonical envelopes preserve text without trimming or newline conversion, with an exact UTF8 byte length and SHA256.
- `/api/checkpoints/answers/drafts` supplies authenticated GET and same-origin POST with explicit required body limits/timeouts, strict canonical JSON, scoped immutable receipts, CAS conflict reporting and separate storage errors. Rejected streams are cancelled without waiting on a hostile cancel promise. Save invokes no official acceptance, result, grade, Run or progression port.
- `postgres-answer-drafts.ts` accepts an existing injected restricted client only. It opens nothing during construction. The query adapter binds provider identity to application identity, verifies context/contract/receipt, captures Save intent before asynchronous work, and rejects mismatched acknowledgement bytes, request or version.
- `/api/checkpoints/answers/submissions` accepts only a separately supplied official service. That service captures an immutable complete snapshot and requires an exact reviewed evaluator route for its frozen definition, task, kind and version. It returns pending acceptance or an explicit uncertain outcome; it fabricates no grade. Exact replay requires the same current authority and frozen bytes and must not debit allowance twice.

The official repository port requires one transaction for current access/time/definition/contract/routing/allowance checks, idempotency, immutable payload and pending outbox acceptance. The contract now has concrete injected query/app adapters and an unregistered DRAFT0022 receipt/outbox/debit transaction proposal. Fake/static tests are not PostgreSQL transaction proof. No evaluator dispatcher or terminal result/allowance reconciliation is implemented by that intake draft.

Production assembly intentionally supplies null draft, official-submission and body-policy dependencies. There is no environment toggle that silently enables this slice. Existing source-only Save/Submit behavior remains separate. No active frozen mixed-answer definition is published by this work; activation must also prove that typed tasks cannot enter the legacy source-only submission route.

## Database draft and unresolved parity

`packages/db/migration-drafts/0021_checkpoint_answer_drafts.DRAFT.sql` is append-only, unregistered and unapplied. It requires an explicit frozen `answerContract` and matching explicit persistence policy; it does not infer a contract from a `.go` task. It proposes scoped locks, CAS, immutable idempotency receipts, storage accounting and bounded cleanup, with no policy seeds or production numerical defaults. Registered migrations and earlier DRAFT0011/0014 remain unchanged.

The initial jsonb validator was replaced in source with two exact canonical envelope grammars and one string-token grammar. It validates without decoding escaped NUL or rewriting payload bytes. The differential source corpus covers 68,124 vectors per answer kind (136,248 total), plus malformed UTF8/raw-NUL byte vectors. Readiness must identify the exact reviewed validator body and properties, because the prior implementation had the same signature. This is catalog identity, not native proof.

PostgreSQL regular-expression and UTF8 parity, native syntax, ACLs, actual concurrency, rollback and cleanup remain unverified. DRAFT0021 and DRAFT0022 cannot be activated from grammar/fake tests alone. Do not silently strip or normalize an answer, or reinterpret a source-model test as a PostgreSQL pass.

## Remaining ordered integration gates

1. Finish one fresh, independently reviewed co-resident Auth profile: real invitation issue/inspect/activate, separate issuer/activation/web clients, explicit confirmation/password/rate/origin policies, exact synthetic identity accounting and deadline-bound cleanup. The old direct-enrollment broker is not this flow.
2. Bind the proven owner/DBA migration-context and ACL adapters to that fresh target; preserve historical closed target guards. Confirm the provider's actual bootstrap authority and acknowledgements before requesting runtime approval.
3. Verify typed-draft native parity, then propose the smallest fresh private-socket synthetic database rehearsal for DRAFT0021 with explicit test limits and independent shutdown. No such rehearsal is executed here.
4. Natively verify the proposed concrete structured official acceptance/outbox persistence and implement the reviewed evaluator/result path. The approved future Exam1 duration is 180 minutes; weights 75 coding, 10 trace and 15 debug; pass requires at least 60 overall and 45 coding. Detailed partial-credit/retry rules remain separate. The historical synthetic four-task/90-minute fixture is unchanged.
5. Join real browser save/reload/conflict/revocation and immutable Submit evidence, then genuine grading/result/progression and exact-revision project mentor review. Fixtures and old SQL rehearsals cannot qualify this all-flow gate.

No fresh executable runtime proposal is ready yet. Before asking for one, the source profile must enumerate the exact new target, ports, roles/authority, account count, keys/session lifetime, migration hashes/order, selected content/pack digests, test policies, independent cleanup guard and retained evidence. Approval for source preparation is not permission to create those resources.

## Verification record

The complete source suite passed 1,560 tests across 85 files. Typecheck, repository lint, formatting, production build and diff checks passed. An independent reviewer also reran the 81 HTTP/app-adapter/official-service tests and accepted the corrected trust boundaries. The four unrelated original dirty files retained their exact hashes. Tests in this slice use fake clients, injected ports or static SQL inspection. Native PostgreSQL, authenticated browser integration, structured scoring, real outbox delivery and full learner/mentor E2E are unrun. The existing fixture preview remains separate and unchanged.
