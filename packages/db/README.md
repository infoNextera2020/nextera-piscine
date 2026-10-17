# Database foundation

The approved model is [DATABASE_SCHEMA_v0.1.md](../../docs/architecture/DATABASE_SCHEMA_v0.1.md).
This package implements its 16 tables, six state/role enums, version/ownership
foreign keys, uniqueness, row-local checks, and operational indexes. The schema
entry can load without credentials. Runtime connections are exported separately
through `@nextera/db/connection`, guarded by `server-only`.

## Connections and migrations

- `DATABASE_URL`: server runtime only. The bounded Postgres.js pool disables
  prepared statements for Supabase transaction pooling.
- `MIGRATION_DATABASE_URL`: separate owner identity, using direct PostgreSQL or
  session pooling. `pnpm db:migrate` reads the repository-root `.env` when present.
- `TEST_DATABASE_URL`: local disposable test database, named `foundation_test*`.

`pnpm db:generate` generates reviewed SQL and metadata; `pnpm db:migrate` applies
the committed history. There is no database-push command or startup migration.
The standard `drizzle.__drizzle_migrations` bookkeeping table is outside the 16
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

## Structured fields

Evaluation specifications/snapshots store positive budgets under
`resource_limits.compilation` and `resource_limits.execution`: `cpu_limit`,
`memory_bytes`, `pid_limit`, `timeout_ms`, `output_bytes`,
`temporary_filesystem_bytes`, and `temporary_filesystem_inodes`. Missing, null,
non-numeric, zero, and negative budgets are rejected. The full immutable identity
contract remains ADR-009; digest verification and runtime payload validation
belong to publication/protocol milestones. No hidden test bytes belong here.

Measurements are flat nonnegative numeric objects. Feedback, safe diagnostics,
and activity payloads are JSON objects bounded to 64 KiB each. Protocol code must
construct the approved safe projections before persistence; a size check does
not prove hidden-test confidentiality.

## Explicitly deferred protocol invariants

These are required future work, not guarantees supplied by ordinary CHECK/FK
constraints or by this foundation:

- Published curriculum/evaluation/artifact immutability and cohort-version
  pinning after enrollment, through publication/runtime authorization boundaries.
- Full evaluation identity validation, trusted digest resolution, supported
  protocol matching, and resource-policy enforcement.
- Legal old-to-new state transitions, monotonic fencing generations, token
  matching, live-lease/database-clock checks, and atomic bounded retry decisions.
- Enforcing that a current attempt's lifecycle matches the job lifecycle.
- Classifying learner versus infrastructure failure and relating verdicts to
  terminal job state; authorized Runner result recording only.
- Verifying first-passing evidence is actually passed, authoritative, and the
  first applied evidence; mastery never regresses and its timestamps stay fixed.
- Transactional verdict/progress/receipt/event application, append-only audit
  permissions, receipt ownership, and reconciliation.
- Actor identity and cross-event semantic consistency beyond explicit foreign
  keys; idempotency-key content matching; graph cycle validation.

Do not expose runtime product or Judge operations before those boundaries are
implemented. No Runner, protocol functions, publication, or progression service
is included here.

## Tests

`pnpm test` checks vocabulary/schema exports and literal DDL checks.
`pnpm test:db` applies the real migration twice and tests PostgreSQL constraints.
It requires `TEST_DATABASE_URL` to target a local `foundation_test*` database.
The integration harness creates only a minimal external `auth.users(id)` fixture
in that disposable database and random test records. It does not implement or
simulate authentication, exercise Supabase sessions, or alter production Auth.
`pnpm test:auth` separately validates both migrations against actual local
Supabase Auth/PostgreSQL and exercises real browser sessions and authorization.
It also verifies the external Auth FK, private Data API schemas, and browser
role revocations. See the root README for setup and explicit provisioning.

Tests leave their random fixtures in the disposable database and never drop an
existing database. Do not point them at a shared or production service.
