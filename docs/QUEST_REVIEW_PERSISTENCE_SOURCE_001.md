# Quest review persistence: source implementation

This implements the reviewed `QUEST_REVIEW_PERSISTENCE_CONTRACT_001.md` as source
only. It does not enable quest reviews or assert PostgreSQL verification.

## Files and boundaries

- `packages/db/migration-drafts/0037_quest_review_persistence.DRAFT.sql` is
  unregistered. No migration journal or registered migration changes accompany it.
- `packages/db/queries/quest-review-postgres.ts` implements the existing
  `QuestReviewRepository`; `@nextera/db/quest-review-postgres` exports it.
- Adapter fake-client tests and SQL text-contract tests are included in the
  ordinary source suite. They do not open database connections.

The draft contains only `app.quest_review_cycles`,
`app.quest_review_assignments` and `app.quest_review_receipts`. It proposes the
isolated `nextera_quest_review_owner` NOLOGIN role with no memberships. Runtime
roles receive no direct table access or owner membership. Its four web EXECUTE
endpoints are `quest_review_lock`, `quest_review_context`,
`quest_review_lock_authority` and `quest_review_dispatch`; private functions are
not web endpoints. PUBLIC remains denied. These are unapplied ACL proposals.

## Fail-closed configuration

`createQuestReviewPostgresRepository()` defaults to unavailable. Callers must
provide the transaction client, authority port, selection-verification port and
all transaction/statement/lock/graph/metadata limits explicitly. No fixture,
environment value, global client or numeric peer-count default fills these gaps.
The 1 MiB native metadata ceiling is an internal protocol bound, not a learner
submission quota.

The supplied native ports only call fixed transaction-bound entry points; they
do not grant authority. The SQL private authority hook raises
`QUEST_REVIEW_CONFIGURATION_REQUIRED`, and its coverage hook returns false.
Supplying JavaScript ports or setting transaction-local consistency fences
cannot enable the SQL writer while those private hooks deny it.

Activation needs separately reviewed current identity/membership/access,
accepted evidence, cohort/version, peer count, eligible reviewer pool/order,
frozen policy/bank/rubric and five-question coverage providers. This source slice
does not choose those missing configuration values or publish a question bank.

## Transaction and replay behavior

Each operation uses one `begin` callback and fixed parameterized queries.
Request/graph locking precedes sorted authority locks; current authority is
rechecked for operations and before commit. The draft also rechecks private
authority inside its writer, independently of adapter consistency checks.

Cycles and assignments are immutable. Initial scope, global request IDs and
assignment receipts have uniqueness guards; receipts bind actor, cycle and
cohort scope. Exact replay still requires current access. There is no new
reassignment, XP/mastery write, exam gate or change to mentor-after-peer-completion
semantics.

The original transaction deadline includes pool wait and authority/selection
callbacks. Transaction-local statement and lock timeouts use its remaining
budget. Only owned pending queries may be cancelled, once; the adapter never
closes a shared pool. Escaped transaction methods reject after callback closure.
Work is returned only after a successful commit acknowledgement. Lost commit
acknowledgement or cancellation is unavailable/uncertain, never proof of rollback
or permission to replay automatically.

## Verification limits and next step

Source checks cover exact replay, conflicts, revoked/drifting authority,
incomplete graphs, writer failures, rollback, callback lifetime/deadlines,
cancel-once and lost-commit-acknowledgement behavior using fakes. Static SQL tests
check schema/ACL/locking invariants as text. Independent source review is required
for both layers.

Real PostgreSQL syntax, function/trigger parity, effective ownership/ACLs, pooled
transaction behavior, concurrent locking, native cancellation and commit/rollback
acknowledgement are unverified. The next native verification requires a separate
reviewed isolated scope. This source work does not authorize migration
registration/application, grants, live assembly, credentials or resource startup.
