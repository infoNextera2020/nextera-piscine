# Exam1 q6-q8 source integration inventory

Audited from `8458e889de8608d8dc0a7fcfd1dbb9626fa18b31`, following Go,
TypeScript and draft SQL call paths. This updates the earlier inventory; it is
not a live-readiness or migration-activation claim.

## Existing application composition

| Stage                      | q6/q7: trace and reason                                                                                  | q8: debugging and reason                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Learner input              | Structured output and reason fields                                                                      | Structured source, explanation and counterexample fields                                      |
| Draft Save                 | Mounted draft route/backend; canonical structured bytes                                                  | Same, with the debug answer contract                                                          |
| Official Submit            | Mounted route, frozen native identity/contract/evaluator, immutable receipt plus pending outbox          | Same; does not create a judge source artifact or job                                          |
| Automatic evidence         | Scoring accepts a trusted `trace_output.matched` boolean; no production comparator/outbox consumer found | Scoring accepts trusted fixed-group outcomes; no accepted-source-to-job/evidence bridge found |
| Mentor review              | Assigned mentor's reason mark 0-2                                                                        | Counterexample 0-4 and explanation 0-2                                                        |
| Aggregation                | Matched output contributes 3, plus reason review                                                         | Verified groups total 9, plus the two manual categories                                       |
| Missing automatic evidence | Remains pending/provisional                                                                              | Remains pending/provisional                                                                   |

The point categories above are approved policy already represented in source.
They do not approve exact group weights, comparator normalization or private
criteria. Manual review does not replace the absent automatic component.

`apps/web/app/api/checkpoints/answers/submissions/route.ts` mounts
`checkpointAnswerApi.submit`. `answer-backends.ts` lazily assembles the real
Postgres repository and `createOfficialAnswerSubmission` only with explicit
storage/body policy and verified native metadata. The service snapshots the
structured answer, checks current scope/deadline/contract and binds the evaluator.
Save and official Submit remain distinct.

`0022_checkpoint_answer_submissions.DRAFT.sql` inserts the exact immutable
receipt, pending `app.checkpoint_answer_outbox` and allowance reservation in one
transaction. `0024_exam_scoring_review.DRAFT.sql` captures that acceptance for
scoring. Neither SQL insert evaluates the answer. A tracked application search
found no consumer of this outbox; other uses are read-only catalog attestation
and receipt history projection in DRAFT0027, not evaluation delivery.

`apps/web/app/api/mentor/checkpoints/scoring/route.ts` mounts the configured
review service. It rechecks assigned mentor access, exact immutable answer,
revision and review evidence. New review is after final exam completion or
deadline; the student can finish without waiting for a mentor. Structured
answers can be read from their bound receipt; external code artifacts need the
separate authorized reader. Manual evidence persistence and outcome/adjudication
interfaces exist, but their live SQL/Storage behavior is unverified.

## Confirmed missing automatic composition

There is no hidden alternative Go q6-q8 producer. The existing native path in
`cmd/runner/work.go`, `cmd/runner/functional.go`, `internal/artifact/scoring.go`,
`internal/protocol/functional.go`, `internal/functional/publisher.go` and the
functional context SQL intentionally covers ABI3 coding q1-q5 only.

For q6/q7, `recordExamFunctionalEvidence` is a validated writer of supplied
evidence, not an implementation of output comparison. `functionalTotal` consumes
the trusted matched boolean; it does not derive it. A real immutable-receipt
consumer/comparator/publication composition is still missing.

For q8, the accepted object contains structured JSON, not the code artifact/job
expected by the Go queue. Although generic ABI3 supports the relevant function
signatures, scored-exam storage-key checks and functional report/context gates
exclude q8. No production adapter extracts the accepted source, binds a trusted
job/artifact and returns group evidence to the original structured acceptance.
This needs both the full answer/receipt digest and extracted source/artifact
identity bound together; merely widening a q1-q5 regex or routing JSON to the
legacy grader would not supply that trust boundary.

These are missing engineering components, not a reproduced native failure or a
safe isolated bug fix. No production code, SQL or existing security gate was
changed during this audit.

## Explicit policy, configuration and proof gates

`scripts/curriculum/exam1-rubric.ts:prepareExam1ScoringRubric` deliberately returns
unavailable for `exact_draft_weights_not_approved`,
`trace_comparator_not_approved` and `manual_criteria_not_bound`. The exact
`exact_utf8` comparator is a proposed decision, not a default or an inference
from approving 3 output points. Exact A-D group weights/draft digests and private
manual criterion documents also need the required approval/provenance bindings.
Approved totals, partial-credit direction and same-attempt resubmission are not
reopened by these finer missing inputs.

After those inputs are fixed, the smallest next source work is a fail-closed,
receipt-bound structured-evaluator delivery seam, with a trace comparator and
q8 source/job/evidence projection, preserving idempotency, current authority,
immutable snapshots and unknown-outcome handling. It must not invent expected
answers, group weights or hidden requirements. Private pack/manifest/artifact
bindings and explicit bounded policies/principals remain configuration gates.

Real PostgreSQL ownership/ACL/transactions, structured outbox delivery, actual
trace/debug grading, mentor read/write, final outcomes and browser learner flow
remain unverified. No SQL application, grant, credential/private artifact access,
runtime startup or frozen transport candidate change follows from this audit.
