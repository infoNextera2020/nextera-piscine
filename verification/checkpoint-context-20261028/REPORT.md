# Checkpoint context/draft PostgreSQL rehearsal — 28 October 2026

**Passed: 17/17 tests against real PostgreSQL 16.15. Cleanup independently verified.**

Source HEAD: `06b640f813ca9275c8c027df4afe6e00c0f54859`. Started at 13:36:18 UTC, deadline 14:06:18 UTC; PostgreSQL completed shutdown at 13:36:35 UTC, well before expiry. PostgreSQL logs use EEST (UTC+3); this report normalizes times to UTC.

## Exact execution

The separately approved command was `python3 scripts/test-checkpoint-context-isolated.py run --ack-private-synthetic-only`, under existing Ubuntu user `anas`. It used fresh database `foundation_test_checkpoint_context_20261028` in `/tmp/01coding-checkpoint-context-test-cuwj29vf/data`, socket identifier 55450 and empty `listen_addresses`; no TCP listener. An independent expiry/parent-loss watchdog was armed before PostgreSQL creation.

Registered SQL 0000–0010 were prerequisite migrations. Draft SQL 0011 and 0014 were parsed/rolled back and then applied only in this fresh database. The synthetic curriculum was published only inside that database to exercise normal eligibility guards. Synthetic SQL identity rows are not Auth accounts. The test-only retention/capacity values are not approved production policy or exam thresholds.

## Actual assertions

- Frozen official context and definition binding; cross-user, unknown task and cross-attempt denial.
- Function ownership, scoped privileges and hostile default-grant cleanup.
- Exact BOM/Unicode/NUL/CRLF/empty source round trips through the real repository.
- Two-session idempotency, compare-and-swap conflicts, access-removal races and finish/deadline ordering.
- Transaction rollback, task independence, configured capacity and retention boundaries, immutable revisions and used policies.
- Context reads versus write refusal after deadline, with no fallback after access removal.
- Saving produced **zero submissions, jobs and outcomes**; zero passwords and zero additional LOGIN roles beyond the local bootstrap role.

The receipt lists 20 detailed evidence markers across 17 tests. PostgreSQL error lines for forbidden/conflicting/expired writes are expected negative-test assertions, not failed tests.

## Cleanup and retained evidence

The harness returned `real_postgres: true`, `tests_passed: true` and `postgres_stopped: true`. Independent inspection found zero processes using the exact data path, no `postmaster.pid`, no socket files and no surviving watchdog. Retained data/socket/evidence directories remain owned by uid 1000 with mode 0700; control is 0600. No permanent deletion occurred. Expiry-purge assertions were rolled back so synthetic records remain reviewable.

Private original logs and control: `.tools/checkpoint-context-verification/`. The fresh stopped cluster data remains under the exact `/tmp` path above. This report and `receipt.json` contain no application credentials. The receipt includes source/evidence hashes and confirms the four original dirty-file hashes are unchanged.

## Verification limits

This verifies the combined legacy-compatible SQL context/draft path. It does not verify authenticated HTTP/browser integration, Supabase Storage, invitations, public Run, Runner execution, dynamic v2 exam scoring, mentor review, XP, real learner progression or the full Sunday journey. SQL 0012 and later invitation/scoring/review drafts were not applied. No live feature was enabled. The previously denied localhost browser action was not retried.
