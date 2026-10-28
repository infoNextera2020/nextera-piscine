# Quest release and review: source contract v1

This slice implements pure, versioned domain contracts in `packages/domain/quest-release-review.ts`. It does not activate scheduled access, assign actual reviewers, publish content, persist review records, award mastery/XP, change registered SQL or replace legacy `curriculum.ts` prerequisites. Existing Challenge, Checkpoint and three-member Raid behavior remains separate.

The owner explicitly confirmed a 31-day Piscine, five sampled questions per peer review, and three learners per project on 2026-10-28. `approvedPiscinePilotPolicy` records those values. Five refers to questions, not the number of peer reviewers. Actual release instants/timezone, reviewer count and other policies remain explicit; the 31-day value does not generate a calendar or change Checkpoint duration/retake rules. Existing three-member Raid semantics remain unchanged. External four-member project briefs still require reviewed redistribution, not silent import.

## Release and review are independent

`questReleaseAccess` compares a trusted server instant with an explicit cohort start plus configured offset in seconds. The caller supplies the exact cohort/quest and schedule revision. Missing configuration is unavailable, removed access is forbidden, mismatched scope/invalid timestamps are rejected, and the opening boundary is inclusive. It accepts an already resolved instant rather than inventing timezone/DST/calendar conversion, actual release dates, late-enrollment behavior or schedule-edit rules. Review completion is not an input and cannot gate a later scheduled quest.

## Immutable review cycle

`freezeQuestReviewCycle` copies and freezes the supplied evidence/content version, digests, cohort, learner, quest, cycle ID, versioned question bank, exact ordered question IDs, selection-policy version and rubric version. The owner has approved exactly five questions per peer review. An explicitly configured server sampler must provide those five distinct questions; no question bank, sampler or random seed is invented. IDs must be distinct and present in the supplied bank. This in-memory freeze is not durable storage or a cryptographic proof of authored bank contents. Persist the cycle before displaying it; retries/reloads must load that record rather than sample again. Changed evidence or selection cannot reuse old assignments/receipts.

## Assignment proposals and completion eligibility

`proposeQuestPeers` uses a supplied ranked eligible pool and complete same-cohort/quest assignment graph. It rejects self-review and reciprocal pairs, filters inactive/ineligible/cross-cohort candidates, and queues when the configured peer count cannot be met. It only proposes initial assignments for a server-confirmed unassigned cycle. It supplies no fallback candidate, reassignment, retry lifetime or algorithm. `proposeQuestMentor` runs only after the explicit peer gate is met and similarly queues without a valid mentor. Candidate eligibility and ranking must be resolved by trusted server policy; booleans from browser requests are never authorization.

`questReviewEligibility` requires exact cycle/policy-bound assignments and immutable receipts. A mentor can be assigned only after all required peer receipts satisfy the explicit `submitted` versus `approved` policy. Self-approval, stale evidence/policy, duplicate/conflicting receipts, wrong actors and mentor-before-peer chronology are rejected. `assertQuestReviewReceipt` also requires current actor eligibility/access before intake. The final result reports only mastery/XP **eligibility**, never an award, XP amount, persisted pass or downstream unlock. Existing historical receipts are not rewritten after access removal; policy for invalidating completed historical reviews still needs explicit design.

## Production boundaries and remaining inputs

These functions do not authenticate, check database roles, persist anything, schedule jobs or make concurrency safe by themselves. A future least-privileged adapter must lock/recheck current access, full reciprocal graph, cycle identity, actor assignment and policy at the committing transaction. In particular two opposite proposals made from the same old graph can race: one must be rejected on the authoritative recheck. The adapter must provide unique/idempotent assignments and receipts, freeze selection durably, preserve evidence history, and implement explicit retry/reassignment/revision and impossible-assignment handling. No production adapter, schema or approved review UI is added here.

Required owner inputs remain: actual cohort schedule/timezone and edits/late enrollment; peer count and submitted/positive-verdict gate; eligible peer/mentor pools, ranking, triggers, retry/reassignment; authored bank, sampling/coverage and rubric; accepted evidence and revision/invalidation rules; mastery criteria and numerical XP award/reversal policy. Synthetic test values are not defaults. New learner peer/mentor queues and status layouts still require design review per `QUEST1_REVIEW_GATE_READINESS_001.md`. The superseded Q1 mentor-unlocks-Q2 gate is not restored.

## Verification boundary

Focused source tests cover opening boundary/scope, review-independent access, missing policy, immutable selection, duplicate/unknown questions, self/reciprocal/cross-cohort candidates, queue behavior, peer/mentor ordering, exact evidence/actor binding, revision/access loss and conflicting records. These are deterministic pure tests, not persisted assignment, SQL, browser or live Auth/Runner evidence. No services, database connections, credentials or real learner records are used.
