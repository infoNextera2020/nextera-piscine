# Foundation 004 — Durable submission and Judge execution protocol

Implementation date: 2026-10-18. No files staged or committed.

The local submission-to-result path is implemented. The real curriculum remains
unpublished, the catalog remains **CANDIDATE**, and both public
`test_pack_artifact` references remain **null**. No registry login/push or catalog
approval occurred. No progression, mastery, unlock, checkpoint or result-receipt
application is implemented.

## A. Submission behavior

`POST /api/submissions` accepts one bounded raw Go source file from an authenticated,
provisioned, active domain learner. It requires same-origin cookie-authenticated
access, active cohort/membership, a matching published projection, accessible stored
progress and a submittable challenge/project. Operator/admin previews confer no
submission authority. Login never creates users or enrolls learners.

The server resolves the curriculum/evaluation environment and source owner.
Client headers identify only cohort, node, filename and a UUID idempotency key;
clients cannot choose evaluation identities, user IDs or attempt numbers.

One narrow database transaction creates the artifact metadata, submission, Judge
job and state events. An advisory transaction lock serializes each learner/cohort
intake; shared authorization-row locks prevent deactivation races. The learner
attempt ordinal counts prior accepted submissions to that node, independently of
infrastructure attempts. Concurrent identical requests return one submission/job.
The same key with different node/file/size/hash is rejected with HTTP 409.

The minimal local form preserves its idempotency UUID across refresh, consumes the
server acknowledgement, and polls authorized history. History shows at most 50
own-node attempts with opaque IDs, timestamps, lifecycle/verdict and fixed feedback.
It resolves terminal verdicts from the active job's authoritative durable result.
Stored submission lifecycle and result application receipts deliberately await the
later ADR-008 product application transaction.

## B. Artifact storage

Sources use the accepted Supabase Storage boundary: private bucket
`nextera-submissions`, 256 KiB maximum. Keys are derived server-side:
`auth-uuid/cohort-uuid/request-uuid/exact-byte-sha256`. The plain required filename,
extension and public size rules are validated; an extension grants no execution trust.

Uploads use the learner's real session with overwrite disabled. Initial and repeated
uploads both read back the authoritative object and verify size/SHA-256 before
database finalization. SQL metadata and immutable-history triggers retain the
accepted identity. No source bytes are stored in PostgreSQL.

Migration 0004 adds two permissive own-prefix/source-reader policies and four
restrictive INSERT/SELECT/UPDATE/DELETE guards to the existing managed Storage
table. Unrelated permissive policies cannot permit source overwrite/delete or
foreign reads. The signed source-reader credential cannot insert, update or delete.
No hidden Judge input is uploaded to Storage. Retention and aged orphan cleanup
remain future work; accepted sources/history are retained.

## C. Database job model

The accepted 16-table app/judge model is retained: no new table, enum, speculative
JSONB index or schema redesign. Reviewed migrations 0003/0004 add protocol functions,
immutable history triggers, grants and Storage policies. Accepted migrations
0000–0002 and accepted architecture/curriculum files remain unchanged.

Every queued job freezes the published evaluation specification plus curriculum
UUID/key/version/Git/content/subject/configuration digests, evaluation-spec digest,
learner/cohort/submission/ordinal/acceptance time and source ID/bucket/key/name/size/hash.
The specification includes real pack/Runner/sandbox/toolchain/platform/profile/
resource/flags/protocol/snapshot identities. None is resolved dynamically later.
Physical attempt UUID/token/generation is assigned when the job is claimed.

Snapshot format 1 hashes UTF-8 `nextera-evaluation-snapshot\0v1\0` followed by
canonical JSON: C/ASCII-sorted object keys, original array order and integer pilot
budgets. SQL/TypeScript/Go golden checks agree. Source hashing preserves exact bytes.
Identity/snapshot/result-payload/audit mutation and history deletion are rejected.

Job lifecycle remains queued → claimed → running → completed/system_error.
Infrastructure attempts remain separate claimed/running/completed/system_error
records. Durable results start with `application_status=pending`. Neither Runner
nor protocol owner can update progression or result application receipts.

## D. Grants and privilege boundaries

All protocol functions revoke PUBLIC execution, use fixed `search_path=pg_catalog`
and qualified objects. Runtime LOGINs inherit purpose-specific NOLOGIN roles.

| Role                        | Newly exposed operations                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `nextera_web`               | `app.submission_context`, `app.accept_submission`, `app.read_submissions`                                                   |
| `nextera_runner`            | `judge.claim_job`, `renew_lease`, `heartbeat`, `record_execution_attempt`, `record_result`, `record_infrastructure_failure` |
| `nextera_judge_maintenance` | `judge.recover_expired` only                                                                                                |

The Runner has schema USAGE and those six EXECUTE grants, with no direct table
read/write, helper execution, role/schema creation, learner/progression or receipt
access. Workers authenticate using `session_user`, not a caller-supplied worker ID.
Provisioner-controlled disable/re-enable closes live claims atomically; old tokens
cannot be resurrected.

`nextera_judge_owner` has SELECT on required auth/cohort/curriculum/progress/worker
rows; SELECT/INSERT on artifacts/state events/results; SELECT/INSERT/UPDATE on
submissions/jobs/attempts; UPDATE(last_heartbeat_at) on workers. Row locking additionally
requires UPDATE(id) on users/cohorts and UPDATE(joined_at) on memberships; exposed
functions never modify those columns. The owner has no progress writes, result
receipt updates, activity-event writes or persistent schema CREATE.

The non-superuser Supabase migration login temporarily receives owner SET membership
only inside the migration transaction, transfers function ownership, then explicitly
revokes its own grant before commit. Supabase's automatic role-creator ADMIN entry
can remain without INHERIT/SET. No runtime login receives owner membership.
An initial permanent-membership approach was rejected by automatic approval review;
it was replaced with this transaction-scoped, verified revocation design.

The web receives no migration/operations/maintenance/service/signing credentials.
The worker receives its operation-only DB credential and a separate one-hour
read-only source JWT. Provisioning retains the signing/admin key locally; those
keys never enter the worker or a learner container. app/judge remain excluded from
the Supabase Data API.

## E. Runner protocol

The independent Go module uses Go 1.27.2 and pgx **5.11.0**. Transitive module pins:
pgpassfile 1.0.0, pgservicefile 20240606120523-5a60cdf6a761 and x/text 0.29.0.
No JavaScript dependency or lockfile version changed. Dependencies download/verify
only during trusted build preparation; vet/tests/build then run offline. The final
scratch Runner image contains the static binary and public CA roots, UID 65532.

`runner work --local-fixtures` currently requires a loopback disposable
`foundation_test*` database. It verifies candidate metadata, binary build revision,
retained build receipt, actual loaded OCI image descriptors and the frozen snapshot.
It then verifies the pack's complete OCI blobs, exact environment and source bytes.
Mismatch is infrastructure system_error; incompatible registered workers skip jobs.

The trusted Docker Engine client creates a disposable compilation container and a
different execution container. It checks both configured and effective controls:
network none, non-root, read-only root, no capabilities, no-new-privileges, seccomp,
cgroup CPU/memory/PID limits and bounded tmpfs bytes/inodes. No bind mount, checkout,
product credential, Docker socket, private pack source or expected answer enters
either container. The real executor generates its transport adapter from public
function signatures; it does not copy the private pack bridge into a sandbox.

Compilation is offline under the unchanged 20-second/512-MiB profile. Only a bounded,
regular ELF file (maximum 7 MiB) transfers through the trusted supervisor; archive
links/extra files/unsafe names/non-ELF output are rejected. Execution runs the case
input array once within the aggregate 2-second/64-MiB/64-KiB profile. Trusted
comparison retains expected values outside learner execution.

| Budget                       | Compilation             | Execution             |
| ---------------------------- | ----------------------- | --------------------- |
| CPU                          | 1                       | 1                     |
| Memory                       | 512 MiB                 | 64 MiB                |
| PIDs                         | 64                      | 32                    |
| Timeout                      | 20 seconds              | 2 seconds             |
| Output                       | 64 KiB                  | 64 KiB                |
| Temporary filesystems, total | 256 MiB / 16,384 inodes | 16 MiB / 1,024 inodes |

Normal completion/cancellation/lease loss destroys the container. An additional
45-second PID-1 watchdog bounds orphan container life after supervisor death;
newly fenced claims remove older attempt containers for their job, and periodic
cleanup removes stopped Judge containers. Existing phase limits are unchanged.

## F. Leases and recovery

Claims use a locked authenticated worker row and `FOR UPDATE SKIP LOCKED` over
compatible ready jobs. One worker holds at most one active claim. A claim creates
an attempt, new random token, incremented generation and 30-second DB-clock lease.
Renewal runs every 5 seconds; heartbeat every 10 seconds conveys health only.
No database transaction/connection remains open during compilation/execution.

All execution/result operations verify job/attempt/worker/token/generation and live
lease. Missing/null fence values and stale tuples are rejected. The independent
maintenance credential/process recovers expired claims every 10 seconds; it persists
LEASE_EXPIRED evidence before requeue. Infrastructure retries wait 2 then 10 seconds,
with three total physical attempts and a final durable system_error.

Result recording locks the job, persists safe immutable evidence, closes the
attempt and updates the queue atomically. An identical completion returns the same
receipt even after lease closure/reconnect; conflicting evidence is rejected.
The worker replays the identical completion on ambiguous connection errors instead
of replacing a learner verdict with an infrastructure error. Expired/revoked workers
cannot create new evidence after losing ownership. Exactly one terminal result wins.

The real PostgreSQL tests use eight simultaneous worker LOGIN connections and a TCP
proxy that discards a committed completion acknowledgement. They assert the result
already exists before replay, then prove the same receipt and one durable row.
Protected E2E kills an actual Go process after claim, runs a separate maintenance
process, and completes the recovered job using a new attempt. No product result
application occurs; all receipts remain pending.

## G. Verdict and feedback safety

The accepted vocabulary is passed, failed, compile_error, runtime_error, timeout and
system_error. SQL constructs fixed allowlisted learner messages; worker text is not
accepted. Operator diagnostics contain only a fixed infrastructure code. Measurements
allow only bounded numeric compilation_ms, execution_ms and compiled_bytes.

Raw stdout/stderr, compiler output, panic stacks, test names/values, paths, cases,
tokens, credentials and source never appear in feedback/history. Output limits and
trusted strict decoding apply before comparison. Resource-policy violations cannot
be converted into a learner pass merely by catching a failed syscall.

Trusted Runner logs contain event names, opaque job/attempt IDs, evaluation digest
and safe verdict only. Submission logs contain the opaque submission ID/source
digest. Durable state_events record the real queue creation once; duplicate HTTP
requests do not falsely log another queue creation. Lease renew/loss, execution
start/completion and system failures have structured safe events.

## H. End-to-end evidence

The explicitly authorized local exception requires all of: a disposable
`foundation_test*` database, `foundation-test-only-*` curriculum key, `test_only`
metadata, actual digest-qualified absolute local OCI layout and explicit Runner
fixture mode. The Runner checks the layout mapping and every blob. Normal publisher
and intake guards remain intact, and the public candidate retains null references.

Tests create explicit isolated users/cohorts through operational fixtures; sessions
use real Supabase Auth and source uses real private Storage. The dedicated DB uses
only a minimal external Auth FK fixture, separate restricted web/worker/maintenance
logins, and the actual reviewed schema. No production cohort or real curriculum
projection is published. A separate rehashed Even root fixture permits Even testing
without making any progression/unlock write.

The protected suite covers upload/replay/changed-body rejection, overwrite/foreign
read denial, refresh, own/foreign/locked/anonymous/origin access, both packs' correct
and adversarial submissions, exhausted mismatched-environment retries and process
death/recovery. Every evaluation compares complete progress rows before/after and
checks pending receipts. Fixture domain accounts/memberships, retained real Auth
accounts and database logins are disabled afterward; history remains retained.

Final protected suite and regression counts are recorded in K.

The final isolated run retained 36 jobs with 36 terminal pointers and 39 durable
results, all 39 pending application. Results were 11 passed, 8 failed, 2 compile_error,
12 runtime_error, 2 timeout and 4 infrastructure system_error records. The additional
infrastructure evidence belongs to bounded retries and the recovered killed attempt;
it does not create extra learner submissions or apply progression.

## I. Updated Runner OCI identity

New real Runner manifest:
`sha256:85d6cad6031bb225bc6e0eadb97076fdcfc800a8d097a41fa9218dd8c19071fb`.

Runner source revision:
`sha256:77575822d0db0886cf9efbab8d5ae922ca72d9c1135634aba0111e4cdee9db1b`.

The distinct Runner config digest is
`sha256:9528b7102d77cf53f7a431d0e02ce2e0841d7e089316ed727345aea10ca3f78e`.

Sandbox manifest remains:
`sha256:206f032819cd2c12d39ce92540a374c3319324c67c981b51031bf62f20e5b2d2`.

Pack manifest digests remain:

- Hello: `aac95987005f11928a2359089bf11411be11590c7b300df99702fc6bd5705c93`.
- Even: `5ff83545dbd710044b0f2263649e507b41f756281205fd5fd6defb6728f6be66`.

OCI exports, manifests/config IDs, local-image receipts, private cases and execution
evidence remain outside the checkout under protected Judge directories. The tested
binary is extracted from the actual loaded Runner image. Config IDs are not
substituted for manifest digests. Both real packs verify against that Runner.

## J. Catalog candidate

`infra/runner/catalog/candidate.json` contains the new Runner manifest and unchanged
verified sandbox/pack identities. Status is CANDIDATE; both artifact references
remain null. The exact approved-catalog parser rejects this wrapper. No OCI registry
URL is invented. Future private registry login, digest-preserving copy, remote
manifest/blob verification, access/retention checks and explicit approval steps
remain documented in `infra/runner/README.md` and were not executed.

## K. Tests and CI

| Command/check                                                                                                       | Final result                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                    | Passed; lockfile unchanged, pnpm 11.22.0 / Node 24.19.0                                                                         |
| `pnpm format:check`                                                                                                 | Passed                                                                                                                          |
| `pnpm lint`                                                                                                         | Passed                                                                                                                          |
| `pnpm typecheck`                                                                                                    | Passed across domain, DB, web and test/script configuration                                                                     |
| `pnpm test`                                                                                                         | Passed: 58 tests (including the curriculum tests)                                                                               |
| `pnpm test:curriculum`                                                                                              | Passed: 27 tests, including candidate-publication rejection                                                                     |
| `pnpm curriculum:validate`                                                                                          | Passed: two nodes, Hello root; publication separately gated                                                                     |
| `TEST_DATABASE_URL=…/foundation_test004_release pnpm test:db`                                                       | Passed: all 70 real PostgreSQL integration tests, including 13 Judge protocol cases                                             |
| `pnpm db:generate`                                                                                                  | Passed: 16 tables, no table-schema drift                                                                                        |
| Real Supabase guarded migration refresh, then `pnpm db:migrate` twice                                               | Passed: five exact migration hashes/timestamps; accepted product/storage fingerprints unchanged; no persistent owner SET access |
| `pnpm build`                                                                                                        | Passed: domain and DB independently built, then Next production build                                                           |
| `GOTOOLCHAIN=local gofmt`, `go mod verify`, offline `go vet ./...`, `go test ./...`                                 | Passed; optional real-engine test run separately                                                                                |
| Python compile and `python3 -m unittest discover -s infra/runner -p 'test_*.py'`                                    | Passed: three public tooling tests                                                                                              |
| Repeated `python3 infra/runner/artifacts.py --inputs … --output …`, candidate/receipt byte comparisons              | Passed: identical Runner, sandbox and both pack manifest identities                                                             |
| Actual Runner `version`, `capabilities`, `verify-catalog`, both `verify-artifact` commands                          | Passed; publication_approved=false                                                                                              |
| `NEXTERA_SANDBOX_INTEGRATION=1 … go test -count=1 -v ./internal/sandbox -run TestActualEngineStreamAndCancellation` | Passed: effective controls, bounded import, Docker framing and cancellation, 6.231 seconds                                      |
| `pnpm test:submissions --credentials … --artifacts … --binary …`                                                    | Passed: all 37 protected browser/Go/Storage/DB cases, 8.7 minutes                                                               |
| `pnpm exec playwright test tests/e2e/identity-access.spec.ts tests/e2e/cohort-enrollment.spec.ts`                   | Passed: all 20 regressions (13 Auth + 7 cohort), 1.3 minutes                                                                    |
| `NEXTERA_SANDBOX_TEST=1 python3 infra/runner/sandbox_test.py --output … --verifier …`                               | Passed: 34 fixture checks plus two correct preflights; 473.755 seconds                                                          |
| Source/build and client credential boundary audit                                                                   | Passed: 736 source/build files, 13 client files                                                                                 |
| `git diff --check`, accepted-file/lockfile comparison and index audit                                               | Passed; accepted files unchanged, nothing staged                                                                                |

Protected execution used actual artifacts in
`/home/anas/.local/share/nextera-judge/foundation003/artifacts`, the image-extracted
`.tools/runner004`, fresh credentials outside the checkout, and disposable
`foundation_test004_browser_release`. No private inputs/credentials are attached to
this report. Re-running requires fresh fixture credentials; the tested logins and
Auth accounts are disabled afterward. The crash fixture deliberately expires its
stored lease through privileged test setup, then exercises the real independent
maintenance operation and a second real Go worker attempt.

Earlier failures were corrected and rerun, not counted as passes:

- Non-superuser function ownership initially failed on Supabase. Temporary owner
  membership with same-transaction revocation fixed it; final real migrations passed.
- The initial default Next build overwhelmed WSL and was interrupted. Recovery used
  standing user authorization; the two-worker production build passed afterward.
- A stale test web process occupied port 3100. Only that observed test process was
  stopped; the isolated rerun passed.
- A browser test initially waited on an unconsumed upload acknowledgement body. The
  form now consumes/validates it; real immutable upload/replay/refresh checks passed.
- Graceful worker stop initially emitted a false system_error; cancellation handling
  was fixed, the actual Runner image rebuilt, and all 37 final cases passed.
- The first full run passed 33 cases, then the repeated per-case inode probe timed
  out. The probe now runs once per process, with the same strict resource verdict
  and unchanged limits; all 37 cases and the separate legacy suite passed afterward.
- Automatic review initially rejected the local uncommitted-migration rollback.
  The user explicitly authorized the guarded refresh. It then passed all empty-history,
  accepted-hash, data-fingerprint and privilege-revocation checks.
- One tool approval review timed out; the permitted identical retry succeeded.
  An initial Linux command lookup also failed before checks started; invoking the
  installed shell directly resolved it. Neither was treated as a test pass.
- The final report identity check caught a transcribed config-digest typo. It was
  corrected against the retained real image receipt, then the identity check passed.

Temporary Supabase and native test PostgreSQL services were stopped with retained
data. Existing Go/MySQL services remain running and Jupyter remains stopped.

Public CI retains workspace/DB/Auth/cohort jobs. It additionally downloads/verifies
pinned Go modules in trusted preparation, then runs offline Go format/vet/unit and
public protocol checks, public Python tooling tests and Runner/sandbox image builds.
The real queue concurrency/fencing/recovery tests run in the PostgreSQL job. Private
37-case execution and the legacy private sandbox suite remain protected-host checks;
CI does not upload packs, sources or raw sandbox output. Hosted Actions was not run
from this local task; the local checks validate the same relevant commands.

## L. Deviations and unresolved risks

- The local fixture exception is explicitly approved by the user; normal publication
  and intake requirements remain. This is no approval of the real curriculum/catalog.
- Terminal verdict application, notifications, reconciliation, mastery/unlocks and
  result-receipt decisions remain the next product milestone. Authoritative history
  reads durable results while the stored submission lifecycle can remain running.
- The one-hour source-reader JWT has bucket-wide read-only source access. Production
  issuance/rotation, per-job source scoping and hosted worker deployment remain open.
- Safe aged orphan cleanup and retention policies remain open. No accepted source
  or assessment history is deleted to make tests pass.
- Local Desktop/WSL is a shared development host; production Judge host OS/MAC,
  infrastructure separation, credential isolation and supervision need validation.
  No production security certification/deployment is claimed.
- Independent maintenance is implemented and process-tested; deployment as a
  supervised service/external scheduler is future infrastructure work.
- The VM has 3.6 GiB RAM. Next production build concurrency is capped at two workers
  after the default build exhausted this host. No product architecture changed.
- Local timings are functional/security evidence, not proof of the production
  median evaluation-latency target. A dedicated Judge host still needs that benchmark.
- The inode adversarial fixture now exhausts inodes once per process, rather than
  repeating the filesystem probe for each case. Both supervisors still require
  actual resource exhaustion and runtime_error; the two-second budget is unchanged.
- WSL/Docker recovery used existing explicit user approval. Existing Go/MySQL
  services were restored and Jupyter was left stopped as requested. Retained disks,
  container data and source/history were not deleted.
- Earlier verification failures and their final reruns are recorded in K. No
  unexecuted or interrupted check is counted as a pass.
- No accepted architecture/content or earlier migration was rewritten. No shared UI,
  Redis, microservice, IDE, AI, registry publication or final design was added.

## M. Resulting tree

`git diff --stat` reports 24 tracked files changed, 348 insertions and 72 deletions.
Another 31 new files remain untracked and are not included in that statistic.
The index is unchanged; all accepted architecture/content/earlier migrations and
the pnpm lockfile are unchanged. Both shared UI directories remain empty.

Relevant implemented/updated files (existing architecture/content/UI folders retained):

```text
apps/
  web/
    app/api/submissions/{route.ts,history/route.ts}
    app/app/cohorts/[cohortId]/challenges/[nodeKey]/page.tsx
    lib/submissions/{form.tsx,origin.ts,origin.test.ts,storage.ts}
    next.config.ts
  runner/
    go.mod
    go.sum
    .dockerignore
    cmd/runner/{main.go,work.go}
    internal/
      artifact/                    # existing trusted verifier
      feedback/                    # existing fixed feedback
      protocol/{snapshot.go,snapshot_test.go}
      queue/client.go
      sandbox/{engine.go,engine_test.go,integration_test.go}
      executor/{executor.go,executor_test.go}
packages/
  domain/{submission.ts,tests/submission.test.ts,index.ts}
  db/
    queries/submissions.ts
    migrations/
      0003_judge_protocol.sql
      0004_source_storage_policies.sql
      meta/{0003_snapshot.json,0004_snapshot.json,_journal.json}
    tests/integration/{judge-protocol.test.ts,constraints.test.ts}
    package.json
    README.md
  ui/{tokens/,primitives/}          # empty
scripts/
  local-judge-fixture.ts
  local-judge.ts
  test-local-judge.ts
  judge-maintenance.ts
tests/e2e/{judge-execution.spec.ts,identity-access.spec.ts}
infra/
  docker/runner.Dockerfile
  runner/{README.md,artifacts.py,sandbox_test.py,catalog/candidate.json}
.github/workflows/checks.yml
.env.example
playwright.judge.config.ts
playwright.config.ts
vitest.config.ts
supabase/config.toml
docs/FOUNDATION_004_REPORT.md
README.md
package.json
```

## N. Suggested commit message

`feat: add durable submission intake and fenced local Judge execution`

All changes remain unstaged and uncommitted for review.
