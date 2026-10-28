# Prepared SQL0011+0014 context/draft rehearsal

**No database rehearsal has been run by this source milestone.** The Python guard tests use fake commands and forbid real subprocess creation. The TypeScript SQL suite is opt-in, outside the default source-test suite, and must not be described as genuine PostgreSQL evidence until separately authorized and executed.

## Concrete proposal requiring runtime approval

- Existing PostgreSQL 16 binaries only, one fresh database `foundation_test_checkpoint_context_20261028` in `/tmp/01coding-checkpoint-context-test-<random>/data`; directory/socket permissions 0700 and current OS-user ownership. Private Unix socket identifier 55450, `listen_addresses=''`, no TCP listener or public exposure.
- Local OS-user bootstrap role only inside that new cluster, no password. Registered 0000–0010 create NOLOGIN roles `nextera_web`, `nextera_checkpoint_owner`, `nextera_result_application`, `nextera_raid_owner`; NOLOGIN `draft_untrusted` exercises hostile-default privilege boundaries. No role/grant is created in an existing cluster.
- Apply registered 0000–0010 plus draft 0011 and0014 **only there**, including transaction rollback/parsing probes. Draft0012 public Run, invitation0016/0018, scoring0017 and schedule/review contracts are excluded. Fake `auth.users` rows are SQL UUID fixtures, not Auth accounts.
- Bounded fixture ceilings: at most 40 synthetic identities and 80 cohorts. The existing finite draft cases plus four combined context cases use the legacy four-task fixture only for compatibility; this does not approve that format or a global pass threshold. Test-only policy 128 source bytes / 3 receipts / 160 stored bytes / 60 seconds retention. No production policy is chosen.
- Existing Python harness, one temporary PostgreSQL process, existing Node/Vitest tests and an independent Python expiry/parent-loss guard. Maximum 30 minutes. The guard can stop only matching owned startup/Postgres processes with the exact fresh data-directory identity. No real Auth/Storage/Runner, email, application credentials, extra web listener or retained database access.
- Finally close clients and stop the recorded cluster, verify process/socket absence, and retain its private data and evidence. Combined-mode expiry-purge assertions run in a rolled-back transaction so those synthetic records remain available for review. No permanent deletion or automatic credential renewal.

## Source entry points and guards

`scripts/test-checkpoint-context-isolated.py` exposes a side-effect-free `plan` command. `run --ack-private-synthetic-only` is prepared but still requires the separate action-time approval above; the flag itself grants no authority. It refuses an existing control record rather than repeating an uncertain run. `cleanup` recovers only the recorded private target. Do not invoke run/cleanup against an unknown or manually reconstructed target.

Control/evidence files live under `.tools/checkpoint-context-verification/` with private ownership/modes and atomic control writes. The guard rejects symlinks, changed owners, retained database names, unsafe modes, nonfinite/extended clocks, PID/data identity changes and unsafe cleanup locks. Commands use a minimal environment and ignore `.env`, pgpass, service files and ambient database/Auth settings. Cleanup retains files and never adopts a preexisting data directory. Parent/expiry cleanup is serialized; pidfd signals are scoped to verified owned processes for the exact fresh target.

`packages/db/vitest.context.config.ts` selects the existing draft-storage suite in its explicit combined mode. Socket/database/mode guards remain separate from the former standalone0011 rehearsal. The suite verifies frozen official metadata versus draft scope, privilege denial, access/deadline changes, exact source/CAS and saving without official submission. It does not test the HTTP layer, dynamic v2 exams, invitation redemption, co-resident Storage, public Run, mentor approval or learner mastery.

`scripts/tests/test_checkpoint_context_harness.py` validates guard behavior using fake commands only: read-only construction/plan, minimal environment, unsafe paths/owners/clocks/permissions, uncertain-control refusal, fake success/failure cleanup, target/PID mismatch, expiry and retained evidence. Those results cannot establish actual SQL parsing, PostgreSQL concurrency or isolation.

## Before runtime execution

Review the current source diff and exact proposal; confirm no earlier uncertain cluster/control exists, verify current installed tooling and scope, then obtain the action-time confirmation. If a permission/credential/security change is unexpectedly needed, stop that step and report it. Do not expand this rehearsal into the newly prepared invitation/scoring/schedule sources. A successful combined SQL run would justify planning the next authenticated Checkpoint rehearsal, not claiming the full Sunday learner journey is operational.
