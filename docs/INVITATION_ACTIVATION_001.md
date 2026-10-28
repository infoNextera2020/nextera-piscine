# Invitation activation service — source only, disabled by default

The current signup UI is committed in 176865f. Production /signup still always displays the unavailable invitation view; no route or login authorization guard is changed by this slice. Existing login verifies a Supabase identity but does not provision app.users or cohort membership. The ordinary learner continues to need an active domain learner plus active authorized membership.

## Implemented source contract

apps/web/lib/invitations/activation.ts is an injected service for inspect and activate. Every dependency and an explicit enabled policy are required: token digest, rate limit, current accepted-learner eligibility, durable invitation ledger, managed Auth ownership recovery and idempotent enrollment. No default invitation lifetime, password strength rule, lease duration, rate quota, email confirmation or session/sign-in behavior is chosen. maxTokenBytes, maxPasswordBytes and claimLeaseMs must be explicitly configured; the password policy must accept the exact bytes. The service does not generate or send invitations.

Email, display name, accepted-admission identity and cohort come only from the private stored invitation. The application role is always learner. Input admits only token, requestId, password and confirmation; extra email, role, name, cohort or profile metadata is rejected. Request IDs must be UUIDs. No token/password is stored, returned or logged; only the injected digest crosses into the ledger/rate ports.

The ledger must perform atomic exclusive claims with expiry and revocation checks, expiring fenced leases and CAS phase transitions. The stable invitation ID is the managed-Auth operation reference. The service durably records auth_pending BEFORE the one possible begin call. An interruption or ambiguous response leaves that intent pending: a retry only invokes ownership-aware recovery, never blindly creates another account. A recovery result must identify the same operation, email and Auth UUID. Unrelated existing identities take the existing-account branch without enrollment, role upgrade, reactivation or deletion.

After an owned Auth identity is recorded, enrollment is retryable only through an idempotent exact-scope transaction. That adapter must revalidate accepted status, active cohort/domain access and ownership atomically, reuse the current prerequisite-preserving enrollment rules, and refuse inactive/conflicting records. Completion must check eligibility/revocation/expiry at its own atomic commit. Per-stage service rechecks supplement, not replace, these database boundaries. No success is inferred from a timeout or failed CAS. Replay of the same completed request returns the same activated status; a different request sees used. An uncertain release is handled by authoritative lease expiry/fencing.

## Prepared SQL, not a live backend

packages/db/migration-drafts/0013_invitations.DRAFT.sql is an unregistered private ledger table draft, guarded to an explicitly approved foundation_test database. It has no raw secret columns, principal creation, accepted-learner seed rows, runtime grants, issuance APIs, CAS functions or adapters. RLS is enabled/forced with no policies. It is deliberately unusable by current web/browser/service roles. SQL has NOT been executed or registered.

The accepted-admission ID is a reference to a future reviewed authority; no accepted-admission schema is invented here. Current app.users and membership tables are not an invitation acceptance registry. Do not reuse scripts/provision-user.ts for public activation: it uses migration authority on fixed port 54322 and can reactivate/change roles. The prepared isolated stack is proposed on 56521/56522/app3150 and remains separately approval-gated.

## Outstanding integration and policy

A real adapter must prove deterministic Auth ownership and safe reconciliation using supported Auth APIs. If it cannot distinguish absent from uncertain previous creation, leave recovery_required for an operator decision; do not retry creation merely because lookup returned no identity. No SQL application, live Auth calls, credentials, account creation or invitation delivery are implemented/tested.

Owner decisions remain: invitation lifetime and reissue/revocation owner; accepted-learner source; editable versus authoritative name; actual password and email-verification policy; completion destination/automatic sign-in; local link/email delivery. Existing public signup remains disabled. These decisions do not block the injected failure/recovery tests but do block enablement.

## Test scope

The owned test suite uses only in-memory injected ports and test-only explicit policy values. It covers missing dependencies, expiry/revocation, used/existing states, role/email tampering, password matching/policy rejection, repeat/concurrent requests, uncertain Auth recovery, interrupted enrollment and access removal. It is not SQL, Auth-provider or full-stack evidence. The root Vitest include list now includes the new invitation directory, so these regressions run in the normal source suite.
