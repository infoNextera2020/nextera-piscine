# Invitation SQL rehearsal — failed safely, closed

The approved run on cbd390e7b77e89516af018e678891006f16859eb started at
10:33:03.235299 UTC on 2026-10-30. Authentic owner approval metadata was preserved.
All 11 registered prerequisite migrations and all 4 invitation draft transactions have
acknowledged commit receipts. The runner then failed during synthetic fixture insertion:
SQLSTATE 23514, nodes_resource_limits_check. None of the 14 planned invitation SQL cases
started or passed. This is not a successful invitation integration rehearsal.

The runner acknowledged disabled test policies, removed invitation test memberships and
NOLOGIN/non-elevated test roles. The controller stopped the cluster; independent checks
confirmed no owned PostgreSQL/startup process, postmaster PID, socket or watchdog. The
raw protected data and evidence remain; no permanent deletion occurred. There is no
active approval/lease to reuse, and no restart or deadline renewal was attempted.

The summary records immutable source/scope/approval and timing, separate SQL/process
cleanup evidence and receipt hashes. Individual registered/draft commits are known;
the whole setup was not rolled back. Partial fixture data remains protected and was
not inspected through a restarted database. Raw logs/database files are not copied here.

Root-cause diagnosis and any correction must remain source-only after shutdown. A new
execution requires a reviewed new target/scope and fresh exact owner approval. Real
Auth registration/browser flow, actual invitation tokens and passwords were not used.

## Source diagnosis and correction

The installed postgres3.4.9 JSONB serializer applies JSON.stringify. The harness had
already stringified the curriculum fixture before binding it to a JSONB parameter;
the driver therefore encoded a JSON scalar string instead of the required object.
The same source pattern existed in two later fixture Auth metadata writes. This
explains the constraint failure; it was not an invitation-grant failure.

All three fixture sites now bind object-backed admin.json values. A permanent pure
regression uses the installed driver Parameter/handleValue/JSONB serializer, with no
client construction or connection, to reproduce the old scalar and verify object
round-trips for the curriculum and both metadata payloads. SQL constraints and both
registered/draft migration bytes are unchanged. Independent review cleared this
source correction only. It has not been rerun on PostgreSQL.

The original profile's target is occupied and closed. Preparing a separately reviewed
unused target and scope, then obtaining fresh exact owner approval, is required for
another real run. No such new target/profile, receipt or runtime window was created.
