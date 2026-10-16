# ADR-008 — Judge Job Lease and Result Protocol

## Status

Accepted

## Context

Judge execution is asynchronous. Workers can crash, lose connectivity, or finish
after ownership of a job has expired. Row locking prevents concurrent claims in
one transaction; it does not establish ownership throughout container execution.

ADR-002 supplies the PostgreSQL queue. ADR-007 separates learner failures from
infrastructure failures and permits two automatic infrastructure retries. This
ADR defines the durable protocol without moving progression into the Runner.

## Decision

### Ownership and execution attempts

One learner submission is distinct from its Judge Job and infrastructure
execution attempts. Every claim creates a new numbered attempt, including a
claim whose worker fails before compilation starts.

A job records its state, availability time, current attempt and worker, opaque
lease token, monotonically increasing lease generation, lease expiry,
infrastructure retry count, protocol version, and immutable evaluation snapshot.

A worker claims an eligible queued job using FOR UPDATE SKIP LOCKED in a short
transaction. The claim increments the generation, creates an unpredictable
token, creates the attempt, and commits before downloading or executing work.
No database transaction remains open during compilation or execution.

Renewal, attempt start, and result/failure recording require all of:

- the authenticated worker identity;
- the current job and attempt identifiers;
- the matching token and generation;
- an active job state and an unexpired lease, checked against the database clock.

A heartbeat reports worker health; it does not renew a job lease. An expired
lease cannot be resurrected. Revocation invalidates its token/generation. A
stale worker must stop and destroy its sandbox when it learns ownership is lost.
Fencing prevents its database writes even if that worker cannot be stopped
immediately; overlapping physical execution after a partition remains possible.

Pilot control-plane defaults are a 30-second lease, renewal every 5 seconds,
worker heartbeat every 10 seconds, expired-lease recovery every 10 seconds, and
result reconciliation at least every 60 seconds. These are operational settings,
separate from immutable learner execution limits. Recovery schedules must run
independently of a particular Runner process and learner page visits.

### States and bounded retries

Job states remain queued, claimed, running, completed, and system_error.
Completed means execution produced a learner verdict; it does not mean passed.

The queue protocol records queued/running lifecycle changes on the associated
submission through constrained database operations. The product application
applies terminal verdicts and all progression changes.

Wrong answers, learner compilation failures, learner runtime failures, and
learner resource-limit violations are not automatically retried.

Container startup failure, artifact/registry unavailability, Runner failure, and
lease expiry are infrastructure failures. A trusted recovery operation records
an expired attempt as system_error before deciding whether to requeue it.

Infrastructure failure recording atomically closes the attempt, persists its
failure result and audit event, and either:

- schedules the same job after 2 seconds for retry one or 10 seconds for retry
  two, with the submission returned to queued; or
- leaves the job in system_error after the third failed execution and identifies
  the durable terminal result for product application.

Each failed attempt consumes the retry budget at most once. Every system_error
remains in operator-visible history even if a later attempt succeeds. Automatic
retry is bounded to two retries: at most three execution attempts per job.
Notification or result-application failures never consume this budget.

### Narrow Runner database operations

The Runner has no direct table reads/writes, schema creation rights, role
administration rights, or progression permissions. A worker login is bound to
its registered worker identity; a caller-supplied worker ID cannot impersonate
another worker.

Only these database operations are exposed to the Runner role:

| Operation | Allowed effect |
| --- | --- |
| claim_job | Claim compatible work; create its execution attempt; return only required execution metadata and artifact references |
| renew_lease | Renew the caller's current, live claim |
| heartbeat | Update the caller's own worker health record |
| record_execution_attempt | Mark the caller's claimed attempt running and append protocol lifecycle events |
| record_result | Persist a validated learner verdict and atomically finish the owned job |
| record_infrastructure_failure | Persist failure evidence and atomically apply the bounded retry decision |

These are operation contracts, not function implementations. Security-definer
functions use a restricted non-login owner, fully qualified objects, a safe fixed
search path, validated inputs, and explicit execution grants. Default PUBLIC
execution is revoked in the same migration transaction. Functions cannot be used
to choose arbitrary tables, roles, paths, or application users.

Expired-lease recovery belongs to a separately authorized product maintenance
operation; a Runner cannot reclaim or mutate another worker's live attempt.
The Runner cannot write learner_node_progress or result-application receipts.

### Durable results and authority

Result recording locks the job and validates ownership before accepting the
first result for an attempt. Result payloads are immutable and bounded. A retry
of the same recording request returns the existing result ID; conflicting
payloads for an already recorded attempt are rejected.

A learner verdict requires a running attempt; infrastructure failure may close
either a claimed or running attempt. An identical recording retry may read its
previous receipt after the lease closes, but cannot create or mutate an outcome
without a current live claim.

The same transaction persists the result, finalizes its attempt, writes audit
events, and sets the job's terminal_result_id when the outcome is terminal.
Job completion clears its lease. A committed terminal result is not re-executed
because its notification was lost or its former lease subsequently expired.

Lease checks happen when accepting a result. Later product application uses
the durable terminal_result_id and the submission's active job reference; it
does not require a completed job to retain a live lease. Intermediate retry
failures remain evidence without becoming authoritative learner verdicts.

### Notification and product transaction

After persistence the Runner may call an authenticated internal product endpoint
identifying the durable result ID. It supplies no authoritative verdict, score,
progress state, or feedback in the notification.

The endpoint verifies a dedicated service credential and reads PostgreSQL. It
does not treat an ordinary learner/operator session as service authentication.
The product application then performs one transaction that:

1. Locks the relevant job, submission, result receipt, and learner/cohort progress
   in a consistent order.
2. Checks the result belongs to the submission's active evaluation and is the
   accepted terminal result.
3. Applies the explicit submission verdict.
4. On passed, moves the current node to mastered and evaluates dependent unlocks
   through the TypeScript domain rules.
5. Records state/analytics events and marks the result applied.

Duplicate requests return the existing processing outcome. Superseded results
and intermediate infrastructure failures are marked processed with a reason,
without changing mastery or unlocking nodes. Concurrent results for one learner
and cohort serialize progression updates. A later failure cannot regress mastery.

### Reconciliation

A separately authenticated scheduled product request scans bounded batches of
durable pending results and invokes the same application service. Processing
does not depend on an in-memory queue, a long-lived Next.js process, or a learner
opening a page. It also invokes authorized expired-lease recovery.

Failed application transactions leave results pending. Reconciliation may retry
application without re-executing learner code. Record pending-result age,
expired leases, retries, rejected stale writes, and reconciliation failures for
operators; repeated application failures require attention rather than silent
discarding.

## Delivery Semantics

- Execution is at least once; exactly-once execution is not assumed.
- Accepted terminal result application is idempotent and transactional.
- Audit history preserves infrastructure attempts separately from learner work.
- The product monolith exclusively owns progression.

## Consequences

This adds lease recovery, durable receipts, and reconciliation to the PostgreSQL
queue while retaining one product deployment and an isolated Go Runner. It
requires concurrency and failure-injection integration tests before launch.

Related: [immutable environments](ADR-009-immutable-evaluation-environment.md),
[schema](../DATABASE_SCHEMA_v0.1.md), and
[sandbox profile](../RUNNER_SECURITY_PROFILE.md).

Reference: [PostgreSQL security-definer function guidance](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).
