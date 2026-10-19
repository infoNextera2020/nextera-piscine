# Foundation 005 — Terminal Result Application, Mastery & Progression

Status: implementation complete; final verification evidence is recorded below.
No production deployment, catalog approval, real curriculum publication, staging or commit.

## A. Result application behavior

The product operation `applyResult(db, resultId)` applies only durable PostgreSQL
Judge evidence. It accepts one result UUID; callers cannot provide a verdict,
submission, learner, node, attempt ordinal, curriculum/evaluation identity, graph
or unlock targets. A separate service-authenticated internal route and an independent
reconciliation command use this same operation. Learner page visits and polling
only read persisted state.

An authoritative terminal result finalizes its stored submission. Passed results
master the challenge and unlock newly eligible nodes in the same transaction.
Failed, compile_error, runtime_error and timeout remain distinct learner outcomes;
system_error remains infrastructure state. None can regress existing mastery or
unlock a dependent on its own. Intermediate infrastructure results are processed
as superseded evidence, never as terminal learner failures.

## B. Authoritative identity checks

The transaction resolves the result's stored job and that job's stored submission.
It checks result/job evaluation-digest equality, immutable snapshot submission,
learner, cohort, curriculum version, node and evaluation-spec identity, the pinned
published node projection, membership identity and complete stored progress rows.
The referenced attempt must belong to the job and have completed execution.

Application requires both the submission's active job reference and the job's
accepted terminal result pointer, with matching job/attempt/verdict lifecycle.
The six supported terminal verdicts are explicitly allowlisted. Existing composite
foreign keys bind result/attempt/job and submission/membership/version/node identity.
The original immutable snapshot digest comes from Foundation 004; application
compares stored authoritative identities rather than accepting a replacement hash.

Missing/corrupt identity rejects the transaction. Non-authoritative intermediate
infrastructure evidence is marked superseded with a fixed reason. A nonactive
evaluation uses the superseded_evaluation receipt reason; changed-environment
reevaluation remains outside this milestone. Conflicting processed receipts reject.

## C. Application transaction

One Drizzle/PostgreSQL transaction authenticates the database session's dedicated
product role, then locks job, submission and result receipt in that order. It takes
the same learner/cohort advisory transaction lock as intake, locks the membership,
and locks the complete progress set in stable node order. Different learners have
independent serialization keys. Relevant simultaneous results for one learner
serialize before progression is calculated.

The transaction writes terminal submission lifecycle, first mastery evidence,
all AND-prerequisite unlocks, state/activity events and processing receipt together.
Rollback leaves the result pending and all product writes absent. There are no
process-local mutexes. The result primary key, per-attempt result uniqueness,
transaction locks and immutable processed-receipt guard establish exactly-once
product effects despite repeated delivery or execution-at-least-once semantics.

## D. Submission lifecycle

Stored submissions finish as passed, failed, compile_error, runtime_error, timeout
or system_error, with finished_at set from application time. Existing history reads
continue to expose only the active job's authoritative verdict and fixed feedback.
After application the stored lifecycle also reflects that verdict.

Migration 0005 adds a trigger that starts an available node when its first accepted
submission is inserted. Replayed intake cannot start it again. It also backfills
Foundation 004's already accepted submissions from their original acceptance time,
using the earliest accepted submission per available node. That backfill writes an
audit event; it does not change Judge evidence, immutable submission identity or
access status. Earlier accepted migrations are unchanged.

## E. Mastery semantics

Only a passed challenge result can master a node. The existing domain function
`prerequisitesSatisfied` supplies the prerequisite rule; `resultProgression`
calculates the atomic mastery/unlock transitions from locked stored state.
Projects/checkpoint scoring are not introduced; a passed unsupported node kind
fails safely for operator attention.

The first successfully applied passing submission sets first_passing_submission_id,
started_at when needed for historical evidence, and mastered_at. Later passes cannot
replace that evidence or timestamps. Later learner failures and infrastructure
errors cannot regress mastery. There is no numeric mastery/skill scoring model.

## F. Unlock/prerequisite semantics

Enrollment still makes roots available and dependent nodes locked. The published,
cohort-pinned graph is read from PostgreSQL. Every requires_pass prerequisite must
be mastered; missing prerequisites do not pass. Unsupported edge rules reject.
Mastery and unlock writes share the application transaction, so committed reads do
not expose mastery with an incorrectly locked newly eligible dependent.

Tests verify Hello -> Even, legitimately available Even completion, partial AND
prerequisites remaining locked, subsequent completion of all prerequisites, unrelated
root preservation, existing mastered/available state preservation and rejection of
locked-node intake. Extended graph fixtures are parsed from isolated fixture bytes;
the real curriculum is never published to perform these tests.

## G. Application receipt

The existing judge.results fields are the durable processing receipt:
application_status, processed_at and application_reason. Applied receipts use the
fixed terminal_result_applied reason. Intermediate retry failures use
intermediate_infrastructure_result; nonactive evaluations use superseded_evaluation.
A trigger prevents changing any processing field once status leaves pending.
Foundation 004's separate payload/history guards remain intact.

The result UUID identifies job/attempt and evaluation digest; the immutable job and
submission identify learner/membership, cohort, pinned curriculum, node, source and
evaluation snapshot. Immutable state/activity events identify the exact resulting
transitions. No large identity snapshots or second redundant receipt table are added.
Identical replay returns the existing receipt and leaves timestamps/evidence/events
unchanged; corrupted receipt classification is rejected.

## H. Events/notifications

Safe activity types are challenge_mastered, node_unlocked,
submission_terminal_learner_failure and submission_infrastructure_failure. Existing
activity columns carry opaque user/cohort/version/node/submission/result/correlation
identity. Payloads are empty objects; no learner source, private cases, Judge output,
credentials or sandbox paths are added. Progress state events record previous/next
state and identify their target node in the reason, linked to the exact result.

The optional internal POST notification accepts only a result ID, protected by a
separate random service Bearer token, not a learner/operator session. The scheduled
reconciliation route accepts an empty JSON object under that same service boundary.
There are no email/push providers or notification UI changes. Runner source/image
are unchanged; no new Runner callback implementation is needed for correctness.

## I. Reconciliation/recovery

`reconcileResults` scans at most 100 pending records, in recorded_at/ID order, and
calls the same application transaction for each. Concurrent scans may select the
same work; database locks converge on one receipt and event set. Each result has its
own commit boundary. A failure returns attention_required and preserves pending
evidence instead of discarding it. Outcomes include pending age in milliseconds.

`pnpm results:reconcile --once` supports an external scheduler; repeated mode waits
60 seconds between bounded scans. When the separate MAINTENANCE_DATABASE_URL is
supplied it also invokes existing authorized expired-lease recovery. Continue the
accepted independent 10-second lease-maintenance schedule. A failed one-shot batch
exits unsuccessfully and emits safe opaque-ID/status/age logs for attention.
No Redis or production scheduler/service installation is introduced.

Recovery evidence covers durable result with no application process, a real failure
after product writes but before commit, termination of the actual application database
connection while blocked before commit, a TCP proxy discarding a successful COMMIT
acknowledgement, identical retry, concurrent scans, two independent reconciler
processes, and corrupt processed receipt state. Judge evidence is not rewritten.

## J. Authorization edge cases

The user explicitly selected the historical-result policy during this milestone:
already accepted work applies its durable result and historical progression even
when the user, membership or cohort is subsequently deactivated. Deactivation
controls current/future access and intake; it does not erase historical truth.

Tests cover each deactivation before result recording, passed mastery/unlocks,
new-intake denial, history-read denial and idempotent replay. Application never
changes user active flags, membership status or cohort status. An inactive learner
does not regain access because progress changes. The immutable membership pair and
cohort pin remain authoritative. There is no mutable global-current curriculum
selection; a newer version cannot replace a cohort's accepted pinned environment.

No accepted ADR conflict was found. The deactivation rule was an explicit policy
gap resolved by the user's instruction, not an invented replacement rule.

## K. Tests and concurrency evidence

| Verification                                                     | Final result                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Formatting, lint, complete TypeScript checks                     | Passed                                                                                                               |
| Unit/curriculum/schema/service authorization suite               | 76 passed in 11 files                                                                                                |
| All PostgreSQL integration regressions                           | 89 passed in 5 files; fresh database and repeated-run verification                                                   |
| Foundation 005 database cases                                    | 19 passed, including real concurrency, two processes, rollback, killed connection and dropped COMMIT acknowledgement |
| Production domain/DB/Next build                                  | Passed with the accepted two-worker build setting                                                                    |
| Real Supabase Auth + cohort browser regressions                  | All 20 passed                                                                                                        |
| Complete protected browser/Go/Storage/sandbox suite              | All 38 passed, 7.5 minutes                                                                                           |
| Focused full learning-loop rerun on the final production build   | Passed, 55.2 seconds                                                                                                 |
| Real non-superuser Supabase migration, applied twice             | Passed; all six exact file hashes verified                                                                           |
| Drizzle schema generation                                        | 16 tables; no schema drift                                                                                           |
| Real Supabase grant/owner audit                                  | Web/Runner denials, safe trigger owner, PUBLIC revocation and revoked temporary SET/CREATE verified                  |
| Exact retained Runner/source/manifest/config and pack identities | Passed; candidate unchanged and unapproved                                                                           |
| Offline Go module verification, vet and all Go tests             | Passed                                                                                                               |
| Public Python artifact tooling                                   | All 3 passed                                                                                                         |
| Curriculum validation                                            | Passed; no publication                                                                                               |
| Git diff/accepted-file/index audit                               | Passed; accepted files untouched, nothing staged                                                                     |

An additional upgrade test cloned the untouched retained Foundation 004 release
fixture. Its 39 real pending results became 36 applied terminal receipts and three
superseded retry receipts. Canonical comparison confirmed every immutable Judge
result field was unchanged. All users/memberships remained inactive. The backfill
used original accepted submission timestamps. Original Foundation 004 data stayed
untouched in its original database.

An operator audit reconstructed a real chain using only opaque identities in the
upgraded clone: submission `b111c04c-9d1b-45ea-a882-bd30e7f09796`, job
`278d48c8-c042-4996-bf5d-dde0e4437924`, execution attempt
`9514ccf3-3372-4577-9f83-0b99f73099c8`, applied result/receipt
`a676a4dc-b2c7-4df4-9823-2897236434aa`, mastery state event
`606c1a70-12d3-42d2-ba17-78e998e8ecc0`, and unlock activity event
`236f33f4-23e8-4ad8-9927-d070bd0cca5d`. The progress row's first passing evidence
matches that submission. This query needed no raw output, hidden cases or source.

The database cases use actual independent LOGIN connections and PostgreSQL locks;
concurrent calls are not mocked. Lost-acknowledgement tests inspect committed
receipt state before replay. The process-death test checks pending receipt, zero
activity events and unchanged unmastered progress before retry. Safe readback uses
existing authorized history queries, while protected browser tests verify refresh.

Earlier verification failures were corrected, not counted as passes: legacy tests
expected five migrations and deferred intake state; one assertion needed Drizzle's
wrapped database error; fixture clones needed matching manifest/config titles;
SKIP LOCKED queue fixtures needed bounded claim retries; the lost-ack proxy needed
to forward extended-protocol parse metadata before suppressing COMMIT acknowledgement;
and a Windows newline initially contaminated a local launch-script argument.
Supabase non-superuser checks also caught and corrected function-grant/trigger-owner
ordering before migration succeeded. The Auth suite also needed its migration count
updated to six. Repeated database tests retain intentionally corrupt constraint
fixtures; the process-concurrency assertion now verifies its own result while
allowing those unrelated records to surface attention. A retained-fixture comparison
was corrected to use canonical JSON rather than object-key insertion order.
No accepted migration was changed to fix these checks.

## L. Grants/privilege audit

nextera_web and nextera_runner grants are unchanged. Runner retains zero direct
product reads/writes, progress writes, receipt writes and product activity writes.
The learner runtime role still cannot master arbitrary nodes or invoke product
application. The service operation uses a separate server-only connection whose
session inherits nextera_result_application; ordinary sessions fail before any
application operation. Service API tests reject caller-supplied outcomes/identities.

The new isolated NOLOGIN role has only the stored-context SELECT grants, lifecycle/
receipt/progress column UPDATE grants, event INSERT grants, and the minimal UPDATE
columns PostgreSQL requires for job/membership row locks. It has no role/schema
administration, publication, source-object, attempt, worker or result-payload writes.
It is a trusted product identity, never a browser/Runner credential.

The intake-only SECURITY DEFINER trigger has a fixed pg_catalog search_path,
fully qualified product objects, no caller-provided state/node parameters and no
PUBLIC execution. Only an accepted submission insert can invoke this trigger;
web/Runner cannot call it or create product triggers. Its owner is the restricted
NOLOGIN product role. Ownership transfer grants/revokes temporary migration SET
membership and schema CREATE in the same transaction, leaving no persistent
migration elevation. Processed receipt guarding is SECURITY INVOKER.

## M. Artifact/catalog status

Runner source and image are unchanged. Verified against the actual retained OCI
manifest bytes, image config and image-extracted binary revision:

- Runner manifest: sha256:85d6cad6031bb225bc6e0eadb97076fdcfc800a8d097a41fa9218dd8c19071fb
- Runner source: sha256:77575822d0db0886cf9efbab8d5ae922ca72d9c1135634aba0111e4cdee9db1b
- Runner config: sha256:9528b7102d77cf53f7a431d0e02ce2e0841d7e089316ed727345aea10ca3f78e
- Sandbox: sha256:206f032819cd2c12d39ce92540a374c3319324c67c981b51031bf62f20e5b2d2
- Hello pack: aac95987005f11928a2359089bf11411be11590c7b300df99702fc6bd5705c93
- Even pack: 5ff83545dbd710044b0f2263649e507b41f756281205fd5fd6defb6728f6be66

The public candidate, sandbox build files and Runner tree have no diff. Candidate
status stays CANDIDATE and artifact references remain null. No registry push,
catalog approval, production cohort or real curriculum publication occurred.
The accepted test-only local OCI fixture exception remains required in all layers.

## N. Deviations and unresolved risks

- The product uses a dedicated database permission role and trusted TypeScript
  transaction, rather than duplicating the accepted TypeScript prerequisite engine
  inside a SQL terminal-application function. Only its service boundary accepts a
  durable result ID. Protect/rotate this dedicated server credential and token.
- Existing learner reads already render persisted progress and safe verdicts, so no
  final UI redesign or shared UI components were needed.
- Scheduling, supervision, hosted credential provisioning/rotation and production
  alert routing are operational work; no production deployment is claimed.
- A sustained batch of 100 corrupt oldest pending records can require operator
  remediation before later pending records advance. Failures remain visible and
  intact; no dead-letter discard or speculative schema was introduced.
- Existing Foundation 004 storage-retention/orphan-cleanup/host-isolation/latency
  benchmark limitations remain. This milestone does not certify production Judge
  hosting or complete every product-spec P0 feature.
- No checkpoints beyond existing prerequisite eligibility, checkpoint scoring,
  percentages, AI, IDE, Redis, microservices or real catalog publication were added.

## O. Resulting tree

Relevant new/updated files; dependencies, private credentials and generated builds
are excluded:

```text
apps/web/
  .env.example
  app/api/internal/results/{route.ts,reconcile/route.ts}
  lib/submissions/{application.ts,application.test.ts}
packages/
  domain/{progression.ts,index.ts,tests/progression.test.ts}
  db/
    operations/results.ts
    migrations/0005_result_application.sql
    migrations/meta/{0005_snapshot.json,_journal.json}
    tests/integration/{result-application.test.ts,judge-protocol.test.ts,constraints.test.ts}
    package.json
    README.md
scripts/
  result-reconciliation.ts
  local-judge-fixture.ts
  test-local-judge.ts
tests/e2e/{judge-execution.spec.ts,identity-access.spec.ts}
.github/workflows/checks.yml
.env.example
package.json
README.md
docs/FOUNDATION_005_REPORT.md
```

The existing CI database job automatically includes the new integration file;
its step now names application, graph, reconciliation and privilege coverage.
The normal unit job includes domain and service authorization cases. No learner
sources, private packs or raw Judge output are uploaded as CI artifacts. Hosted
Actions was not dispatched by this task.

## P. Suggested commit message

`feat: apply durable Judge results with atomic mastery and progression`

All files are left unstaged and uncommitted for review. Test fixture logins and
workers were disabled. Local Supabase and the workspace test PostgreSQL cluster
were stopped with retained data; existing unrelated services were not stopped.
