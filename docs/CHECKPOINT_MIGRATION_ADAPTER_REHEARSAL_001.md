# Checkpoint migration adapter: source and proposed isolated verification

Status: implemented source and injected tests only. This document is a proposal, not execution approval. No connection, grant, SQL application, new runtime directory, service, credential or attempt was created for this work. The adapter is not imported by the live broker.

## Implemented boundary

`scripts/checkpoint-migration-postgres.mjs` accepts an already configured Postgres.js client (`prepare: false`), explicit scope/database/actor/draft hashes, reviewed guard parameters, required time limits and injected wall/monotonic clocks. Construction is pure. It does not read environment files, instantiate a client, authenticate owner approval or install its guard.

One `client.begin('isolation level read committed', ...)` callback supplies every query. The adapter attests the fixed guard's body hash, schema/function owner, SECURITY DEFINER mode, signature, language, search path and ACLs; rejects web effective privileges and SET reachability; invokes the guard; independently proves both shared-catalog locks on this backend/transaction; then re-attests permissions under those locks. Missing proof fails before migration DDL.

The existing contract verifies direct existing ADMIN authority before adding exactly one owner-to-same-actor membership, with ADMIN false, INHERIT false, SET true and that actor as grantor. Existing SET authority uses no grant. After the two exact draft bodies, only the introduced grant is revoked, with qualified grantor and RESTRICT. All original membership rows/options, actor identity and SET availability must match before commit. Web/learner memberships are never a target.

Audit writes use parameters and the server transaction/session identity. Diagnostics expose only a closed stage name and validated SQLSTATE. A rejected query or lost commit acknowledgement never becomes a verified rollback claim or automatic replay permission. A commit acknowledged after the local budget is classified as uncertain, even if it may have committed.

## Why the proposed catalog guard needs separate authority

An ordinary migration actor's ADMIN or CREATEROLE permission does not authorize a strong lock on shared role catalogs. Advisory locks cannot serialize unrelated GRANTs. Giving the actor direct UPDATE on catalog tables or SUPERUSER would be excessive.

The pure `buildMigrationCatalogGuard` builder instead returns setup SQL for a fresh, fixed, zero-argument SECURITY DEFINER function owned by an already trusted cluster administrator. Its entire operation is scope validation plus `SHARE ROW EXCLUSIVE ... NOWAIT` locks on `pg_catalog.pg_authid` and `pg_catalog.pg_auth_members`, returning this backend PID and transaction ID. It contains no role mutation, arbitrary arguments or dynamic SQL. It checks the exact test database, session actor, owner, server major, READ COMMITTED and positive bounded server timeouts.

This is still a real capability to block role changes across its cluster. It is not covered by old rehearsal approvals and must be explicitly approved for a new isolated test. The adapter verifies actual catalog locks; a provider administrator name alone is not proof of permission. This proposal makes no claim that a retained Supabase instance can or should install it.

Setup uses one transaction and fresh object names, failing if they already exist. It removes PUBLIC rights and unexpected default-ACL grantees from only the new private schema, audit table and guard function, then grants the actor exactly schema USAGE, table INSERT and function EXECUTE. Global default privileges remain unchanged. Before setup commits it rejects effective web access or web SET reachability to actor/owner. The adapter rechecks these conditions. No web grant is added for a negative test.

## Time limits: explicit limitation

`checkpointBudgetMs` and `deadlineMs` bound admission and checks between queries, including before returning the transaction callback. They do not cancel an active SQL batch or the driver's initial connection/begin wait. PostgreSQL 16 applies `statement_timeout` separately to statements in a multi-statement simple query, so a draft batch can remain active beyond that checkpoint budget. Statement/lock/idle timeouts are supplemental, not a hard total transaction bound. [PostgreSQL timeout rules](https://www.postgresql.org/docs/16/runtime-config-client.html)

No live enablement should occur without a separately supervised outer deadline and verified cleanup. The disposable proposal below requires an independent process guard that stops only its identified cluster at the deadline or parent loss. This source milestone has not implemented or executed that new test controller.

## Exact smallest proposed real PostgreSQL test

Fresh target, subject to availability checks after approval:

| Item                         | Proposed value                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Host / OS user               | Existing Halawany WSL Ubuntu / `anas`                                                     |
| Existing tools               | PostgreSQL 16 binaries, existing Node 24 and installed Postgres.js 3.4.9; no install      |
| New private root             | `/home/anas/.local/share/nextera-judge/checkpoint-migration-adapter-20261029/run-001`     |
| Data / evidence              | `data/` and `evidence/` under that root, protected and retained                           |
| Private socket               | `s/` under that root, OS-user-only directory and socket permissions 0700                  |
| Database                     | `foundation_test_checkpoint_migration_adapter_20261029`                                   |
| Socket identifier            | `55451`, Unix socket filename only; `listen_addresses=''`, no TCP                         |
| Maximum lifetime             | 30 minutes from actual initialization start; cleanup begins at minute 27, no renewal      |
| Independent guard            | Armed before initdb; PID/data-path/UID identity checks, deadline and parent-loss shutdown |
| Application passwords / Auth | None; private local socket, host authentication rejected, no real accounts or tokens      |

Authority requested for this test only:

1. Initialize a new private local PostgreSQL cluster whose bootstrap administrator is the current OS user; do not reuse or connect to a retained database. Local trust authentication is confined by the private socket directory; no host access or application password is provisioned.
2. Create two synthetic NOLOGIN roles: `checkpoint_migration_actor_20261029` and `checkpoint_migration_probe_20261029`. Make only the actor owner of the one synthetic database and temporarily CREATEROLE during prerequisites. Do not grant it SUPERUSER, BYPASSRLS or CREATEDB. Remove CREATEROLE before running the adapter.
3. Apply registered SQL0000–0010 in that new database as the non-superuser actor, so its existing creator ADMIN grant reflects the relevant PostgreSQL 16 behavior. These prerequisites create seven existing permission roles: `nextera_web`, `nextera_judge_owner`, `nextera_runner`, `nextera_judge_maintenance`, `nextera_result_application`, `nextera_checkpoint_owner`, `nextera_raid_owner`; all remain NOLOGIN. This is nine NOLOGIN test roles total, not nine user accounts. Supply only a minimal synthetic `auth.users` prerequisite table; no Auth or Storage service. Storage-policy guarded branches remain untested without Storage.
4. As the existing private-cluster bootstrap administrator, install only the reviewed guard/schema/audit objects. Give the migration actor USAGE/INSERT/EXECUTE on those new objects. Test connections establish the NOLOGIN actor identity through bootstrap-owned `SET SESSION AUTHORIZATION` in test setup, before the adapter begins; inside the adapter current/session actor must match and never switch.
5. Allow the actor, only after verifying its preexisting direct ADMIN row, to grant itself the single temporary SET-only owner membership within the adapter transaction. Allow the unchanged internal bodies of draft0011 then draft0014 only there, followed by exact membership restoration and commit acknowledgement. No journal promotion or extra draft execution.
6. Permit a second private test session to contend on the same catalogs and attempt an owner-to-probe membership with a short timeout. It must block while the adapter holds the locks, then roll back; never grant to web, learners or a real identity. This verifies protection from an unrelated role writer rather than only a cooperating advisory-lock caller.
7. For ACL rejection cases only, allow the bootstrap administrator to add and then revoke its own new USAGE/EXECUTE/INSERT grants to the synthetic probe on the three newly created guard/audit objects. Snapshot and restore their exact ACLs before the next case. Do not exercise that access, change global default privileges, change the actor's original role membership, or grant anything to web.

Required local test settings, proposed only: guard statement/idle ceilings 5000 ms; adapter statement 2000 ms, lock 1000 ms, idle 3000 ms; admission/checkpoint budget 20000 ms and a fresh per-case absolute deadline. Individual cases also have an outer supervised timeout. These are migration-test limits, not learner Run, exam, quota or retention policies. No curriculum, learner result, draft source or progression award is needed for this adapter test.

## Assertions and retained evidence

- Validate fresh target/data directory/socket identity and no TCP listener before any SQL. Record immutable owner approval identity/time/scope in a controller that rejects expired, reused or closed approval; no timestamp refresh. The new harness must be prepared, fake-tested and reviewed before asking for runtime approval.
- On real PostgreSQL, verify the existing ADMIN row and absent SET right, the exact temporary grant delta/grantor/options, both draft schemas, unchanged guards/source hashes, audit order, original role graph after commit, and no effective web access to guard/audit.
- Order cases explicitly: permission negatives, contention and forced-rollback cases first; one acknowledged committed migration success last. Never reapply unchanged non-idempotent draft bodies after that commit in the retained database. No reset, schema drop, extra database or role-fixture change is implicitly authorized.
- On the real database, use only the explicitly proposed probe ACL mutations above to test rejection and exact ACL restoration, plus wrong-identity rejection before DDL. Web reachability, default-ACL cleanup simulation, existing-SET and missing-ADMIN alternatives remain source/fake-tested in this smallest scope; live variants need a separate precise fixture plan and authority. Do not alter the actor's original ADMIN/SET row or add web reachability just to manufacture a negative case.
- Inject a test-client failure before second DDL or before audit without modifying either locked SQL file; use the independent bootstrap session to verify DDL, audit and temporary grant rollback before the final success. Missing commit acknowledgement is already injected-test-covered; an actual lost-ack wire fault is deferred, not simulated as a verified network failure. Any unexpected commit ambiguity requires read-only reconciliation and no automatic replay.
- Use two real sessions for NOWAIT contention, unrelated role-writer timeout, and release after commit, rollback and client disconnect. Fake tests alone do not prove these PostgreSQL semantics.
- Record controlled SQLSTATE, stage, source hashes, timings and assertion results. No passwords, raw connection strings, source dumps or signed Library transfer metadata in reports.

## Cleanup and explicit exclusions

After tests or any failure, the test controller closes owned clients, revokes the actor's EXECUTE capability and drops only the verified temporary guard function, keeps all synthetic roles NOLOGIN/NOCREATEROLE, then stops only the identity-verified cluster. Dropping that guard is explicitly part of the proposed future cleanup; no database/schema/audit table/data directory is deleted. If safe guard removal cannot complete, stop the cluster and report the retained function rather than expanding permissions. Verify no matching process/socket/TCP listener remains; retain data, audit table, protected logs and receipts under the private root. The independent guard must also stop the cluster on parent loss or expiry.

Excluded: attempt001/002/003 data or services, SQL replay against their uncertain state, Supabase/Docker/Auth/Storage/Runner, public Run, official grading, invitations, Raid, user accounts, new persistent login access, global ACL changes, hidden-test access, publication, deployment and push. The existing localhost3118 fixture stays unchanged. Earlier approvals do not authorize this new target or guard capability.

## Verification labels

Current evidence is static review and injected Postgres.js-client tests. Existing private-socket draft tests and stopped authenticated attempt003 are separate historical evidence. No actual SQL syntax, catalog-lock, default-ACL, transactional grant, driver wire protocol or timeout behavior is newly proven by this source-only milestone. Original draft0011/0014 hashes remain the pinned values; real verification requires the specifically approved isolated test above after its controller is ready.
