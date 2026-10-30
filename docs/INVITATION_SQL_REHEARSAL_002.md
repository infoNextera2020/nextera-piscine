# Invitation SQL rehearsal — unused attempt002 proposal

Execution status: attempt002 PASSED all 14 real PostgreSQL cases and is now CLOSED.
All access cleanup and independent process/socket shutdown checks succeeded. See
verification/invitation-rehearsal-attempt002-20261030 for sanitized evidence. This
historical target and approval are not reusable. Real Auth/browser signup remains
unverified and requires separately reviewed source/settings and runtime approval.

This is source preparation only, based on the JSON fixture correction in `75307b77f44a3a0045262ffc494dd6c625652dee`. It does not renew the previous approval. The earlier target remains closed, protected and untouched; its 14 invitation SQL cases did not run. Its acknowledged prerequisite/draft commits do not substitute for the cases proposed here.

## Exact fresh binding

- Root: `/home/anas/.local/share/nextera-judge/invitation-sql-20261030-attempt002/run-001`. Its new parent must also be absent; neither has been created.
- Database: `foundation_test_invitation_sql_20261030_attempt002`.
- Native installed PostgreSQL 16; private Unix socket `<root>/s`, identifier 55461, permissions 0700, no TCP.
- Local bootstrap DBA `anas`, confined to this new cluster. Fourteen NOLOGIN test roles, with unchanged internal names: `invitation_migration_actor_20261030`, `invitation_probe_20261030`, `invitation_issuer_client_20261030`, `invitation_activation_client_20261030`, `nextera_web`, `nextera_judge_owner`, `nextera_runner`, `nextera_judge_maintenance`, `nextera_result_application`, `nextera_checkpoint_owner`, `nextera_raid_owner`, `nextera_invitation_owner`, `nextera_invitation_issuer`, `nextera_invitation_runtime`. They are created only inside a future approved fresh cluster; no retained role or database is reused.
- Scope version 2. Source hashes and the exact final scope SHA256 are in `verification/invitation-rehearsal-attempt002-source-20261030/proposed-plan.json`.

## Unchanged operations and limits

Registered 0000–0010 run with the existing four exact reviewed DBA spans, followed by 0013 ->0020 ->0016 ->0018. No 0011/0012/0014/0019 or other draft is added. The actor's CREATEROLE is confined to prerequisites and revoked afterward; temporary SET-only invitation-owner membership is removed before tests. Test issuer and activation memberships use ADMIN FALSE, INHERIT TRUE and SET FALSE, and are revoked on cleanup. The local bootstrap is not exposed to web or browser callers.

The same 14 ordered SQL cases in [the detailed scope](INVITATION_SQL_REHEARSAL_001.md) cover issuance authorization, exact email/cohort/version binding, atomic acceptance and rollback, replay/single consumption, expiry/revocation, same/distinct invitation concurrency, fence/retry handling, private ACLs and no role/mastery escalation. Fixture policies remain synthetic-only: 120000ms maximum invitation lifetime, 60000ms normal fixtures, 5000ms expiry fixture, 10000ms claim leases. SQL bounds remain 10000ms statement/2000ms lock/15000ms idle and20000ms per case. No production policy is chosen.

Maximum runtime 1800 seconds, independent cleanup 180 seconds early. Launch requires a newly verified authentic owner message/time bound to this exact source/scope within 600 seconds; receipt time cannot replace owner approval time. Guard readiness precedes initialization. Parent loss, boot change and wall/monotonic deadlines trigger owned shutdown. No new approval receipt exists.

Cleanup disables fixture policies and test access, revokes invitation test memberships, verifies restricted NOLOGIN flags, closes clients and independently stops the owned process/socket/PID/watchdog. SQL acknowledgement and process shutdown remain separate evidence. Protected data/evidence are retained 0700/0600; no permanent deletion or existing-target adoption occurs.

There is no real Auth provider, login session, password/key, raw invitation capability, email delivery, browser service, Runner, curriculum import or published learner content in this scope. The SQL Auth table is a synthetic stub only. Other work on the laptop remains untouched.

## Serialization proof and remaining uncertainty

The actual builders now produce object-backed `admin.json` parameters. A no-connection regression uses the installed postgres 3.4.9 Parameter/handleValue/OID3802 serializer against all six payload templates: root/dependent nodes for both synthetic versions, plus valid and invalid ownership metadata. It checks exact object round-trips and demonstrates that the previous pre-stringified values become JSON strings. It constructs no PostgreSQL client and executes no SQL.

This verifies serialization, not the 14 SQL cases or real Auth enrollment. Another SQL failure remains possible. Once source review and read-only preflight pass, execution still needs fresh exact owner approval; the old target and old approval must not be used. Real Auth/browser integration remains a later separately scoped gate.
