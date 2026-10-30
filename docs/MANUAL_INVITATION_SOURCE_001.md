# Manual invitation source milestone

This implements prepared source for Sunday's approved private invitation flow. It does not issue a real invitation, enable public registration, configure an Auth provider or apply SQL. Creating an invitation is the acceptance decision. Anas manually delivers the returned link; no second per-learner admin confirmation is introduced.

## Implemented source boundaries

`apps/web/lib/invitations/issuance.ts` accepts only request ID, email, accepted name, cohort and explicit expiry. A verified server identity resolver must return a currently active admin in the explicitly configured owner allowlist. Browser role, issuer, admission, curriculum-version and token fields are rejected. Owner rate decisions, provider-compatible email canonicalization, invitation lifetime bound, signup origin, clock and cryptographic capability generator are required inputs; none has an enabled fallback. Construction performs no work.

`issuance-postgres.ts` calls one parameterized atomic repository function with a digest only. Exact committed identity/scope metadata must match before the capability link is returned. No raw token/password is a database parameter. Unknown commit outcomes return `uncertain`; the service never retries, rotates, revokes, adopts an account or claims rollback. A completed request replay returns `already_issued` without a replacement link. Deliberate reissue/revocation and lost-link recovery remain a separate reviewed operation.

`issuance-http.ts` and `issuance-assembly.ts` provide a bounded same-origin JSON POST with explicit ingress limiting and private/no-store, no-referrer responses. The raw capability is deliberately returned once to the authorized issuer as `/signup#invitation=...`, not a query string, database field or log. Automated email is absent. The actual `/api/invitations/issue` route supplies null settings and returns503, as does the existing activation route. No environment, SQL or Auth client is created by this milestone.

## Unregistered SQL preparation

The deliberate draft installation order is registered0000–0010, then0013, **0020**,0016,0018. The new0020 authority is required before0016; filename order is not a migration runner. These files remain outside the registered journal and must not be auto-applied.

0020 adds private immutable acceptance records and an empty issuer/cohort policy. It checks an active admin against the owner policy and exact restricted issuer database login; issuer permissions cannot be inferred from browser metadata or arbitrary public user rows. The policy pins the published curriculum version. Issuance atomically inserts acceptance plus the digest-only ledger; uniqueness arbitrates concurrent requests and repeated cohort/email issuance. There is no second acceptance flag. Replays never mint a second valid capability. The private admission hook locks stored acceptance/current cohort and owner policy for each activation transaction, rejecting a repinned cohort, disabled policy or inactive issuer. Existing activation operations separately recheck ledger expiry/revocation, claims and fences.

The source correction in0016/0018 completes PUBLIC revokes, intended EXECUTE grants, RLS and policies before ownership transfer. Temporary schema CREATE is allowed only after proving it absent and is revoked before commit. No INHERIT, SUPERUSER or broad actor grant is added. Registered migration bytes remain unchanged. SQL execution/parse, role graph, provider data types, row locks, concurrent rollback and ACL correctness of these invitation drafts are **not yet verified on PostgreSQL**.

The separate previously completed native checkpoint rehearsal at e524063 does not test these invitation drafts. Its sanitized evidence is committed in0949dd9; it is closed and cannot be reused.

## Existing activation retained

The existing activation/managed-Auth/enrollment machinery still owns deterministic provider operation IDs, current invitation/acceptance eligibility, fixed learner role, exact cohort, claim fences, immutable request scope, uncertain provider recovery and enrollment receipts. It never upgrades an existing account or mutates a password on recovery. Existing-account navigation remains an explicit outcome, not implicit enrollment.

Source tests cover the new issuance interface, private repository protocol and HTTP assembly, alongside existing activation replay/concurrent consumption, invalid/expired/revoked invitations, email/ownership mismatch, no role escalation and partial Auth/enrollment recovery. These use injected synthetic doubles. Static SQL assertions are not PostgreSQL integration evidence.

## Remaining minimum steps

1. Independently review and prepare a guarded **new** invitation SQL rehearsal controller. Use a fresh private-socket PostgreSQL16 test database, synthetic owner/cohort/identity rows and restricted NOLOGIN test principals, then apply0000–0010,0013,0020,0016,0018 in the explicit order. Assert issuance/acceptance atomicity, exact role/session/owner/cohort/version denial, concurrent uniqueness and consumption, lock/revocation ordering, expiry, rollback and PUBLIC/web ACL denial. Stop independently and retain protected evidence/data. No old attempt or completed lease may be reused. The exact resource manifest and fresh runtime approval are prerequisites; this source milestone does not authorize that execution.
2. Supply reviewed explicit trial settings: exact invitation lifetime, eligible cohort/version and owner identity; restricted issuer/activation client boundaries; actual provider canonical email/password and verification behavior; ingress/issuer/inspect/activation rate settings; safe origin and post-activation login flow. No numeric policy has been selected here.
3. In a separately approved fresh co-resident Auth/product database environment, verify real invitation -> deterministic account creation -> exact ordinary learner membership/progress, plus partial-failure recovery and session cleanup. Restricted credentials/accounts and real token issuance need exact action-time approval, an independent time guard and retained shutdown evidence. No email provider is needed for Anas's manual delivery.
4. Wire approved signup to fragment extraction/removal, inspection, accepted fixed identity and activation, preserving password semantics and preventing URL/history/telemetry leakage. The current signup is still a fixture presentation; this milestone does not claim browser or live registration success. No new layout is proposed.

The stable global student number is deliberately separate from the cohort-scoped invitation record. The minimum next source change is a unique immutable user-level number, collision-safe allocation and separate projections: own account settings only for learners, authorized staff beside the name (with email/cohort where permitted), no peer exposure. No number/schema/identity is assigned by invitation issuance here.

No runtime, credentials, accounts, emails, secrets, grants, published curriculum, push or deployment was performed. The four pre-existing unrelated dirty files remain outside this work.
