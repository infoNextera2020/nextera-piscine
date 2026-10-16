# ADR-009 — Immutable Evaluation Environment

## Status

Accepted

## Context

A historical result must identify the inputs, trusted tests, toolchain, and
execution policy used to assess it. A mutable test-pack name or image tag cannot
supply this guarantee. ADR-004 makes Git the curriculum source of truth; this
ADR defines immutable evaluation identity and hidden-test distribution.

## Decision

### Evaluation identity

Before a Judge Job is queued, the product resolves and freezes:

| Identity | Required value |
| --- | --- |
| Curriculum | Published curriculum version ID, declared version, source Git commit, node key |
| Content | SHA-256 of the versioned curriculum content and the node subject/configuration |
| Learner artifact | Immutable storage reference, byte size, SHA-256 |
| Test pack | Test-pack ID, immutable SHA-256 digest, trusted artifact reference |
| Runner | Immutable Go Runner image digest |
| Sandbox | Immutable evaluation image digest when separate from the Runner image |
| Toolchain | Exact Go version, target platform, trusted build flags, offline dependency policy |
| Resource policy | Versioned profile and resolved compilation/execution CPU, memory, PID, timeout, output, and temporary-filesystem limits |
| Protocol | Judge protocol version and evaluation-snapshot format version |

The evaluation snapshot has a canonical digest. Every attempt and result
references that snapshot. Test packs that use generated cases must also pin a
seed and generator version. Immutable image references use digests, not mutable
tags. Runner-control and sandbox image digests have distinct meanings even when
one deployment happens to use the same artifact for both.

Curriculum content digests use a versioned algorithm over sorted repository
relative paths and their exact bytes. Hidden test contents are not part of the
web curriculum projection; their separate artifact digest binds them to an
evaluation without disclosing them.

### Publication and retries

Git remains the authoring source. Publication validates content and resolves a
trusted metadata catalog of approved test-pack/image digests. The web publisher
receives identifiers and digests, not hidden test source or image pull access.

Published curriculum projections and evaluation specifications are immutable.
Reimporting the same version and identical resolved specification is idempotent;
reusing that version with different content, tests, images, or limits is rejected.
A new specification requires a new published curriculum version for the pilot.
Cohorts remain pinned; changing a cohort's curriculum after enrollment requires
an explicit migration outside Vertical Slice 001.

Infrastructure retries reuse the exact snapshot and learner artifact. Workers
verify artifact digests and supported protocol/toolchain capabilities before
execution. They do not replace a missing image with latest, download arbitrary
dependencies, or silently raise limits. Unavailable or mismatched trusted
artifacts are infrastructure errors, not learner failures.

Re-evaluation against a changed environment is a new explicit evaluation with
its own identity and audit history. It never rewrites the original result and
is outside the first slice's learner-facing workflow.

### Hidden-test boundary

Hidden test source, fixtures, expected values, and trusted assessment code exist
only in private trusted Judge artifacts/images and their protected build inputs.
They are never included in curriculum Markdown/YAML, the public repository
distribution, web deployment artifacts, browser bundles, or application database
payloads. The web application has no credentials to fetch these hidden artifacts.

Compilation and execution both occur inside the isolated sandbox. The trusted
Runner controls test selection, comparison, and result construction. Learner
stdout/stderr is untrusted data and cannot declare an authoritative pass.

Feedback is an allowlisted projection. Public test failures may include bounded
public diagnostics. Hidden test failures expose only approved aggregate status
and fixed safe messages. Never forward hidden source, expected/actual values,
test names, raw output, stack traces, or harness paths to the web application,
including its operator diagnostics, logs, or notification payloads. A learner
printing a hidden file must not turn it into visible feedback.

For the pilot, omit raw learner stdout/stderr from every phase. Public summaries
use approved test metadata and safe fixed messages. Any future richer public
diagnostics require an explicitly reviewed stage with no hidden material.

Private registry access, database credentials, storage credentials, service
notification credentials, and the container runtime control socket stay in the
trusted Runner control plane. They never enter learner execution environments.

### Reproducibility and retention

Retain pinned images, test packs, and learner artifacts for the declared pilot
retention period; do not garbage-collect artifacts still referenced by retained
evaluations. Deletion or loss must be explicit and auditable. Digests establish
traceability but cannot restore deleted bytes or guarantee identical timing
across different host hardware. Record worker/platform information with results.

## Consequences

Results remain attributable after later curriculum or Runner changes. This
requires immutable artifact publication, a protected metadata catalog, explicit
retention, and tests for digest mismatch and hidden-feedback leakage.

Related: [lease/result protocol](ADR-008-judge-job-protocol.md),
[schema](../DATABASE_SCHEMA_v0.1.md), and
[sandbox profile](../RUNNER_SECURITY_PROFILE.md).
