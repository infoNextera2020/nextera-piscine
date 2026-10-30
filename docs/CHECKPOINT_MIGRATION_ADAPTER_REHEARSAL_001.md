# Checkpoint prerequisite repair and migration rehearsal: proposed scope v2

Status: source preparation only. No PostgreSQL connection, SQL execution, runtime directory, service, credential or grant application occurred during preparation. The plan reports `prepared_source_ready: true`, `runtime_ready: false`, `real_postgres_verified: false`, and requires fresh runtime approval. Earlier runtime approvals are closed. Historical receipts and failed attempts remain untouched.

## Why the DBA phase is necessary

The non-superuser actor has no inherited owner privileges. Registered 0003 revokes PUBLIC execution, transfers function ownership, then tries to grant EXECUTE. With no remaining privileges that can raise a hard error, so a repair appended after all prerequisites would be unreachable. Registered 0007/0008/0009 contain related authority boundaries. Merely adding INHERIT, SET ROLE, SUPERUSER or GRANT OPTION to the actor would conceal the problem and is excluded. [PostgreSQL GRANT rules](https://www.postgresql.org/docs/16/sql-grant.html#SQL-GRANT-NOTES)

The prepared solution preserves every registered byte and uses the originally authenticated private-cluster bootstrap DBA only for four fixed source spans. Each file remains one transaction on one physical connection. The actor executes its unchanged prefix; the named DBA executes only the pinned privileged span; the actor is restored and verified before any suffix and before commit. A source/hash/boundary mismatch fails before transaction execution. [PostgreSQL session authorization](https://www.postgresql.org/docs/16/sql-set-session-authorization.html) supports LOCAL identity changes and restoration; this is test-bootstrap authority, not an application login feature.

| Registered source              | Exact DBA span                                                 | Everything else |
| ------------------------------ | -------------------------------------------------------------- | --------------- |
| 0003_judge_protocol.sql        | Three complete EXECUTE GRANT statements, original lines363–367 | Actor           |
| 0007_checkpoint_operations.sql | Entire unchanged final DO block, original lines314–330         | Actor           |
| 0008_raid_domain.sql           | One complete EXECUTE GRANT statement, original line106         | Actor           |
| 0009_raid_operations.sql       | Two complete EXECUTE GRANT statements, original lines258–260   | Actor           |

Byte offsets and SHA256 values for every prefix/span/suffix and all 11 registered files are frozen in `scripts/checkpoint-prerequisite-manifest.mjs`. Concatenation must reproduce each original buffer exactly. The final DO in 0007 cannot be split at its internal GRANT without rewriting registered code; it executes as verified bootstrap superuser, so its conditional temporary self-membership branch is unnecessary. No owner role is granted to the actor by this handoff.

## Append-only 27-grant repair

`packages/db/migration-drafts/0019_prerequisite_execute_repair.DRAFT.sql` is unregistered and never discovered by ordinary `db:migrate`. It contains exactly27 EXECUTE GRANT statements for 25 fixed functions and existing grantees already named by the registered contracts:

- 0003: three web, six Runner and one maintenance edges.
- 0007: six web and two result-application edges.
- 0008: two Raid-owner edges on the existing submission helpers.
- 0009: six web and one result-application edges.

The complete function/owner/grantee manifest is fixed in source and tested against the original statements. The repair creates no objects or roles, changes no owner or role attributes, revokes no existing rights, grants no grant option, and grants nothing to PUBLIC or the migration actor. On a successful mixed-authority fresh replay, all 27 edges should already exist: the repair is idempotent reconciliation there, not evidence that grants were previously missing. Missing-edge recovery and failure rollback are injected-test coverage until a separately approved real test establishes them.

The named DBA runs the repair in one READ COMMITTED transaction. It checks the exact synthetic database and DBA identity, acquires NOWAIT SHARE ROW EXCLUSIVE locks on pg_authid, pg_auth_members, pg_proc and pg_namespace, and independently verifies those locks. It requires safe existing NOLOGIN permission roles, exact function owners, PUBLIC denial, and no unexpected grantee or grant option. The actor must have neither SET nor inherited/USAGE access to any of the seven owner/recipient roles; existing ADMIN-only rows may remain. This prevents object grants from indirectly expanding actor privileges through an existing membership.

After the 27 fixed grants, exact intended ACLs and effective web permissions are checked. The role/attribute/membership graph must be unchanged. Protected receipts include actual safe before/after ACL facts and graph digests, source hashes and commit acknowledgement. Any source, identity, ACL, path, graph or statement failure aborts. Commit/connection ambiguity is never a rollback claim or permission to replay. No retained attempt is inspected to infer its old catalog or rollback state.

## Exact proposed execution resources

| Item           | Proposed value                                                                             |
| -------------- | ------------------------------------------------------------------------------------------ |
| Environment    | Halawany, existing WSL Ubuntu, OS user anas                                                |
| Tools          | Existing PostgreSQL 16, Node 24 and installed Postgres.js 3.4.9; no install                |
| Fresh root     | `/home/anas/.local/share/nextera-judge/checkpoint-migration-adapter-20261029/run-001`      |
| Database       | `foundation_test_checkpoint_migration_adapter_20261029`                                    |
| Socket         | `s/.s.PGSQL.55451` below that root; directory/socket 0700; no TCP                          |
| Data/evidence  | Protected `data/`, `snapshot/`, `evidence/`; retained after shutdown                       |
| Lifetime       | At most 30 minutes; cleanup begins 3 minutes early; no renewal                             |
| Approval       | Verified human message ID/time and exact new scope hash; start within 600 seconds          |
| Authentication | Private local socket only, host access rejected; no application passwords or Auth accounts |

initdb creates only its standard bootstrap administrator identity `anas`, confined to the private OS-user-only socket. The nine synthetic NOLOGIN roles are `checkpoint_migration_actor_20261029`, `checkpoint_migration_probe_20261029`, `nextera_web`, `nextera_judge_owner`, `nextera_runner`, `nextera_judge_maintenance`, `nextera_result_application`, `nextera_checkpoint_owner`, and `nextera_raid_owner`. These are database permission fixtures, not learner accounts.

The actor owns the one synthetic database, creates the ordinary registered source objects and is CREATEROLE only during prerequisites, as previously proposed; it remains NOLOGIN/NOINHERIT/NOSUPERUSER/NOCREATEDB/NOBYPASSRLS. CREATEROLE is removed before repair. The DBA performs only disclosed setup, the four pinned authority spans, the fixed 27-grant repair, narrow catalog-guard installation and cleanup. This adds DBA execution authority to the new approval scope; it does not add actor privileges.

The minimal prerequisite is an empty synthetic auth.users table, not an Auth service. Storage must be absent and auth.uid unavailable, so 0010's conditional Storage branch is explicitly not verified. No curriculum or learner/result records are seeded. Registered 0000–0010, new repair draft 0019 and corrected draft 0011/0014 are the only SQL source inputs. Registered history and the migration journal remain unchanged.

## Draft 0011/0014 and test cases

The reviewed draft source fixes ACLs while the actor still owns its new objects, before ownership transfer. The SET-only adapter verifies the actor's existing direct ADMIN authority, adds one SET-only/INHERIT-false/ADMIN-false self-membership if needed, applies both exact draft bodies in one transaction, and restores the original graph/options before commit. The actor receives no permanent owner authority. Current corrected hashes:

- 0011: `eaf3f7e95589fddf081f73084700ee994e9d87a775187d76f0d39d8d89e5a1e6`.
- 0014: `8146ae6be34adfeacdbcaf3fb9e22b4a3516b9202eeee8cfaf3fbd88e81b78c3`.

Planned real cases remain: wrong identity, bounded probe ACL rejection/restoration on only new guard objects, failure before second draft, failure before audit, two-session catalog contention, unrelated owner-to-probe writer timeout/rollback, lock release on rollback/disconnect, then one committed draft success last. No non-idempotent draft is reapplied after that commit. Missing-ADMIN/existing-SET alternatives, web-access expansion fixtures, global-default-ACL mutation and real lost-ack wire faults remain deferred; their current tests are injected only.

Migration-test limits are explicit test settings, not learner policies: guard statement/idle ceilings 5000 ms; adapter statement 2000 ms, lock 1000 ms, idle 3000 ms; per-case outer timeout 15000 ms; checkpoint budget 20000 ms. Budgets check admission/between-query progress and do not cancel every in-flight batch. The independent lifetime/parent-loss guard is required; there is no deadline extension or automatic retry.

## Retained evidence and cleanup

Before initialization, create the private source snapshot and immutable approval/control record, verify all hashes, then require an independently identified watchdog-ready handshake. Record each registered file's start/source hash and acknowledged authority receipt; record repair start and safe before/after evidence. No raw connection strings, passwords, signed Library metadata or raw SQL errors are retained in reports.

Success or failure closes owned clients, revokes actor EXECUTE on the temporary catalog guard and drops only that verified helper function, retains the audit table/data/evidence, keeps synthetic roles NOLOGIN/NOCREATEROLE, and stops only the UID/PID/data-path-verified cluster. Verify process and socket absence; no database/schema/table/data-directory deletion. If SQL cleanup cannot complete, stop the cluster and explicitly report the unverified SQL cleanup rather than broadening authority. Source-time fake cleanup is not real PostgreSQL cleanup evidence.

Excluded: every old attempt/data directory, Docker/Supabase/Auth/Storage/Runner services, real accounts or invitations, grading/public Run, real learner awards, publication, network/security changes, credential provisioning, deployment and push. Existing fixture preview is untouched. This native SQL rehearsal does not prove authenticated browser autosave or the complete Sunday learner journey.

## Next critical path for the narrowed Week 1 trial

1. Obtain fresh approval for this exact reviewed native SQL scope and verify real results and shutdown.
2. Prepare/review one co-resident local Auth/Storage/DB/web/Runner trial setup, then request its separate exact temporary-access approval. Earlier credentials and approvals cannot be reused.
3. Freeze the preconfigured Week 1 content/evaluation contracts and private test-pack bindings. Confirm handling of the approved mixed exam answers and project evaluation; do not treat all authored curriculum as machine-ready.
4. Verify invitation activation/login as an ordinary learner; wrong then correct challenge submission, actual isolated execution, durable history/result and server progression.
5. Verify authenticated exam save/reload/conflict/recovery, access/time boundaries and official immutable submission. Recovery/Run policies and unsupported adapters must remain honest until configured and tested.
6. Verify the preconfigured three-member project team, exact automated attempt and assigned mentor decision, per-member completion receipts and prerequisites. One human tester does not justify fictional team evidence or learner self-approval; other synthetic identities need explicit provisioning scope.
7. Rehearse that complete path Saturday and report ready/not-ready from actual evidence. Sunday Nov 1 is the target trial, not a delivery guarantee. Advanced automatic assignment, exception administration and expanded admin dashboards are deferred.

The approved Sunday manual invitation decision and source-gap inventory are recorded in [SUNDAY_WEEK1_TRIAL_001.md](SUNDAY_WEEK1_TRIAL_001.md). This planning record does not enable invitations or expand this native SQL approval scope.
