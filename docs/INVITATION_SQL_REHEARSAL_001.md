# Invitation SQL rehearsal — prepared, not executed

This is the smallest SQL-only integration check for the manual invitation source in7ccd7b7. It is not an authenticated browser registration test. It reuses the native PostgreSQL lifecycle pattern, with a fresh target and independent source/scope binding. Previous rehearsal approvals are closed and are not accepted as authority for this target.

## Exact proposed resources and authority

- Native PostgreSQL16, using the already installed binaries; no Docker stack or installation.
- New root `/home/anas/.local/share/nextera-judge/invitation-sql-20261030/run-001`; its project parent must not already exist. No old target is adopted, restarted, read or changed.
- Database `foundation_test_invitation_sql_20261030`.
- Private Unix socket `<new root>/s`, identifier55461, socket permissions0700, `listen_addresses=''`. No TCP listener or browser endpoint.
- Local initdb bootstrap DBA `anas`, inside this new cluster only. No password, key, Auth token or real account is created. OS-user-protected local trust is limited by the private0700 root/socket.
- Fourteen restricted NOLOGIN roles: migration actor `invitation_migration_actor_20261030`; unauthorized probe `invitation_probe_20261030`; issuer test principal `invitation_issuer_client_20261030`; activation test principal `invitation_activation_client_20261030`; and permission roles `nextera_web`, `nextera_judge_owner`, `nextera_runner`, `nextera_judge_maintenance`, `nextera_result_application`, `nextera_checkpoint_owner`, `nextera_raid_owner`, `nextera_invitation_owner`, `nextera_invitation_issuer`, `nextera_invitation_runtime`.
- The migration actor creates the seven registered permission roles through unchanged registered SQL, using temporary CREATEROLE only for those prerequisites. It is revoked afterward. The bootstrap does not precreate those seven roles and accidentally deprive the actor of their required ADMIN-only ownership operations.
- Registered0000–0010 use the same reviewed four fixed DBA source spans (0003/0007/0008/0009) and otherwise run as the restricted migration actor. Source bytes and span hashes are checked before each transaction, and actor identity is verified on every transaction and before commit.
- Draft installation order is0013 ->0020 ->0016 ->0018, each in one acknowledged transaction. The actor temporarily gets SET-only invitation-owner membership, with INHERIT FALSE and ADMIN FALSE, then loses it before tests. Temporary owner schema CREATE is removed within each draft. No0011/0012/0014/0019 or other draft is applied.
- The issuer test principal inherits only the issuer capability, the activation principal only the activation capability, with ADMIN FALSE and SET FALSE. No generic web/browser/real learner grants are created. The native SQL calls use transaction-local session authorization, rechecked on every physical connection, not persistent pool SET state.

## Synthetic fixtures and test-only settings

The `auth.users` table is a local SQL compatibility stub with only the reviewed columns needed by the invitation queries. It is not Supabase Auth/GoTrue, and its synthetic rows are not real accounts. No provider request or password is involved. Two fake staff identities, two private test cohorts, two published SQL-only metadata versions, synthetic invitation/enrollment rows and two prerequisite-linked nodes are confined to this database. Test artifact/image digests and `fixture.invalid` pack references are explicitly synthetic and never executed or presented as a ready curriculum.

No raw capability is generated. The harness uses deterministic nonsecret SHA256-shaped fixture digests, fixed fake UUIDs and `example.test` emails. Persisted invitation data contains a digest, not a raw token, link or password. The sole enabled issuer/cohort policy is fixture-only, bound to the exact test principal and published version. Its maximum lifetime is120000ms; ordinary cases request60000ms and the expiry case requests5000ms then waits5.1 seconds. The admission fixture requires confirmed email in the SQL stub. These are test controls, not selected production invitation or verification policy. Claim leases are10000ms. Per-call test bounds are10000ms for statements,2000ms for locks and15000ms idle-in-transaction; each case has a20000ms outer bound. These are bounded rehearsal controls, not product policies. HTTP rate profiles are not configured or exercised here.

## Planned real SQL assertions

Fourteen ordered cases cover:

1. Private table/function ACLs, PUBLIC denial, wrong issuer/activation/probe capabilities.
2. Configured active admin, exact owner/session/cohort policy and version pinning.
3. Same-request replay without rotation, one persisted digest and no raw-token/password columns.
4. Concurrent issuance with a single durable acceptance.
5. A unique acceptance failure rolling back the preceding ledger insert.
6. Invalid digest, expiry and revocation blocking claims.
7. Concurrent claims, stable request identity, increasing fences and stale-worker rejection.
8. Wrong email/cohort and invalid private Auth ownership proof blocking enrollment.
9. Fenced enrollment recovery, immutable receipt and exact root/dependent progress; completion replay cannot consume again.
10. Concurrent same-invitation enrollment recording one domain user and one receipt.
11. Concurrent distinct invitations into the same cohort without a SHARE-to-UPDATE lock-upgrade deadlock.
12. Locked admission authority preventing concurrent owner deactivation; subsequent deactivation blocks the claim.
13. Explicit outer rollback of issuance/enrollment with observer checks, followed by safe retry.
14. No submissions, jobs, mastery or role escalation created by enrollment.

The0020 admission hook now takes the cohort UPDATE lock from its first read. This matches the existing enrollment lock order and avoids two different invitations each holding SHARE and attempting an UPDATE upgrade. Actor permissions and product eligibility rules do not change. Static and fake tests do not establish this real concurrency result until the approved rehearsal runs.

## Guard, cleanup and retained evidence

Maximum runtime is1800 seconds from immutable control creation. The independent watchdog starts cleanup180 seconds before the deadline and also checks monotonic time, parent process identity and boot identity. It must acknowledge readiness before initdb. Authentic owner message ID/time and exact scope hash are required within the existing600-second launch window, rechecked after preflight and before initialization; receipt creation never refreshes approval time. No approval receipt has been created in this source milestone.

Cleanup disables fixture issuer/admission policies, revokes test issuer/activation/temporary owner memberships, verifies all test roles remain NOLOGIN and without elevated flags, closes clients and stops only the owned cluster. SQL cleanup acknowledgement is distinct from independent process/PID/socket shutdown proof. Failure or missing SQL acknowledgement never suppresses the cluster stop. A partial or unacknowledged migration commit is reported as unknown and is not automatically replayed.

Protected control/snapshots/data/evidence remain0700/0600 under the new root; no permanent deletion occurs. Public source evidence will contain scope/hash/case status and cleanup booleans only. Raw PostgreSQL logs and database data remain private and are not copied into the repository or chat. A completed or occupied target cannot be reused. No other services, files or existing data are stopped or changed.

## Source entry points and approval boundary

- `scripts/test-invitation-isolated.py plan` only reads and hashes source; it creates no target, receipt, role, connection or process.
- `scripts/test-invitation-isolated.py run --approval-json ...` is executable source for a future exact approval, not authorization to run it now. The outer caller must verify the genuine user message and pass its authentic immutable timestamp. No fabricated timestamp or old receipt is acceptable.
- `scripts/tests/test_invitation_isolated.py` injects fake commands and temporary fixture directories only.
- `scripts/tests/invitation-rehearsal.node-unit.mjs` tests source/control/session/chunk/case behavior without PostgreSQL.

The committed source plan and scope SHA256 are recorded in `verification/invitation-rehearsal-source-20261030/proposed-plan.json`. Current status is prepared source, real SQL unrun, fresh execution approval required. A harmless source-plan/preflight recheck must precede the approval request; any source/scope change requires a new bound proposal. Do not run the completed checkpoint rehearsal again.

## Minimum remaining Auth integration gates

After native SQL validation, use one fresh co-resident Auth/product environment, not a new architecture: configure the restricted issuer/activation clients and exact owner/cohort/version policy; provide the existing supported password and provider-compatible email policy, explicit lifetime/verification/rate settings and approved origins; and verify one ordinary learner through manual link -> signup -> deterministic Auth creation -> exact cohort enrollment -> login. Browser fragment extraction/removal, inspection/activation wiring and interruption/recovery still need source integration and real verification. A lost issuance response must remain explicit; no automatic reissue or account adoption is authorized by this rehearsal.

Real Auth accounts, credentials, actual invitation capability creation, service ports/lifetime, session revocation and retained shutdown require a separate exact runtime proposal and approval. This SQL-only scope does not authorize them. Automated email delivery, full invitation management, global student-number allocation and new UI layouts remain separate; student-number learner visibility stays account-settings-only, with authorized staff display beside the name.
