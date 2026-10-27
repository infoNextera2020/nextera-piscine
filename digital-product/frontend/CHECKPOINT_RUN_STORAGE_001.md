# Run reservation/outbox storage - source proposal 001

Status: **unapplied SQL draft plus prepared repository/application adapters and injected tests**. No SQL parser or database connection was used. No SQL execution, retention policy activation, worker/executor/service startup, account, token, password or permission-role provisioning occurred. Production draft/Run adapters remain null, and the manually accepted Home/Journey preview remains stopped.

## Deliverables

- `packages/db/migration-drafts/0012_visible_runs.DRAFT.sql` is outside `migrations/` and its journal. It is not installed by `db:migrate`. It depends on existing Checkpoint foundations, not the unapplied draft-storage migration 0011.
- `packages/db/queries/visible-runs.ts`, exported as `@nextera/db/visible-runs`: catalog-only readiness for distinct web/worker/maintenance callers; prepared context, admission/read, bounded discovery, claim/pulse/complete, recovery and payload-purge RPC adapters. Importing it opens no connection. Unknown contract, broad privileges, malformed bytes/projection or invalid acknowledgement fails closed.
- `apps/web/lib/checkpoints/postgres-runs.ts`: prepared factory over those injected ports. It independently validates canonical public configuration identities, then uses the existing Run authority/reservation contract. `editor-backends.ts` does not instantiate it.
- `visible-run-spec.ts`: canonical public artifact serializers and mandatory **separate compilation, startup and lease budgets**, plus explicit cumulative storage/read-retention settings. Source fixtures are synthetic only; no production values are seeded.
- Pure test fixtures and injected repository/adapter tests, including source-registration/guard checks. Reading SQL text is not parsing or executing it.

## Proposed durable data model

Six isolated owner/RLS tables separate immutable public profile binding, admission receipts, exact source bytes, bounded result bytes, outbox state and disabled-by-default database-principal mappings. Profiles default disabled. No public example, enabled profile, principal mapping, image, quota value or scheduler is seeded. All permission roles are prerequisites; the draft creates none.

The public manifest and policy are stored as exact canonical UTF-8 bytes with domain-separated digests. Public examples can contain JSON-escaped NUL without converting the manifest to PostgreSQL JSONB. The prepared web/worker layer must parse and revalidate the public-only manifest, harness and digest before use. SQL validates policy fields and its immutable definition/task binding; it does not certify that a trusted administrator authored the right public examples. Publication/driver/approval gates remain necessary. Policies are shared across the questions of one exam definition; profile binding edits are rejected, with an explicit enabled/disabled hold available. Schema checks and adapters remain unverified against a real PostgreSQL host.

One accepted request is designed to insert an immutable learner/request receipt, exact bytea source and one dedicated outbox row in the same statement transaction. Its digest binds every scope/definition/request/source/manifest/policy/deadline field. The current learner/cohort lock order is preserved, with a separate learner Run lock. Exact duplicate requests are checked before new quota charges; conflicting reuse is rejected. Deadline, active access, task rules and explicit profile are rechecked at admission. No ordinary submission, Judge job, checkpoint outcome, mastery or unlock write appears in this draft.

Separate accounting uses only Run receipts/outbox: a rolling per-learner Run admission window, unfinished per-learner/attempt concurrency, and explicit cumulative attempt receipt/source-byte capacity. All questions share the same exam policy, avoiding a question switch selecting a different quota. Receipts remain as immutable idempotency/accounting metadata after payload purge; metadata/tombstone retention still needs owner review before any live enablement. Draft saves and graded submissions are not counters for Run.

## Proposed outbox and recovery protocol

Outbox discovery is bounded and only a hint; it neither claims work nor authorizes execution. Claim takes the normal locks, rechecks access/time/profile/runtime-image identity, and fences work with a generation and lease token. These are data-level fencing identities, not newly provisioned Auth credentials. A worker must receive the start acknowledgement before any user compilation or execution, using the immutable public work/configuration. The actual executor and proof verifier are not implemented here.

`queued -> claimed -> running -> terminal` is the normal source proposal. Queued work that never acquired a worker can expire safely. A claimed/running lease expiry or access/deadline uncertainty moves to **recovery_required** and still occupies concurrency capacity. Lease timeout alone never releases that slot or returns work to queued. A missing completion acknowledgement can be retried against the same fenced immutable terminal receipt; conflicting/stale completion is rejected. There is no automatic redispatch after claim.

Completion/reconciliation requires a trusted stop-evidence digest, restricted worker/maintenance caller and the matching generation/token where applicable. A digest's presence is **not proof that a process stopped**. A future trusted runtime/maintenance adapter must verify real external stop evidence before calling these operations. Do not wire a user-supplied boolean/hash or elapsed lease time to automatic release. Database fencing does not establish exactly-once external execution. Actual worker crash, concurrent claims, stale leases, lock ordering and reconciliation must be exercised in an authorized integration test before enabling anything.

Source and output payloads are stored separately from immutable accounting receipts. The proposed bounded maintenance purge accepts an explicit cutoff/batch, caps cutoff at trusted now, and removes only already-expired **terminal** source/output payloads; uncertain active work remains held until proven stopped. No purge scheduler is installed. Logical read expiry, physical cleanup timing, exceptional held-work retention and minimal metadata/tombstone retention require an approved policy. This code does not silently select those retention values.

## Execution time means execution time

The earlier **two-second recommendation is the aggregate visible-example execution budget only**. Compilation and container/startup each require their own positive configured budget; neither is silently charged to, or allowed to extend, that two-second execution budget. A lease/heartbeat lifetime is a separate liveness mechanism, not an execution or compilation allowance. The future executor must enforce every budget externally and cap combined output while it is produced. No resource enforcement is proven by parsing a policy.

For review only: retain the earlier proposal of **one concurrent Run per learner/attempt**, **five new Runs per minute**, **two seconds of execution**, **128 MiB memory** and **16 KiB combined output**. Set source no larger than the smallest relevant authored task source limit. Calibrate compilation/startup separately against the approved fixed driver before choosing their limits. Do not approve a single combined two-second timer. Lease, cumulative Run/source storage, result/source read expiry and metadata retention remain explicit decisions, with no numeric production defaults in code or SQL.

## Readiness and authorization boundaries

Readiness is a read-only catalog/permission probe: expected hardened owner/search path/function ACLs, private helpers, isolated RLS tables, guards, isolated NOLOGIN permission roles and a least-privileged non-owner caller with one intended Run capability. It always reports `liveRunVerified: false`. Structural readiness is not policy availability, enabled execution, SQL correctness or a live rehearsal. The prepared adapter additionally validates source/configuration identities and precise output projection; it cannot replace atomic database checks or a real sandbox.

The draft requires existing `nextera_checkpoint_owner`, `nextera_visible_run_worker` and `nextera_visible_run_maintenance` isolated NOLOGIN permission roles, plus separately approved enabled principal mappings for future worker/maintenance connections. It does not create them, issue credentials or broaden a retained login. Future application to any target requires a reviewed migration/schema registration, rollback/export plan and specific target/principal approval. Applying this file to retained data is outside current authorization.

Before data exists, a reviewed rollback can remove only these new objects. After intake exists, disable the production adapter/profile first, stop/fence workers, preserve receipts/evidence, and resolve or prove stopped all held work before retiring payloads or schema. Do not reset old foundations, delete unrelated data, drop credential roles or infer that running work has stopped.

## Smallest next verification gate

Recommend a separately approved disposable PostgreSQL cluster with a private mode-0700 Unix socket, no TCP or application passwords/Auth tokens, and synthetic data only. Its bootstrap would create the existing foundations plus the two new NOLOGIN permission-role prerequisites inside that disposable cluster, apply draft 0012 there only, use synthetic disabled/enabled mappings via test session authorization, and clean up completely afterward. No cluster or role is created by this source slice.

Required real cases: complete migration rollback/application and default ACL cleanup; canonical TypeScript/SQL intent digest parity; duplicate concurrent admission; one available slot versus two different requests; shared-question quotas; access/finish/deadline races; profile hold/configuration concurrency; concurrent claim/start; exact completion replay; stale tokens/generations; queued expiry versus uncertain claim expiry; missing/invalid stop evidence; terminal-only bounded source/output purge; unauthorized web/worker/maintenance callers; and complete cleanup. Injected tests and SQL string checks do not establish these properties in PostgreSQL.

No external executor launch is included in that suggested database-only rehearsal. Sandbox/image availability, process stop evidence, compilation/startup/execution timing and browser/editor integration need their own reviewed plan and authorization.

## Source verification

Evidence directory: `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-run-storage`. Final counts/checks are recorded after verification. The earlier 13 real PostgreSQL tests verified draft 0011 only; they do not verify this new Run SQL. No new browser QA is claimed. Four original unrelated dirty files are preserved; no push/deployment.

Source review corrections before commit: the draft claim clock is refreshed after access-lock waits, profile holds serialize with lifecycle checks, and readiness now includes the computed private-helper and permission-role checks in its pass condition. The per-flag tests isolate catalog failure from caller permission, so they do not pass merely because a secondary mocked permission response is missing. These are source corrections; SQL behavior remains unverified.

The draft also refuses any preexisting Run object names/overloads before creation/ownership cleanup, so it cannot silently adopt unrelated objects during grant cleanup. Its migration search path is transaction-local and pinned to pg_catalog. These boundaries remain source-reviewed, not executed.

Final source verification: **64 new cases; 582/582 tests across 42 files passed**. Full typecheck, lint, formatting and production build passed. SQL source-boundary checks were rerun after the final namespace safeguard; draft 0012 was not parsed or executed. No database/worker/browser integration test is claimed.
