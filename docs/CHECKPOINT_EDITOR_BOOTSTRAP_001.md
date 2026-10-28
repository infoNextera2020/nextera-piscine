# Checkpoint editor bootstrap and draft synchronization 001

Current source assembly and controller integration supersede the earlier next-step notes below. See [HTTP assembly 001](CHECKPOINT_HTTP_ASSEMBLY_001.md). The separate [real SQL rehearsal](../verification/checkpoint-context-20261028/REPORT.md) passed 17 tests; authenticated HTTP/browser autosave remains unverified and disabled without explicit runtime configuration/policy.

## Scope

This source-only slice adds a read-only authenticated GET /api/checkpoints/editor for one attempt/task, a bounded client decoder/transport, and a per-question synchronization controller. It does not enable live autosave, local source storage, visible Run execution, or a new grading path.

The bootstrap derives learner/cohort/attempt/task/definition from authorized server context, includes an existing draft or explicit null, and validates the published filename, source ceiling and trusted clock. Missing production backend returns 503. Non-learners, removed access and mismatched context are rejected before protected source is returned. Responses are private and not cached.

## Capability boundaries

- Draft capability is attested only through the configured draft backend. The production backend remains null.
- Bootstrap does not authorize official Submit or Run. Official raw-source submission keeps its existing independent access, time and quota checks.
- No hidden test, grading pack, Auth identifier or secret is exposed by the new payload.
- Recovery policy is null. No TTL, numerical Run limit, cross-device overwrite rule or automatic deadline submission is introduced.

## Client orchestration

CheckpointDraftSync is prepared for one question after a validated bootstrap. It preserves any source typed before loading finishes, tracks server version and local revisions, and acknowledges only the exact saved revision. A later edit remains unsaved. A lost or malformed acknowledgement retains the original source, request ID and base version for an idempotent retry. Concurrent saves are suppressed. A conflict requires an explicit keep-local/use-server choice. Server access removal, session expiry or a definition mismatch invalidates this in-memory controller and stale callbacks cannot restore its source.

Deadline hints advance using an injected monotonic clock. Invalid or reversed clocks fail closed. Every actual API write still rechecks authority/time/CAS atomically; these client hints grant no access. Empty drafts may be saved without becoming a graded submission.

An optional recovery envelope can be prepared only when a future adapter supplies an explicit positive retention policy. It is capped at the exam deadline. This module performs no browser storage or automatic recovery and sets no retention default.

## Verification and remaining integration

Node/injected tests cover the HTTP handler, identity binding, protected response handling, exact UTF-8/BOM/CRLF transport, bounded JSON, first-save metadata, CAS conflicts, uncertain retries, edits during save, expired/invalid clocks and access removal during an in-flight save. These tests are not authenticated browser or real-database evidence.

Next independent slice: wire the validated bootstrap/controller into the existing Checkpoint component lifecycle with observable save status and explicit conflict UI. The component must preserve pre-bootstrap edits and per-question state, dispose on identity/access changes, and never report saved on 503. Local recovery storage must remain disabled until its retention/cleanup policy is configured and reviewed. Then verify responsive browser behavior in the approved sample preview separately from real authenticated persistence.

Live gates remain: co-resident isolated Auth/product/Storage environment, approved migration/application scope and bounded credentials, draft backend configuration, explicit recovery retention, visible-example manifests/policy/executor, and SQL0012 rehearsal (not authorized or run in this slice). No services, database connections/mutations, migrations or credentials were created here. Existing manual preview was not rebuilt or restarted.

The sanitized Library exports are a frozen pre-slice snapshot of 0a93a06, not an archive of this later commit. Their manifest and checksums remain unchanged. Four original unrelated dirty files were preserved.
