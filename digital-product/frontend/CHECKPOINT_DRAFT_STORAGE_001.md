# Versioned Checkpoint draft storage — source slice 001

Status: prepared PostgreSQL repository/adapter, injected tests and **unapplied migration draft**. The production adapters in `editor-backends.ts` remain null. No database connection, DDL, data/role/credential change, service startup, persistence rehearsal or real learner operation was performed.

## Deliverables

- `packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql`: standalone review draft, outside the migration runner's `migrations/` directory and absent from its journal. Do not move/apply it to a retained database as a side effect of this commit.
- `packages/db/queries/checkpoint-drafts.ts`: catalog-only readiness probe, scoped context/read/save RPC interfaces, strict record projection, exact UTF-8/base64/hash validation and private SQLSTATE mapping. Exported via `@nextera/db/checkpoint-drafts`; importing it does not connect to a database.
- `apps/web/lib/checkpoints/postgres-drafts.ts`: prepared factory for the existing draft HTTP backend port. It is not instantiated or enabled by production wiring.
- Repository/adapter tests use injected `execute` callbacks. Migration tests inspect source and registration boundaries only; they do not parse or execute PostgreSQL and are not proof of transaction/race correctness.
- HTTP UUIDs are canonicalized before validation/comparison, matching PostgreSQL UUID representation. Commit-time definition mismatch has a distinct 412 response. Existing global identity validation and graded submission behavior are unchanged.

## Proposed persistence contract

Each accepted revision is an immutable receipt scoped to the authoritative learner/cohort/attempt/question/definition. A save has a unique learner/request ID, base version, next version, exact bytea source, server-verified SHA-256 and trusted timestamps. Bytea/base64 preserve BOM, CRLF, Unicode and NUL without converting protected source through PostgreSQL text. The repository rejects malformed UTF-8, noncanonical base64, hash/length mismatch, foreign scope or an incoherent acknowledgement.

The draft SQL reuses the existing learner/cohort advisory lock order and `checkpoint_lock_access`, then locks the attempt. A request-ID lock also serializes duplicate IDs across cohorts for the same learner. It rechecks ownership, active enrollment/cohort, immutable task/definition, explicit enabled policy and trusted time before accepting new content. Save and finish use the same learner lock namespace, so a later real concurrency rehearsal must establish their ordering in PostgreSQL.

Exact duplicate receipts return their original revision without moving the current head. Reuse with different scope/base/bytes is a conflict. A new save only inserts when its base equals the latest committed version; a concurrent loser receives the actual authorized current revision without overwriting it. GET may look up the original request receipt independently of the head. Accepted receipt replay never creates another revision. No draft write creates a submission, Judge job, verdict, mastery or unlock.

Readiness requires the three expected hardened functions, isolated owned/RLS-enabled tables, guards, only the intended web execution grants, a least-privileged web caller and no owner-role inheritance/SET ability. Missing contract, unexpected grants/privilege, malformed projection or catalog failure fails closed. Catalog readiness explicitly is **not live persistence verification**. The SQL draft removes unexpected deployment default grants only on its new objects and grants web EXECUTE only on context/read/save; no direct web table access or web cleanup privilege is added.

## Retention and storage limits are proposals, not configured policy

Policy rows default disabled; the migration seeds none. Enabling requires explicit source-byte, receipt-count, total-byte and retention-after-deadline settings. No production values are selected. Limits are separate draft-storage safeguards and do not consume graded attempts or decide Run allowances.

Proposed retention model: writes stop at the trusted deadline/finish; exact receipts remain readable only to a currently authorized learner until the configured deadline-plus-retention expiry. Each receipt freezes its expiry. Used policy settings cannot silently change under retained data, though an explicit disabled hold can stop access. Access removal blocks reads/writes immediately through the existing locks; it does not silently award, exclude or extend an exam.

An admin-only cleanup function is drafted, not scheduled or granted to the web role. It accepts an explicit bounded batch and deletes only rows already expired by trusted server time, never a future cutoff. After expiry/purge, draft receipt/source history is unavailable; official submissions/results are unaffected. The owner must review retention/read-after-finish, physical cleanup and minimal metadata/tombstone needs before production enablement. Browser offline retention/logout purge remains a separate still-unconfigured adapter concern. No indefinite retention or automatic deletion policy is activated by this source commit.

## Verification limits and rollout gate

The normal source suite covers safe parameter binding, exact byte round trips, missing-contract failure, scope/hash/version validation, conflicts, original-intent reads, error privacy and disabled production wiring. It does not prove that the SQL parses, its owner/ACL changes work on an actual host, row locks serialize correctly, cleanup is physically effective or the browser autosaves. No source-test result may be called a live database test.

The migration is deliberately not added to the installed Drizzle schema/journal. Promotion must include the reviewed schema mapping and migration registration, migration-owner/default-grant checks, rollback/export considerations and an authorized isolated SQL rehearsal first. Rollback before data exists can remove only the new objects; after accepted drafts exist, first disable the adapter/policy and preserve or explicitly dispose of retained source according to the agreed policy. Do not roll back old foundations, reset databases or drop unrelated objects.

## Smallest next real-verification approval

Recommend one disposable PostgreSQL 16 cluster under a newly created `/tmp/nextera-checkpoint-draft-test-*` directory, private mode-0700 Unix socket only (`listen_addresses=''`, host auth rejected), database `foundation_test_checkpoint_drafts_ephemeral`. Apply the existing foundations needed for Checkpoint plus this draft **there only**, using test-only fixture identities/definitions and explicitly test-only limits/retention. The existing isolated Raid runner demonstrates the installed-runtime/private-socket/cleanup pattern; it must not be run or repurposed against retained databases under this source-only approval.

That next approval would cover temporary initdb bootstrap identity and the foundations' temporary NOLOGIN roles confined to the disposable cluster, with no application login passwords, Auth accounts/tokens, Docker, TCP listener, retained database or current preview change. Stop the cluster and verify removal on success/failure; preserve test logs, not credentials. PostgreSQL binary installation is not included.

Required SQL cases: first save, exact duplicate, ID/body/base/scope conflicts, two-session same-base race with exactly one accepted revision, cross-task independence, cross-user/attempt/definition denial, access-removal and finish/deadline races, empty/BOM/Unicode/NUL bytes, disabled/missing policy, storage bounds, expiry/read denial and bounded purge. Test-only configuration does not approve any production retention value.

## Remaining Run work

The Run backend stays null. It still needs a server-owned visible-example manifest/digest, explicit separate resource/rate/concurrency policy, isolated executor/reservation store, immutable Run-source identity and safe result projection. Do not reuse private grading packs, ordinary graded receipts or draft storage counters as Run authorization. These requirements do not block the prepared draft source slice.

Evidence: `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-draft-storage`. The running Home/Journey fixture remains separate and unchanged at 127.0.0.1:3118, PID 527.

Final source verification: **48 new cases; 433 total tests across 39 files passed**. Full typecheck, lint, formatting and production build passed. SQL source guard tests are included in those counts; no PostgreSQL parser/execution/concurrency/ACL test was run. The migration journal and production null adapters remain unchanged.
