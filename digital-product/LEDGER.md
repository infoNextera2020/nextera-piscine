# Implementation ledger

## 26 October 2026 — Home B / full-heart Journey

- Approved original Home B and viewport-fit heart implemented using existing server-owned data and routes.
- Full 288-test suite, typecheck, lint, format check and production build passed.
- Application browser acceptance pending; no service, database, credential, push or deployment action performed.
- See [slice report](frontend/HOME_B_JOURNEY_001.md) and [frozen approved handoff](frontend/APPROVED_DESIGN_HANDOFF_20261026.json).
- Next independent source work: Checkpoint editor contracts and pure tests; new Run/autosave integration must keep the documented access and service boundaries.

## Checkpoint editor contracts — slice 001

- Added scoped per-question draft/save/conflict/recovery model and independent visible-example Run / official Submit intents.
- No active Checkpoint UI, API, storage or database behavior changed; missing backend capabilities remain unavailable.
- Numeric Run limits and local retention have no production defaults. No automatic submission, deadline extension or silent conflict overwrite.
- See [contract and integration gates](frontend/CHECKPOINT_EDITOR_CONTRACT_001.md). Source verification is separate from browser/live verification.

## Home B / Journey browser follow-up

- Approved loopback-only fixture left running on 127.0.0.1:3118 for manual review.
- Fixed clipped tablet labels and a clipped desktop map label; heart geometry/server data unchanged.
- Final actual Chrome pass: 78 checks, zero failures or page/console errors at 1440/768/390/320 with reduced motion.
- See [browser evidence and manual review](frontend/HOME_B_JOURNEY_BROWSER_001.md). This is fixture verification, not live Auth/DB/Judge E2E.

## Checkpoint draft/Run HTTP boundary — slice 001

- Added separate authenticated draft and visible-example Run route wiring, bounded exact-source intake and explicit backend interfaces.
- Production adapters remain unavailable; no fake save/Run success and no fallback to official grading.
- No migration, retained database, credential, Judge or catalog changes; current manual preview untouched.
- See [API boundary and remaining backend gates](frontend/CHECKPOINT_EDITOR_API_001.md). Injected-port HTTP tests are not live integration.

## Versioned Checkpoint draft storage — source slice 001

- Prepared strict repository/RPC projection and a PostgreSQL adapter factory; production remains disabled.
- Added an unregistered migration DRAFT with immutable byte receipts, scoped CAS/idempotency and explicit disabled policy configuration.
- No PostgreSQL connection or SQL execution; injected tests and SQL source guard checks are not real race/ACL/cleanup verification.
- See [storage draft, policy proposals and smallest isolated verification gate](frontend/CHECKPOINT_DRAFT_STORAGE_001.md).
