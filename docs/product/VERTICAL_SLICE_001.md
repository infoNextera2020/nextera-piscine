# Vertical Slice 001 — Submission, Mastery, and Unlock

Status: architecture revised after approval with required changes.
Implementation is not authorized by this documentation update.

## Objective and boundary

Prove the complete two-challenge learning loop using a real product application,
Supabase Auth, PostgreSQL, private storage, and the isolated Go Runner:

Sign in -> access cohort -> read Hello Go -> submit a local file -> assessment
-> feedback -> Hello mastered -> Even or Odd available.

Use the current foundations quest and requires_pass edge in the Git curriculum.
No browser editor or execution environment is part of this flow. Screens are
minimal and local to apps/web, styled with Tailwind CSS. Shared UI packages stay
empty until actual reuse requires a primitive or token implementation.

## Acceptance criteria

### Required first E2E

Given a learner authenticated through Supabase and enrolled in a cohort pinned
to an immutable published curriculum version:

| Step | Submission expectation | Hello Go progress | Even or Odd progress |
| --- | --- | --- | --- |
| Initial cohort view | No submissions | available; unlocked_at set | locked; all progress timestamps null |
| Incorrect hello.go accepted | One queued submission/job; eventually failed | in_progress; started_at set | locked |
| Incorrect result displayed | Failed learner assessment with safe feedback | in_progress; no mastery evidence | locked |
| Correct hello.go accepted | A second learner submission/job | in_progress | locked until passing result application |
| Correct result applied | passed; durable receipt applied | mastered; mastered_at and first_passing_submission_id set | available; unlocked_at set; started_at null |

This exact sequence must pass through the browser and real Runner without
mocking the judge verdict or directly updating progression in the test.

Refresh the dashboard and challenge routes to prove persistence. Replay the
passing result notification and run reconciliation to prove no duplicate
mastery/unlock events or changed first-passing evidence.

### Product and data behavior

- Login/logout and cohort access are server-authorized. A learner cannot read
  another learner's private submission or submit into an unauthorized cohort.
- Subject pages use the cohort's pinned published projection, including the
  required filename and local-development instructions.
- The locked Even or Odd submission operation is rejected server-side even if a
  learner bypasses the interface. It creates no submission, job, or progress change.
- Valid hello.go and even_or_odd.go uploads follow the exact required-file
  allowlist and 256 KiB maximum. Reject extra files, wrong names/extensions,
  path manipulation, empty files, and oversized requests before enqueueing.
- Storage objects are private and immutable. Verify size/digest before creating
  the submission/job transaction; clean up aged orphan uploads safely.
- Duplicate identical upload requests return one submission/job. Reusing an
  idempotency key with different content is rejected.
- Accepting a first submission starts an available node. Only an authoritative
  passing result masters it; failed/system_error results cannot unlock successors.
- Each submission identifies its immutable environment and remains separate from
  its execution attempts. Counts and scores remain derived.
- A learner sees attempt history, current processing state, and safe feedback.
  Operators can inspect authorized cohort submissions, infrastructure errors,
  execution attempts, pending results, and worker heartbeat state.
- Submission acceptance, terminal result application, mastery, and unlock events
  are durable. Infrastructure failures are excluded from learner failure metrics.

### Failure and security behavior

- Concurrent workers cannot hold the same current claim. Expired workers cannot
  renew, start, or record a new authoritative outcome after ownership is lost.
- Infrastructure failures cause at most two retries; learner failures cause none.
  Exhausted infrastructure failures become visible system_error outcomes.
- A result committed before a crash remains available to the monolith. Failed
  notifications/application transactions are repaired without executing again.
- Duplicate and out-of-order callbacks cannot regress mastery, overwrite a
  newer evaluation, duplicate events, or change first passing evidence.
- Runner credentials cannot directly query/update product tables, set progress,
  alter publication data, or mark results applied. A normal user cannot invoke
  the internal service endpoint or product maintenance operations.
- Both compilation and execution use the hardened sandbox profile. Hidden test
  contents and raw hidden output never enter browser responses, web artifacts,
  database feedback payloads, or web/operator logs.
- All required identities in ADR-009 are resolved before queueing. Digest or
  protocol mismatch fails safely as infrastructure error; retries keep the same
  environment.

## Testing strategy

| Layer | Tools/environment | Required coverage |
| --- | --- | --- |
| Domain unit tests | Vitest; pure TypeScript, no framework/database | Four progress states, timestamp semantics, AND prerequisites, fail/pass rules, no mastery regression, legal submission transitions, authorization policies, replay/out-of-order application decisions |
| Database integration tests | Real PostgreSQL with local Supabase Auth/Storage where needed; independent concurrent connections | Migrations, composite FKs/checks/index uniqueness, publication immutability, idempotent submissions, atomic rollback, concurrent SKIP LOCKED claims, fencing/expiry races, two-retry bound, result uniqueness/receipts, restricted function grants, reconciliation races |
| Runner integration tests | Go test suite on a dedicated Linux container-capable host with PostgreSQL and trusted test artifacts | Actual compile/test path; good/wrong/signature-invalid code; timeout/OOM/output/PID/tmpfs limits; network/filesystem/privilege restrictions; output spoofing and hidden leakage; digest/protocol mismatch; worker crashes, lost leases, persistence-before-notify, cleanup |
| Vertical Slice E2E | Playwright against real Next.js, Supabase, PostgreSQL, private storage, and Go Runner | Exact incorrect-then-correct Hello Go sequence above; persistent feedback/progress; blocked-node enforcement; notification loss and duplicate delivery recovery |

Use a deliberately incorrect solution that compiles and fails correctness, plus
a correct solution satisfying visible and hidden tests. Separate fixtures cover
compile_error, runtime_error, timeout, and infrastructure failure; do not replace
the required first wrong-answer outcome with a compilation failure.

Fast domain/lint/type/build checks run on normal changes. Database checks run
when persistence/protocol changes; Runner tests run on the isolated Linux Judge
test host. The integrated first E2E is a merge/release gate once the full slice
exists. Use isolated test cohorts and deterministic fixtures; never run malicious
fixtures in the web environment or against production services.

## Measurement and launch scope

Record queue delay, execution time, result-application delay, submission count,
learner failure count, infrastructure retries, stale writes, and pending-result
age. Measure the product spec's 99% execution success and under-four-second
normal-result median targets in a representative synthetic pilot run. Define
the sample size/report before launch; this architecture document does not claim
those operational targets are already met.

Checkpoints, aggregate skill mastery/scoring, full Quest Map presentation,
blocked-learner analytics, and broader operator dashboards remain pre-launch
work where required by the product specification. This slice does not complete
every P0 feature. It introduces no CMS, browser IDE, Redis, microservices, UI
framework, or speculative shared component system.

Related: [product specification](PRODUCT_SPEC_v0.1.md),
[schema](../architecture/DATABASE_SCHEMA_v0.1.md),
[workspace](../architecture/WORKSPACE_LAYOUT.md),
[security profile](../architecture/RUNNER_SECURITY_PROFILE.md),
[ADR-008](../architecture/adr/ADR-008-judge-job-protocol.md), and
[ADR-009](../architecture/adr/ADR-009-immutable-evaluation-environment.md).
