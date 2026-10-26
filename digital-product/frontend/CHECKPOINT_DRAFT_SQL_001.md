# Checkpoint draft SQL verification 001

Status: **13 real PostgreSQL cases passed** in one explicitly authorized disposable PostgreSQL 16 cluster. This verifies database/repository behavior, not authenticated browser autosave, real Auth, Storage or Judge execution. No production adapter was enabled.

## Isolation and approval

The user approved a private local socket rehearsal with synthetic data and complete cleanup. The runner `scripts/test-checkpoint-drafts-isolated.py` uses a newly created mode-0700 `/tmp/nextera-checkpoint-draft-test-*` directory, a mode-0700 socket, `listen_addresses=''`, host authentication rejected and the fixed database `foundation_test_checkpoint_drafts_ephemeral`. Its explicit start/test/cleanup modes verify the absolute data directory and empty TCP listen address before connecting or deleting anything. It never reads `.env`, accepts a database URL fallback, or installs software.

Only the ephemeral initdb bootstrap identity and committed foundations' NOLOGIN roles existed in this removed cluster. Synthetic `auth.users` UUID rows are foreign-key stubs, not accounts issued through an Auth service. Tests used session authorization for the existing restricted web role, without application login passwords or Auth tokens. No retained database, catalog or real learner record was accessed.

The test suite has its own opt-in `packages/db/vitest.drafts.config.ts`, including only `checkpoint-draft-storage.test.ts`; normal `pnpm test` does not run database operations. Start refuses an existing control record. Each test retry resets only the fixed synthetic database within that same verified cluster. Future rehearsals need a fresh bounded authorization; do not blindly reuse the retained control record or run the ordinary migration command.

## Real assertions

- Draft SQL parsed, its complete transaction rolled back without retained objects or owner schema-CREATE privilege, then applied successfully inside the disposable database.
- Actual catalog readiness, hardened function ownership/ACLs, RLS isolation, hostile deployment-default grant removal, and no direct web table access or cleanup EXECUTE privilege.
- Real repository save/read round trip for exact BOM, Unicode, NUL and CRLF bytes, plus explicit empty-source clearing.
- Two simultaneous sessions with the same request/body produced one immutable receipt; a changed body under that ID failed.
- Two different writes from the same base version produced one winner and one conflict, without overwriting the winning source.
- Per-question heads remained independent and original-request reconciliation returned the original receipt after later saves.
- Cross-user reads, unknown tasks, mismatched definitions, cross-attempt request reuse and removed membership/user access failed.
- A save blocked behind a concurrent membership removal rechecked access after the row lock and saved nothing.
- A save blocked behind finish rejected new intake after finish committed; save transaction rollback left no receipt and retry safely accepted once.
- Explicit synthetic source/receipt/byte limits, disabled policy and immutable source/used-policy settings were enforced without graded submissions.
- Synthetic past-deadline attempts rejected new intake; retained receipts remained readable only before expiry. Expired reads failed. Admin purge rejected a null batch and deleted only one already-expired row even with a future cutoff, preserving the unexpired receipt.

Final database assertions: **0 submissions, 0 Judge jobs, 0 Checkpoint outcomes, 0 password-bearing roles, 0 additional LOGIN roles**. Source bounds and retention values in the test are synthetic fixtures, not production policy choices.

## Corrections and cleanup

One cluster was started; two suite runs occurred. First run: 1 passed, 12 failed because the test bootstrap applied only foundations 0000–0007 while the current Drizzle enrollment model references the Raid outcome column from 0008. The test bootstrap was corrected to apply the existing committed 0000–0010 baseline inside the synthetic database. Second run: **13/13 passed**. The draft SQL and production source code required no correction; its original SHA-256 remains `08234e3b628de71cca7be786d6bd21a4c5d1f463b548abe9b285c068fcb5d548`.

Cleanup verified PostgreSQL stopped, the recorded postmaster PID absent, zero private socket files, and the exact temporary cluster directory removed. Test logs and cleanup evidence were preserved outside the removed cluster. The manual fixture preview remained the existing PID **527**, listening only on **127.0.0.1:3118**; no new application/Auth/Runner service started.

Evidence directory: `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\checkpoint-draft-sql`. Includes both suite logs, database assertions, cleanup report, server log and source-check logs. Raw synthetic IDs are test-only; no credentials are included.

## Remaining boundary

`0011_checkpoint_drafts.DRAFT.sql` remains outside the migration journal and production adapters in `editor-backends.ts` remain null. This rehearsal does not approve migration promotion, retained database mutation, retention values, browser offline retention, scheduled cleanup, new access or production enablement. A real persistence rollout needs a reviewed retention/read-after-finish policy, schema/journal promotion and a specifically approved target/migration principal, followed by separately authorized app integration verification.

The next independent source-only task is the visible-example Run manifest/policy/reservation contract and injected tests. No Run executor or manifest implementation was added by this SQL verification slice. Numeric Run limits and production retention remain unset proposals. The editor UI and live browser persistence are not verified by this database suite.

## Final source checks

`pnpm test`: **433/433 tests across 39 files passed**, separate from the **13/13 real PostgreSQL integration cases**. Full `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm build` passed. Python runner syntax parsed successfully. All four original dirty files remained byte-identical and unstaged. No application/runtime SQL or UI change was required in this verification commit.
