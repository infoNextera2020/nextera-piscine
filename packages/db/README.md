# Database foundation

The approved model is [DATABASE_SCHEMA_v0.1.md](../../docs/architecture/DATABASE_SCHEMA_v0.1.md).
This package implements its initial 16 tables plus four Foundation 006 checkpoint tables, six state/role enums, version/ownership
foreign keys, uniqueness, row-local checks, and operational indexes. The schema
entry can load without credentials. Runtime connections are exported separately
through `@nextera/db/connection`, guarded by `server-only`.

## Connections and migrations

- `DATABASE_URL`: server runtime only. The bounded Postgres.js pool disables
  prepared statements for Supabase transaction pooling.
- `MIGRATION_DATABASE_URL`: separate owner identity, using direct PostgreSQL or
  session pooling. `pnpm db:migrate` reads the repository-root `.env` when present.
- `TEST_DATABASE_URL`: local disposable test database, named `foundation_test*`.
- `OPERATIONS_DATABASE_URL`: privileged publication/cohort/enrollment tooling only;
  separate from normal web runtime credentials. Local setup uses the disposable
  local migration owner; hosted operations require separately provisioned access.

`pnpm db:generate` generates reviewed SQL and metadata; `pnpm db:migrate` applies
the committed history. There is no database-push command or startup migration.
The standard `drizzle.__drizzle_migrations` bookkeeping table is outside the 20
domain tables. Production must already have the Supabase-managed `auth.users`
table. Application migrations reference it and never create or change it.

The initial migration has two reviewed additions after generated SQL: deferred
validation of `submissions_active_job_fk`, and revocation of PUBLIC schema/table
access. Deferral permits inserting a submission and its required active job in
one transaction while rejecting orphan commits. Drizzle's snapshot does not
record this property; preserve the SQL addition on future constraint changes.

Foundation 002A adds a separate reviewed privilege migration, `0001_identity_access`.
The NOLOGIN `nextera_web` permission role receives schema usage and SELECT only
on the five user-resolution columns. Browser roles and PUBLIC cannot access
private app/judge objects. The local setup script provisions a separate runtime
LOGIN; do not connect the web application as the migration owner. Hosted setup
must keep private schemas out of the Data API and preserve explicit grants.
No Judge protocol role or function is included.

Foundation 002B adds reviewed migration `0002_curriculum_enrollment`: four
SECURITY INVOKER trigger functions guard published versions and child projections,
serialize membership writes with cohort pinning, and prevent changing an enrolled
cohort's version. Publication validates a nonempty DAG and complete metadata
identities; existing positive-resource constraints remain intact. No table,
column, enum, index, or Judge protocol function is added.

Additional `nextera_web` SELECT column grants:

| Table                 | Columns                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| cohorts               | id, slug, name, curriculum_version_id, status, starts_at, ends_at                                                         |
| cohort_memberships    | cohort_id, user_id, status, joined_at                                                                                     |
| curriculum_versions   | id, curriculum_key, version, status                                                                                       |
| quests                | curriculum_version_id, quest_key, title, position                                                                         |
| curriculum_nodes      | curriculum_version_id, node_key, quest_key, kind, title, position, difficulty, skills, submission_rules, subject_markdown |
| node_prerequisites    | curriculum_version_id, prerequisite_node_key, dependent_node_key, rule                                                    |
| learner_node_progress | cohort_id, user_id, curriculum_version_id, node_key, state, unlocked_at, started_at, mastered_at                          |

There are no direct web writes or direct reads of evaluation specifications,
publication digests, artifacts, submissions, or Judge data. User/cohort
row authorization remains enforced in server adapters as required by the accepted
architecture; these direct SQL connections do not inherit browser JWT filtering.

## Foundation 004 protocol

Migration 0003 retains sixteen tables. Web receives EXECUTE on
`app.submission_context`, `app.accept_submission`, and `app.read_submissions`.
Verified server Auth identity supplies the acting UUID. Database functions repeat
active learner/membership/cohort/node checks, resolve the pinned specification,
and atomically create artifact/submission/job/audit rows. Advisory locks serialize
request idempotency and learner ordinals. Changed content under an existing request
ID is rejected. Source blobs never enter PostgreSQL. Progress remains unchanged.

`nextera_runner` receives judge schema usage and exactly six EXECUTE grants:
`claim_job`, `renew_lease`, `heartbeat`, `record_execution_attempt`, `record_result`,
`record_infrastructure_failure`. A real LOGIN maps through `session_user` to its
registered worker. No direct table, schema creation, role administration, progress,
or result-receipt permissions reach workers. Optional provisioner-owned
`fixture_cohort_ids` restrict fixture claims to explicitly assigned test cohorts.

`nextera_judge_maintenance` receives only `recover_expired(integer)`. Run the
independent maintenance process every ten seconds. It closes expired attempts
before bounded retry, without applying results or progression. Claims use row
locks and SKIP LOCKED; renew/start/new result recording validate worker, attempt,
token, generation, state, and the database clock. Heartbeats never extend leases.
Identical recording retries return the existing receipt after lease closure;
conflicting payloads fail. Infrastructure retries wait 2/10 seconds and permit at
most three attempts. Terminal outcomes cannot be claimed again.

New functions use fixed `search_path=pg_catalog`, qualified objects, revoked PUBLIC
execution, and restricted NOLOGIN owner `nextera_judge_owner`. Owner grants:

- SELECT on users/cohorts/memberships/versions/nodes/progress/workers;
- SELECT/INSERT on artifacts, state events and results;
- SELECT/INSERT/UPDATE on submissions/jobs/attempts;
- UPDATE(last_heartbeat_at) on workers;
- UPDATE(id) on users/cohorts and UPDATE(joined_at) on memberships, solely because
  PostgreSQL FOR SHARE requires an UPDATE privilege. Exposed functions never
  change those columns.

The owner has no progress, application-receipt or activity-event writes. Temporary
schema CREATE and migration-login SET membership are revoked in the migration
transaction. Supabase's automatic role-creator ADMIN record can remain, without
INHERIT/SET access. No owner membership reaches runtime logins. Immutable-history
triggers reject identity/snapshot/payload changes and audit updates/deletes.

Migration 0004 creates Storage policies when its managed table exists; it changes
no managed table definitions. Users insert/read their own private source prefix.
A separate signed one-hour local credential reads the source bucket, with no
overwrite/delete/admin capability. Restrictive policies protect source immutability
and read scope even alongside unrelated permissive policies. app/judge stay private.

The user approved an isolated fixture exception: real local OCI layout references
require a `test_only` projection, the test curriculum prefix, and a disposable
`foundation_test*` database. Runner additionally checks loopback fixture mode and
the exact protected layout mapping. Normal intake still requires a remote OCI
reference; publisher/candidate gates remain intact and candidate references null.

Authorized history returns the learner's latest 50 safe summaries. Terminal state
comes from the active job's authoritative result. Foundation 005 atomically finalizes
stored submission state, mastery/unlocks, events and the processing receipt through
a separate trusted product application connection.

## Structured fields

Evaluation specifications/snapshots store positive budgets under
`resource_limits.compilation` and `resource_limits.execution`: `cpu_limit`,
`memory_bytes`, `pid_limit`, `timeout_ms`, `output_bytes`,
`temporary_filesystem_bytes`, and `temporary_filesystem_inodes`. Missing, null,
non-numeric, zero, and negative budgets are rejected. The full immutable identity
contract remains ADR-009. Publication tooling validates a protected metadata-only
catalog and hashes the resolved specifications. The Go executor verifies artifact
bytes and frozen snapshots before execution. No hidden test bytes belong here.

Snapshot digest format 1 is SHA-256 of UTF-8
`nextera-evaluation-snapshot\0v1\0` followed by canonical JSON. Object keys sort
by C/ASCII order, arrays retain order, and all current pilot budget numbers are
integers (including CPU=1). The snapshot extends the published evaluation spec
with curriculum UUID/Git commit, membership scope, learner submission UUID/ordinal,
acceptance time, and source reference/size/SHA-256. SQL, TypeScript and Go agree in
integration tests. Source SHA-256 hashes exact uploaded bytes without normalization.

Measurements are flat nonnegative numeric objects. Feedback, safe diagnostics,
and activity payloads are JSON objects bounded to 64 KiB each. Protocol code must
construct the approved safe projections before persistence; a size check does
not prove hidden-test confidentiality.

## Trusted product application

Migration 0005 introduces the isolated NOLOGIN permission role
`nextera_result_application`. A separate trusted product login inherits it; the
web runtime, Runner and browser roles do not. Its SELECT rights cover stored
submission/job/result identity, pinned curriculum/prerequisites, memberships and
progress. Column UPDATE rights cover submission lifecycle, receipt fields and
progress; UPDATE(id) on jobs and UPDATE(joined_at) on memberships permit row locks.
Only INSERT is granted on state/activity events. There are no result-payload,
execution-attempt, worker, curriculum, source or role-administration writes.

`operations/results.ts` accepts only a durable result ID. One transaction locks
job, submission, receipt, the intake-compatible learner/cohort advisory key,
membership and all progress rows in node order. Stored immutable identities and
terminal authority determine the outcome; TypeScript domain rules determine
mastery and AND prerequisite unlocks. Existing result receipt columns and immutable
events bind evidence through result/job/submission and membership/version/node
foreign identities. A database trigger prevents changes to a processed receipt.

An AFTER INSERT submission trigger starts an available node at acceptance time.
Its SECURITY DEFINER owner is the restricted product role; its search_path is
pg_catalog and all objects are qualified. PUBLIC execution is revoked. It is a
trigger-only operation with no caller-selectable state/node parameters; only a
real accepted submission insert invokes it. Function ownership transfer uses
same-transaction temporary migration membership and revokes CREATE/SET access.
A migration backfill starts existing Foundation 004 submissions without changing
Judge evidence, access status or immutable submission identity.

Already accepted results apply historical progression after deactivation; current
reads and intake remain authorized independently. This policy was explicitly
selected by the user for Foundation 005. Cohort version pins remain authoritative;
there is no mutable global-current version check or changed-environment workflow.

`reconcileResults` scans bounded pending batches and invokes the same transaction.
Concurrent scans may duplicate work selection; database locks converge on one
receipt and event set. Failures stay pending and return attention_required.
The dedicated reconciliation command can also invoke separately authorized lease
recovery. Neither notifications nor application retries consume execution retries.
See the root README for service/scheduler configuration.

Storage credential issuance/rotation, retention and aged orphan cleanup remain
future operational work. No referenced source or assessment history is deleted.

## Trusted checkpoints (Foundation 006)

Migrations 0006 and 0007 add immutable checkpoint definitions, timed attempts,
outcome receipts and infrastructure replacement grants. The cohort-pinned
snapshot freezes four checkpoint-specific evaluations and a trusted 90-minute
deadline. Task submissions reuse the existing Judge and product-application
pipeline. The product finalizer aggregates authoritative applied task results,
then commits checkpoint mastery and satisfied AND-prerequisite unlocks atomically.

The isolated NOLOGIN `nextera_checkpoint_owner` owns narrow checkpoint functions.
Web and Runner have no direct checkpoint table access. Only the separate product
role may invoke finalization and retake announcements; callers cannot supply a
score, verdict, task credit or time. PUBLIC function execution and temporary
migration ownership access are revoked within the migration transaction.

Two normal attempts, a 24-hour retake cooldown, permanent passes, fair-quota
infrastructure classification and scoped replacement grants follow the
[accepted checkpoint policy](../../docs/product/FOUNDATION_006_CHECKPOINT_POLICY.md).
Historical application preserves current access restrictions. The independent
result reconciler also closes expired attempts and finalizes ready outcomes.
See the [Foundation 006 report](../../docs/FOUNDATION_006_REPORT.md) for validation,
privilege audits and the unapproved evaluation catalog identities.

## Tests

`pnpm test` checks vocabulary/schema exports and literal DDL checks.
`pnpm test:db` applies the real migration twice and tests PostgreSQL constraints.
It requires `TEST_DATABASE_URL` to target a local `foundation_test*` database.
The integration harness creates only a minimal external `auth.users(id)` fixture
in that disposable database and random test records. It does not implement or
simulate authentication, exercise Supabase sessions, or alter production Auth.
`pnpm test:auth` separately validates all migrations against actual local
Supabase Auth/PostgreSQL and exercises real browser sessions and authorization.
It also verifies the external Auth FK, private Data API schemas, and browser
role revocations. See the root README for setup and explicit provisioning.
`pnpm test:cohorts` tests real browser sessions, controlled CLI cohort/enrollment
operations, scoped reads, and locked-subject denial with explicitly non-runnable
test-only projections. They never publish the real unresolved curriculum.

Tests leave their random fixtures in the disposable database and never drop an
existing database. Do not point them at a shared or production service.
