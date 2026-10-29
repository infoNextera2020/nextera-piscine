# Attempt003 SQL0011 diagnosis and source correction

Status: real rehearsal failed; cleanup independently verified. The migration-principal mismatch is confirmed in source. The actual server exception was discarded, so its SQLSTATE, failed predicate and retained catalog/rollback state are not attested.

## Observed runtime

Attempt003 used reviewed HEAD 5ffcd2012a17cb4c64de910a998233f918113438 and version2 scope 2ea73394604160d80746e9c50d499b25c361ec6c430195899dfb5e18b263dfd6. Start was 14:33:54.526700 UTC; original deadline 15:33:54.526700 UTC. Services started; the journal marks SQL0000–0010 applied, SQL0011 started and SQL0014 not reached. Learner issuance and authenticated HTTP/browser assertions did not run.

Cleanup completed at 14:34:56.221742 UTC. Independent metadata verification at 14:37:20.478440 UTC found all 8 project containers exited, ports 56531/56532/3151 closed, guard exited, access disabled and no cleanup errors. Protected data, volumes, keys and evidence remain retained. No restart, replay, datafile read, permission change or old-attempt access occurred. The completed approval is now pinned closed in source.

## Why the earlier test did not cover this principal

- SQL0011 and SQL0014 initial guards require an existing isolated safe nextera_checkpoint_owner, nextera_web, and pg_has_role(current_user,'nextera_checkpoint_owner','SET').
- Registered SQL0007 temporarily grants that owner membership when required for ownership transfer, then revokes its own grantor membership when marked temporary; it does not snapshot arbitrary preexisting options. It does not promise later migrations permanent owner access.
- The co-resident broker connects as supabase_admin and directly executes the drafts without supplying or checking that owner context.
- The earlier 17-case private-socket suite creates PostgreSQL 16 with the OS user as its initdb administrator and uses that principal for migrations. Its administrator context did not validate the co-resident provider principal.

This is a concrete source precondition mismatch and a strong explanation for the first draft failing. It is not proof of the actual exception. The old broker retained only a coarse phase-failed message. Filtered stopped-container stdout/stderr contained startup errors only; metadata inspection found no additional PostgreSQL diagnostic log paths in the writable layer. No database reconnection, raw database-file inspection or SQL replay was used to infer missing facts.

## Transaction and partial-state limits

The retained journal records SQL0011 started without applied. Its reviewed bytes contain explicit BEGIN/COMMIT; that alone does not establish the final catalog state or verify rollback after a failed connection. Do not reuse this target or rerun the draft based on that expectation. The original marker and all receipts remain unchanged.

## Source-only correction

The broker now verifies the exact locked hash before any draft query, then uses a read-only catalog attestation mirroring the owner/web/SET preconditions before marking a draft started or sending DDL. Missing authority fails closed with a controlled reason. It never grants membership, changes the principal, selects a superuser, strips a guard or changes SQL bytes.

On future runs, sql-failure.json records only controlled file/hash/stage/reason, a validated PostgreSQL SQLSTATE and explicit application uncertainty. Raw message, SQL, detail, hint, stack, DSN and credentials are excluded. Its thrown cause is the same sanitized metadata. Failure after SQL was sent, including an applied-journal failure, cannot become a rollback or catalog-state claim. Registered SQL0000–0010 execution retains its exact-byte path.

This improves admission and attribution; it does not enable the missing migration authority or repair the stopped database. New tests use fake clients only.

## Remaining prerequisite before another runtime proposal

Decide and separately authorize the migration context. A narrowly reviewed option is temporary SET-capable membership in the existing NOLOGIN checkpoint-owner role for only the migration transaction, preserving existing memberships and restoring the original graph before commit. It must not become a persistent grant or learner/web membership. That option is not implemented, configured or authorized by this record. It needs source review, transaction/failure tests and an updated exact runtime scope before execution.

Occupied attempt003 and its copied source remain closed and untouched. No new attempt profile, root or credentials are prepared here. Browser evidence remains unrun. The next decision concerns this precise context, rather than another unchanged startup attempt.
