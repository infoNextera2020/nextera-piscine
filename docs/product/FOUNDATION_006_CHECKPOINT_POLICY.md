# Foundation 006 — Accepted Piscine Pilot Checkpoint Policy

Status: Accepted product policy.
Source: explicit user instruction in the Foundation 006 conversation, 19 October 2026.
This document records that instruction; it does not claim implementation is complete.
Later milestones must not reinterpret these rules without an explicit policy change.

## 1. Composition and task identity

A checkpoint is a curriculum node of kind checkpoint containing exactly four
checkpoint-specific tasks. These are not references to ordinary practice challenges.
Each task has its own stable task identity and evaluation identity in the committed
curriculum definition. Tasks may assess the same concepts as earlier challenges,
but prompts and evaluation identities must be checkpoint-specific to test transfer.

All four definitions are frozen into the immutable attempt snapshot when the
checkpoint starts. All four tasks become visible at start, and navigation order
is unrestricted. Individual tasks are evaluation items, not progression nodes.

## 2. Eligibility and current authorization

All committed requires_pass prerequisites must be mastered before a checkpoint
can start. Unrelated mastery grants no eligibility. Eligibility is calculated from
trusted stored state, never frontend declarations. Starting an attempt, submitting
a task, starting a normal retake or starting a replacement requires current active
learner/membership/cohort access.

## 3. Trusted duration

Every legitimate attempt lasts 90 minutes:

- started_at is trusted PostgreSQL/server time.
- deadline_at is started_at plus 90 minutes.
- The browser countdown is display-only.

Refresh, browser close/reconnect, device-clock changes and web-process restart
must not extend the deadline. An existing attempt's clock is never extended or
rewritten for infrastructure recovery.

## 4. Early finish and deadline closure

The learner may explicitly choose Finish checkpoint before the deadline. After
confirmation, finish is irreversible. No new task submissions are accepted after
finish; unanswered tasks are not passed; already accepted submissions continue
through Judge evaluation; the attempt enters evaluation/finalization.

Without manual finish, trusted reconciliation closes the attempt automatically
at deadline_at. No new task submissions are accepted at or after that deadline.
Unanswered tasks contribute zero. Submissions accepted before the deadline remain
valid even if their Judge results arrive afterward. Browser activity is not
required for expiry or finalization.

## 5. Per-task submissions and credit

Each task allows at most three learner-result submissions within one checkpoint
attempt. A consumed learner-result submission is an authoritative terminal
passed, failed, compile_error, runtime_error or timeout outcome. Infrastructure
system_error does not consume this quota.

A task is passed if any legitimately accepted submission returns passed. Later
results cannot regress a task pass. If no submission has passed, the learner may
retry only while the attempt is active, trusted time is before the deadline and
fewer than three learner-result submissions have been consumed. Retry feedback
continues to hide all private test details.

Task credit is binary and equally weighted: passed is one point, not passed is
zero. There is no partial credit. failed, compile_error, runtime_error and timeout
remain distinct history verdicts, each contributing zero unless another allowed
submission for that task passes.

## 6. Aggregate pass rule

The checkpoint score is an integer from zero to four points. A checkpoint passes
when at least three of its four tasks pass:

| Passed tasks | Outcome |
| --- | --- |
| 4 | PASS |
| 3 | PASS |
| 2 | FAIL, subject to the infrastructure rule below |
| 1 | FAIL, subject to the infrastructure rule below |
| 0 | FAIL, subject to the infrastructure rule below |

This count is checkpoint aggregation only. It is not a mastery percentage or a
skill-scoring model.

## 7. Pending accepted results

After closure, the attempt remains evaluating/finalizing while relevant accepted
pre-deadline submissions are pending. A pending task must not be classified as
learner failure merely because its Judge response arrives after the deadline.
Aggregate only when the necessary authoritative results are terminal. Scoring
consumes only authoritative product-applied Judge results linked to that attempt's
task submissions; no caller can supply task credit, score or checkpoint outcome.

## 8. Infrastructure outcomes

Preserve the existing bounded Judge infrastructure retries. system_error is never
a learner failure and never consumes the per-task learner-result quota. While
time remains and access is active, a learner can submit another solution without
being penalized for that infrastructure failure.

At checkpoint finalization:

- At least three passed tasks may produce PASS despite another task ending in
  unresolved infrastructure failure, because that task cannot change passing.
- If fewer than three tasks pass and unresolved infrastructure failures could
  still affect reaching three, do not produce learner FAIL. Classify the attempt
  as infrastructure-blocked/attention-required and require recovery.

Do not restore or mutate the original attempt clock.

## 9. Infrastructure replacement

An operator/admin may grant a replacement only for an authoritative
infrastructure-blocked attempt whose unresolved trusted infrastructure failure
prevented a fair final outcome. No general discretionary score override is allowed.

A replacement has a new immutable attempt ID, a fresh full 90-minute duration and
the same cohort-pinned checkpoint definition/version. Preserve the original as
history and record why the replacement was granted. A replacement does not consume
the normal retake allowance. It cannot start until current learner/membership/
cohort access permits it. Do not add arbitrary minutes to an existing attempt.

## 10. Normal attempts and retakes

A learner has at most two normal attempts per checkpoint: the first attempt and
one retake. A normal retake requires all of the following:

- The previous normal attempt finished with learner FAIL.
- The checkpoint has not already passed.
- Current learner/membership/cohort access permits it.
- At least 24 hours have elapsed since the failed attempt completed.

The second normal attempt receives a fresh 90-minute timer. There is no third
normal learner attempt. Infrastructure replacements do not count toward the
normal-attempt limit. Neither unlimited retries nor reopening a terminal attempt
is introduced by this policy.

## 11. Permanent pass and gated progression

An applied checkpoint pass masters the checkpoint progression node. Its durable
mastery evidence is the applied checkpoint outcome/receipt and its checkpoint
attempt identity. An individual task result must never master that node.

In the same trusted product transaction, evaluate the committed curriculum graph
and make every newly prerequisite-satisfied dependent available atomically.
A failed checkpoint remains unmastered and unlocks no dependent. If a normal
retake remains, attempt eligibility may return after the 24-hour cooldown. After
two normal failures, keep the checkpoint unmastered and dependent gates locked,
and record normal-retake exhaustion.

Once passed, the pass is permanent. No retake is allowed, no later failure can
regress mastery, and original mastery/evidence timestamps are not replaced.
Historical attempts remain retained. No numeric mastery model is added.

## 12. Node progress and attempt state

Starting the first legitimate attempt may move node progress from available to
the existing in_progress equivalent. A failed attempt preserves started history.
Checkpoint attempt status and node mastery/progress are separate concepts. Do not
introduce extra node-progress vocabulary merely to support UI presentation.

## 13. Historical deactivation

A checkpoint attempt validly started while access was active remains historically
valid after later learner, membership or cohort deactivation. Its timer continues.
Submissions already accepted before deactivation continue through Judge, may
contribute to aggregation, and may produce a historically applied outcome,
mastery and unlocks.

Current access restrictions remain in force: no new task submission, checkpoint
attempt, normal retake or replacement start is permitted while access is inactive.
Historical progression must never reactivate access or permit unauthorized reads.

## 14. Safe events

Use names that fit the existing product event architecture:

- checkpoint_started
- checkpoint_finished
- checkpoint_expired
- checkpoint_passed
- checkpoint_failed
- checkpoint_infrastructure_blocked
- checkpoint_retake_available
- checkpoint_retake_exhausted
- checkpoint_replacement_granted
- node_unlocked

Events must be idempotent. Payloads must omit source, hidden cases/values, raw
Judge output and private paths. No email/push provider is added.

## 15. Required acceptance examples

| Example | Evidence/transition | Required behavior |
| --- | --- | --- |
| A | Four task passes | Score 4; PASS; checkpoint mastered; gated node unlocked |
| B | Three passes and one learner failure | Score 3; PASS; checkpoint mastered |
| C | Two passes and two learner failures | Score 2; FAIL; no unlock; retake after 24 hours if allowance remains |
| D | Two passes, one learner failure, one unresolved system_error | Infrastructure-blocked, not learner FAIL; operator may grant replacement |
| E | Three passes and one unresolved system_error | PASS; the infrastructure-affected task cannot change the threshold outcome |
| F | Submission accepted at 89:59; Judge finishes after deadline | Result still counts |
| G | Task never submitted before closure | Task contributes zero |
| H | First normal attempt fails | Second normal attempt only after 24-hour cooldown |
| I | Second normal attempt fails | No third normal attempt; gate remains unmastered |
| J | First attempt passes | No retake; original pass/mastery permanent |
| K | Valid start, then membership deactivation | Accepted work may finish/apply historically; no new submissions/attempts or access reactivation |

## 16. Implementation boundaries

Reuse Foundation 004/005 submission, Judge and product-application machinery.
Do not create a second Judge pipeline or change Runner protocol/image for this
policy. Runner cannot decide checkpoint score, pass/fail, mastery or unlocks.
The browser cannot decide time, credit, score, outcome or retake eligibility.

Keep the catalog CANDIDATE. No real curriculum publication, production cohort,
registry push, final visual UI, shared UI components, Redis, microservices, browser
IDE or AI features are authorized. Files must remain unstaged and uncommitted.

The original Foundation 006 instruction also requires stopping before any genuine
Runner/protocol change and explaining why it is needed. Recording this policy does
not authorize an exception to the unchanged-Runner boundary.

## Subsequent Runner compatibility authorization

The user explicitly authorized a narrow Foundation 006 compatibility update after inspection proved the accepted Runner only executed two hardcoded practice identities. Trusted pack metadata now declares a bounded version-1 Go function contract (item key, learner file, exported function, string/int64 input and string output). Catalog, immutable snapshot, OCI pack metadata and all prior environment identities must agree. This authorization supersedes only the earlier instruction to leave the Runner image unchanged. It does not authorize checkpoint policy or progression authority in the Runner, catalog approval, publication or registry push. Existing pack and sandbox bytes remain unchanged.

## Fair-opportunity clarification accepted on 19 October 2026

An earlier system_error remains historical infrastructure evidence, but it no longer blocks aggregation when the learner subsequently receives all three authoritative learner-result opportunities for that task and none passes. The task is definitively not passed. No replacement may be granted solely because that historical infrastructure event existed.

An infrastructure-blocked outcome requires an unresolved trusted condition that prevented the full fair evaluation opportunity set, and whose missing opportunity could still change checkpoint pass/fail. Thus system_error followed by three learner failures is not a block; system_error near deadline with only one or two usable learner outcomes can block a threshold-relevant task. Three already passed tasks still yield PASS despite infrastructure uncertainty on the fourth.
