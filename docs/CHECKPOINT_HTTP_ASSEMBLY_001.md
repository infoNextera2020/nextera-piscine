# Checkpoint authenticated HTTP source assembly 001

## Implemented scope

The editor GET and draft GET/POST routes now use one lazy `createCheckpointEditorApi` factory. Constructing it performs no Auth request, database acquisition or SQL query. Production still uses the existing verified-session `requireDomainUser`, existing `getDatabase` and exact `CHECKPOINT_DRAFT_STORAGE=postgres-v1` opt-in. No environment or credentials were changed.

A concrete bootstrap bug was fixed: a legitimate draft policy may have a smaller source ceiling than official submission intake. Previously equality was required, making a stricter autosave policy return 503. The shared editor now uses the smaller server-provided draft ceiling; a draft ceiling larger than official intake, changed filename/definition/scope/deadline/status, missing SQL readiness or missing policy still fails closed. Official Submit continues to enforce its own server rules and atomic intake checks.

The new source-level integration suite connects the actual lazy adapters, repository validation, HTTP handlers, client bootstrap decoder and save transport/controller using injected Auth, SQL replies and in-process fetch. It performs **no socket connection, database execution, browser navigation or service startup**. Its fake SQL replies are not evidence of real provider/database behavior.

## Covered regressions

- Lazy construction and authentication/role rejection before database acquisition.
- Bootstrap with stricter draft limits, exact BOM/UTF-8/NUL/CRLF save intent and reload through the client decoder.
- Explicit conflict resolution without overwriting local text, and idempotent retry of the original uncertain intent.
- Missing schema readiness, disabled draft opt-in and mismatched definition denial without protected-source fallback.
- Commit-time access/deadline/definition failures and deadline-crossed writes without a false saved status.
- Recovery remains null and public Run stays unavailable; autosave creates no official submission or job.

The previous separately approved real PostgreSQL rehearsal remains distinct evidence: [17 combined context/draft SQL tests](../verification/checkpoint-context-20261028/REPORT.md). It did not verify these HTTP/client/provider interactions. This source slice does not renew that runtime authority.

## Remaining operational gates

[The authenticated rehearsal proposal](CHECKPOINT_AUTHENTICATED_REHEARSAL_PROPOSAL_001.md) describes a fresh, separately approved environment. The denied browser target remains `http://127.0.0.1:3118/review/auth/login` with `net::ERR_NETWORK_ACCESS_DENIED` before rendering. No alternate browser, URL, file surrogate or security-setting workaround was attempted. The restriction must be resolved through a permitted route before issuing rehearsal credentials. HTTP/in-process tests are not visual QA.

Server source/revision/byte retention values require explicit test or product policy; no default is enabled. Same-device recovery retention and cross-device recovery remain separate decisions/capabilities. Invitation admission/activation, dynamic scoring-v2 SQL, scheduled release/review, public Run and full learner progression are outside this milestone. No new services, database connections, credentials, migrations, publication, push or deployment occurred.
