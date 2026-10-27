# Checkpoint editor lifecycle 001

## Implemented source

The actual Checkpoint component now receives its authenticated learner ID from the existing authorized server page and owns a session keyed by learner, cohort and immutable attempt. Selecting a question does not dispose that session. Bootstrap hydration preserves text typed while loading; per-question draft buffers survive free navigation. Fresh request generations and disposed controllers ignore late responses. Official Submit remains the existing raw-source intake and captures an immutable source snapshot independently of saving. Run remains unavailable.

The editor displays checking/unavailable, unsaved, saving, saved, failed, conflict and closed states. Save uncertainty retries the original request ID, source and base version before later revisions. Explicit keep-local/use-server controls resolve a newer server version. Device recovery requires an explicit review choice and never silently overwrites either current edits or a newer server draft. The component keeps a page-only fallback when bootstrap is unavailable, with a clear refresh-loss warning.

Draft writes debounce for 800 ms as a client interaction delay. Client network waits are bounded at 10 seconds; timeout is an uncertain write, not proof of failure, and retries remain idempotent. These are client interaction settings, not Run resource policies. No grading threshold, eligibility, attempt quota, Run numeric budget, deadline extension or automatic deadline submission was introduced.

## Recovery policy stays disabled

The browser adapter can retain exact source temporarily only after a validated positive retention capability. Keys bind learner, cohort, attempt, question and definition digest. Payload size, UTF-8, version, identity and expiry are validated before showing recovery. Expiry is capped at the trusted exam deadline. Normal unmount preserves an eligible device draft; access revocation clears known scopes and in-memory buffers. Disabled browser storage is surfaced without a false success. No Auth token or credential is stored.

Production bootstrap still returns offlineRecovery: null; both production editor backends remain null. No source is written/read through this adapter without a retention capability. Selecting an actual retention period, cleanup behavior across expired sessions and any subsequent live enablement remain review gates. Injected tests use explicit test-only 60-second retention, not a product default.

Access, paused reads and trusted deadline guard resync. Old clock hints cannot extend the current monotonic deadline. A reconnect requests fresh bootstrap; it cannot discard an uncertain write or resolve a conflict by itself. The API continues to own access/time/CAS checks atomically.

## Verification boundaries

Injected source tests cover question switching, edits during bootstrap and saves, older reads, remounts, uncertain retries, explicit conflicts, network read pauses, deadline cancellation, non-extending clock refresh, access loss during a write, unavailable adapters, identity-isolated temporary recovery, explicit reload recovery, changed server versions, disabled storage and invalid retention settings. Existing component SSR regressions verify the honest unavailable state. These are source-level fixtures, not real authenticated persistence.

The browser-only fixture assets are separate from the shared preview bundle. A Chrome QA attempt failed on its first navigation to http://localhost:3118/checkpoint-lifecycle-fixture with net::ERR_NETWORK_ACCESS_DENIED. No responsive or interaction assertion completed and no screenshot was produced. The test browser was closed; security settings/URLs were not changed to bypass the failure. A later read found no WSL listener on 3118 and no old preview process. No replacement service was started. Its previous PID 1728 must not be reused blindly.

Next verification scope: authorize/restore the existing localhost-only sample preview if desired, then run the prepared browser-local mocked transport checks at 1440, 768, 390 and 320. This needs no Auth, DB or Runner. Full live persistence still requires the separate environment/migration/credential approvals and configuration; SQL0012 rehearsal is not authorized by this code slice and remains unrun.

## Preserved scope

Home/Journey/Raid presentation and the four original dirty files are untouched. The two delivered Library ZIPs remain the frozen 0a93a06 snapshot. No service bootstrap, retained DB connection/mutation, SQL application, new credentials, real learner awards, push or deployment occurred.
