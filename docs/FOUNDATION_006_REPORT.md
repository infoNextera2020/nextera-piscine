# Foundation 006 — Checkpoint attempts, scoring and gated progression

Status: implementation and verification complete. All changes are unstaged and uncommitted. Catalog approval, real curriculum publication, production cohort creation, registry push and deployment remain blocked.

The authoritative product policy is recorded in `docs/product/FOUNDATION_006_CHECKPOINT_POLICY.md`, including the user's subsequent narrow Runner compatibility authorization. Foundation 001–005 accepted migrations and real curriculum sources are unchanged.

## A. Checkpoint definition/model

A committed checkpoint has exactly four checkpoint-specific evaluation items. `checkpoint.yaml` declares policy version 1, 5,400 seconds and four stable task keys. Each task has its own `task.yaml`, public subject, learner file contract, test-pack identity, configuration digest and subject digest. Tasks are separate evaluation items; enrollment creates progress only for curriculum nodes.

The strict committed-source loader rejects unknown fields, duplicate keys, missing/unreferenced files, unsupported duration/policy and invalid task counts. Evaluation resolution requires explicit bounded execution contracts for checkpoint packs. The publication transaction stores `checkpoint_definitions` alongside nodes and edges. Database guards reject missing checkpoint projections at publication and prevent edits to definitions. Only disposable test fixtures were published into isolated `foundation_test*` databases.

Four added tables: checkpoint definitions, attempts, outcomes and replacement grants. Existing submissions acquire attempt/task references; progress acquires checkpoint-outcome evidence. Composite foreign keys preserve learner, membership, cohort, curriculum and node identity. State/activity events can link directly to checkpoint evidence without inventing a new progression-state vocabulary.

## B. Eligibility

Trusted start derives eligibility from the cohort-pinned published projection, stored progress and every committed `requires_pass` edge. All required nodes must be mastered. A missing prerequisite denies start; unrelated mastery does not satisfy a required edge. Current learner role, active domain identity, membership and cohort are required. A prior checkpoint pass permanently denies new attempts.

## C. Immutable attempt snapshot

Start receives only authenticated learner identity, cohort/node and an idempotency UUID. It resolves and freezes all four tasks and evaluation specifications, definition identity, learner/membership/cohort/version/node identity, attempt ID, normal slot, kind, trusted start and deadline. Domain-separated SHA-256 hashes bind the attempt snapshot and final outcome evidence. Start requests are unique in learner/cohort scope. One active/evaluating attempt and one normal attempt per slot are enforced independently by unique indexes.

Identity fields, snapshot, start and deadline cannot change. Terminal attempts cannot reopen. Infrastructure recovery creates a different attempt rather than extending or editing the original.

## D. Timing/deadline semantics

PostgreSQL supplies `started_at`; `deadline_at` is exactly 90 minutes later. Intake samples trusted time after obtaining the learner serialization lock, so a request queued before expiry is rejected if it reaches acceptance after expiry. At the deadline, new submissions stop even if reconciliation has not yet updated the displayed status.

Explicit confirmed finish closes intake irreversibly. Otherwise trusted reconciliation records expiry at the original deadline. Both enter `evaluating`; unanswered tasks contribute zero. Pre-deadline accepted work continues through Judge and product application after closure. Pending accepted work is never converted into a learner failure because it completed late.

The browser displays a countdown from a server-time/deadline pair using elapsed performance time. Browser clock changes, page navigation and reload cannot write timing state. PostgreSQL persists timing across process restarts. A real integration test starts two fresh trusted server read processes against the restricted web connection and verifies identical attempt identity, start and deadline. Browser E2E also covers refresh, closing/reopening and a device clock set to 2099. Receipt timestamps are bounded below by their accepted/result evidence timestamps, preserving history ordering during a local host clock correction without changing attempt deadlines.

## E. Task submissions

Checkpoint intake uses the existing immutable source bucket, artifact records, `app.submissions`, `judge.jobs`, claim/lease protocol, bounded infrastructure retries and allowlisted feedback. There is no second Judge pipeline.

Each submission binds to one frozen attempt task and its evaluation digest. Current ownership/access, active attempt, trusted deadline, required file, size/hash and immutable task contract are checked again in PostgreSQL. Idempotent replay must match attempt, task and artifact identity.

At most three terminal learner outcomes count per task: passed, failed, compile_error, runtime_error and timeout. Pending accepted jobs reserve slots to prevent concurrent over-subscription. Applied terminal system_error releases its reservation and consumes no learner quota. A pass is permanent task credit; later already accepted failures cannot regress it. New submissions to a passed task are denied. The read operation supplies authoritative task-pass and reservation summaries, so the browser renders server-derived task credit/quota instead of calculating it from a truncated history.

## F. Scoring/aggregation policy

Each task contributes either zero or one point. Exactly four equally weighted tasks yield 0–4 points. Three or four passes produce PASS. Zero, one or two passes produce FAIL when infrastructure uncertainty cannot change the threshold. No percentage or numeric mastery model is introduced.

The pure domain aggregator and trusted PostgreSQL finalizer have matching policy coverage. Finalization consumes only committed, authoritative, product-applied terminal Judge results. Any still-pending accepted job leaves the attempt evaluating, including when three other tasks have passed, so the durable numeric result is stable.

## G. System-error behavior

Judge retains its existing maximum three infrastructure execution attempts. system_error remains infrastructure evidence, with fixed safe feedback. If at least three tasks passed, unresolved infrastructure on another task cannot prevent PASS. If fewer than three passed but uncertainty on unpassed tasks could reach the threshold, the outcome is `infrastructure_blocked`. Infrastructure uncertainty that cannot affect the threshold does not prevent a deterministic learner FAIL. The user further clarified that an earlier system_error stops blocking once the task receives all three fair authoritative learner outcomes with no pass; the historical infrastructure event remains, but cannot by itself justify a replacement. With only one or two fair outcomes, unresolved threshold-relevant infrastructure still blocks.

An operator with active cohort scope, or an active admin, may grant one replacement for an authoritative infrastructure-blocked attempt. The grant records actor, fixed reason and original attempt. No discretionary score override exists. Replacement start still requires current active learner access, receives a new immutable attempt ID and full 90 minutes, uses the pinned definition and retains the original evidence. Replacements inherit the interrupted normal slot and do not consume another normal allowance.

## H. Outcome application

The trusted product result service validates checkpoint task/attempt identity instead of treating a task pass as ordinary node mastery. It applies the existing task result receipt and invokes checkpoint finalization in the same transaction when closure permits it.

The checkpoint finalizer takes the same cohort/learner advisory lock, locks the attempt, reconstructs task evidence, inserts one immutable outcome receipt, changes terminal attempt state and applies progression/events atomically. The unique attempt outcome, irreversible state guards and first-pass evidence prevent duplicate application. Finalizers read committed task evidence without locking Judge jobs, avoiding a reverse lock order with ordinary result application.

A task pass alone never masters the checkpoint or creates a task progression node.

## I. Gated progression

A checkpoint PASS masters the checkpoint node with `first_passing_checkpoint_outcome_id`. The composite reference binds that receipt to the same learner/cohort/version/node. Ordinary mastery continues to use its passing submission evidence; exactly one evidence kind is required for mastered progress.

In the same transaction, locked dependent nodes whose complete committed prerequisites are mastered become available. Safe state/activity events reference the checkpoint attempt/outcome. FAIL and infrastructure-blocked outcomes leave the checkpoint in its existing started state and leave gated nodes locked. Existing ordinary result behavior is retained.

## J. Retake policy

There are two normal slots, enforced independently of replacement count. After a learner FAIL in normal slot 1, the next normal attempt requires 24 hours from trusted completion, current access and no prior pass. Slot 2 receives a fresh 90 minutes. Its learner FAIL records `checkpoint_retake_exhausted`; no third normal attempt exists.

Replacement attempts retain the normal slot they recover. A fair failure of a slot-1 replacement therefore permits only the remaining slot-2 normal attempt after cooldown. A checkpoint pass is permanent, preserves its first mastery timestamp/evidence and prohibits retakes. The reconciler emits one retake-available event after cooldown while access permits it.

## K. Reconciliation/recovery

`pnpm results:reconcile` now reconciles Judge result receipts, expired/evaluating checkpoints and elapsed retake cooldowns. It runs with the separate product connection and can run independently of web, browser and Runner. `--once` supports a trusted external scheduler; the existing authenticated internal reconciliation endpoint also includes checkpoints. Neither path accepts caller-provided score, verdict, task credit or time.

Each bounded scan item has its own restartable transaction. Repeated scans converge under the same locks and durable receipts. Infrastructure-blocked attempts require the explicit replacement grant, followed by a new learner-initiated start when access permits it. Production process supervision and scheduling are deployment work; no production service was installed.

## L. Authorization and historical deactivation

Web has only explicitly granted checkpoint functions; it cannot write checkpoint tables, outcomes, progress or Judge evidence directly. Learner reads and mutations resolve current authorization. Foreign attempt ownership, unknown tasks and inactive access are denied. Checkpoint tasks are returned only after an owned attempt exists. Operator preview does not start work; the accepted infrastructure recovery grant is its only added mutation power.

Legitimately accepted work remains historically valid after learner, membership or cohort deactivation. Previously accepted results may apply and final checkpoint mastery/unlocks may commit historically. Current reads, intake, new attempts, retakes and replacement starts remain denied. No checkpoint operation reactivates access or rewrites accepted identity.

## M. Concurrency evidence

The checkpoint PostgreSQL suite covers duplicate start requests, independent learners, simultaneous quota reservation, irreversible finish, delayed intake crossing the deadline, concurrent finalizers/reconcilers and one outcome/unlock receipt. It also terminates an actual product database connection before commit and discards an actual committed PostgreSQL acknowledgement through a TCP proxy; replay recovers without duplicate progression/events.

The final PostgreSQL 16 run passed all 114 integration tests, including 25 checkpoint cases. Duplicate starts and concurrent finalizers include two learners in the same cohort, proving they converge independently. The same 20 checkpoint policy/migration cases also passed on PostgreSQL 17 using Supabase's non-superuser migration identity; five additional recovery/deadline cases are covered by the full PostgreSQL 16 run.

## N. Security/privilege audit

`nextera_checkpoint_owner` is a restricted NOLOGIN function owner, separate from web and Runner. All checkpoint definers use `search_path=pg_catalog` and qualified objects. PUBLIC execution is revoked. Temporary migration ownership membership and schema CREATE are revoked within the migration transaction, after the required grants are completed, including on Supabase's non-superuser migration identity.

The final privilege audit on both databases verified 20 tables, eight migrations, nine checkpoint security definers, no PUBLIC checkpoint execution, no direct checkpoint table access for web/Runner, no direct product outcome INSERT, isolated owner-role attributes and no runtime role able to SET the owner. All stored attempt/outcome hashes and checkpoint job identities were independently reconstructed and verified. The PostgreSQL 17 audit confirmed temporary owner membership was revoked for its non-superuser migration account.

Runner has no checkpoint, score, timing, progression or retake mutation authority. Product finalization accepts only an attempt ID. Artifact identity, immutable source storage, hidden-feedback allowlisting, sandbox resource/network/filesystem/process controls and bounded Judge retries remain in place. Events contain identifiers and safe fixed payloads; outcome evidence contains result identities/verdicts/digests/receipt times, never source, private cases, hidden values, raw Judge output or private paths.

## O. Runner/catalog identity status

The accepted Runner originally hardcoded the only executable evaluations to hello-go-v1 and even-or-odd-v1, including node/file identity and function adapters. Four checkpoint-specific evaluation identities could not execute through that compatibility contract. The user explicitly authorized this narrow compatibility update after that boundary was reported.

New packs explicitly declare a bounded version-1 Go function contract: stable item key, safe learner file, exported function, string/int64 input and string output. Compatibility requires agreement between trusted catalog, immutable snapshot and verified private OCI metadata, plus every existing pack digest/artifact, protocol/snapshot, Runner/sandbox, platform/toolchain, offline flag and resource identity. Unknown/untrusted evaluations remain rejected. Legacy metadata retains its exact compatibility path so unchanged pack bytes keep their original identities. The Runner still performs only transport, sandbox execution and safe verdict recording.

Actual verified OCI manifest identities:

| Artifact                      | SHA-256 manifest identity                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| Previous Runner               | `85d6cad6031bb225bc6e0eadb97076fdcfc800a8d097a41fa9218dd8c19071fb` |
| New Runner                    | `02a806f4bba0b55ee40c3773c7cb7e9ad1f3560f0eef0d21f9b385dfcad0ccc3` |
| Unchanged sandbox             | `206f032819cd2c12d39ce92540a374c3319324c67c981b51031bf62f20e5b2d2` |
| Unchanged hello-go-v1         | `aac95987005f11928a2359089bf11411be11590c7b300df99702fc6bd5705c93` |
| Unchanged even-or-odd-v1      | `5ff83545dbd710044b0f2263649e507b41f756281205fd5fd6defb6728f6be66` |
| checkpoint-normalize-label-v1 | `69ff6768ed7ac69e4f2883634f4a3918ffdd4ed9928f01dc3c59b28d3eb9c3e0` |
| checkpoint-count-vowels-v1    | `435c48e8c6336831fa57a11bfd71588d33b9661a732c554e8ed83f2e890621e5` |
| checkpoint-digit-sum-v1       | `3f393de0db658843505390d9b1ed409619c543fdb635a8b7a68dc70205b174be` |
| checkpoint-sign-label-v1      | `a4f3788fa632779f7300d1a0498182bf975fcf4ca3e9900ee65bda9c081ddc76` |

New Runner config digest: `sha256:513c08534ec4925718c4dd0ce48d010ccfa74e92ea09a921f2c8441318cc8cee`. New Runner source receipt: `sha256:5821f1672a54c382f9c1a68502775082360550a1e4989a1f67612aca61408129`. Config and manifest identities remain distinct. The unchanged sandbox config identity is `sha256:3b7ace59b241a725dc10c291f1e17ba7c7e365a609301cae93fef83ee476961a`; toolchain `go1.27.2`, `linux/amd64` and resource profile `go-functions-pilot-v1` remain pinned.

The new builder reuses the verified sandbox and copies original legacy layouts without repacking. Only Runner code and the four genuinely new checkpoint fixture packs require new identities. The public sandbox process-limit test fixture was corrected to probe once per process and kill/reap its own children after the kernel rejects a fork, permitting the trusted harness to read the cgroup limit-hit counter without repeating the flood for each input. The same process limit and required nonzero counter assertion remain; this test-only change changes no sandbox, Runner or pack artifact bytes. Private inputs, packs and OCI archives remain in the trusted build owner's protected directory outside the checkout. All six layouts were verified using the binary extracted from the newly built Runner image.

`infra/runner/catalog/candidate.json` was regenerated with the new Runner and real checkpoint digests. It remains `status = CANDIDATE`, contains metadata only, retains null private registry references and is rejected by the approved-catalog parser. There was no catalog approval, real curriculum publication, production cohort creation, private registry login/push or deployment. Publication remains blocked.

## P. Tests/CI

Final verification completed on 19 October 2026:

| Verification                                                                                | Result                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository unit tests                                                                       | **93/93 passed**                                                                                                                                |
| Full PostgreSQL 16 integration regression                                                   | **114/114 passed**, including 25 checkpoint cases                                                                                               |
| PostgreSQL 17 with Supabase's non-superuser migration identity                              | **20/20 selected checkpoint cases passed**; five other cases covered by the full PostgreSQL 16 run                                              |
| Protected legacy Judge/browser regression, rebuilt Runner                                   | **38/38 passed**                                                                                                                                |
| Protected checkpoint Auth/Storage/Judge browser E2E                                         | **9/9 passed**                                                                                                                                  |
| Ordinary Auth/access/cohort browser regression                                              | **20/20 passed**                                                                                                                                |
| Sandbox matrix                                                                              | **34 distinct cases passed**: 32 unchanged cases from the full matrix run, followed by successful focused reruns of both corrected PID fixtures |
| Public metadata/packaging                                                                   | **3/3 passed**                                                                                                                                  |
| Real private OCI verification                                                               | All six layouts passed using the binary extracted from the new Runner image                                                                     |
| Independent privilege and evidence audits                                                   | Both databases passed; 20 tables, eight migrations, nine checkpoint definers; snapshot/outcome digests and task-job identities reconstructed    |
| Artifact byte/source audit                                                                  | Legacy pack trees and sandbox archive unchanged; current Runner source matches the rebuilt image receipt                                        |
| Go formatting, vet and package tests                                                        | Passed                                                                                                                                          |
| Type checking, lint, formatting, Python compilation, curriculum validation, diff whitespace | Passed                                                                                                                                          |
| Production build                                                                            | Passed                                                                                                                                          |
| Local publication check                                                                     | No real published curriculum and no production cohort                                                                                           |

The public sandbox test adjustment is explained in section O. The existing Auth migration-inventory assertion now expects eight reviewed migrations. All security assertions, resource budgets and production behavior remain intact. Browser refresh/reopen/device-clock manipulation, fresh server processes, deadline-delayed intake, post-deadline results, real transaction rollback/connection loss, lost commit acknowledgements, permanent passes, bounded retakes, scoped replacement grants, historical deactivation and the clarified fair-opportunity cases are covered.

CI includes all public domain/database checkpoint tests and Runner protocol tests. The protected E2E wrapper accepts `--checkpoints` to run real Auth/Storage/Runner checkpoint fixtures with separate restricted web and product credentials. CI never receives or uploads private test packs, learner source, raw Judge output or credentials. No artifact upload step was added.

## Q. Unresolved policy gaps/risks

No unresolved checkpoint product policy remains. The user supplied the policy and narrow Runner authorization explicitly. The four checkpoint tasks are isolated pilot verification fixtures, not a publication of real curriculum content.

The user-authorized WSL/Docker restart recovered the environment. A later native PostgreSQL run exposed cross-core WSL clock skew in an existing Judge timestamp constraint. Pinning only the disposable PostgreSQL server to one CPU produced the clean 114-test run; no accepted Judge protocol or time check was weakened. The sandbox limits also remain unchanged.

Production isolation, private registry availability/retention, approved catalog review and deployment supervision remain later accepted gates. No claim of production readiness or live deployment is made.

## R. Resulting tree

Added files:

```text
apps/runner/internal/
  artifact/contract.go
  executor/contract_test.go
apps/web/
  app/api/checkpoints/route.ts
  app/api/checkpoints/submissions/route.ts
  app/app/cohorts/[cohortId]/checkpoints/[nodeKey]/page.tsx
  lib/checkpoints/checkpoint.tsx
docs/
  FOUNDATION_006_REPORT.md
  product/FOUNDATION_006_CHECKPOINT_POLICY.md
infra/runner/
  checkpoint_artifacts.py
packages/db/
  migrations/0006_checkpoint_domain.sql
  migrations/0007_checkpoint_operations.sql
  migrations/meta/0006_snapshot.json
  operations/checkpoints.ts
  queries/checkpoints.ts
  tests/integration/checkpoints.test.ts
packages/domain/
  checkpoints.ts
  tests/checkpoints.test.ts
tests/
  e2e/checkpoint-execution.spec.ts
  fixtures/checkpoints.ts
  fixtures/checkpoint-read-probe.ts
```

Updated existing integration points: domain curriculum types/exports; committed-source loader/evaluation resolver; schema/migration journal and schema/constraint tests; curriculum import and trusted result application; existing independent reconciler/internal service; database package exports; cohort-map links; Runner artifact/snapshot/adapter verification and tests; public sandbox/metadata tests; protected Judge test wrapper/configuration; metadata-only candidate; migration-inventory browser assertion; root/database READMEs and CI.

No shared final UI, browser IDE, Redis, microservice, AI feature or production configuration was added. All changes remain unstaged and uncommitted.

## S. Suggested commit message

`feat(checkpoints): add durable timed attempts and atomic gated progression`
