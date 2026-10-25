# Disposable Raid rehearsal — prepared, not started

This is code-only preparation. No service, database, account, key, token or role
has been created by this change. The SQL catalog probe has not been run against
a live database. Real mentor downloads through Supabase Storage remain unverified.

## Why a separate instance is needed

The previous native `foundation_test_vertical_20261025` product database on port
55439 is separate from the retained Supabase Auth/Storage database. Having Raid
functions in the product database does not install their policies in Storage's
database. Migration 0010 deliberately skips its Storage installation when that
schema is absent. A second database beside retained Supabase is insufficient:
Auth, Storage, application tables and policies must use the same database.

The local test pack guard in migration 0003 still requires a database named
`foundation_test%`, a `foundation-test-only` curriculum and an explicitly test-only
pack. Do not weaken it or publish candidate content to make a rehearsal pass.

## Prepared target and non-executing check

`plan.json` reserves an independent Compose project `nextera-raid-rehearsal`:

| Item                 | Prepared value                                 |
| -------------------- | ---------------------------------------------- |
| Database             | `foundation_test_raid_rehearsal_20261025`      |
| Database host port   | `127.0.0.1:56522`                              |
| Auth/Storage API     | `http://127.0.0.1:56521`                       |
| Application          | `http://127.0.0.1:3150`                        |
| Test identities      | Three learners, one assigned mentor, one owner |
| Worker token maximum | One hour                                       |

From the repository, this command reads templates and runs pure validation only:

```sh
pnpm raid:preflight --check-config
```

It does not load root `.env`, connect to Docker/Postgres, fetch images, generate
credentials or run migrations. Its output always distinguishes prepared
configuration from rendered Compose and live Storage evidence.

## Future preparation, only after execution approval

1. Review the pinned official [Supabase self-hosted v0.8.3 Docker bundle](https://github.com/supabase/supabase/tree/self-hosted/v0.8.3/docker)
   in a **fresh private directory outside this checkout**, with owner-only access.
   Record the upstream commit and image digests. Do not execute `setup.sh`: that
   convenience script can install software and generate credentials. No upstream
   bundle or executable has been installed by this preparation.
2. Use that directory's own fresh bind mounts, project-scoped volumes and network.
   Never point them at retained data or attach the retained Supabase network.
   Layer `compose.rehearsal.override.yml` explicitly over the reviewed base file.
   All fixed container names are replaced. Gateway/DB are loopback-only; inherited
   pooler ports are cleared. The [Docker `!override` merge tag](https://docs.docker.com/reference/compose-file/merge/)
   requires Compose 2.24.4 or newer. The static tests do not simulate Docker's
   merge. No Docker daemon or Compose command was run for this change.
3. Only under a fresh credential approval, complete a private upstream environment
   file using reviewed non-secret defaults and **new** secrets. This repository's
   `environment.example` intentionally leaves all private values empty. Never use
   upstream example JWTs, retained root `.env`, or previously disabled test roles.
   The override refuses startup without a password/JWT secret. Other upstream
   required private values must also be populated before a later startup.
4. Review the effective configuration privately using Compose's `config --quiet`
   validation, and a private rendered file if necessary. Do not print expanded
   secrets in a task log. Verify only the reserved loopback ports, independent
   mounts/network and correct DB name for Auth, Storage, REST and the app.
   This preparation has **not** rendered the official merged configuration.
5. `raid-jwt.sql` replaces the upstream JWT setting script at its existing mount
   target. It names the selected fixture database rather than `postgres`. It is
   source for a later isolated bootstrap only; it has not been executed. Managed
   bootstrap against this non-default database is not yet verified. Stop if real
   `auth.users`/`auth.identities`, `auth.uid()`/`auth.jwt()`, and RLS-enabled
   `storage.objects`/`storage.buckets` are absent. Do not substitute protocol-test
   stubs or move to the retained/default database.

## Readiness and migration sequence after approval

The web process must explicitly set `RAID_STORAGE_DATABASE_NAME`,
`RAID_STORAGE_API_URL`, and `NEXT_PUBLIC_SUPABASE_URL` to the prepared target. Its
existing database connection must point to that same database. These variables
are an operator configuration binding, not independent proof of where a remote
Storage API connects. Review the managed service DSNs and then prove a real
authenticated request. Never report `liveStorageVerified` from catalog checks.

For an approved read-only catalog inspection, the separate optional command is:

```sh
pnpm raid:preflight --database
```

It requires an explicit private `RAID_PREFLIGHT_DATABASE_URL` with exactly the
reserved host, port and database. It ignores root `.env` and rejects retained
targets. It uses a read-only transaction and timeouts. Before application
migrations it should report missing Raid capabilities; after an approved full
migration chain through 0010 it must report every capability present. Failed or
missing probes keep team intake, assignment, review and downloads unavailable.
This command has **not** been run during code-only preparation.

Do not run bare `pnpm db:migrate`: the existing migrator reads retained root
`.env`, whose default target can be `54322/postgres`. A separately approved
application migration must use an explicitly verified fresh fixture DSN and all
prerequisite migrations, reviewed privileges and current migration ledger. No
migration application is authorized by this README or the configuration check.

## Rehearsal still to be implemented and executed under approval

The old native-database helper is not reusable unchanged: it hardcodes the old
database and manually inserts an `auth.users` stub after managed Auth creation.
In the co-resident instance, create test identities only via managed Auth, then
use their actual IDs in the existing application provisioning operations. The
three-member harness, current-session mentor download and fixture cleanup need a
bounded implementation/review before live execution. This preparation is not a
completed provisioning or rehearsal script.

Use an explicitly test-only project and a verified runnable local test pack, such
as a documented HelloGo-derived fixture if compatible. Do not call that fixture
approved Quad/Sudoku curriculum. Keep production/candidate publication disabled.

Required evidence:

- Wrong artifact yields durable automated failure and no shared awards.
- A corrected new immutable attempt gets a real Runner PASS, still without mastery.
- Assigned mentor downloads the exact accepted file using their current Auth JWT;
  size/digest match. Nonmembers/unassigned reviewers cannot download or approve.
- Assigned mentor approves that exact attempt; one outcome and exactly three
  per-member receipts persist, with each learner's own downstream prerequisites.
- Replay/lost response does not duplicate effects; a revision requires new checks
  and review; access removal blocks approval and flags the owner hold.
- Browser refresh shows the durable shared result. Distinguish browser evidence,
  API/Runner evidence and SQL contract evidence in the report.

## Cleanup and rollback boundary

After a future approved run, stop only this instance's app/worker/Compose project.
Disable the five test Auth identities, application LOGIN roles and worker access;
track expiry and remove protected token files as applicable. Existing JWTs can
remain cryptographically valid until expiry: do not claim immediate revocation
unless the actual mechanism is tested. The worker token must last at most one
hour. Preserve non-secret results and private evidence with appropriate access.

The new stack is disposable; avoid shared/retained volumes and any destructive
retained-database rollback. There are no down migrations for shared outcomes and
their per-member evidence. Do not drop that evidence or substitute the uploader's
submission for teammates. A failure must leave the independent instance stopped
and its access disabled; retaining protected evidence is acceptable.

**Remaining approval:** one explicitly bounded isolated service/bootstrap and
application-migration run, new private instance keys plus restricted test roles,
five test Auth identities and short-lived worker/application tokens, real
Runner/Storage/browser rehearsal, and its cleanup. None of those actions is
authorized by the completed code-only work. No production data, real learner
award, candidate catalog publication, Quest 11/12 approval, push or deployment.
