# Week 1 invitation/Auth executable-source assessment — 30 October 2026

Status: SOURCE-ONLY; initial assessment below is supplemented by the implemented milestone at the end. This concrete profile and source handoff is not an executable broker, runtime approval, credential manifest or readiness receipt. No runtime directory, database, service, account, session, invitation, token, email or provider configuration was created or contacted. All historical approvals/profiles remain closed.

The smallest honest flow is authenticated manual issue API → private link → browser inspect/activation → explicit ordinary login → Checkpoint bootstrap/save/reload/CAS conflict → access revocation. Learners must be created and enrolled by invitation activation. The old broker's direct createUser/app.users/enrollLearner path cannot qualify.

## Exact proposed fresh profile

Every value below is proposed for review, never a route fallback. Freshness/port availability have NOT been inspected or attested.

| Binding              | Proposed value                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile/token        | week1-auth-20261030-invitation1 / 20261030_invitation1                                                                                               |
| Root                 | /home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-001                                                                        |
| Project              | 01coding-week1-auth-20261030-invitation1                                                                                                             |
| Database             | foundation_test_week1_auth_20261030_invitation1                                                                                                      |
| Loopback ports       | gateway 56531; database 56532; web 3151; host 127.0.0.1 only                                                                                         |
| Origin               | http://127.0.0.1:3151                                                                                                                                |
| Synthetic issuer     | week1-issuer-20261030-invitation1@example.invalid; Week 1 Synthetic Issuer; separately bootstrapped active admin only here                           |
| Learners             | week1-a-20261030-invitation1@example.invalid / Week 1 Synthetic Learner A; week1-b-20261030-invitation1@example.invalid / Week 1 Synthetic Learner B |
| Account count        | Exactly one issuer and two ordinary learners; no existing identity grant/adoption/upgrade                                                            |
| DBA candidate        | supabase_admin; actual superuser/session identity needs attestation, never inference from name                                                       |
| Migration actor      | week1_auth_migrator_20261030_invitation1                                                                                                             |
| Issuer SQL login     | week1_auth_issuer_20261030_invitation1; only nextera_invitation_issuer membership                                                                    |
| Activation SQL login | week1_auth_activate_20261030_invitation1; only nextera_invitation_runtime membership                                                                 |
| Web SQL login        | week1_auth_web_20261030_invitation1; only nextera_web membership                                                                                     |
| Pinned services      | db, auth, rest, storage, imgproxy, meta, studio, api-gw; existing installed exact public image/template lock only                                    |
| Time bounds          | 600-second owner admission; immutable 3600-second maximum; stop work/cleanup 180 seconds early                                                       |
| Retention            | Owned directory 0700/files 0600; protected DB/volumes/evidence and disabled identities retained; no permanent deletion                               |

Reviewed HEAD, final immutable source-lock digest/file map, authentic owner message/time/scope and supported browser-context receipt remain UNBOUND. The new lock must include all required SQL and final assembly/profile/broker bytes. Do not extend a closed profile lock in place.

Excluded: mail delivery, public signup, production email-ownership claims, installs/pulls, network/security changes, old-state inspection/restart, grading/official submission, push/deploy.

## Explicit proposed policies

Absent or inconsistent bindings must keep issue/inspect/activate/signup unavailable and prohibit launch. These proposals instantiate nothing.

| Policy                | Proposed exact value                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation          | Synthetic admin preconfirmation: adapter emailConfirmed=true and DB email_confirmation_required=true; no mail/ownership claim. Provider must prove admin email_confirm=true semantics without mail. Do not inherit historical auto-confirm settings. |
| Canonical email       | Exact allowlist of the two lowercase ASCII learner addresses above; reject case/whitespace/alias changes and all other addresses. Provider must return/store the identical email.                                                                    |
| Names                 | Exact accepted fixed names above; no client editing/normalization; same bytes in SQL scope and provider ownership digest                                                                                                                             |
| Password              | 20–96 UTF-8 bytes, ASCII letters/digits and only ! # % + , . = @ ^ _ ~ - symbols; server/public maxPasswordBytes=96. Provider acceptance of this subset is unverified. No password is generated here.                                                |
| Invitation            | maxLifetimeMs=900000; expiresAt also before the original cleanup cutoff; issuing is acceptance; no second admin decision or automatic reissue                                                                                                        |
| Activation claim      | claimLeaseMs=30000; maxTokenBytes=43 for existing 32-byte base64url capability                                                                                                                                                                       |
| HTTP                  | allowedOrigins=[http://127.0.0.1:3151]; maxBodyBytes=4096; bodyTimeoutMs=5000; no query capability/encoded body/redirect/forwarded-header trust                                                                                                      |
| Public signup         | Only with matching real assembly: enabled=true, timeoutMs=10000, maxResponseBytes=4096, maxPasswordBytes=96                                                                                                                                          |
| Caller key            | One conservative aggregate bucket for the entire isolated profile: SHA256 of its public profile identifier. All callers share it; no IP/proxy/secret trust inference. Existing token-aware DB actions also enforce their shared token axis.          |
| Ingress DB profile    | week1_ingress_20261030_invitation1; ingress; window_ms=60000; max_requests=120; retention_ms=3600000                                                                                                                                                 |
| Inspect DB profile    | week1_inspect_20261030_invitation1; inspect; window_ms=60000; max_requests=30; retention_ms=3600000                                                                                                                                                  |
| Activate DB profile   | week1_activate_20261030_invitation1; activate; window_ms=60000; max_requests=10; retention_ms=3600000                                                                                                                                                |
| Issuer limiter        | Persistent fixed window 4/60000ms per verified issuer domain UUID                                                                                                                                                                                    |
| Issue ingress limiter | Persistent aggregate fixed window 20/60000ms across all requests                                                                                                                                                                                     |
| Rate retention        | Retain protected counter data; expires_at is metadata, not proof of purge/scheduler                                                                                                                                                                  |
| Draft limits          | max_source_bytes=1024; max_receipts_per_task=64; max_bytes_per_task=65536; retention_after_deadline_seconds=600; offline recovery disabled                                                                                                           |
| Auth JWT              | Explicit proposed 300 seconds; global sign-out does not prove immediate access-JWT invalidation                                                                                                                                                      |
| Checkpoint window     | Existing 5400-second fixture; a one-hour lease cannot claim natural Checkpoint expiry coverage                                                                                                                                                       |

Actual activation keys are token/requestId/password/confirmation. Installed Node's in-memory JSON calculation with a 43-byte token and 36-byte UUID gives 138 metadata bytes. Worst JSON escaping is at most six bytes per UTF-8 byte in each password: 138 + 2 × 6 × 96 = 1290 bytes, below 4096. Handler actual-byte counting remains required; excess raw JSON whitespace may still be rejected. This proves a source envelope bound only.

## Exact executable-source blockers

1. **Real API assembly absent.** apps/web/app/api/invitations/{issue,inspect,activate}/route.ts pass null settings. Bind createInvitationIssuanceAssembly/createInvitationAssembly to separate restricted SQL clients, provider-admin capability, protected clocks/rates and explicit policies. Resolve the issuer through genuine authenticated server identity, never a constant admin object. Exact owner UUID/cohort/published version remain unbound. Public signup settings alone cannot enable routes. Root owns shared route/configuration changes; this slice edits none.

2. **Provider assertions still required at runtime; not an intrinsic source-implementation blocker.** apps/web/lib/invitations/managed-auth.ts explicitly documents custom AdminUserAttributes.id/app_metadata support as installed SDK source evidence, not actual provider integration proof. Unknowns: exact invitation UUID→Auth ID, exact email/private marker, no-mail admin confirmation, password subset, exact-ID not-found versus unavailable, lost-create-response recovery, ordinary login and retention-compatible ban/session invalidation. Source booleans cannot supply this evidence. A fail-closed source implementation can proceed with supplied fake authorized clients if its cleanup journals every possible operation, proves a fresh empty baseline, accounts for all owned synthetic identities/sessions and still stops owned resources after an uncertain result. That implementation is not present here. No provider call is authorized/made now.

3. **Fresh owner/DBA migration adapter unbound.** invitation-auth-migration-plan.mjs intentionally returns runtimeReady:false; boolean-shaped receipt flags prove no DB truth. Required order: registered 0000–0010 → 0019 → atomic 0011/0014 → 0013 → 0020 → 0016 → 0018. Preserve registered bytes. Bind actual DBA spans/27 EXECUTE-edge repair, parameterized catalog guard, same-connection transactions and restored owner context to this exact fresh target. Historical test-checkpoint-migration-adapter.mjs and invitation SQL actors/DBs cannot be relabeled. Check actual superuser/session identity, actor-only guard ACL, acknowledged commit/rollback and restored prior membership graph. The old broker's client.unsafe loop is insufficient.

4. **Complete uncertain-account/session cleanup absent.** The old broker signs out only recorded authId entries, then searches approved emails for bans. A lost create response can miss session handling; email alone proves no ownership. The fresh broker needs the exact ledger below for issuer and every possibly-created invitation account. That real adapter is absent.

5. **Fresh broker/lease integration absent.** Existing rehearsal.py/live-adapter.py/runtime.mjs permit historical attempt001–003 only; preserve them. A new scope must reuse protected journal/pinned snapshot, independent wall+monotonic deadline/parent-loss guard, command gate/process identity and retained ownership-only shutdown. Do not widen old allowlists, renew timestamps or infer target readiness. Genuine browser evidence must bind real issue/inspect/activate, explicit login and Checkpoint assertions to the new lease.

These are missing source/dependency proofs, not a denied/pending runtime action. No generic executor is added merely to accept assertions that the gaps are closed.

## Minimal concrete source wiring handoff

Root coordinates shared app files. The minimal implementation is:

1. Add **apps/web/lib/invitations/runtime-configuration.ts**, marked server-only. Expose request-time getInvitationIssuanceSettings(request), getInvitationActivationSettings(request) and getInvitationSignupPublicPolicy(). Missing configuration returns null. The protected reader accepts only the exact fresh profile root, owner/mode/no-symlink private files, reviewed scope/source-lock, original immutable started/deadline/cleanup cutoff and current non-revoking guard/lease identity. Recheck after awaited identity work and immediately before each authority-bearing operation. Provider timeouts must fit the remaining original work budget; no receipt renews time. Construct/cache issuer, activation and ordinary web clients separately with their exact limited roles, never grant web invitation-owner authority. No generic env/DSN fallback. No secret enters public props.
2. Change exactly the three existing **apps/web/app/api/invitations/{issue,inspect,activate}/route.ts** exports to async POST wrappers. Each request obtains current settings, then calls the existing issuance or activation assembly. Inspect uses that same validated activation configuration's INSPECT handler. Do not capture an enabled assembly at module import; a started app must become unavailable when cleanup begins or its original lease closes.
3. In that server configuration's issuance identity resolver, use existing **requireDomainUser/requireRole(['admin'])** from apps/web/lib/auth/server.ts. That path verifies the actual provider user with getUser and reads the current domain record. Match its exact domain UUID to the fresh profile issuer allowlist; return current id/role/active only. Map auth/permission failures to unavailable/forbidden, with no raw exception or page redirect. SQL issuance uses the distinct issuer client, not the ordinary getDatabase() client.
4. Change **apps/web/lib/invitations/signup-settings.ts** to derive its public whitelist from the same live validated configuration and enforce matching server/password/transport bounds. **apps/web/app/signup/page.tsx** already reads policy at request time and can remain unchanged if the getter stays synchronous; otherwise make that page async and await it. The browser still receives only enabled/timeoutMs/maxResponseBytes/maxPasswordBytes.
5. Add fresh **scripts/week1-auth-live-adapter.py** and **scripts/week1-auth-runtime.mjs** with the exact new profile and existing guard/source-lock/command/ownership patterns. The broker binds real owner/DBA migration adapters, seeds only the synthetic issuer/cohort/reviewed policies, issues learners through the protected API, and performs exact uncertain-ID/session cleanup. Keep private environment generation restricted to exact approved keys/clients. No old profile switches or grants change.
6. Add focused injected tests beside the new runtime configuration and new broker. Cover null/partial/mismatched policy, 1290-byte envelope bound, source/role/lease mismatch, elapsed original deadline and cleanup race, real-request issuer resolution, separation of all clients, no private public props, and lost provider response accounting for issuer and every issued operation. Use only supplied fake clients/subprocesses; passing them is source evidence, never a genuine invitation/browser receipt.

This handoff identifies missing concrete methods and call sites; none is claimed implemented. No additional inert proof-contract module is needed.

## Complete uncertain account/session contract

Before issuer create, durably journal its fresh planned exact Auth UUID, scope digest, email/name/private marker and create-not-sent state. Before learner activation, durably bind each issued invitation UUID/request UUID/acceptance/cohort/version/name/email/ownership digest. The private invitation ledger determines learner IDs: enumerate every possibly-created operation, not only HTTP successes or IDs recorded after create replies.

Record create-sent/unknown before a provider call can become uncertain. Reconcile exact ID read-only as missing/owned/conflicting/unknown with provider and co-resident DB facts. Unknown is not missing. Never retry creation after uncertainty, adopt by email, reset password or choose another ID. A conflicting identity cannot be disabled as rehearsal property.

Cleanup first closes issuance/activation and stops owned in-flight writers. Reconcile issuer and every incomplete invitation. For every proven owned account: revoke product access/membership, disable future provider login with the reviewed operation, and verify no provider sessions/refresh capability remain. Cleanup-only login/refresh is itself a new session action needing an explicit future policy; do not silently inherit it from the old broker. Disable all three SQL logins/memberships and terminate only their scoped verified connections. Stop only verified owned app/container processes; retain protected data/receipts.

Global sign-out does not invalidate all existing access JWTs immediately. Separately prove product denial and owned endpoint shutdown. Unknown identity/session/transaction state means cleanup_unverified; keep evidence while the independent guard attempts verified owned shutdown within the original deadline. Never renew/restart/recreate uncertain state.

## Work and evidence

Read the named preparation/rehearsal/live/runtime/migration sources and invitation factory/route/provider/admission policy contracts. Inspected Git changed-path metadata solely to avoid overlap. Ran one pure in-memory envelope calculation with installed pinned Node 24.19.0: metadataBytes 138, worstEscapedEnvelopeBytes 1290, proposedMaxBodyBytes 4096.

No SQL connection/execution or DB/Auth/HTTP/browser integration test ran. No runtime path was inspected/changed. This delegated slice owns only this new document; controllers/routes, original dirty assets, other agents' source and closed guards are preserved. Parent can now review exact proposed values and coordinate the missing concrete bindings without mislabeling an injected test as runtime readiness.

## Implemented bounded source milestone (later 30 October)

New runtime-configuration-core.ts provides dependency-injected protected snapshot validation, independently anchored immutable lease/source bindings, per-request and per-operation cutoff/revocation checks, exact profile/client role checks, native readiness calls, explicit policy/envelope coherence, fresh request identity lookup and client disposal. New server-only runtime-configuration.ts deliberately supplies null native dependencies. The three invitation routes now acquire/close settings per request; signup derives only the same getter's public whitelist, and independent environment JSON no longer enables signup.

This supersedes earlier statements that this slice changed only the note or left those route call sites untouched. It does not implement native runtime wiring: descriptor-based protected loader, independent trusted review/guard anchors, actual bound and budgeted SQL/provider/cookie clients, persistent issuer/ingress limiters, narrow native private-policy reader and fresh migration/account/session cleanup broker remain absent. Restricted activation receives no private-table SELECT grant. Provider conformance remains a future runtime assertion.

Focused tests use fake snapshots/process facts/native client rows only. No live configuration values, credentials, filesystem loader, SQL/Auth connection, process/service/account or token issuance is used by these tests. No end-to-end readiness or executable approval proposal is claimed.

Independent review fixes preserve authentic owner approval fractions to microseconds with bigint admission comparisons; every native/provider/limiter/capability operation now requires a fresh remaining budget and the original absolute wall/monotonic cutoffs, with an after-call guard. The required native cancellation/abort implementation remains unbound. A sent mutation may have committed: a late reply becomes unknown/recovery_required and must be reconciled by the future owned broker, not relabeled as a known no-account failure.

The required narrow native reader also binds exact issuer/cohort/curriculum version/login/lifetime; activation ledger replies are constrained to the reviewed synthetic learner/name/cohort scope. No private-table SELECT or role grant is added. Focused source evidence after review: all 270 invitation source tests pass, including 27 new core fake tests; scoped ESLint and apps/web no-emit TypeScript pass. No native runtime evidence is claimed.

## Aggregate source verification

The full source suite passed 1,661 tests across 89 files. Full typecheck, repository lint, formatting, production build and diff checks passed. An older presentation test was updated to await the async server signup page and use a unit-only server-component marker mock; production server-only protection remains intact. Independent review passed 67 affected fake tests. All four unrelated original dirty-file hashes were preserved. No native database, Auth provider, browser activation, real client, credential or service verification occurred.
