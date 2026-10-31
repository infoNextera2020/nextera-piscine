# ATM observable semantic oracle: bounded engineering result

31 October 2026. Developer-only inactive proposal and pure test prototype. No learner program is executed or rewritten; no source is published, Runner configured, grade/PASS awarded or mentor gate waived.

The current approved source does not define a deterministic automatic output oracle for every required fact. This is not a choice of English error labels. The source explicitly allows flexible wording and never defines how a machine identifies which printed number is the current balance. It also asks for some internal behavior that need not produce any output at all. [The concrete counterexamples](counterexamples.md) demonstrate both gaps; the tests reproduce them.

The engineering closing step is concrete: before a future automatic pack is enabled, publish one small machine-readable **observable projection** alongside the unchanged business rules, provide its serialization infrastructure and bind the Runner's captured stdout/termination to the immutable source attempt. Keep arbitrary human prompts/explanations on a separate channel. [The candidate contract](projection-contract.md) specifies the complete framing and facts. It is a new technical output restriction requiring a visible source addendum before enforcement, not a hidden test assumption or a request for preferred English sentences.

The [pure prototype](prototype/oracle.py) independently computes the expected event/state trace from exact stdin under the retained brief, strictly parses the proposed projection and compares complete ordered facts. It does not infer truth from a learner's “correct”, “pass”, README, reported checks or self-reported process status. It changes nothing in learner code and implements no live grader. Calling it without the explicit candidate contract always returns `unresolved_contract`; even an exact matching candidate trace returns only `observations_match`, never an academic PASS.

## What is actually closed

- Exact PIN/menu/amount input distinctions, invalid-line counting, bounded integer amounts, balance updates, full cap rejection, insufficient funds, repeated menu readiness, whole-line/CRLF/final-line handling, and termination with no pending operation are represented by a deterministic independent model and adversarial tests.
- The proposed wire grammar prevents prompts, sample balances, PINs, echoed input or limits from being mistaken for current balances. There is no number scraping or magic phrase search.
- A matching trace proves only this finite captured observable scenario under the proposed projection. It does not prove all possible executions, free-prose clarity, internal variable assignments, teammate participation, README honesty or a completed project. Existing assigned-mentor/source review remains necessary; the platform's existing automated-result requirement is not bypassed by this prototype.

## Smallest sufficient boundary, with limits stated

The needed extra boundary is a separately framed machine projection, not fixed human wording. The candidate uses one two-field JSON record per fact: event kind and current balance (or null before authentication). Record order supplies timing; the input script supplies the operation, so there are no timestamps, learner IDs, operation IDs, source claims, reason essays or independent “success/pass” fields. Six routine event kinds distinguish ready menu, amount request, explicit balance observation, accepted transaction, rejection and termination. Specific rejection reason codes are unnecessary because the model derives the reason from the input and current state. Exact event spellings are an engineering grammar, not an owner language preference.

This is a small sufficient complete projection of the observable facts, not a theorem that six tokens is the mathematically shortest encoding. Some projection/framing is necessary: removing record boundaries returns the ambiguity shown in the counterexample; removing balance values loses wrong-amount detection; removing observable outcome/state transitions conflates a rejection with ignored input or a wrong branch. A narrower “digits only on balance lines” rule could test fewer balance observations, but it would not cover login/menu/rejection/EOF facts and therefore would not close this task's observable contract.

No output restriction can prove an invisible assignment after the last output immediately before program return. Such source-level requirements belong to exact-attempt source review or must be expressed as observable requirements in a future assessment contract. Adding an `end` balance report makes the intended terminal observation testable; it does not turn learner output into proof of internal memory or justify silently waiving source review.

## Source and verification

The model derives only from [the retained learner brief](../../content/source-baselines/project1-atm-v1/learner-en.md), SHA-256 `8d8ff72fdbc241e0c7fdcfe1692cef8223ee426ca68d373f004f63cf15f28a1b`. Its historical proposed-value labels are preserved. The exact supplied helper remains SHA-256 `ce71d84089a9d950208be1479bbd731a0a1f86280370a75af4fd46fab5820bd3`; no helper or learner baseline is edited. The separate input demo, single-main packaging/README proposal and existing resources remain untouched.

Run only the isolated pure tests with `python3 -m unittest discover -s docs/week1-atm-semantic-oracle-proposal-20261031/prototype -p 'test_*.py' -v`. This runs the reference/comparison logic and synthetic transcript fixtures; it launches no ATM, compiler, Runner, browser, Auth, SQL or service and uses no network. `verification.json` records the exact source hashes and observed test results.

No owner question about punctuation, capitalization or an English balance/error label is needed. Publishing a structured observation channel before automatic enforcement is the actual closing step. If the current arbitrary-output contract must remain entirely unchanged, the truthful automatic result for an unrecognized transcript remains unresolved; a universal deterministic full-semantic oracle is not supplied by the brief.
