# Invitation admission and activation — prepared source, disabled runtime

Current verification (2026-10-30): a fresh isolated native PostgreSQL rehearsal passed
all 14 invitation SQL cases, with 11 registered prerequisites and four draft commits
acknowledged, SQL access cleanup and independent shutdown verified. Evidence:
verification/invitation-rehearsal-attempt002-20261030. Its policy/Auth rows were synthetic.
Production issue and activation remain 503; real provider/browser registration and
actual settings are unverified. No real account, session, password, token or email
was created. Earlier preparation notes below remain historical context.

Sunday trial planning update (2026-10-30): owner-issued invitation is the acceptance decision; Anas manually sends a private email-bound, expiring, single-use link. Registration joins the fixed cohort without a second admin confirmation. Automated invitation delivery/management are deferred. See docs/SUNDAY_WEEK1_TRIAL_001.md for approved scope and inspected gaps. Prepared private authority and issuance source now exist; policy configuration, SQL/provider verification and live UI wiring remain gated. No token or account has been issued.

This slice extends the existing invitation activation service; it does not activate public signup.
`app/api/invitations/activate/route.ts` supplies **null** configuration and returns503. `/signup`
is unchanged and still shows unavailable. No environment client, SQL connection, provider request,
cookie, session, invitation delivery or account is created by importing/constructing these factories.

## Manual issuance preparation update (2026-10-30)

The private acceptance hook and owner-authorized digest-only issuance now have source
implementations in unregistered0020 and issuance*.ts. Installation order is0013 ->0020
->0016 ->0018, not filename order. Exact owner/login/cohort/version policy is empty and
required. Ownership/ACL ordering in0016/0018 is corrected as unregistered source only.
Both production issue and activate routes remain 503; signup remains a fixture. No
invitation SQL/provider/browser integration is claimed. The historical preparation
notes below describe the earlier slice; the current implementation, limitations and
remaining gates are in docs/MANUAL_INVITATION_SOURCE_001.md. No live token was issued.

## Assembly and trust boundaries

`assembly.ts` composes the existing private ledger and deterministic managed Auth adapter with
`admission.ts` eligibility, enrollment and rate adapters. The caller must supply the SQL client,
authorized managed Auth client, clock, enabled activation policy, actual password-policy function,
explicit email-confirmation policy, admission contract and three distinct rate-profile identifiers.
HTTP requires explicit origins, byte/time bounds and a trusted transport caller-key resolver. Missing
dependencies/policy stay unavailable. No invitation lifetime, password strength, rate/window,
proxy identity, verification, sign-in or reissue default is chosen.

`http.ts` rejects cross-origin/unconfigured origins, query-string capabilities, non-JSON/encoded
bodies, oversized or stalled streams and invalid UTF8. Unsafe envelope configuration above
the fixed 1MiB allocation ceiling is rejected; the ceiling is not a default or selected policy value.
The configured byte/time limits are still required. Cancellation failures/stalls do not retain the
handler's body-reader lock. It consumes caller ingress rate before
body parsing and password-policy work. It never derives trust from forwarded headers by itself.
Caller keys must be opaque SHA256-shaped values derived by the configured trusted resolver;
token digests are computed server-side, and raw passwords/tokens/IPs are not persisted or logged
by this code. Resolver secret/key management and transport/proxy validation remain setup gates.
HTTP returns allowlisted statuses only, with private/no-store and no-referrer headers; it emits
no login cookie or private email/provider error. Returned activated means the stored activation
completed, not that a new authenticated session was created.

The request accepts only token/requestId/password/confirmation. Email, name, admission, cohort
and fixed learner role come from the immutable private ledger. Client role/email/cohort/name
claims cannot self-enroll. A new request cannot adopt or change an unrelated Auth/domain identity.

## Prepared SQL0018, NOT run

`packages/db/migration-drafts/0018_invitation_admission.DRAFT.sql` remains unregistered and
unexecuted. It requires reviewed0013/0016 and their existing restricted NOLOGIN owner/runtime
roles. It deliberately does **not** implement/seed an accepted-learner registry or a permissive
`invitation_admission_current` stub. That private volatile SECURITY DEFINER hook must already
have the exact signature, owner, restricted ACL, search_path and contract checked by0016,
and lock genuine acceptance/access rows until the enclosing transaction ends. Current public
users/memberships are not proof of acceptance. The real authority still has to be chosen/built.

The draft prepares empty explicit admission-policy/rate-profile tables and private rate counters,
plus immutable exact-operation enrollment receipts. No policy rows are inserted. Fixed-window
rate profiles separately cover ingress/inspect/activate, with both per-caller and per-token axes
for token-aware actions. Caller accounting is independent of token rotation; token accounting
is shared across callers. A denied token request can still consume its caller budget. Algorithm,
numeric limits, window and counter retention/purge operation need owner review/configuration;
expires_at metadata does not constitute an automatic purge job. No scheduler is installed.

Enrollment locks the invitation, rechecks the **current fence/lease**, exact stored scope,
expiry/revocation and real admission hook, then verifies deterministic Auth ID and private
app_metadata ownership proof. Confirmed-email requirements are checked against explicit stored
policy; managed Auth columns/schema/provider compatibility remain integration-unverified.
Banned/deleted identities are blocked. A new domain learner, membership, prerequisite-respecting
initial progress and receipt are inserted atomically. It grants no mastery, results, attempts,
curriculum publication or role upgrades. Existing identities without an exact ownership receipt
are blocked; receipt recovery verifies active exact records and refuses to repair inactive or
incomplete enrollment. Final lease/expiry failure raises and rolls back new rows. Completion
still uses the existing separately fenced0016 finalization gate.

The NOLOGIN owner receives only needed insertion/column-read privileges. The restricted runtime
gets narrow EXECUTE only, with no general table grants to web/browser/service roles. SQL application,
owner/ACL/RLS/grant verification, concurrency/rollback/provider integration and operational policy
review all remain required before runtime enablement. Do not apply this draft to the currently
approved first-slice stack (which admits0000–0010 only).

## Corrected existing boundaries

The ledger claim query now aliases JSONB as result, matching its decoder and SQL0016 return type.
EnrollmentPort now receives the current Lease as a second argument. Recovery retains the exact
operation scope but passes the new fence; a stale worker cannot borrow a later claim's authority.
Managed Auth recovery is still read-only: a different retry password does not reset/update the
password created by the original request. No create retry, adoption or credential mutation is added.

## Verification and remaining gates

Tests use injected protocol doubles only. They cover HTTP bounds/rates/origin, missing config,
authority tampering, exact Auth creation scope, completion replay, uncertain enrollment recovery
with a fresh fence and existing service/provider failures. Static SQL assertions are not SQL execution
or proof of transaction/ACL correctness. No live Auth, DB, invitation or browser test is claimed.

Owner policy decisions: genuine acceptance authority and who issues/revokes/reissues invitations;
invitation lifetime; authoritative name policy; actual password and email-verification flow; rate
algorithm/quotas/windows/retention; trusted caller/proxy handling; post-completion login destination.
Runtime gates: implement the secure authority hook, review/apply drafts in a separately approved
isolated database, configure reviewed policy rows and restricted clients/permissions, test actual
provider deterministic creation/recovery and enrollment concurrency/expiry/access removal,
then explicitly wire the production route and invitation inspection/UI. These are not completed
by a source-test pass, and no new layout or operational authority is inferred.
