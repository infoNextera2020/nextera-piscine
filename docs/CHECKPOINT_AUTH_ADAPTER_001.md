# Authenticated Checkpoint adapter 001

Source implementation and fake verification only. No environment, credentials, identities or migration application has run. Earlier approvals are completed/expired. The owner manually accepted the current auth UI on 29 October; that is not a live Auth or full-device test.

## Adapter and execution gates

`scripts/checkpoint-auth-live-adapter.py` supplies guarded OS/Compose orchestration to the existing scope lifecycle; `scripts/checkpoint-auth-runtime.mjs` stages the pinned public source, prepares the genuine provider/database fixture, builds the isolated application and runs real HTTP assertions when separately authorized. Neither provisions on import. Default CLI only prints the proposed scope. `--execute` requires a private owned fresh approval file bound to the exact scope digest, timestamp and new app origin, plus a recent supported-browser context receipt. It never retries a denied browser route or starts a headless browser.

Preflight verifies the public source SHA256 manifest, recorded image digests already installed, unused project/volumes/network, free loopback ports and exact database. Missing images stop; no pull/install is included. Existing resources are never reused. New source is staged from `git archive HEAD`, excluding real environment files and unsafe links. Existing dependency directories are linked only for this host-side isolated build; no retained secret configuration is copied. The effective Compose configuration must attest eight exact services, pinned images, restart=no, new mounts/volumes/network and two exact loopback bindings. The app uses the third loopback port.

Before keys or services, the private lease/journal and independent deadline/parent-loss guard must acknowledge. Runtime code is copied into the private run, so later checkout edits cannot replace cleanup code. New work stops three minutes before the one-hour maximum, reserving time for cleanup without renewal. Active task phase processes are identity-checked/stopped before revocation; launch gates prevent unregistered sensitive commands or app startup. Cleanup disables access, globally revokes test sessions through the provider, stops only verified owned processes/containers and checks listeners; it retains all new data/evidence. Unverified cleanup is failure, not success or permission to restart.

## Fresh approval scope to request

- Fresh protected run `/home/anas/.local/share/nextera-judge/checkpoint-browser-20261028/run-001`, project `01coding-checkpoint-browser-20261028`, database `foundation_test_checkpoint_browser_20261028`. Existing names cause a stop, not adoption or automatic renaming.
- Existing installed Docker/Compose and the eight pinned services db/auth/rest/storage/imgproxy/meta/studio/api-gw. Only 127.0.0.1:56531 gateway, 56532 DB and 3151 Next app are exposed. Existing sample preview3118 is untouched. No settings change, software/image install, public exposure or retained data connection.
- Fresh required instance keys/passwords listed in the base proposal, one restricted `checkpoint_browser_web_20261028` LOGIN role inheriting only nextera_web, and exactly two synthetic ordinary learners checkpoint-a/b-20261028@example.invalid. No emails/invitations, real people, Runner or result-worker access.
- Registered SQL0000–0010 then drafts0011 and0014 only, verified against source hashes, on the new genuine co-resident Auth/Storage/product database. One synthetic cohort with four-task legacy checkpoint fixtures. No Q1/Q2 or candidate curriculum publication. No grading/Run/outcome/XP execution.
- Explicit test-only draft limits: 1024 source bytes,64 receipts/task,65536 stored source bytes/task,600 seconds retention after the frozen deadline. Offline local recovery stays disabled.
- Maximum one-hour environment/access window and five-minute Auth JWTs, no environment renewal. One initial ordinary session per synthetic test account supports cleanup. If needed, cleanup may authenticate/refresh only those existing test accounts inside the original window solely to globally revoke their sessions, then ban them and remove app access. This cleanup authentication is a proposed explicit permission, not already granted. It does not extend the environment deadline. Instance admin/anon keys expire at that deadline; stopped data remains protected and does not authorize restart.
- On success/failure/parent loss/expiry: revoke scoped access, stop only the new app/project, verify listeners/guard exit and retain new protected files/volumes/evidence with no permanent deletion.

## Assertions and browser handoff

After a permitted actual browser login, test saved status, free question switching, refresh recovery and explicit losing-source conflict. Record a new private `browser-evidence.json` bound to origin3151, scope digest and this lease start; earlier fixture acceptance cannot qualify. The adapter waits only within its guarded window; missing browser evidence triggers cleanup. No code creates a fabricated browser receipt.

The HTTP phase signs in with the genuine managed provider using ordinary learner sessions and SSR cookies. It tests unauthenticated/cross-learner rejection, authoritative bootstrap, exact BOM/Unicode/CRLF/NUL source save/reload, stable idempotency, concurrent CAS conflict, stale-definition and oversize rejection, access removal with an otherwise valid session, durable revision count and zero official submissions/jobs/outcomes. The synthetic fixture has non-runnable grading references because evaluation is excluded; no successful evaluation is claimed.

The installed legacy exam is90minutes. The environment is at most60minutes; natural deadline crossing is not tested or rewritten. Earlier genuine SQL and injected expiry tests are separate evidence. No extra expired fixture or migration0017 is added.

## Remaining runtime prerequisites

Review this source and the fake-test results, verify current browser context again, then obtain the exact fresh approval above. Current supported extension inventory/read of3118 works;3151 has not been started or navigated, so its access is not proven. A new denial must stop that browser action without security changes or route switching. Runtime readiness/image availability/permissions are checked at preflight and can still block before secrets are issued. There is no present claim that this unexecuted adapter works against live Docker/Auth/DB/browser.

The full Sunday learner journey still separately needs invitation/admission, curriculum/evaluation contracts, public Run execution, review/mentor policy and all-flow integration evidence. This is only authenticated checkpoint autosave preparation.

## Operator commands after review

`python3 scripts/checkpoint-auth-live-adapter.py --plan` prints the non-secret proposed scope and its digest, without provisioning. A later approved run uses `--execute --approval-file <private-0600-receipt> --browser-context <fresh-supported-context-json> --template <verified-public-template-directory>`. It does not accept a connection string, existing database or replacement project name.

The fresh approval receipt must contain `confirmed_at_action_time: true`, the displayed `scope_sha256`, current `utc_epoch` and `browser_origin: http://127.0.0.1:3151`, populated only after Anas gives the exact runtime approval. The browser context is a recent supported Chrome-extension inventory/bind observation of the existing3118 login page with `denied_route_retried: false`; it establishes transport context, not3151 reachability. The real browser/manual assertion receipt must be newly produced after the live app is available, never copied from current UI acceptance.

For recovery, `--cleanup` accepts only the recorded fixed private lease and retains data; it is not permission to start/reuse that lease. Do not run the old first-slice helpers. Source/hash/ownership/expiry failures require inspection rather than automatic retries.

Provider cleanup rationale: [the pinned Auth user implementation](https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/models/user.go) updates the ban state without logging out sessions. The adapter separately uses global provider sign-out and verifies no scoped sessions remain. Cleanup-only authentication of existing synthetic accounts is explicitly part of the proposed approval, not an assumed permission.

Post-commit failure-path review: sensitive phase commands and the app use a one-byte launch gate. The target cannot execute until its PID/start identity is durably recorded; a lost registration gets EOF without GO. Cleanup therefore uses registered identities and does not scan unrelated process command lines. If provider cleanup fails, SQL-only deactivation/membership removal and NOLOGIN/revocation are still attempted independently before owned services stop. Provider-session uncertainty still makes the overall cleanup fail; the SQL fallback never converts that into success.

Actual bootstrap rehearsal 29 October: window07:51:05–08:51:05UTC; startup failed before app migrations/learners because copied public init templates were mode600. Cleanup stopped all owned services by07:51:34UTC. Source now gives only verified public templates mode644, public shell entrypoints755, public template directories755; runroot700 and secret files600 remain unchanged. Existing database-data permissions are never changed. A single explicitly authorized recovery may recognize only this verified pre-SQL stopped lease, retain failed initialization, reuse its original keys and preserve its original deadline. Post-SQL, learner-created, unknown-cleanup or expired states fail closed. No denied PG_VERSION read is repeated or worked around.
