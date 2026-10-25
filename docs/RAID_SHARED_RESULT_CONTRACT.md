# Shared Raid workflow — local implementation

Approved owner rules: exactly three learners; the owner assigns the team and its
mentor; any active teammate may upload; accepted upload freezes the recipients;
automated PASS precedes assigned-mentor approval of that exact immutable attempt;
a revision needs fresh checks and review; one shared completion has one receipt
per frozen member, while each learner's other prerequisites still govern unlocks.
Access removal before approval creates a sticky owner-decision hold. There is no
automatic award, exclusion, override, or hold-resolution policy.

## Installation boundary

The source contains migrations `0008_raid_domain`, `0009_raid_operations`, and
`0010_raid_artifact_read`. They are **not applied to the retained local application
database or production** by this work. Deployment/migration application, real team
assignments, fresh live test access, and curriculum publication remain separate
gates. No new dependency or login credential is required by the feature code.

Missing migrations keep project intake unavailable, owner assignment hidden and
project briefs read-only. Ordinary challenge/checkpoint result reconciliation
checks for the optional Raid registrar before using its unchanged ordinary path.
An unlinked project PASS still fails the existing `UNSUPPORTED_MASTERY_KIND` guard.

## Stored identities and authority

- Immutable team assignments are made only by an active domain `admin` (the pilot
  owner surface), with an explicit active operator/admin mentor. The owner UI uses
  existing provisioned domain IDs; it does not create people or grant roles.
- `raid_attempts` links one genuine uploader-owned submission/artifact/job to an
  immutable definition digest and three frozen `raid_attempt_members`. Old teams
  are retired on owner reassignment; accepted recipients are never rewritten.
- `raid_automated_receipts` records the authoritative terminal Judge result through
  the trusted result-application connection. It never awards mastery.
- `raid_reviews` records one append-only exact-attempt decision, actor, request
  identity, timestamp and feedback. Only the currently assigned active mentor can
  decide; no self-review, admin override, browser-selected recipients or Runner
  approval. Requested changes require a new upload for another review.
- Approval, `raid_outcomes`, three `raid_member_receipts`, progress and activity
  effects commit atomically or roll back. Team locks serialize revisions/reviews;
  member advisory keys are acquired in UUID order. Duplicate request/approval and
  lost acknowledgement converge to the same durable receipts.
- Progress uses `first_passing_raid_outcome_id`, whose FK includes the actual
  recipient/cohort/version/node. It extends the exactly-one-evidence constraint;
  it never copies the uploader's individual submission evidence to teammates.
  Existing first mastery is retained, and later failure cannot regress it.
- Access-removal triggers freeze an owner hold even if access is later restored.
  Current reads and actions remain subject to current access. The owner queue
  retains holds for retired teams/inactive cohorts; no implicit resolution exists.

## Connected surfaces

- Existing project node destination:
  `/app/cohorts/<cohort>/challenges/<project>`: authorized brief, current team,
  existing local-editor/raw-file upload, frozen history and separate check/review
  status. No hardcoded project titles, curriculum, outcomes or unlocks.
- `/operator/raids`: assigned mentor queue and admin-only owner assignment form.
  Team links preserve `?team=<id>` for exact review selection.
- `/api/raids`: private uncached GET; bounded same-origin authenticated POST for
  owner assignment or exact-attempt mentor decision. SQL rechecks all authority.
- `/api/raids/artifact?attempt=<id>`: exact accepted-file download for its assigned
  mentor after checks pass. Existing Auth session, digest/size verification,
  attachment-only response. Submitted code is never executed/rendered by the UI.
- Migration `0010` adds only that exact-object mentor read to the existing Storage
  guards. It leaves owner/worker reads and no-overwrite/no-delete boundaries in
  place. Hidden packs, private Judge payloads and credentials are not exposed.

## Reproducible isolated database verification

`pnpm test:raids` uses the already installed PostgreSQL 16 and Python 3 on Linux.
It never installs software, reads `.env`, connects to a retained database, provisions
application LOGIN roles/passwords/tokens, or exposes TCP. It creates an isolated
`foundation_test_raid_ephemeral` cluster under an OS-private temporary directory,
uses only a private Unix socket, runs the selected transaction tests and removes
the cluster after shutdown. Permission roles and synthetic fixture users exist
only inside that disposable cluster. The initdb bootstrap identity is confined to
that private socket and disappears with the cluster; no application credential is
issued. No real learner receives a result.

These tests use synthetic Judge protocol outcomes with a deliberately NON-RUNNABLE
test pack. They prove database state/authorization/idempotency, not actual Runner
execution or an authenticated Supabase browser rehearsal. The Storage fixture
models policy behavior; a real Supabase API check remains a separate gate.

Requested test coverage: exactly-three eligibility; any teammate upload; frozen
roster and revision identity; unassigned/nonmember/self-review denial; automatic
PASS grants nothing; one outcome/three receipts; distinct personal prerequisites;
independent concurrent review sessions; discarded response/replay; mid-fan-out
rollback/retry; member/cohort deactivation and reactivation; retired-team history;
exact-source RLS; direct web/Runner evidence-write denial; unchanged ordinary guard.

## Remaining gates

Run the final expanded isolated suite only in its approved execution scope, review
all three migrations and privileges, and obtain explicit local application-migration
approval before enabling the feature against retained services. A live authenticated
three-member upload → real Runner → mentor download/review → durable shared result
rehearsal needs fresh approved access and an authored runnable project/test pack.
No candidate catalog or Quest 11/12 content is approved by this implementation.
