# Exam1 functional producer composition audit

> Source follow-up: `EXAM_DEBUG_PROJECTION_SOURCE_001.md` supplies a disabled q8
> repair-source/evidence composition over required future native ports. Native q8
> queue/Storage/Go/result adapters remain absent. The frozen 83fb612 Windows fake
> guard test has now passed; this is not a container or database execution proof.

## Finding corrected

`createScoredExamFunctionalProducer` in the database TypeScript package is a
reference/client implementation whose call sites are tests. That fact does not
mean the real Runner lacks a functional producer. The native application path
already exists in commit `99e3043`, before this audit. Adding another producer to
the web or result reconciliation path would duplicate an existing responsibility.

No additional production writer or composition factory is introduced here.

## Actual application path

1. `apps/runner/cmd/runner/main.go` dispatches `work`.
2. `work.go` loads `localConnections` with the explicit optional
   `--functional-publisher-config`. `functional.go` validates the declared local
   queue target before reading publisher configuration. Omitted configuration
   returns no publisher; it does not load evaluator credentials or enable scoring.
3. `internal/functional/local.go` binds every separately configured evaluator
   route to that exact local target. The queue principal is not reused for scoring.
4. `internal/executor/executor.go` builds a host aggregate report only from a
   verified scoring manifest and complete observed case results.
5. `work.go` acknowledges the queue's binary result before calling
   `publishAfterAcknowledgement`. Failed acknowledgement never enters that branch.
6. `functional.go` stops/joins lease renewal and creates a separately bounded
   publication context. Only ABI3 coding items q1-q5 with a host report reach
   `Prepare`; system errors and unsupported/missing observations do not become
   fabricated group points. This producer does not establish composition for
   q6/q7 tracing or q8 debugging; their approved scoring/review paths need separate
   verification.
7. `internal/functional/publisher.go` captures the report, reads
   `app.scored_exam_functional_context`, validates immutable identity/artifact/
   rubric/manifest/group bindings, stores a protected exact envelope, then calls
   `app.record_exam_scoring_event` once with the evaluator principal.
8. Unknown acknowledgement retains the original operation/revision/payload for
   explicit exact-envelope replay. The work handoff does not automatically create
   a new scoring operation. Binary persistence is distinct from final scored-exam
   outcome and mentor review.

## Regression and proof boundaries

The added composition regressions cover omitted publisher configuration and the
acknowledged ABI3 q1-q5 boundary, including disabled/missing/legacy/ATM/trace/debug,
missing-observation and infrastructure-error cases. Existing tests cover the
native context/report binding, TypeScript/Go canonical evidence parity, durable
outbox before write, tamper/capacity failure, unknown acknowledgement, explicit
replay, target confinement and parent cancellation. All clients and credentials
in these source tests are synthetic; database calls are mocked.

The actual native invocation, database privileges and persisted scoring outcome
have not been verified by this audit. The existing SQL remains draft, and the
local-only target/configuration gates remain unchanged. No publisher was enabled,
private artifact read, SQL applied, permission granted, credential used/created,
resource started or frozen transport packet changed.

## Real remaining gates

The blockers are verified deployment inputs and runtime evidence, not an absent
producer call: exact approved per-question functional groups/weights and criterion
bindings, complete private pack/manifest/case/artifact bindings for the selected
form, reviewed SQL/role setup, explicit protected evaluator/outbox limits and
target-bound configuration, then actual result-to-scoring-to-review verification.
The fixed published rubric supplies points; neither this audit nor synthetic
fixtures choose weights, hidden criteria or default authority.

No new product choice is required to retain this existing composition. Any
unresolved exact case-group weights or criteria remain publication inputs to
resolve against approved content before activation. Final result/review and the
full learner journey are not claimed ready.
