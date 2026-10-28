# Sunday implementation source milestone

This source milestone follows `d6ad8e79`. No new runtime stack, database migration, credential, invitation, learner record, published curriculum or real code execution was enabled. The sample preview remains separate from the real learner environment. Historical registered migrations remain unchanged.

## Implemented source

- Invitation admission/enrollment/rate adapters and bounded activation HTTP assembly are prepared, with an explicitly unavailable production route until trusted policy and clients exist. The existing JSONB claim alias and enrollment lease fence were corrected. Unregistered SQL0018 requires a genuine private admission authority and inserts no accepted registry or policy defaults.
- Unregistered SQL0017 derives v2 task counts and per-exam thresholds from frozen definitions while preserving legacy records/proof shape. Server and client read projections validate optional current/historical policy metadata and derive existing score labels from the correct attempt. Missing legacy metadata stays unknown. Drizzle remains the registered v1 schema until a reviewed promotion; actual SQL correctness/concurrency is unverified.
- Pure scheduled-release and peer/mentor review contracts keep quest access independent from mastery/XP, reject self/reciprocal review, queue missing reviewers and bind receipts to exact evidence/question selection. They are proposals/eligibility computations, not persisted assignments or awards; transactional authorization and storage remain future work.
- Explicit owner decisions are recorded: **31 days, five sampled questions per peer review, three learners per project**. Five is not the number of reviewers. Release dates/timezone, retry/reassignment, rubric, bank contents and XP remain undecided. No automatic calendar or redistribution of external four-person briefs occurred.
- A guarded SQL0011+0014 rehearsal harness and combined context/draft suite are prepared. Only fake-command guard tests ran. The real SQL suite is unexecuted and excluded from default tests.
- Auth artwork has a bounded safe-aspect CSS fill. The supplied wider screenshot's exact case still requires a new matching render; browser access was denied before rendering. See `AUTH_ARTWORK_ASPECT_001.md`.

## Verification

The combined source run passed **1,059 tests**, typecheck, lint, formatting, production build and **13 fake harness tests**. Focused checks included invitation protocol doubles, source/static v2 SQL tests, domain contracts and projection parsing. No passing source/static assertion establishes real SQL parsing, privilege isolation, provider behavior, container cleanup or live activation. The earlier real HelloGo/EvenOrOdd wrong/correct result/progression evidence and completed cleanup remain documented separately; it did not cover these new features.

## Next source and operational gates

Source can continue on the real acceptance authority and deliberate activation wiring, transactional scheduled assignment/review storage, immutable question-bank publication and scoring-v2 schema/promotion readiness. No new learner/mentor layout should be invented without design review. The approved five-question selection still requires an authored bank with sufficient reviewed coverage.

The smallest next runtime proposal is the prepared private SQL context/draft rehearsal in `CHECKPOINT_CONTEXT_REHEARSAL_001.md`: a fresh private-socket PostgreSQL target, synthetic data, explicit test policy, bounded lifetime/cleanup guard, retained evidence, and no Auth accounts/passwords/tokens/TCP or retained database access. It excludes SQL0012/0016/0017/0018 and is not authorized to run yet. A later Auth/Storage/Runner rehearsal needs a separate exact scope and fresh short-lived restricted access.

Owner decisions genuinely needed before runtime/publication: accepted-learner authority and name policy; invitation issuance/reissue/lifetime, password and email-verification flow; rate/caller/retention settings; draft and same-device recovery retention; each exam's passing threshold; actual release calendar/timezone; reviewer pools/count/gate/retry/reassignment, rubric/evidence revisions and XP amounts. The remaining full learner journey is not operational merely because these source checks pass.
