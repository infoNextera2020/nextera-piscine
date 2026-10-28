# Quest review and scheduled access — readiness mapping 001

Status: accepted product direction mapped to current source; **not implemented or published by this document**. Source inspection: 28 October 2026, HEAD `01da509382d9fbc72ed94f455f765d7fd6e4222f`. The working tree also contains independent in-flight work; this document does not validate or enable it.

## Accepted direction and superseded gate

- Quest 1's approved beginner module is preserved in `content/source-baselines/quest1-beginner-v1/`. Its five original files remain byte-identical to Library file `libfile_46754df198d08191852a1af6d6d3cab8`. This is source-baseline approval, not curriculum publication, an executable grading pack or learner enrollment.
- **SUPERSEDED:** the earlier requirement that mentor approval of Quest 1 should unlock Quest 2. Do not add that prerequisite or treat this document's historical filename as permission to add it.
- **Current requirement:** each quest opens at its configured cohort date/time. Review completion is separate from access to a later scheduled quest. No actual dates, times, timezone, calendar or late-enrollment rule are selected here.
- Review is required for **every quest**, with peer review followed by assigned mentor review determining the learner's quest mastery/pass and eligibility for points or XP. Eligibility is not an implemented award, a numerical XP value or automatic credit.
- Peer assignment is automatic and **nonreciprocal**. It must not assign a learner to themselves or create an A-reviews-B / B-reviews-A pair. Mentor assignment is automatic. Candidate pools, selection/balancing algorithms and reassignment rules are not yet specified.
- Each quest has a question bank from which the learner is shown **four or five** questions. The selected identities must be frozen server-side so refresh/retry cannot reroll them. The exact count, sampling method, ordering and retry lifetime remain decisions; this is not a new fixed four-question exam policy.

These changes require a separately versioned access/review implementation. Existing challenge, checkpoint and Raid semantics must remain intact until an approved migration and adapter path supports the new quest contract. No database policy, API, learner state or existing prerequisite edge is changed here.

## Verified current source and gaps

| Concern                    | Existing source evidence                                                                                                                                                                                                                                                               | Consequence for this requirement                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quest identity             | `scripts/curriculum/load.ts:92` accepts only quest `id`, `title`, `order`; `packages/domain/curriculum.ts:4` has challenge/project/checkpoint node kinds and `questKey` grouping.                                                                                                      | There is no first-class quest review outcome or scheduled quest access contract in this model. Do not disguise a quest review as a challenge or checkpoint.                                                                 |
| Access                     | `packages/domain/curriculum.ts:9` allows `requires_pass`; lines 80–84 derive prerequisite satisfaction from mastered node states; line 104 permits subject reading only when the node is not locked.                                                                                   | Current node access cannot be presented as cohort-scheduled quest opening. A new authoritative, separately evaluated quest-access rule is required; changing labels or adding the superseded Q1→Q2 edge would be incorrect. |
| Trusted results            | `packages/db/operations/results.ts:24` requires the trusted result-application role; line 186 rejects ordinary PASS mastery for unsupported kinds; checkpoint and Raid use dedicated paths.                                                                                            | Keep automated challenge results and their idempotent application intact. An automated PASS is not a new quest mentor approval or XP award.                                                                                 |
| Raid review                | `packages/db/migrations/0009_raid_operations.sql:2` is owner-assigned team/mentor setup; lines 7–8 require three distinct members and a separate mentor. Lines 75–111 record automated evidence without awarding mastery; the dedicated Raid path binds exact attempts and membership. | Generic automatic quest peer/mentor assignment is a different contract. It must not silently replace Raid's approved three-person and exact-attempt mentor obligations.                                                     |
| Q1 content/runtime         | `scripts/curriculum/load.ts:50` defaults to `content/piscine-v1`; lines 91, 150 and 242 require the pilot Go language. The new baseline has no manifest and is outside that root.                                                                                                      | Bash scripts, command text and plain files in Q1 are not supported by the current Go-only loader/evaluator. Do not fabricate Go functions, test packs or upload acceptance to claim Shell grading exists.                   |
| Generic review/schedule/XP | Bounded inspection of `apps/web/app/api`, `packages/db/operations`, `packages/db/schema` and `packages/domain` found no generic quest-review, quest-schedule or XP-ledger contract.                                                                                                    | This is a real implementation gap, not an adapter that this document can enable. No endpoint names or schema below are represented as already existing.                                                                     |

The newer Checkpoint policy work concerns frozen exam task sets and explicit per-exam thresholds. It is not a substitute for a quest review question bank, and this decision does not select Checkpoint pass counts, Run quotas, resource limits or retention periods.

## Contract preparation, not an implemented schema

The smallest coherent design must keep the following authorities distinct:

1. **Scheduled access:** a configured cohort/quest opening instant, evaluated by the server's clock. The owner's actual schedule, display timezone and enrollment edge cases must be supplied before enabling it. Later quest access must not depend on the superseded review gate.
2. **Evidence identity:** a quest content version and immutable evidence bundle being reviewed. Q1 local Git practice remains distinct from platform file upload. Which artifacts/manual demonstrations constitute that bundle is unresolved; changing submitted evidence cannot silently inherit approval for different work.
3. **Assignments:** server-owned peer and mentor assignments scoped to the learner, quest, cohort and review cycle, with authoritative actor access checks. Reject self and reciprocal peers. Do not invent pool eligibility, balancing, fallback self-review, forced reciprocal pairs or a successful assignment when no valid candidate exists.
4. **Question selection:** a versioned bank and immutable selected question IDs, frozen before the learner receives them. Persist the selected set so refresh, navigation, request retries and interrupted sessions reuse it. Do not choose four versus five, invent bank questions, select an algorithm, or add reroll/retry rules here.
5. **Review outcome:** durable peer and assigned-mentor receipts bound to the exact evidence and question selection. The server must recheck current authority, deduplicate retries and reject stale or conflicting decisions. Required peer completion/verdict, mentor criteria, return-for-revision and invalidation behavior still need decisions.
6. **Mastery and XP eligibility:** a quest-level outcome separate from scheduled access and ordinary node results. Numerical XP, award/reversal rules, thresholds and idempotent award mechanics are not selected or implemented. An eligibility flag must not be presented as credit already granted.

Any future implementation needs concurrency, duplicate request, interrupted request, stale evidence, access removal, reassignment and impossible-assignment coverage. It must fail closed on missing policy without blocking unrelated scheduled access. There is no automatic approval, silent exclusion of an inaccessible member or invented override policy.

## Design review needed before new screens

Existing approved Home, heart Journey, Checkpoint and Raid designs remain intact. This slice creates no screen, new layout or implementation. The following gaps must be brought to Anas for review before implementing new surfaces:

- Learner peer-review work: assigned review queue, correct evidence access, rubric/question presentation, explicit submission and durable status/recovery.
- Assigned mentor work: review queue, exact evidence and frozen question set, decision/revision action and clear authority limits.
- Quest status: scheduled/not-yet-open access, independently awaiting peer/mentor review, revision and mastered/pass state. Avoid copy implying Quest 2 is locked by Quest 1 review. XP eligibility must be distinguishable from awarded XP.
- No eligible nonreciprocal peer or mentor, reassignment, removed access and uncertain review submission states.

Do not assume these screens are already approved merely because existing components can be reused. Continue independent backend preparation while the missing visual surfaces are reviewed.

## Decisions and content required

| Required input         | What remains unresolved                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question bank          | Exactly four or five per quest (or explicit per-quest count), minimum bank size, coverage/difficulty/order, sampling method, retry/review-cycle lifetime and frozen-selection invalidation. No question bank has been authored in this slice.                        |
| Peer/mentor review     | Number of peer reviews, whether a submitted review or positive verdict is required, rubric and mentor pass/revision criteria, eligible pools, assignment trigger, balancing and reassignment/no-candidate rules. Nonreciprocal assignment itself is already decided. |
| Cohort schedule        | Real quest opening instants/timezone, late enrollment and any owner-edit behavior. No calendar is seeded.                                                                                                                                                            |
| Evidence/revisions     | Accepted Q1 evidence formats/manual demonstrations, immutable bundle identity, what restarts peer/mentor review after edits and what remains historical.                                                                                                             |
| Mastery/XP             | Exact quest pass criteria and points/XP eligibility versus actual award/reversal policy. No numeric amounts or thresholds are inferred.                                                                                                                              |
| Q1 publication/grading | Approved Shell/plain-file acceptance and review approach or a separately reviewed bounded runtime; real grading fixtures if automatic grading is wanted; deferred JSON dataset and upstream reuse/provenance review before publication.                              |

A single real tester cannot truthfully complete a real peer-review workflow alone. Additional eligible people/identities and an approved test roster or an explicitly limited rehearsal are required; do not manufacture peer or mentor approvals. The root's separate one-learner official HelloGo isolated test does not authorize quest review identities, new records or policy changes. Raid's separate three-person/assigned-mentor requirements are unchanged.

## Preserved Q1 baseline and verification

The original `README.md`, `q1-learner-en.md`, `review-ar.md`, `review-ar.html` and `source-map.md` are copied without edits. `PROVENANCE.json` records their exact byte counts and SHA256 values and the source ZIP hash `816db5644c981a3972363c182d046e9bc818153a95cbd8be6c2d3f3a3a7c20a5`. Supplemental `BASELINE_STATUS.md` records the later approval and the corrected review/access direction.

The supplied mapping accounts for all 13 reviewed upstream Q1 files. Deferred curl/jq/JSON exercises, the external capstone and optional quoting/advanced stretches remain deferred. Git learning does not enable Git submission, remotes, push or credential storage. Optional video references are preserved; no new playback or caption verification is claimed.

Verification for this slice is source-copy/hash/path and documentation consistency checking. No loader import, publication, execution pack, SQL, database connection, credentials, learner records, service or UI change is performed. No claim of operational Shell grading, live review assignment, quest scheduling or XP awards follows from these files.
