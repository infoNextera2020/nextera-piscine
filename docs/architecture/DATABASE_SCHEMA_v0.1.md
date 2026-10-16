# Initial PostgreSQL Schema — Vertical Slice 001

Status: revised architecture baseline; implementation has not started.

This document specifies logical tables, invariants, and access paths. It is not
SQL or Drizzle implementation. PostgreSQL is the source of truth for product
state; Git remains the authoring source for curriculum.

## Conventions and authorization

- UUID primary identifiers, UTC timestamptz timestamps, and explicit foreign keys.
- Product tables live in an unexposed app schema; execution tables live in judge.
- Roles are learner, operator, and admin. Non-admin access is restricted to
  authorized cohort memberships; roles are read from domain records.
- A domain user has its own ID and a unique Supabase auth.users reference.
  Deactivate users and memberships rather than cascading away assessment history.
- The migration owner is separate from runtime roles. Browser roles have no
  product-table privileges. Drizzle requests require server-side authorization;
  they do not implicitly inherit Supabase JWT row filtering.
- The Runner receives only the operation grants in ADR-008. It cannot read/write
  general product tables or update progression or application receipts.

## Tables

Fields below are the initial logical columns. Timestamps are required unless
explicitly nullable or dependent on lifecycle state.

| Table | Fields and ownership |
| --- | --- |
| app.users | id; auth_user_id (unique FK to Supabase auth.users); display_name; role; active; created_at; updated_at. Product-owned identity integration. |
| app.curriculum_versions | id; curriculum_key; version; git_commit_sha; content_digest; digest_format_version; status (draft/published); published_at (nullable before publication). Publisher-owned immutable release. |
| app.quests | curriculum_version_id; quest_key; title; position. Composite primary key on version/key. |
| app.curriculum_nodes | curriculum_version_id; node_key; quest_key; kind (challenge/project/checkpoint); title; position; difficulty; subject_markdown; subject_digest; skills; submission_rules; resolved_evaluation_spec; evaluation_spec_digest. Composite primary key on version/key. Contains no hidden test bytes. |
| app.node_prerequisites | curriculum_version_id; prerequisite_node_key; dependent_node_key; rule (requires_pass). Composite primary key on version/from/to. |
| app.cohorts | id; slug; name; curriculum_version_id; status; starts_at; ends_at (nullable). Version is fixed once learners are enrolled. |
| app.cohort_memberships | cohort_id; user_id; status (active/inactive); joined_at. Composite primary key on cohort/user. |
| app.submission_artifacts | id; owner_user_id; storage_bucket; storage_key; original_filename; size_bytes; sha256; created_at. Immutable private object identity; no signed URLs persisted. |
| app.submissions | id; cohort_id; user_id; curriculum_version_id; node_key; artifact_id; idempotency_key; state; evaluation_spec_digest; active_judge_job_id; created_at; started_at (nullable); finished_at (nullable). One learner attempt. |
| judge.workers | id; db_principal (unique); runner_image_digest; protocol_versions; platform/capabilities; enabled; last_heartbeat_at (nullable). Provisioning owns identity and capabilities; worker heartbeat only updates health. |
| judge.jobs | id; submission_id; evaluation_number; state; available_at; protocol_version; immutable evaluation_snapshot; evaluation_digest; retry_count; lease_generation; lease_token (nullable); lease_expires_at (nullable); current_worker_id (nullable); current_attempt_id (nullable); terminal_result_id (nullable); created_at; finished_at (nullable). |
| judge.attempts | id; job_id; attempt_number; worker_id; lease_generation; claim_token; state (claimed/running/completed/system_error); claimed_at; started_at (nullable); finished_at (nullable); infrastructure_error_code (nullable). Distinct infrastructure execution record. |
| judge.results | id; job_id; attempt_id (unique); evaluation_digest; verdict; measurements; learner_feedback; safe_operator_diagnostics; recorded_at; application_status (pending/applied/superseded); processed_at (nullable); application_reason (nullable). Result payload immutable; only product processing changes receipt fields. |
| app.learner_node_progress | cohort_id; user_id; curriculum_version_id; node_key; state; unlocked_at; started_at; mastered_at; first_passing_submission_id. Nullable fields and constraints are specified below. |
| app.state_events | id; submission_id; job_id (nullable); attempt_id (nullable); result_id (nullable); entity_type; previous_state (nullable for creation); next_state; actor_type; actor_id (nullable); reason; correlation_id; occurred_at. Append-only protocol/product audit trail. |
| app.activity_events | id; event_type; event_version; user_id (nullable for system events); cohort_id (nullable); curriculum_version_id (nullable); node_key (nullable); submission_id (nullable); result_id (nullable); correlation_id; bounded payload; occurred_at. Append-only analytics; no hidden output or secrets. |

Subject Markdown and metadata are reproducible published projections. Runtime
roles cannot edit published curriculum. Private Judge artifacts are referenced
by identifier/digest only. Each job snapshot contains all identities specified
in ADR-009, including explicit compilation and execution limits.

Submission states remain queued, running, passed, failed, compile_error,
runtime_error, timeout, system_error, and cancelled. Job states remain queued,
claimed, running, completed, and system_error. Cancellation UI and changed-test
re-evaluation are outside the first slice; retaining the submission enum does
not introduce either workflow.

## Learner node progress

The primary key is cohort/user/version/node. Composite references ensure the
version is the cohort's version and the learner has a membership in that cohort.
All four progress states are persisted explicitly; a missing row is not treated
as an alternative representation of locked.

| State | unlocked_at | started_at | mastered_at | first_passing_submission_id |
| --- | --- | --- | --- | --- |
| locked | null | null | null | null |
| available | required | null | null | null |
| in_progress | required | required | null | null |
| mastered | required | required | required | required |

Transitions and ownership:

1. Enrollment initializes every node. Roots are available with unlocked_at set;
   other nodes are locked. Enrollment and progress initialization are atomic.
2. locked becomes available when all requires_pass prerequisites are mastered.
3. available becomes in_progress when the first valid submission and its job are
   committed. started_at is set once. Reading a subject does not start a node.
4. in_progress becomes mastered only when the monolith applies an authoritative
   passed result. It sets mastered_at and first_passing_submission_id once.
5. An incorrect submission, compile/runtime failure, timeout, infrastructure
   failure, or later failed submission never regresses node state.

The first passing submission is the first passing evidence successfully applied
for that learner/cohort/node. Concurrent/replayed result application cannot
replace it. Unlock/mastery timestamps preserve their original values.

Database checks enforce the nullability matrix and timestamp ordering:
unlocked_at <= started_at <= mastered_at when those fields exist. A composite
foreign key binds first_passing_submission_id to the same learner, cohort,
version, and node. Its passed verdict and authority are verified in the product
transaction; they cannot be proven by a row-local CHECK constraint.

There are no stored attempt-count or score columns on progress. Submission
counts, learner failure counts, time-to-first-pass, and any future supported
scores are derived from submissions/results. Infrastructure retries do not add
learner submissions, and system_error is excluded from learner failure metrics.
In Slice 001, mastered means the node's pinned correctness policy passed; skill
labels do not imply an additional numeric skill-mastery model.

## Relationships and integrity

- A curriculum version has quests, nodes, prerequisite edges, and cohorts.
- Quest/node and both edge endpoints reference the same curriculum version.
- A user has many cohort memberships and submissions. Every submission references
  its cohort/user membership and its cohort/version pair.
- A submission's artifact belongs to the submitting user. Initial uploads contain
  exactly the challenge's required Go file.
- A submission has one initial job, numbered evaluations, and one active job
  reference. Changed-environment evaluations remain outside the first workflow.
- A job has up to three numbered infrastructure attempts and at most one result
  per attempt. A terminal_result_id must reference a result from that same job.
- A result is applied only if the job is still the submission's active evaluation
  and the result equals the accepted terminal_result_id. Intermediate retry
  failures are processed as non-authoritative evidence without progression.

Enforce these constraints in migrations:

- Unique curriculum key/version, cohort slug, immutable storage bucket/key,
  job submission/evaluation number, and attempt job/attempt number.
- Unique idempotency key per cohort/user. Reuse with different node/artifact
  content is rejected; identical retries return the existing submission.
- At most one queued/claimed/running job per submission, via a partial unique index.
- Retry count in 0..2; attempt number in 1..3; positive lease generations and
  positive resource limits; nonnegative measurements; positive artifact size.
- Current attempt/worker/token/expiry are present for live claims and refer to
  the matching job. Terminal jobs have a durable terminal result and no live lease.
- Pending results have no processed_at; applied/superseded receipts have one.
- Relevant positive/unique curriculum positions, no self-edge, and same-version
  foreign keys. DAG cycles and unsupported rules are rejected at publication.
- Assessment history uses restrictive deletion rules. Deactivation preserves it.

Circular references (submission active job, job current attempt/terminal result)
are added after their target tables exist. Protocol functions maintain their
cross-row invariants transactionally. Defined state values do not by themselves
enforce legal transitions.

## Indexes

| Access | Index beyond primary/unique keys |
| --- | --- |
| Learner attempt history | submissions(cohort_id, user_id, node_key, created_at, id) |
| Operator cohort submissions | submissions(cohort_id, state, created_at, id) |
| Ready Judge work | jobs(available_at, id), partial where queued |
| Expired leases | jobs(lease_expires_at, id), partial where claimed/running |
| Worker health | workers(last_heartbeat_at), partial where enabled |
| Pending result reconciliation | results(recorded_at, id), partial where application_status is pending |
| Prerequisite checks | node_prerequisites(version, dependent node); reverse prerequisite lookup |
| Learner dashboard | learner_node_progress(cohort_id, user_id, state) |
| Submission/job audit | state_events(submission_id, occurred_at, id) and (job_id, occurred_at, id) |
| Cohort analytics | activity_events(cohort_id, event_type, occurred_at, id) |

Add foreign-key indexes where these keys do not already provide a suitable
leading prefix. Do not add speculative JSONB indexes or event partitioning.

## Transaction and migration ownership

Submission acceptance checks membership, unlock state, file policy, and artifact
identity. Its transaction creates submission/job/events and marks an available
node in_progress. Rejected uploads create no learner submission or job.

Runner functions maintain lease/attempt lifecycle only. Final result application
locks job then submission, result receipt, and cohort membership/progress; all
operations touching those same rows use a consistent order. Progress updates
for one learner/cohort serialize, and dependent nodes are processed in a stable
order. Accepted result payloads and terminal job authority are immutable.

The monolith applies the verdict, mastery, unlocks, analytics/audit events, and
processing receipt atomically. Rollback leaves the result pending. Receipt/event
uniqueness prevents duplicate application side effects.

Drizzle owns one reviewed migration history in packages/db/migrations. Use
generated migrations plus reviewed custom SQL for privileges and protocol
functions; do not alter Supabase-managed Auth/Storage schemas. A controlled
migration step uses separate credentials. Validate clean migration/reapplication
on real PostgreSQL, including the Auth foreign key in a local Supabase stack.
Production changes use expansion/backfill/cleanup and compatible protocol
versions; no startup migrations or schema push against shared databases.

Curriculum publication is a separate idempotent operation from schema migration.
Artifact upload precedes database commit; cleanup removes aged unreferenced
objects without deleting artifacts referenced by retained assessments.

Related: [ADR-008](adr/ADR-008-judge-job-protocol.md),
[ADR-009](adr/ADR-009-immutable-evaluation-environment.md), and
[acceptance/testing](../product/VERTICAL_SLICE_001.md).
