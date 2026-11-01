# Exam1 scoring details — bounded owner proposal

> Policy update: the exact generic group weights, manual point splits and
> CRLF/LF plus one-terminal-newline equivalence were approved in
> `Sentinel_e849fe300ea88191acd6431b61521c7a`. See
> `EXAM1_GRADING_APPROVAL_20261101.md` for the current record and
> `EXAM_TRACE_PROCESSOR_SOURCE_001.md` for the source integration boundary.
> Older "proposed/unapproved" wording below is retained as historical evidence.
> Private artifact/provenance bindings and actual native verification remain
> required; this update grants no runtime authority or grading activation.

Status: categories and Sunday submission/review/attempt rules approved on 30 October; see the owner-decision section below. Exact per-item semantic weights and output comparator remain unconfigured proposals. This document activates no runtime or role. Do not use the separate mentor DSA rubric.

## Already approved

Duration 180 minutes; five coding questions worth 15 each, two trace questions worth 5 each, one debug question worth 15. Pass requires at least 60 overall AND 45 coding. Partial credit and resubmission in the same attempt are accepted directions, not questions to ask again. Every official Submit freezes a separate immutable snapshot; subsequent edits remain drafts until another explicit Submit. No automatic deadline submission.

Historical confirmation: owner Sentinel_aca60fa875708191811a326710929e80 accepted the partial-credit proposal with duration changed to 3 hours; Sentinel_78871a1ed7a88191a192fea8c9a69096 accepted edits followed by another Submit. The content baseline still has `fine_partial_credit_rubric:null` and `retry_policy:null` in `content/source-baselines/exam1-go-v3/assessment-policy-approved.json`: these are missing details, not a reversal of those approvals.

## Approved categories; proposed per-item weights

Use 13 functional plus 2 announced contract/method points per coding question. Each semantic group has fixed integer weight; duplicating raw test cases never changes its value.

| Question | Functional groups totaling 13                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Q1       | Ordinary nonzero branches 4+4; exact threshold 3; zero override 2                                            |
| Q2       | Ordinary mutation 5; signed/operand-sensitive mutation 5; zero 3                                             |
| Q3       | Range classification 5; endpoints 2; equal bounds 2; duplicates 2; nil/empty 2                               |
| Q4       | Ordinary counting 4; multibyte rune handling 5; empty/all-excluded 2; form-specific character distinctions 2 |
| Q5       | Valid lengths 3; leading zeros 2; marker/length validation 4; ASCII/full-input validation 4                  |

The other 2 points assess only API, side-effect and manual-method requirements already stated in the approved question. No style points, new restriction scanner or unannounced edge cases. Blank/irrelevant answers earn zero. Compilation failure earns no functional points; any method credit requires explicit mentor evidence from that exact submitted source. This adds manual review workload; assigning all 15 points to semantic groups instead would require a revised approved weight table. Freeze the corresponding cases and rubric for each A–D form before use.

For each trace question, propose 3 output plus 2 causal-reasoning points. Reasoning has two form-specific causal checkpoints, one point each. Propose CRLF/LF equivalence and one optional final newline for comparison only; spacing/order/values otherwise remain exact and stored bytes are never normalized.

For debugging, propose 9 repair plus 4 counterexample plus 2 explanation. Repair groups: ordinary cases 3, signed/zero 2, singleton 2, nil/empty 2. Counterexample: in-domain concrete input 2 and correct original-versus-repaired behavior 2. Explanation: identifies the defect mechanism 1 and explains the repair 1. Respect each question's stated domains; do not add hidden nil pointers, invalid ranges, malformed UTF8 or overflow requirements.

Propose the existing cohort's designated exam mentor for manual reasoning, counterexample, explanation and method assessment, recording exact submission, rubric revision, points and evidence. Another existing mentor handles disputes or threshold-changing judgement. This is a proposed responsibility, not a grant or an implemented exam-review UI.

## Submission and trial rules — proposal history, now approved below

Recommend the best WHOLE finalized submission per question within the same 180-minute attempt, latest accepted submission on equal-score ties. Never combine fields or groups across snapshots. Accepted submissions may finish grading after the server deadline. Pending results remain provisional; infrastructure errors do not become zero or replace valid results, and reconciliation reuses the immutable submission without a new learner opportunity.

For Sunday's trial, propose one assigned attempt and no automatic retake, preserving same-attempt resubmission. Retake limits remain an owner decision for the product. Any extra synthetic attempts must have a finite predeclared fixture count in fresh runtime approval; no unlimited attempts, cooldown bypass or lease renewal is implied. Request/resource limits must be explicit and cannot silently import the legacy quota 3.

## Technical gates independent of these decisions

Current Runner ABI does not support the approved package-piscine functions. The staged ABI3 patch is unapplied after automatic permission denial and has a same-process observation trust-boundary issue. A restricted-function profile would need an explicit accepted-source policy; unrestricted Go requires a stronger observation boundary. No approved question is changed to fit the legacy grader.

Native typed intake/outbox, evaluator delivery, terminal result/allowance reconciliation, weighted score aggregation and authenticated browser evidence remain unverified. This recommendation does not turn reference Go tests or source-model corpora into platform grading evidence.

## Restricted-profile compatibility evidence

All 24 required coding/debug model functions across A–D compiled and passed their original selected tests as import-free subsets on Windows/amd64 Go 1.26.2 with downloads disabled. A/B/D each passed six top-level tests; C passed six with 25 successful events including subtests. Original function bodies needed no substitutions or helper dependencies. Private test imports and trace-model helpers were excluded from the learner-source subset. This is trusted reference compilation, not ABI3/Runner or adversarial security proof. B standalone student wording was absent from the inspected staging, so only its private criteria/model compatibility is attested there.

Helpers, local variables/constants/types, loops, branches, pointers and slices can remain allowed. The proposed security profile would reject all imports, compiler/build/link/line directives, init functions, package variables and goroutines across every submitted source file before compile; enforce one exact original learner file plus only hash-bound trusted staging files, and bind the exact typed function signature. No archive/path or v1/v2 policy relaxation is proposed. Existing student wording permits the standard library, so this narrows accepted implementations and requires explicit owner approval/announcement despite all models fitting. The staged ABI patch remains unapplied.

## Owner decision received — 30 October 2026

The owner approved the presented categories and trial rules in message Sentinel_4f3e232daf84819194826b1721e16d1b (21:19:52 UTC): coding 13 functional + 2 published contract/method; trace 3 output + 2 reason; debugging 9 repair + 4 counterexample + 2 explanation; assigned exam mentor review with independent second review for disputes/verdict-changing judgements; best whole finalized submission with newest accepted tie; one Sunday attempt with same-attempt resubmission and no automatic retake. Runtime faults remain unresolved infrastructure results, never automatic zero. The original table of exact semantic group weights above and newline comparator are still proposals, not implicitly frozen runtime configuration.

The learner can finish the exam and submit each question without waiting for a mentor. Manual completion or time expiry closes intake independently of review. Expiry never turns an unsent draft into an official submission. The final result remains provisional until required review/adjudication completes.

The separate restricted-function profile and local ABI source/tests/security review were approved in Sentinel_f1b3c2267ea4819197049193d0c8a7b8 (21:20:41 UTC). Existing unqualified statements above that the decision is pending are retained as proposal history. They do not describe the latest owner decision. Source and native execution evidence must still be recorded separately.

The pure scoring module requires a frozen form/question/rubric binding and positive case-group weights before it can score functional outcomes. It does not choose the remaining weights, seed a rubric, grant reviewer authority, publish content or enable grading. Approved responsibilities do not give any client a self-asserted reviewer role.
