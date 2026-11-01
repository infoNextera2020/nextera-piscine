# Exam1 trace reader: restricted source contract

This source milestone extends `EXAM_TRACE_PROCESSOR_SOURCE_001.md`. It implements
the missing q6/q7 PostgreSQL reader adapter and proposes its native RPC and
comparator compatibility change. It does not install them or enable grading.
The separate PowerShell fake-test approval remains pending.

## Source gaps closed

- `0038_scored_exam_trace_context.DRAFT.sql` is unregistered and unapplied. It
  proposes one evaluator-only RPC and the exact comparator allowlist extension
  needed by the approved `crlf_lf_optional_terminal_lf_v1` policy. Historical
  `exact_utf8` semantics remain intact. Original DRAFT0024 and registered
  migrations are unchanged.
- The draft reader binds the current enabled evaluator principal to one immutable
  q6/q7 structured-answer acceptance, pending outbox and debit, frozen
  learner/cohort/attempt/question/answer identity, published source provenance and
  current scoring revision. It returns the existing processor's exact data ABI;
  expected answers and private reasoning checkpoints are never returned.
- Historical accepted answers remain gradeable after exam expiry or later
  learner/cohort deactivation. Acceptance must have occurred within the original
  attempt and before closure. Current intake-open checks do not invalidate it.
- `createPostgresScoredExamTraceReader` performs current session/role, function
  owner, signature, body hash and ACL attestation in the same parameterized
  statement as the reader call, on every read. It never reuses a previous pool
  connection's authority proof. Catalog argument and return types are qualified
  through `pg_catalog`.
- The adapter and existing processor share one bounded data-only snapshot parser.
  The adapter validates the complete receipt tuple, canonical answer bytes and
  provenance, without rewriting the stored answer. Missing client or explicit
  limits leaves it unavailable before client-method access; construction makes
  no query or connection.

## Proposed native authority

The draft is restricted to a direct bootstrap DBA in a synthetic
`foundation_test_*` database with existing owner SET/schema CREATE authority.
It creates no roles or memberships and grants no new table access. The new RPC
would be owned by the existing NOLOGIN checkpoint owner, with only the existing
exam-evaluator role receiving non-grantable EXECUTE. PUBLIC and other non-owner
execution are denied. The existing validator keeps its exact owner, OID, flags
and private ACL; only its approved comparator allowlist changes.

Runtime readers must be restricted LOGIN principals with current evaluator
membership, no role override and no web, result-application, Runner or owner
authority. The RPC independently rechecks its session principal and frozen
receipt. Source assertions are not evidence that these native properties are
installed or satisfied.

Pinned UTF-8 function-body SHA256 values:

- Reader: `3f2236d9f2c1c10a1904dbe82c16f83bf50a940cf3a618953f02667995e4afe1`.
- Replacement validator: `66bef21e55436ebf378b1e9f95f71451faddde4366720436a1228cb185f6b616`.

The adapter and regression tests bind these values to the actual draft bodies.
The bootstrap audit marker is not an authorization credential.

## Source verification and limits

Focused tests cover unavailable configuration, exact same-statement attestation,
fresh checks on repeated/pooled reads, source hashes, receipt and provenance
mismatches, q8 rejection, malformed or oversized data, getter-safe snapshots,
sanitized errors, deadlines and cancellation of only the owned pending query.
A composition test feeds the adapter through the existing trace processor and
restricted evidence writer using fake SQL clients and private synthetic criteria.
Static SQL tests verify the proposed body change, ABI and authority assertions.
Independent source review accepted the implementation.

A timeout requests cancellation where supported, ignores late results and never
retries. It does not prove PostgreSQL cancellation, connection closure or rollback.
No pool close, role mutation or alternative authority path is used.

## Remaining gates

- The SQL draft still needs native parse/execution, OID/ACL/role, baseline,
  concurrency, revocation and cancellation verification in a separately approved
  isolated rehearsal. No SQL, grants or migration registration were executed.
- Actual verified private-criteria/artifact loading and durable publication
  outbox adapters remain required. Valid-looking digests cannot substitute for
  authentic approval/provenance or complete published manual criteria.
- Work discovery, claiming/leasing, restart recovery and delivery are not supplied
  by this explicit-receipt adapter. Production composition remains unavailable
  without its real authority, artifact and durability bindings.
- q8 still needs the automatic structured repair-answer projection into the
  bound job/evidence producer. This trace-only reader deliberately denies q8.
- No real Auth, PostgreSQL, Runner, Storage, browser learner/mentor journey or
  Sunday readiness proof is established by these source/fake tests.

No new grading policy is introduced. Frozen transport sources and retained
diagnostic data remain untouched. Live grading is disabled.
