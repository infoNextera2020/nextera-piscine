# Exam1 grading policy approval — source addendum

The owner approved proposal `Sentinel_772f0614fef88191b978c186a2bf8248` (2026-11-01T03:30:05.901657Z) by direct reply `Sentinel_e849fe300ea88191acd6431b61521c7a`.

The exact approval timestamp is unavailable. The reported approximate time is 2026-11-01 around 05:30 UTC. No exact timestamp or runtime approval receipt is inferred from that approximation. This record concerns grading policy only, separately from the pending PowerShell test and all runtime access.

The approved functional group weights remain in their existing question order for all four forms:

| Question  | Group points  |
| --------- | ------------- |
| q1        | 4, 4, 3, 2    |
| q2        | 5, 5, 3       |
| q3        | 5, 2, 2, 2, 2 |
| q4        | 4, 5, 2, 2    |
| q5        | 3, 2, 4, 4    |
| q8 repair | 3, 2, 2, 2    |

A functional group earns its points only when every fixed case passes. Infrastructure faults or missing trusted observations remain pending/attention-required rather than receiving invented zero points.

The new trace comparator is named `crlf_lf_optional_terminal_lf_v1`. Both operands must be valid UTF-8. It converts CRLF to LF and removes at most one final LF from each operand, then compares all remaining bytes exactly. Lone CR, other whitespace, blank lines, BOM, Unicode representation, values and ordering remain significant. Historical `exact_utf8` bindings retain exact comparison; their name never acquires normalization semantics. New rubric preparation explicitly requires the new named comparator.

Manual components are one point for the published coding signature and one for the remaining published obligations; two causal trace checkpoints worth one point each; debugging counterexample input and described behavioral difference worth two points each; defect cause and repair explanation worth one point each. Equivalent explanations are accepted without mandated terminology. These are generic categories, not private expected answers or per-form causal checkpoints.

The existing mentor-after-completion policy and provisional-result behavior remain. A second mentor handles appeals or judgments that change pass/fail. No synchronous mentor action blocks exam progression or submission.

Each source candidate has a new draft digest because policy metadata and generic manual descriptors changed. Published learner-paper and functional-criterion digests and group weights remain intact. Preparation still requires explicit form, definition, paper, exact candidate and private manual-criteria bindings. A message ID or a plausible hash alone is not authenticated approval; the authoritative publication adapter must verify provenance and private criteria. There is no fixture/default activation.

This addendum and its pure tests do not enable grading, publish content, connect to PostgreSQL, apply SQL, create credentials, or prove native database/browser behavior. Native version allowlists and runtime evidence remain separate integration gates.
