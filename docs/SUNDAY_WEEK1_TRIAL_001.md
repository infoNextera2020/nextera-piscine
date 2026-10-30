# Sunday Week 1 local learner trial

Planning record, 2026-10-30. Target: one preconfigured learner flow on Anas's laptop Sunday, November 1. Saturday's complete rehearsal decides readiness; delivery is not guaranteed. Source preparation, fixture evidence and real authenticated verification must remain separate.

## Approved scope

- Private invitation and registration/login with ordinary learner permissions.
- Challenge upload, actual isolated evaluation, durable result/history and server progression.
- Checkpoint exam save/reload/conflict/recovery and honest access/time boundaries.
- Preconfigured three-member project team, actual submission/evaluation and assigned mentor review of the exact attempt.

Advanced automatic assignment, exam-exception administration and expanded admin dashboards are deferred. Existing authorization, grading and prerequisite rules are not waived. One human tester does not permit fictional teammate evidence, fabricated results or learner self-approval; additional synthetic team/mentor identities require an explicit setup scope.

## Approved Sunday invitation decision

Anas manually sends a private, email-bound, expiring, single-use invitation link to the test learner. Issuing that invitation is the acceptance decision. Successful registration joins the invitation's intended cohort; no second administrator confirmation is required after registration. Automated invitation-email delivery and full invitation management remain later work.

This decision does not authorize issuing a live token, creating credentials/accounts, sending messages, configuring an email provider or changing Auth settings now. It also does not select a numeric invitation lifetime, bypass email-verification policy, or permit public signup, role upgrades, email/cohort tampering or adoption of unrelated existing accounts.

## Existing source inspected

| Source                                                                           | Present contract                                                                                                                 | Sunday source gap                                                                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/invitations/activation.ts`                                         | Immutable email/cohort/learner scope, token digest lookup, expiry/revocation, fenced single-use activation, recovery, enrollment | Needs real configured ports and issuance-as-acceptance authority; source tests do not prove live activation                                                                  |
| `apps/web/lib/invitations/assembly.ts`                                           | Composes ledger, managed Auth, admission/enrollment and rate adapters with required policy                                       | No default client, password/confirmation policy, caller identity or operational configuration                                                                                |
| `apps/web/app/api/invitations/activate/route.ts`                                 | Uses `createInvitationAssembly(null)`                                                                                            | Currently returns 503; no live route enablement or inspection/UI transport verified                                                                                          |
| Drafts 0013/0016/0018                                                            | Digest-only ledger, exact operation/fence receipts, cohort enrollment and explicit rate/policy contracts                         | Unregistered/unexecuted; requires a genuine private locking `invitation_admission_current` authority hook; current contracts do not supply an issuer/accepted-learner writer |
| `apps/web/lib/invitations/managed-auth.ts` and private ledger/admission adapters | Deterministic Auth ownership, read-only recovery, exact cohort enrollment; no arbitrary identity adoption                        | Actual Auth provider, restricted client/permissions and concurrency/failure behavior remain integration-unverified                                                           |
| `apps/web/lib/invitations/README.md`                                             | Documents runtime-disabled state and explicit policy gates                                                                       | Sunday acceptance/delivery decisions above now resolve those product questions; implementation and remaining technical policies are still required                           |

## Smallest next invitation source slice

1. Implement a restricted issuer/acceptance contract that atomically records the owner's acceptance decision and immutable invitation scope. Supply the real private admission hook from that record; do not introduce a permissive acceptance stub or a second post-registration approval.
2. Store only a digest of a cryptographically generated bearer token, with explicit expiry, single-use/fenced state and email/cohort/learner binding. Prepare a protected one-time link handoff for Anas; no automated delivery is needed for Sunday. Do not invent renewal/reissue behavior.
3. Wire genuine invitation inspection and activation to the approved UI, preserving invalid/expired/used/existing-account/recovery states. Current HTTP rejects query-string capabilities: choose a link/transport that respects that boundary, such as a browser-held fragment sent in the POST body, without token logging/referrer/analytics exposure.
4. Keep the existing exact-scope enrollment transaction and initialize prerequisite-respecting learner progress only. Verify successful activation joins the intended cohort without any second admin confirmation or role upgrade.
5. Test wrong email/cohort claims, duplicate clicks, expiry/revocation, existing unrelated accounts, interrupted Auth creation, stale fences, cohort deactivation and uncertain enrollment recovery. Distinguish injected tests from real Auth/database assertions.

Before live setup, explicitly configure the invitation lifetime, current supported password policy, Auth email-verification behavior, required ingress/inspect/activate rate profiles, trusted caller/origin handling and post-completion login destination. Current activation takes no client-supplied email/name/cohort; the ledger owns displayName. Reconcile the approved signup name field with that existing contract before changing it. Manual delivery alone does not decide these policies.

## Approved stable student number and display boundary

Each student needs a unique, stable, human-readable student number, separate from the immutable internal User ID and stable across cohorts. STU-00127 is illustrative; its exact prefix, padding and allocation algorithm are not fixed by that example. Generation must be server-owned, persistent and enforced by database uniqueness, not derived from a name or reset for each cohort.

The learner sees their own student number only in account settings. Do not place it next to the learner name in the learner header, Home, Journey or peer-facing views. Authorized mentor/admin views show the number beside the student name. Authorized staff results, staff exports and eventual staff acceptance/rejection confirmations also identify email and cohort, so duplicate names cannot select the wrong person. Emails must not be exposed broadly to peers, and adding a number must not widen staff access.

Lookup may use the student number, but actual actions remain bound to immutable internal User ID and the relevant authorized cohort membership. A display label or client-supplied student number is not authorization. Server projections should enforce the learner/peer privacy boundary rather than merely hiding fields with CSS.

Read-only source inventory: registered 0000 app.users has UUID id as primary key and unique auth_user_id, with display_name, role and active state. It has no human student-number column; no student_number/studentNumber field was found in the inspected database schema and web library/component sources. Email is not a column of that initial app.users table, so authorized staff email must come from a trusted existing identity source, not a caller claim or an invented duplicate field.

The smallest trial slice is one globally persisted, uniquely constrained number for each preconfigured learner, correct own-settings and authorized staff projections, and tests for duplicate names, cross-cohort stability, lookup authorization and no peer/email leakage. Versioned schema/source preparation and any actual test-data assignment are separate work; no number, migration or runtime record is created by this note. Full admissions filtering, batch exports and acceptance/rejection management remain deferred; no acceptance/rejection decision is made here. This feature is excluded from the current native ACL rehearsal approval scope.

## Ordered readiness path

1. Fresh approval and actual verification of the reviewed native PostgreSQL prerequisite/ACL scope, with verified shutdown and retained evidence.
2. Complete the invitation source slice and selected Week 1 content/evaluation/test-pack bindings; confirm mixed exam answer handling without inventing unsupported grading or new UI.
3. Review one co-resident local Auth/Storage/DB/web/Runner setup and obtain its separate exact resource/credential/identity/time/cleanup approval. Do not reuse expired keys, roles or previous runtime approvals.
4. Issue only the explicitly approved trial invitation after setup approval; Anas sends the private link. Verify the whole ordinary-learner path, real wrong-then-correct execution/result and progression, authenticated exam persistence/recovery, and exact project/mentor outcome.
5. Rehearse the complete flow Saturday, including retry, reload, access removal and service failure. Record passed, failed and unrun checks, then make the Sunday readiness decision.

No live invitation, email, credential, provider configuration, database change or new runtime was created by this planning record.

## Manual invitation source update — 2026-10-30

The private owner-authorized issuer, locked acceptance hook, pinned cohort/version policy,
digest-only atomic repository and disabled issuance HTTP route are now prepared in source.
See docs/MANUAL_INVITATION_SOURCE_001.md for exact implemented files, limits and next gates.
The former missing issuer/authority source gap is addressed; no invitation SQL, live provider,
account, token, email or browser registration has been executed or enabled. Fresh SQL/provider
verification and explicit settings remain required. Stable global student number remains a
separate user-identity step with the previously approved private display rules.
