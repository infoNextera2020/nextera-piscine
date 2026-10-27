# Draft 0012 disposable SQL rehearsal - prepared, not run

Approval status: **new explicit approval required**. Previous draft-0011 approval does not cover this test. No cluster, SQL connection, role or record was created during preparation.

Prepared source: `scripts/test-visible-runs-isolated.py`; exact opt-in Vitest config `packages/db/vitest.runs.config.ts`; integration suite `packages/db/tests/integration/visible-runs.test.ts`. Normal unit tests do not include this suite. Python syntax and TypeScript can be checked without running any PostgreSQL command. These checks are not evidence that the SQL or integration suite passes.

## Exact bounded request for owner approval

May I run one disposable PostgreSQL 16 rehearsal for draft 0012 using database **foundation_test_visible_runs_ephemeral**, a newly created mode-0700 **/tmp/nextera-visible-run-test-*** directory and mode-0700 private Unix socket (logical port 55451), with **no TCP**? It would apply existing foundations 0000-0010 and draft 0012 only there, create six additional synthetic **NOLOGIN** test roles (two Run permission roles, three separate caller principals and one hostile-default-grant test role), and use only synthetic learner/attempt/public-example data. No application login password, Auth token, external executor, Docker, retained database or production policy would be created or changed. I would stop PostgreSQL and remove that exact disposable directory afterward, including after a failed test, and preserve nonsecret test/cleanup evidence.

The extra NOLOGIN names are `nextera_visible_run_worker`, `nextera_visible_run_maintenance`, `foundation_test_visible_web`, `foundation_test_visible_worker`, `foundation_test_visible_maintenance`, and `foundation_test_visible_untrusted`. Existing foundations also create their test permission roles in that disposable cluster. The only LOGIN identity is initdb's ephemeral local bootstrap identity; no password is set. Synthetic `auth.users` UUID rows are FK stubs, not accounts issued by an Auth service.

The synthetic worker protocol uses a test image digest and a test stop-reference hash; it **does not run code or verify a real process stopped**. That is deliberately outside this database-only request. Numerical limits/retention in fixtures are not production approvals.

## Approved-run mechanics (do not execute while approval is pending)

From the existing checkout, explicitly run `python3 scripts/test-visible-runs-isolated.py start`, then `test`, and always `cleanup`. Start refuses an existing control record. Test verifies the exact server data directory and empty listen_addresses before resetting only the fixed synthetic database in that same cluster; never create a second cluster to retry. Cleanup validates absolute target, UID and private directory mode, stops the recorded PostgreSQL instance, checks PID/socket removal and removes only that exact newly created /tmp child. Read `.tools/visible-run-verification/control.json` before any uncertain retry. No database URL/.env fallback, install or credential lookup is used.

Evidence stays under `.tools/visible-run-verification`; preserve/copy it into the Windows task verification directory before handoff. Do not print application secrets or retain bootstrap access.

## Prepared coverage and limits

The initial nine-case SQL suite covers migration transaction rollback/application, actual web/worker/maintenance readiness/ACLs/schema usage, default-grant cleanup, two-session identical admission, one-slot competing admission, idempotency/source and ownership denial, two-worker claim fencing/start/terminal replay, expired uncertain lease hold/reconciliation with synthetic stop reference, cross-question Run quota, access/finish closure, bounded queue discovery and web lifecycle denial. Final assertions require zero graded submissions/jobs/outcomes, zero passwords and zero extra LOGIN roles.

Before a live enablement claim, extend the same approved disposable scope as needed for real row-lock access/deadline races, cumulative storage caps, namespace-collision refusal, malformed policies/bytes, physical source/output expiry purge, rollback after partial intake, cancellation and crash paths. Those properties are currently source-reviewed/injected only. No actual sandbox, compiler/startup/execution budgets, Auth/browser integration or external stop evidence is verified by this suite.

Preparation found missing schema-USAGE grants for future worker/maintenance roles; the unapplied draft and fail-closed readiness were corrected. No grant was executed. Source tests must pass before this preparation commit. Actual SQL results remain **not run**.
