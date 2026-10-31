# Exam1 rubric source freeze 001

This is source preparation, not owner approval of exact weights, curriculum publication, private test-pack construction or runtime activation. The approved categories remain coding 13+2, trace 3+2 and debugging 9+4+2. No answer, expected trace output, reference implementation or private case is included in the domain module.

`scripts/curriculum/exam1-rubric.ts` freezes the existing proposed semantic weights into immutable A/B/C/D draft records, each with exact learner-paper SHA256, per-question SHA256 and per-group criterion digest. Hash inputs are UTF-8, canonical JSON with lexicographically sorted object keys and preserved array order. Draft domain is `nextera-exam1-rubric-draft-v1\0`; criterion domain is `nextera-exam1-criterion-v1\0`. Paper and question digests hash their original bytes, without newline normalization. The complete learner-paper digest also binds its instructions and input-domain exclusions.

## Evidence and boundaries

- A: repo `content/source-baselines/exam1-go-v3/exam1-student-en.md`; SHA256 `b39bd12cd76e3f5e8a41399bc74fed5d4ebaa1949e2b21df0b27bb620b8b76f0`.
- C: verified Library archive `libfile_48caa28d22208191b0ff77647bcf58b7` version0, `C/learner.md`; SHA256 `a528401ba443b7101568919c3b5de5625ed48f140ad52ff59859648a03cf0c97`.
- D: same archive, `D/learner.md`; SHA256 `a6246dab869f14c60bfda3ed896865c1fa64c90176e7f7d3f5f9877410cd8151`.
- B: verified Library learner file `libfile_9c326e1e3c448191b7b4b2ef8d227c4b` version0, materialized with the unchanged current official helper on native Linux; SHA256 `0476b7427bb0263d4315a0f003ca9ec02c4da6b86c847138c0e7c0e0c9cdc30f`. Exact learner filenames, domains and all eight question digests are now inspected and frozen. Its previous unavailable draft is superseded by this source-reviewed revision, not by a mentor guide.

No author-supplied code ran. Only the A/B learner papers and C/D learner entries were read for criteria. A combined read that also requested B's private mentor guide was rejected by automatic review before execution; it was not retried. C/D learner-only reading then succeeded. Private solutions remain outside source/public assets.

## Exact draft weights and their published basis

| Item | Proposed functional points | Published basis                                                                                                                                       |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1   | 4 + 4 + 3 + 2              | Two nonzero branches, exact threshold, zero override; the comparison/threshold differs by form.                                                       |
| Q2   | 5 + 5 + 3                  | Ordinary pointer mutation, signed/operand-sensitive mutation, zero operands; no hidden nil pointer.                                                   |
| Q3   | 5 + 2 + 2 + 2 + 2          | Range classification, endpoint semantics, equal bounds, repeated values, empty/nil; no reversed bounds or slice mutation.                             |
| Q4   | 4 + 5 + 2 + 2              | Ordinary runes, valid multibyte runes, empty/all-excluded input, form-specific excluded character; no malformed UTF-8 or out-of-domain Unicode cases. |
| Q5   | 3 + 2 + 4 + 4              | Valid lengths, leading zeroes, declared marker/length, ASCII and entire-input validation; no overflow requirement.                                    |
| Q8   | 3 + 2 + 2 + 2              | Ordinary sum, signed/zero values, singleton, empty/nil within the declared domain.                                                                    |

These groups partition scoring value, not raw test counts. Repeating a case cannot increase a group's weight. Existing private cases have not been assigned to these groups or activated. Their group-completeness behavior and result evidence must be implemented and tested separately.

Manual categories preserve the approved allocation. The two coding points cover published API/side-effect/method requirements only, not style. Trace reasoning has two points, but form-specific one-point mentor checkpoints still need a reviewed private rubric. Debug counterexample has two points for an in-domain input and two for correct original-versus-repaired behavior; explanation has one point for the defect mechanism and one for the repair. No model answer is stored here.

## Integration API and remaining decisions

`getExam1RubricDraft(form)` returns an immutable review draft. It never returns an owner-approved flag or selected trace comparator.

`prepareExam1ScoringRubric(input, sha256)` can build the existing pure scoring module's `ExamScoringRubric` only from exact source/definition binding plus authoritative decision records: owner approval of this exact draft digest, an explicit owner-approved comparator and a separately verified manual-rubric digest. A–D are not interchangeable. Missing or mismatched evidence returns unavailable before hashing. The injected SHA256 hashes the exact supplied UTF-8 binding string; no ambient crypto, files, network or default rubric is used. The rubric digest binds the canonical scoring body; the separate sourceBindingDigest binds source draft, learner paper, decision records, definition and all scoring groups. The caller must verify the authenticity and referenced bytes of those records; they must never come from learner claims.

Only `exact_utf8` comparator is represented as a candidate implementation contract. It is not selected automatically. The earlier CRLF/LF and optional-final-newline proposal is still unapproved and is not implemented. Stored answer bytes remain exact. If that normalization is chosen, add a new reviewed comparator version rather than silently changing this one.

Every result retains `runtimeEnabled:false`. Preparing a scoring object does not publish an exam, grant mentor authority or connect it to a runner. Remaining gates are exact weight approval; explicit comparator choice; reviewed manual criteria with two trace checkpoints; source-locked case-group membership and trustworthy per-group evaluator evidence; and native persistence/review integration. The restricted-function rules also need publication to learners before use; historical papers allowing the standard library were not rewritten by this source task.

Completion remains independent of marking. No synchronous mentor gate, draft submission, retake or resource default is added.

## Digest parity clarification

rubric.digest binds only the canonical scoring body with the same01coding-exam-scoring-rubric NUL-v1-NUL framing as SQL. sourceBindingDigest separately binds the paper/draft/owner decisions/comparator/manual criteria record. These identities must both be preserved; source metadata is not silently discarded or treated as owner authorization merely because its hash matches. The candidate remains runtime-disabled.

## Learner bundle boundary

All four source-review form maps live in the curriculum preparation script, outside the public domain package exports. Client components cannot obtain other forms through the shared domain index. Runtime publication must expose only the learner's assigned frozen form, never this preparation map or private manual criteria.
