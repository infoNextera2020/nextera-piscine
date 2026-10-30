# Real private PostgreSQL rehearsal — 2026-10-30

Passed the approved scope on source commit e52406339829be6cd7146278d43bd8979ba8aee9.
The exact immutable owner approval, source scope, start/deadline and cleanup receipt
times are in verification-summary.json. No approval time was refreshed.

All 11 registered migration receipts were acknowledged; actor identity was restored
before each commit. The four exact DBA source spans ran as reviewed. The 27-grant
repair reconciled 25 functions with PUBLIC denied, identical before/after ACL facts
and role-graph digests, and no actor privilege expansion. Both current draft bodies
were exercised in real transactions.

Seven real SQL cases passed: wrong identity; probe ACL rejection/restoration;
rollback before second draft; rollback before audit; NOWAIT contention plus unrelated
role-writer timeout/rollback; disconnect lock release; final combined draft commit.
Only the final draft case committed those non-idempotent draft objects.

SQL receipts confirm removal of the temporary guard and disabled test-role access.
Independent read-only process/socket checks after completion found no owned PostgreSQL,
startup helper, PID file, socket or watchdog. Private data and evidence remain retained;
no database/schema/table/data directory was deleted. There is no active lease to reuse.

These are native SQL/ACL/transaction results. They do not establish authenticated
application persistence or the full Week 1 learner journey. No Auth/Runner services,
emails, invitations, student numbers or real learner records were created. The actual
repair was idempotent; missing-edge/fault repair recovery remains fake-client coverage.

Protected full receipts remain outside the repository at the retained root named in
the JSON summary; raw database data/logs are not copied into this report.
