# Quest-review persistence contract 001

Status: source-only draft for the initial-cycle interface, not registered SQL,
permission creation, runtime enablement or a new review product. Based on main
`bef457a03a7a5728c97342c23994f88930243cda`. The frozen transport candidate is separate.

## 1. Scope and existing authority

Implement only `QuestReviewRepository` / `QuestReviewTransaction` in
`packages/db/operations/quest-reviews.ts`, with the rules in
`packages/domain/quest-release-review.ts`. Persist three new logical tables:
`app.quest_review_cycles`, `app.quest_review_assignments`, `app.quest_review_receipts`.
No question bank, schedule, queue, retry, XP ledger, grading engine, new public API,
admin override, second acceptance or later-quest access gate is added.

The existing service supports an initial cycle and exact reads/replays, not cycle
replacement. Completed required peer reviews precede automatic assigned-mentor
allocation. Peer receipt decision is `submitted`; the service's configured policy
requires `peerGate: submitted`. Mentor decisions are `approved` or
`changes_requested`. The domain's broader `approved` peer-gate union does not
activate that alternative. No count of peer reviewers is inferred from the five
review questions. Five questions remain fixed; the approved five-of-twenty coverage
policy is a separately verified sampler input, not a new choice in this contract.

Review eligibility does not write mastery or XP and does not change scheduled
quest access. Exam1 Finish remains independent of marking and mentor availability;
this contract adds no synchronous exam mentor gate or exam rule.

## 2. Identity and representation

Native entity/operation IDs use the repository's UUID storage convention: cohort,
learner, reviewer, cycle, assignment and receipt/request IDs. Auth subject is the
verified server Auth UUID; it is resolved to the current internal `app.users.id`.
Never bind a write using a name, student number, email, browser role or caller's
claimed internal identity. Synthetic text IDs in pure domain tests are not a native
SQL format promise. Require canonical lowercase hyphenated UUID text before any
lookup, lock encoding or query, using the same lowercase UUID pattern as existing
native query adapters. Reject uppercase, brace, compact and other UUID aliases;
do not let equivalent PostgreSQL UUID values take different request/graph locks.
There is no new UUID-version requirement.

Quest/version/rubric/policy/question identifiers are exact opaque text matching the
current domain `id()` predicate (nonempty, no NUL, unchanged by ECMAScript trim).
Native text must additionally be Unicode scalar text: reject ill-formed UTF-16,
including lone high/low surrogates, before UTF-8 encoding, hashing or SQL. Never
silently replace them with U+FFFD. This is native admissibility, not a change to
the pure domain's broad string type. Use byte-sensitive `C` collation for key
comparisons and preserve well-formed UTF-8 without case or Unicode normalization.
Test validator parity only for that explicit native scalar-text intersection;
do not claim every JavaScript string can round-trip through PostgreSQL UTF-8. Digests are exactly 64
lowercase hexadecimal characters. Selected question IDs retain their order.

Domain timestamps are exact safe-integer milliseconds in the existing JS Date
range, persisted as bigint and parsed with explicit range checks. `assignedAtMs`
and `submittedAtMs` come from the trusted server runtime, never the request body;
persist them unchanged so replay returns the same receipt. A separate DB-generated
`recorded_at` audit timestamp does not replace those identity fields. Do not invent
a clock-skew tolerance, lifetime or deadline for quests.

## 3. Three-table contract

### Cycles

| Column/group          | Required representation and invariant                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | UUID primary key; the domain `cycleId`                                                                                                                                             |
| Scope                 | `cohort_id`, `learner_id` UUID; `quest_key` exact text                                                                                                                             |
| Native content anchor | Server-resolved `curriculum_version_id` UUID, bound to the cohort's pinned version; separate from opaque domain `content_version`                                                  |
| Evidence              | `content_version`, `evidence_version` exact text; `evidence_digest` SHA-256                                                                                                        |
| Frozen selection      | `question_bank_version`, `question_bank_digest`, `selection_policy_version`, `rubric_version`; `question_ids` text array, exactly five non-null unique valid IDs in original order |
| Policy snapshot       | Version 1, exact revision, positive safe-integer bigint `peer_count`, `peer_gate = submitted`, exact `ranking_policy_version`; no numeric default                                  |
| Audit                 | DB-owned `recorded_at`                                                                                                                                                             |

Unique initial scope is `(cohort_id, quest_key, learner_id)` with no version escape
hatch. Changed content, evidence, bank, sampler, rubric or policy fails closed;
it does not insert another cycle. A future revision/reassignment policy needs a
separate versioned path, not an UPDATE or a second row under altered scope.

Foreign keys bind learner/cohort membership and `(cohort_id,curriculum_version_id)`
to existing records with restrictive delete/update behavior. The current native
curriculum has no first-class quest table: the authority reader must prove that the
exact quest exists in that pinned curriculum and that the current existing
publication/cohort access checks permit it. A source baseline alone is not live access. Do not fabricate a node ID or a new
quest table just to obtain a foreign key. A unique composite cycle identity also
supports the child scope/policy foreign key described below.

Before insert, the native writer verifies all proposed cycle fields against the
locked authoritative context, including selected-ID membership and the verified
selection policy. Five IDs plus a matching hash do not prove five-bucket coverage.
The current Bank interface contains IDs/version/digest only; its separate trusted
sampler/selection validator must attest the already-approved coverage contract.
A missing validator is configuration-required, not a permissive acceptance stub.

### Assignments

| Column/group | Required representation and invariant                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | UUID primary key                                                                                                                 |
| Cycle/scope  | `cycle_id`, `cohort_id`, `quest_key`, `learner_id`, `policy_revision`; composite foreign key to the exact immutable cycle/policy |
| Reviewer     | `reviewer_id` UUID references existing user; never equals `learner_id`                                                           |
| Kind         | Exactly `peer` or `mentor`                                                                                                       |
| Time/audit   | Exact `assigned_at_ms` bigint plus DB-owned `recorded_at`                                                                        |

Unique `(cycle_id,kind,reviewer_id)` rejects duplicate peers; a partial unique index
on cycle for kind mentor allows at most one mentor. Do not add a distinct-person
rule across kinds that the existing service does not impose. Current actor/pool
roles and eligibility are still checked on each operation.

Peers are inserted atomically as either no allocation (queued) or the complete
frozen `peer_count` bundle; partial peer sets cannot commit. The complete same-
cohort/quest historical peer graph is checked under the graph lock: no self or
A-reviews-B/B-reviews-A pair. Do not filter the graph to active users or incomplete
receipts, or silently truncate it. Assignment writes must repeat that check in the
protected native writer, not trust caller-supplied `graphComplete`.

The mentor is allocated only after all required peer receipts are submitted, with
`assigned_at_ms >=` every required peer submission. Peer candidates have the current
learner role; mentor candidates have current operator/admin role. Eligibility and
ranking come from the explicit authoritative pool policy; role alone does not
assign an unrelated admin. Do not introduce an unconditional membership exception
or silently require a new admin membership not selected by that policy.

### Receipts

| Column/group     | Required representation and invariant                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`             | The exact UUID request ID, globally unique across actors, scopes and assignments; no second receipt identity       |
| Assignment/scope | `assignment_id`, cycle/scope and `reviewer_id`; composite foreign key to the exact assignment and its frozen cycle |
| Decision         | Peer: submitted. Mentor: approved or changes_requested. No other decision                                          |
| Time/audit       | Exact `submitted_at_ms >= assigned_at_ms`, plus DB-owned `recorded_at`                                             |

Unique assignment ID means one immutable receipt per assignment. No UPDATE/DELETE
or ON-CONFLICT-UPDATE path exists. Reconstruct the full domain cycle from its
immutable parent; never attach another caller-supplied cycle JSON or raw evidence.
Store no private questions/answers, password/token, email or arbitrary feedback in
these tables. The existing receipt interface has no free-text feedback field.

## 4. Transaction, locks and authorization

The adapter keeps one retained connection and one SQL transaction for the entire
repository callback. It accepts only the detached command snapshot from bef457a.
All methods use that same connection, scope, verified subject and request ID. There
is no statement-per-connection adapter and no callback after transaction close.

Acquire locks in this fixed order:

1. For submission only, transaction advisory lock for the global receipt request ID.
2. Transaction advisory lock for the complete `(cohort_id,quest_key)` peer graph,
   including initial-cycle absence. Prepare uses this same graph lock.
3. Current actor, learner and candidate user rows in UUID order, then their relevant
   membership rows in `(cohort_id,user_id)` order, then the cohort row, using FOR
   SHARE as existing checkpoint/raid access readers do. Re-read active/role/access
   facts after locking; do not use FOR KEY SHARE for mutable active/status columns.
4. Current authoritative context/policy/evidence references, then cycle row and assignment/
   receipt rows in deterministic identity order. Revalidate current context and
   exact binding before returning an existing result or committing new rows.

Discover the native identity set for row locking from the private authority reader,
not the request. That preliminary discovery is not authorization. Re-read the
context after locking. If its required identity set or protected reference changes,
abort rather than acquire another out-of-order row/graph lock or silently omit a
candidate. A complete peer graph and a configured candidate-pool snapshot are
separate facts; neither is inferred from the other.

Advisory lock keys use separate fixed protocol prefixes plus unambiguous JSON-array
encoding, hashed with PostgreSQL `hashtextextended(...,0)`: request prefix
`quest-review-request-v1`, graph prefix `quest-review-graph-v1`. Hash collisions can
only over-serialize; every query still filters exact native keys. Never use a
per-learner/per-cycle lock alone, SKIP LOCKED, partial graph or lock outside the
transaction. Each callback owns one request and graph scope; it never acquires a
second request/graph lock. No new lock namespace overlaps by construction with a
bare concatenated data value. Cross-domain deadlocks remain aborts, not a claim of
global deadlock freedom or a reason to weaken locks.

Use explicit bounded transaction/statement/lock settings supplied by the reviewed
runtime configuration, without selecting a product retry quota or numeric timeout
here. Missing bounds or incomplete graph results fail closed. A definite deadlock,
serialization failure, cancellation or statement failure rolls back all cycle,
assignment and receipt writes. No partial selection or receipt reaches the learner.

Prepare requires current active ordinary-learner ownership of that exact scope.
Submit requires the exact current assigned reviewer, non-self identity, expected
current role/eligibility, active learner access and unchanged evidence/policy. An
admin role is not an override. Current access checks precede duplicate lookup, as
in the existing service. Scheduled availability stays separate from review mastery.

A trusted private context authority must resolve policy, bank, evidence, schedule-
based access, ordered candidate pools and the initial-assignment trigger under the
same transaction and pin their authoritative versions. No HTTP/caller JSON provides
those facts. Missing provider or missing policy/bank/evidence returns unavailable/
configuration-required. This contract creates no new authority table, fabricated
context reader or permissive hook; concrete binding remains a technical integration
gate. Immutable file-backed policy/bank metadata also requires independently checked
source/approval digests and a transaction-consistent current-reference check.

## 5. Replay, uncertain outcomes and projection

Under the global request lock, a duplicate request succeeds only when the stored
receipt has the same request ID, exact cycle, assignment, reviewer and decision,
and is present in that cycle's receipt collection. Return original timestamps.
Cross-actor/scope/assignment/decision reuse is idempotency_conflict; it returns no
foreign receipt data. A different request ID for an already-receipted assignment
also conflicts. A read for prepare returns the persisted five IDs without invoking
the sampler again; changed authoritative inputs are conflicts, not rerolls.

A commit acknowledgement lost after sending COMMIT is uncertain, not rolled back
or committed by assumption. Return no persisted/saved success and do not rerun the
callback automatically. A later authorized prepare reads the same unique scope;
a later authorized submit uses the same original request ID and semantic intent.
Both recheck current access first. New request IDs, timestamps or approvals cannot
be fabricated to conceal uncertainty.

Readback preserves the stored question array order, orders assignments by
`(assigned_at_ms,id)` and receipts by `(submitted_at_ms,id)`, and reconstructs
only the existing StoredQuestReview domain shape. Selected questions are not shown
before commit acknowledgement. The public route may expose only its authorized
existing projection; internal context/complete peer graph is not a learner export.
Exact immutable records plus current facts produce eligibility only; no mastery,
XP award, outcome replacement or later-quest unlock is written by this slice.

## 6. Proposed privilege boundary, no changes performed

Follow isolated-owner conventions in registered 0003/0006/0008/0009: a purpose-
bound NOLOGIN owner (proposed name `nextera_quest_review_owner`), no superuser,
createdb/createrole/replication/bypass-RLS flags or runtime membership/SET access.
Immutable history guards reject UPDATE/DELETE on all three tables. Definer entry
points use fixed pg_catalog search_path and qualified names, with no dynamic SQL.

| Principal                                            | Intended later authority, subject to exact reviewed DDL/ACL audit                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC                                               | No table or function access                                                                                                           |
| Existing web permission role                         | EXECUTE on only the exact context/read/write entry points; no direct table DML or owner membership                                    |
| Runner, maintenance, ordinary learner SQL principals | No quest-review write/owner authority introduced                                                                                      |
| Isolated owner                                       | Own the three tables and narrow functions; read only required current identity/cohort/curriculum context; minimum row-lock privileges |
| Setup/migration actor                                | Separate reviewed setup authority, no persistent runtime escalation; restore exact prior temporary ownership/membership state         |

PostgreSQL FOR SHARE needs UPDATE privilege: registered 0003 explicitly grants
owner-only UPDATE(id) on users/cohorts and UPDATE(joined_at) on memberships for that
purpose. The reviewed implementation must account for equivalent minimum privileges
and every context-reader dependency; never grant broad web DML or owner inheritance
to fix a lock error. Every native write entry point rechecks the authority and
cross-table invariants; a TypeScript callback or digest alone is not DB authority.

No role, grant, function, trigger, table, security setting or migration is created
by this document. Actual setup/ACL changes require their separate applicable review
and action-time authorization; no expired transport/runtime approval applies.

## 7. Remaining inputs and precise next source slice

The storage contract is parameterized, so no new product decision blocks drafting
its tables and adapter. Before activation, authoritative configuration must supply
the actual peer-review count, eligible pool/ranking revision, approved bank/coverage
validator and rubric, evidence definition/version and real cohort schedule. No
exact peer count or production pool/ranking was found in the inspected canonical
policy records; one peer in tests is a fixture, not an owner decision. If these are
not already decided elsewhere, those values/evidence requirements are the narrow
inputs for Anas. A reviewed preconfigured trial roster and explicit candidate order
can supply pool/ranking configuration; no new automatic balancing algorithm is
required by the three-table adapter. Five questions, nonreciprocal peers, submitted-peer completion,
assigned mentor, immutable selection and mentor-after-completion are not reopened.

No initial-cycle path implements revisions, reassignment, retakes, XP amounts or
new bank content. Those later features remain outside this slice rather than
receiving invented defaults. Current changes_requested remains immutable
revision_required; this contract cannot silently replace it with approval.

Next implementation slice, after this contract review:

1. Write an unregistered three-table DRAFT with the exact constraints/history guards,
   narrow native entry points and explicit ACL proposal. Allocate an unused draft
   number then; leave the migration journal and registered SQL bytes unchanged.
2. Add `packages/db/queries/quest-review-postgres.ts` implementing the existing
   repository interface on one bounded transaction and explicit private authority
   reader/selection-validator ports. Missing ports stay unavailable. No route or
   environment flag can self-approve current facts or enable the adapter.
3. Fake-client regression tests must cover fixed lock order, reciprocal concurrent
   proposals, unique initial scope, global cross-scope request reuse, exact replay,
   stale/revoked authority, missing/changed bank/policy/evidence, full rollback after
   each insert, lost commit acknowledgement and no automatic replay; preserve the
   input snapshot regressions from bef457a. Static review must cover every FK,
   unique/history guard, PUBLIC denial, exact owners and row-lock privilege needs.
4. Independently review those source changes. Production assembly remains disabled
   until a real authoritative context binding exists. Native SQL syntax, role/ACL,
   concurrency, cancellation and uncertain-commit verification require a separate
   fresh disposable rehearsal; no test execution is authorized by this document.

Source evidence: `packages/db/operations/quest-reviews.ts` (transaction requirements
and initial-cycle orchestration); `packages/domain/quest-release-review.ts`
(frozen selection/complete peer graph/eligibility); `packages/domain/piscine-pilot-policy.ts`
(five questions); registered `0003_judge_protocol.sql` (row-lock privileges),
`0007_checkpoint_operations.sql` (recheck access under row locks), and
`0008_raid_domain.sql` / `0009_raid_operations.sql` (immutable history, purpose-bound
owner, composite identity and transaction locking conventions). Schema absence and
bef457a regression evidence are retained in the Windows task workspace under
`verification/quest-review-input-binding-20261101`, not inside the product checkout.
