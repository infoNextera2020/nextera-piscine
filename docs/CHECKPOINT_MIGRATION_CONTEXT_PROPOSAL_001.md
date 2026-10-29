# Checkpoint migration context: source contract and bounded proposal

Status: source-only injectable contract with fake tests. No database adapter, broker import, runtime enablement, grant, credential, migration application or new attempt is included.

## Existing authority and why it differs from SET access

SQL0007 creates an isolated NOLOGIN checkpoint owner when absent. For ownership transfer, it temporarily supplies SET-capable membership to the migration actor when required, then revokes membership attributed to its own grantor when that temporary flag was set. It does not snapshot arbitrary preexisting options; the new contract adds exact preservation checks. This intentionally leaves later migrations without that temporary access; SQL0011/0014 still require it.

PostgreSQL 16 distinguishes administering a role from using its privileges. A non-superuser creator normally receives a bootstrap grant with ADMIN enabled and SET/INHERIT disabled. That can explain how the existing migration actor can administer the owner yet fail the draft's SET check. This is a source-consistent explanation, not recovered evidence of the attempt003 exception or current catalog. See [PostgreSQL role attributes](https://www.postgresql.org/docs/16/role-attributes.html).

The future adapter must verify the actual existing ADMIN membership. CREATEROLE alone is insufficient; the proposal adds no ADMIN, SUPERUSER, CREATEROLE or BYPASSRLS privilege. Existing SET access uses the no-grant path. A missing ADMIN proof, unsafe owner or ambiguous same-grantor membership fails closed. [PostgreSQL role grant rules](https://www.postgresql.org/docs/16/sql-grant.html) distinguish ADMIN, SET and INHERIT and require an authorized grantor.

## Prepared source contract

The module is scripts/checkpoint-migration-context.mjs. It has no driver, CLI, credential access, filesystem access or process launch. It is not imported by the broker. Callers must supply an explicit policy bound to an outer controller's approved scope digest, exact synthetic database, migration actor, mode and both exact draft hashes. The module does not authenticate owner approval itself.

The default is no policy and therefore no operation. The explicit existing_only mode requires already available SET authority. The separately proposed temporary_self_membership mode requires a direct, existing ADMIN membership for this actor and the existing safe owner. The actor cannot be nextera_web or the owner itself; session and current user must remain the expected actor.

The repository contract requires one dedicated connection and one transaction spanning both drafts, serialization of the complete relevant role graph, and commit acknowledgement. Server facts include exact database/principal/OIDs, numeric transaction ID, complete memberships, supported membership options, safe owner attributes and no web SET/inherited owner reachability. Membership rows preserve role, member, grantor, ADMIN, INHERIT and SET options. [The catalog records these separately](https://www.postgresql.org/docs/16/catalog-pg-auth-members.html).

The sequence is:

1. Verify both source hashes, UTF-8 bytes, fixed draft order and strict outer transaction envelopes before entering the transaction. Remove only the reviewed outer BEGIN/COMMIT boundaries so both unchanged internal bodies and their guards run inside one adapter transaction. No SET ROLE or session-identity switch is allowed.
2. Lock/attest the complete graph and record original authority and actor identity. An advisory lock covering only cooperating clients is insufficient to prove protection from unrelated GRANTs; the concrete adapter must establish exclusive migration ownership or stronger verified serialization.
3. If separately approved and required, add one fresh membership from the existing owner to this same migration actor: SET true, INHERIT false, ADMIN false, with this actor as grantor. Reject an existing row for that grantor instead of overwriting it. Verify the only graph delta is that exact new row.
4. Execute SQL0011 then SQL0014 on the same transaction connection, preserving the guards. Record file/hash, start and application audit events inside that transaction.
5. Revoke only the introduced row, qualified by role/member/grantor, without CASCADE. Verify identity, owner isolation, web exclusion and exact original graph/options before commit. Preexisting bootstrap ADMIN and all other memberships remain unchanged.
6. Return success only after the adapter acknowledges commit. Any grant, draft, audit or restoration failure aborts. Connection/commit uncertainty never becomes a rollback claim or permission to retry.

The contract records controlled, immutable audit events and excludes raw errors/SQL/credentials from failure traces. Fake rollback assertions prove only the fake repository's behavior. There is no claim that PostgreSQL transactional grant/DDL execution has been verified here.

## Exact additional authority for future review

For a separately named fresh isolated rehearsal, allow only its existing migration actor, after verified preexisting ADMIN authority, to acquire the single temporary SET-capable self-membership above during the transaction containing SQL0011/0014. Require its removal and exact graph restoration before commit. Never grant that membership to the web role, learners, mentors or another principal. No new privileged role or lasting escalation is included. If verified existing authority is absent, stop rather than expanding privileges.

This is a proposal, not a runtime grant. Before asking for execution approval, implement/review the concrete least-privilege adapter, verify its transaction/serialization and grantor-option behavior under a separately authorized disposable database test, and bind the policy and source hashes into a fresh runtime scope. Reuse neither attempt003 nor its closed approval. No target, resource, account, key or new profile is prepared by this record.

## Verification and remaining limits

Injected tests exercise the existing-authority path, exact temporary delta and restoration, ambiguous memberships, missing ADMIN, role impersonation, web reachability, incomplete graphs, source/envelope changes, failures at every mutation/audit stage, changed transaction identity, commit uncertainty and diagnostic redaction. Actual SQL0011/0014 source bodies are inspected through the fake adapter to verify envelope handling preserves their guards and internal text; the files themselves remain unchanged.

The attempt003 failure remains as recorded: SQL0011 started without an applied marker; actual SQLSTATE, failed predicate and rollback/catalog state are unverified. This proposal does not replace that uncertainty with an inferred success or recovered exception.
