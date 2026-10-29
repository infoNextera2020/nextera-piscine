# Proposed authenticated Checkpoint autosave rehearsal 001

**Proposal only. Not approved, provisioned or executed.** The completed private-socket SQL rehearsal is stopped and retained. Its approval does not authorize this fresh Auth/HTTP environment.

## Exact proposed resources

- One fresh private run directory `/home/anas/.local/share/nextera-judge/checkpoint-browser-20261028/run-001`, mode 0700; protected configuration/evidence files 0600. Refuse existing run/control/resources rather than reuse uncertain or retained data.
- Compose project `01coding-checkpoint-browser-20261028`, new project-only network and data volumes. Reuse the previously reviewed pinned self-hosted template at upstream commit `bc27d2661edd09a5d0b8d76ce33da6d4071a756e` and recorded image digests; verify availability and effective configuration before keys are issued. No software installation or security/integration-setting change is included.
- Exact existing service composition: `db`, `auth`, `rest`, `storage`, `imgproxy`, `meta`, `studio`, `api-gw`. Keeping the known co-resident composition avoids reviving the old split product/Storage database arrangement. Only DB and gateway expose host ports; management/support services stay internal. Storage is present but file submission/download is excluded from this slice.
- Fresh database `foundation_test_checkpoint_browser_20261028`; gateway `127.0.0.1:56531`, PostgreSQL `127.0.0.1:56532`, actual Next app `127.0.0.1:3151`. No other exposed ports, host network, public binding, external volume or retained database connection. Existing sample preview 3118 is left alone.
- Startup uses only existing installed Docker/Compose/tooling. Unexpected terms, elevation, integration toggle, settings change, missing image/install or port/resource conflict stops setup for an exact decision. No existing container is stopped, reset or adopted.

## Access and credential approval needed

- Fresh instance values for POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, PG_META_CRYPTO_KEY, SECRET_KEY_BASE, REALTIME_DB_ENC_KEY, VAULT_ENC_KEY, DASHBOARD_PASSWORD and S3 protocol access key ID/secret, as required by the exact existing template. No copied retained secrets or expired tokens.
- Instance admin/migration authority is setup-only inside the fresh environment. One restricted LOGIN role `checkpoint_browser_web_20261028` may inherit only existing `nextera_web` grants; no owner/result-application/Runner membership, superuser, BYPASSRLS, CREATE ROLE/DB or replication rights. No Runner, result worker or maintenance service token is created.
- Two synthetic managed Auth learners: `checkpoint-a-20261028@example.invalid` and `checkpoint-b-20261028@example.invalid`; ordinary active learner roles and isolated cohort membership only. Fresh protected random test passwords, no email or invitations, no real-person accounts. Public signup and anonymous signup remain disabled. Provider password policy is unchanged; any mismatch must be reported rather than relaxed. This tests direct synthetic sign-in, not invitation activation or accepted-learner admission.
- Public browser configuration receives only the normal publishable/anon key. Service/admin secrets and privileged DSNs stay outside the app/browser. Auth access JWT lifetime 300 seconds; independent maximum environment/access window 3600 seconds, no automatic renewal. Keys are issued only when image/port/tooling and permitted browser access checks have passed.

## Proposed data and SQL boundary

Apply registered 0000–0010 and drafts 0011 plus 0014 only to the verified fresh co-resident database. Do not run a root-env migrator or promote the journal. Auth/Storage use their genuine managed schemas; no fake provider or auth.users replacement. Exclude 0012 public Run, invitation 0013/0016/0018, scoring 0017 and unimplemented schedule/review storage.

Create only synthetic curriculum, one cohort and one frozen legacy-compatible checkpoint attempt per synthetic learner through the existing guarded fixture path. Synthetic publication occurs only in this test database. Per-attempt deadline is fixed at start using the installed legacy 5400-second (90-minute) contract; no deadline rewrite, automatic submission, invented production threshold or real mastery/XP. The independent stack/access window remains at most one hour. A ten-minute attempt is incompatible with registered migration 0006 and the current loader and is withdrawn from this proposal. Exact fixture setup/enrollment must be verified against the selected registered contract before provisioning.

**Proposed test-only draft policy, requiring confirmation with this scope:** 1024 source bytes, 64 immutable receipts per question, 65536 total stored source bytes per question, retention 600 seconds after the frozen deadline. These are not product defaults. Browser same-device source persistence remains disabled (`offlineRecovery: null`); deciding/implementing production local retention is not smuggled into this test. Draft backend opt-in is confined to this run's app environment.

## Actual end-to-end assertions planned

1. Sign in through real managed Auth as an ordinary synthetic learner; verify the server resolves current domain user/cohort and returns protected bootstrap/draft responses with no caching or Auth identifiers.
2. Edit exact source, observe saving/saved, switch question, refresh and recover the real server draft. Check unchanged source bytes and monotonic version in durable records.
3. Two authenticated tabs submit same-base edits: one succeeds, one explicit conflict; the losing local source is not silently overwritten. Retry the exact accepted/uncertain request idempotently.
4. Reject unauthenticated access, another learner's attempt/task, stale definition and removed access. Recheck permission at write time; invalidate stale callbacks and do not report saved after denial.
5. Autosave alone creates zero official submissions/jobs/outcomes. Natural 90-minute attempt expiry cannot be observed within the proposed one-hour environment. Do not claim full browser deadline coverage: expiry/access SQL and injected HTTP checks remain separate prior evidence. A separately reviewed already-expired synthetic fixture would be needed for additional runtime expiry assertions; none is added or authorized here.
6. No graded Submit, public Run, artifact upload, worker execution, invitation, mentor approval or learner progression occurs in this slice. Their controls/contracts are not tested or declared ready by this result.

These are planned assertions, not current results. Existing 17 real SQL tests and injected HTTP tests are prior evidence at different boundaries.

## Guard and stop-with-retention cleanup

Before startup, arm an independent expiry/parent-loss watchdog and record UTC issue/deadline plus exact project, resource labels, process IDs/start identity and private run paths. Use restart policies `no`, bounded command timeouts and no automatic credential extension.

On success, failure, lost parent or one-hour expiry: revoke the synthetic learners' app access/membership, ban/sign out the two test Auth users and revoke refresh sessions through supported provider operations; disable the one test LOGIN role and revoke its membership; stop only the verified new app/project. Verify app/gateway/DB listeners gone and no project/guard process remains. Already issued JWTs may remain cryptographically valid until expiry; access denial and stopped endpoints must be verified, not assumed.

Retain all new protected data volumes, stopped database and evidence for review; do not use `down -v`, delete files/volumes or perform permanent cleanup. Instance keys expire within the approved window; saved credentials do not authorize restart. Any cleanup uncertainty is an explicit blocker. No retained environment is touched.

## Decisions and blockers before asking to execute

- The earlier headless browser `net::ERR_NETWORK_ACCESS_DENIED` remains unexplained and that route is not retried. The supported existing Chrome extension previously verified the already-open 3118 fixture; this is separate evidence, not clearance of the earlier denial or proof that authenticated port 3151 is permitted. The prior resume timed out; on29October supported extension inventory and a safe bind to the existing3118 login tab worked. This does not prove3151 reachability. Verify current URL/context before any new browser action; do not change security settings or evade restrictions.
- Confirm the exact test-only draft limits and two-account/one-hour access scope above. Production retention/receipt limits and same-device recovery retention remain separate decisions.
- `scripts/checkpoint-auth-rehearsal.py` now provides a proposed scope, exact-scope digest, fail-closed preflight and injected lifecycle/cleanup contract with fake-only tests. Running it only prints a non-secret proposal. The source-only sibling adapter now implements OS/Compose/provider/SQL/HTTP orchestration and waits for real supported-browser evidence; see `docs/CHECKPOINT_AUTH_ADAPTER_001.md`. It has not been run against live services. Review its fake checks, exact cleanup-authentication scope and effective configuration gates before asking to execute. The earlier first-slice harness is hard-bound to another target and must not be replayed.
- Invitation/admission policy, full curriculum/threshold publication, public Run limits/manifests/executor, dynamic exam scoring and reviewer/XP policies are not prerequisites for this narrowly bounded autosave test, but still block the complete Sunday learner journey.

No approval request should imply all-feature readiness. Once the harness/browser gates are resolved, ask specifically to create this environment/credentials/data for one hour and stop with retention; do not execute based on this document alone.

Source adapter update: the exact additional proposed cleanup-only authentication/session-revocation behavior, early cleanup cutoff, source/image lock and browser receipt boundary are detailed in `docs/CHECKPOINT_AUTH_ADAPTER_001.md`. No runtime authority has been granted.
