# Checkpoint editor contract slice 001

Status: source-only client model and pure regression tests. This slice does not wire an editor, persistence, Run endpoint, timer, background worker or HTTP mutation into the active application. Existing Checkpoint upload, fixed Foundation 006 scoring, quotas, deadline and result code remain unchanged.

## Files and behavior

- `apps/web/lib/checkpoints/editor-contract.ts`: learner/cohort/attempt/question/definition scope, capability and trusted-window hints, explicit Run resource configuration, exact UTF-8 source capture, and free selection among supplied questions without a previous-pass condition.
- `editor-drafts.ts`: per-question buffer, revision and monotonic server version, truthful unsaved/saving/saved/failed/conflict states, immutable save intent, explicit conflict choice and bounded same-device recovery envelope preparation/inspection.
- `editor-execution.ts`: independent visible-example Run lifecycle and official Submit lifecycle. Uncertain requests retain their original ID and exact source despite subsequent editing. A matched receipt is acceptance only, never a grade, mastery, unlock or client quota award.
- `editor-session.test.ts`: pure regression cases; included in the ordinary Vitest suite by `vitest.config.ts`. No browser, storage, database, credentials or compiler execution is used by these cases.

All source remains preparatory and is not imported by the current Checkpoint page. Existing server contracts are authoritative; this model cannot grant permission or reserve quota. Current `CheckpointPresentation` does not expose the new draft/Run capabilities. An adapter must report missing capabilities as unavailable, not infer them from the existence of the old upload endpoint or a client flag.

## Approved product behavior preserved

Checkpoint alone gets an internal editor. Quests and Raids retain external editing/upload. Question count comes from the supplied exam, and selection has no question-level pass prerequisite. No sample ten-question curriculum or new exercise is created.

Saving is separate from grading. A late acknowledgement marks only the revision it saved; newer text remains dirty. A failed/uncertain write retries its immutable old intent before sending newer text. Stale IDs, foreign scopes and invalid versions are ignored. Concurrent saves preserve local and server source separately; only an explicit conflict choice selects the next candidate.

Run is visible-example-only, ungraded and consumes no graded attempt. Its output/state/source association is separate from official history. The result model has no grade or mastery field, rejects oversized/unsupported responses, and marks output stale after edits. Pending/uncertain Run has one source intent; no client-side compiler, hidden test pack or cancellation fiction is introduced.

Submit captures exact bytes, including original line endings and UTF-8 encoding. New edits never change an existing snapshot. An uncertain Submit retries that snapshot, rather than binding new bytes to its old ID. A deliberate revision after acceptance requires a new intent; existing server intake still decides whether it is allowed. No offline submission queue or automatic deadline submission exists.

## Integration gates and conservative engineering specification

1. **Authorization and clock:** the model only consumes hints from a currently authorized server read. The real save/Run/Submit server must atomically recheck current identity, enrollment, attempt, task/definition, deadline and action allowance. Advancing a local clock or reconnecting must never extend the server window. Missing/expired/session-uncertain access blocks mutation. Reads and accepted-before-deadline outcomes can still reconcile after intake closes; never convert a late accepted result into failure.
2. **Save API — not implemented:** use optimistic compare-and-swap on learner/attempt/question/definition scope with a monotonically increasing server version and idempotent request ID bound to source bytes. A version conflict must return the actual authorized remote version without applying the stale write. Reject scope reuse and replay of an ID with different bytes. Runtime-validate every payload; do not cast arbitrary network/storage JSON into these TypeScript types.
3. **Offline storage — not implemented:** the helper prepares data only; it reads/writes no browser storage. Retention is a required argument with no default, capped at the trusted exam deadline. Recovery requires the same identity/attempt/question/definition and current access; expired envelopes are blocked. Divergent versions require choice, and older server versions never silently replace local work. Production retention duration, storage mechanism, raw-envelope size/schema validation, multi-tab coordination and logout/access-removal purge must be settled before a persistence adapter is enabled. No credentials belong in a recovery envelope or source log.
4. **Run execution — not implemented:** an explicit, validated policy must supply timeout, memory, output/source byte limits, request-window limits and concurrency. The numbers in tests are illustrative fixtures only. No production numbers/defaults are selected here. The dedicated server executor must isolate visible examples from private grading packs and must not write graded receipts/progression. Rate/concurrency reservations, request deduplication, deadline rules and cancellation need server implementation; the client hints do not enforce resource isolation.
5. **Submit adapter — not wired:** the existing raw-byte `/api/checkpoints/submissions` endpoint remains a candidate transport. Preserve its required filename, same-origin/auth checks, size validation, immutable source hash, task/attempt binding, quota reservation and idempotency. Server-authorized filenames/limits are inputs, not values guessed by the editor. Reconciliation after a lost acknowledgement must look up the original intent before allowing a new deliberate submission.
6. **Privacy and lifecycle:** on logout/access removal the future UI must hide protected statement/source/history immediately, stop requests and prevent stale responses from repopulating another identity. Session expiry blocks save/Run/Submit until reauthorization within the allowed window. The pure model does not implement rendering, logout events, purge or authorization enforcement; those remain explicit integration acceptance cases.
7. **Per-exam scoring:** before real exam publication freeze its question list and passing count. Do not treat the existing historical four/pass-three Foundation policy as a new global default. This slice deliberately leaves the existing policy and aggregation untouched.

No new endpoint names, persistence table, role, migration or environment credential is introduced. No service, retained database mutation, push or deployment is needed to run these pure checks.

## Validation and next work

The committed slice report is accompanied by source verification logs at `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-editor-contracts`. Final test/type/lint/format/build results are recorded in the completion report and `source-checks.json`.

Browser/editor interaction, reload/offline recovery, actual autosave, visible-example execution, authenticated access and immutable server intake are **not verified by these tests**. No new runtime functionality is claimed. Home/Journey browser verification was separately approved and its loopback-only fixture is running; its results are reported separately from these contracts.

Next source step: implement explicit server capability/policy and versioned draft/Run boundaries as tested local code or migration drafts, or build the approved editor component against a clearly unavailable adapter. Applying migrations, starting services, retained database mutations and creating access still require their separately scoped approval. No repeated approval is needed for ordinary source-only work already authorized.

Final source verification: **50 new contract cases; 338 total tests across 35 files passed**. Full typecheck, lint, formatting and production build passed with the installed Node 24.19.0 / pnpm 11.22.0 runtime. No new live or browser-editor capability was exercised.
