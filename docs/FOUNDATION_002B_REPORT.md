# Foundation Commit 002B — Curriculum Publication & Cohort Enrollment

## A. Implemented behavior

Committed Git curriculum is validated and hashed independently of the web app.
Controlled scripts import draft receipts, publish resolved immutable projections,
create/pin cohorts, and transactionally enroll active domain learners. `/app`
lists authorized real cohorts; cohort/subject pages read PostgreSQL projections.
Shared UI and Runner directories remain empty. No submissions, uploads, Judge
execution, queue functions, or result-driven mastery are implemented.

**Real curriculum publication remains gated, as explicitly confirmed by the user.**
`nextera-piscine@0.1.0` has one validated draft receipt, no node projection, and no
cohort. No approved evaluation catalog exists. Positive publication/enrollment
tests use isolated, explicitly non-runnable test fixtures; these are not an
approved catalog or evidence that real Judge artifacts exist.

## B. Curriculum model and digest strategy

`packages/domain/curriculum.ts` contains framework-independent types, DAG/root
detection, AND prerequisite semantics, initialization, and visibility policy.
Node kinds are challenge/project/checkpoint. Roots are exactly the zero-incoming
nodes, sorted by key; positions never implicitly define roots. Non-roots require
valid incoming `requires_pass` edges. Missing prerequisite states do not pass.

The Node-only loader under `scripts/curriculum/` resolves a Git commit and reads
regular blobs using `git ls-tree`/`cat-file`. It reads committed bytes, including
original newlines/BOMs, rather than working-tree files. Routes import no loader,
filesystem code, or authoring YAML. Unknown files/fields, duplicate IDs/positions
or YAML keys, invalid references/kinds/rules, missing subjects, unsafe submission
allowlists, self-edges, aliases, and cycles fail explicitly. Node/quest IDs are
unique within their respective namespaces; positions are unique per quest for
nodes and per curriculum for quests, matching the accepted schema.

Content digest format **1**:

1. SHA-256 begins with UTF-8 `nextera-curriculum\0v1\0`.
2. Sort repository-relative POSIX paths by their UTF-8 byte values.
3. For each file append unsigned 32-bit big-endian path-byte length, path bytes,
   unsigned 64-bit big-endian file-byte length, then exact Git blob bytes.
4. Return lowercase hexadecimal SHA-256. Every referenced manifest/YAML/subject
   participates; duplicates and unreferenced files are rejected.

Subjects and challenge configuration separately use SHA-256 of exact bytes.
Resolved evaluation digests hash UTF-8 `nextera-evaluation-spec\0v1\0` followed
by canonical JSON: recursively sorted object keys, preserved array order, JSON
scalar encoding, finite numbers only. This is an explicit versioned format,
not a claim to implement a separate canonical-JSON standard.

Current committed content digest:
`d9c3598aecc28518891c3ad7bd63ba3c15287568cb34734e28601e889fec2593`.

New exact dependencies: **yaml 2.9.1** for strict metadata parsing and
**react-markdown 10.1.0** for subjects, with raw HTML skipped. Existing
Drizzle 0.45.4 is also declared at root for operational/test adapters. The pinned
Node/pnpm/Next.js toolchain is unchanged; no UI library was introduced.
API references: [yaml](https://eemeli.org/yaml/) and
[react-markdown](https://github.com/remarkjs/react-markdown).

## C. Publication behavior

`curriculum:validate` needs Git only. `curriculum:import` creates an idempotent
draft source receipt in `app.curriculum_versions`, without quests/nodes/edges.
This preserves the accepted non-null resolved-spec/resource constraints; it does
not represent incomplete nodes as valid projections. Changed content under an
existing receipt is rejected. Identical content retains the first source commit.

`curriculum:publish --catalog <protected-json>` requires approved metadata for
every referenced test pack. It atomically inserts quests/nodes/edges and marks
the version published. An advisory lock and version-row lock serialize competing
imports. Identical version/content/evaluation identities return the existing
publication. Changed bytes or resolved evaluation identity require a new version.

Migration 0002 locks parent versions on child writes and rejects INSERT/UPDATE/
DELETE against published projections, including the version itself. Publication
also checks nonempty projections, a DAG, complete matching evaluation identities,
and the existing resource constraints. No earlier migration is rewritten.

## D. Cohort and enrollment implementation

CLI commands: `cohort:create`, `cohort:list`, `cohort:pin`, `cohort:enroll`.
Create/pin requires a published version. A cohort cannot change version after
any membership exists, including inactive memberships. Membership writes and
pinning serialize on the cohort row; SQL triggers protect ordinary direct DML.

Enrollment requires an existing active domain learner and an active cohort.
One transaction creates membership plus every progress row. Roots are available
with `unlocked_at = joined_at`; non-roots are locked with every progression
timestamp/evidence field null. Duplicate/concurrent enrollment preserves rows
and timestamps. Inactive memberships and incomplete existing progress require
explicit review; the operation neither reactivates nor silently repairs them.
Tests force an actual progress INSERT failure and prove membership rollback.

For the two-node fixture: Hello Go is AVAILABLE and Even or Odd is LOCKED.
Reading a subject never starts progress. Cohort start dates are informational
in 002B; active membership controls access. There is no automatic enrollment.

## E. Authorization and database grants

`requireCohortAccess` verifies the active domain user and cohort scope. Queries
repeat the scope predicates; hidden links are not an authorization boundary.
Learners/operators need active membership in an active cohort. Operators have no
implicit global cohort access. Active admins have explicit read-only global
preview access to published cohort curricula. Operator membership assignment
remains a controlled administrative database action; learner enrollment rejects
operator/admin roles.

Locked learner subjects return 404 even via direct URLs. Available/in_progress/
mastered subjects expose published Markdown and file requirements. Assigned
operators/admins may preview all subjects in their authorized cohorts, visibly
labeled, without invented learner progress. The map query never reads subjects.
The subject query enforces membership/state itself. No submission form exists.

Migration `0002_curriculum_enrollment.sql` adds column-level SELECT grants on
cohorts, memberships, versions, quests, nodes, prerequisites, and progress. Exact
columns are listed in `packages/db/README.md` and the migration. Existing five
user-resolution grants remain. No web writes, evaluation-spec reads, submission/
Judge reads, or new function EXECUTE grants are added. Four SECURITY INVOKER
trigger functions enforce cross-row invariants; none is a Judge protocol function.
The sixteen-table model, columns, indexes, checks, and Supabase-owned schemas
remain unchanged. A custom snapshot records no table changes.

`OPERATIONS_DATABASE_URL` is exclusively for controlled tooling, separate from
`DATABASE_URL`. Local setup uses the disposable migration owner for operations;
hosted operational access must be explicitly provisioned. Web never receives the
operational/migration/service-role variables; browser schemas remain unexposed.
Server adapters enforce user row scope; direct SQL does not inherit Auth JWT RLS.

## F. Tests and verification

Results are recorded from Ubuntu with Node 24.19.0 / pnpm 11.22.0. Native database
integration uses new disposable `foundation_test002b` on PostgreSQL 16. Real
Supabase verification uses managed PostgreSQL 17, Auth, restricted runtime login,
the production Next.js build, and Chromium on D:.

| Command/check                             | Result                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`          | Passed                                                                                                  |
| `pnpm peers check`                        | Passed                                                                                                  |
| `pnpm format:check`                       | Passed                                                                                                  |
| `pnpm lint`                               | Passed                                                                                                  |
| `pnpm typecheck`                          | Passed                                                                                                  |
| `pnpm test`                               | Passed: 51 tests                                                                                        |
| `pnpm test:curriculum`                    | Passed: 25 parser/digest/catalog tests, also included in normal unit tests                              |
| `pnpm curriculum:validate`                | Passed: committed two-node curriculum and deterministic root                                            |
| `TEST_DATABASE_URL=… pnpm test:db`        | Passed: 57 tests, including 19 new publication/enrollment cases                                         |
| `pnpm build`                              | Passed: independent domain/database compilation and production Next.js routes                           |
| `pnpm db:generate`                        | Passed: no schema drift or extra migration                                                              |
| `pnpm db:migrate` on real Supabase, twice | Passed; three history entries, repeat made no changes                                                   |
| `pnpm curriculum:import`, twice           | Passed; same real draft receipt, zero real projected nodes                                              |
| `pnpm curriculum:publish` without catalog | Expected refusal: `PUBLICATION_BLOCKED`, exit 1                                                         |
| Cohort creation against the real draft    | Expected refusal; zero real cohorts created                                                             |
| `pnpm test:auth --max-failures=1`         | Passed: all 13 real Auth regression tests                                                               |
| `pnpm test:cohorts --max-failures=1`      | Passed: all 7 real browser cohort/subject tests                                                         |
| Local data audit                          | Real version remains draft; zero real nodes/cohorts; zero Judge jobs; temporary browser cohorts removed |
| `git diff --check`                        | Passed after LF metadata normalization                                                                  |
| `git diff --stat`                         | 22 tracked files: 939 insertions, 52 deletions; 21 additional new files remain untracked                |

The final combined production browser run passed all **20 tests in 45.7 seconds**.
Source inspection also passed: 14 JSON files have unique keys; no private runtime,
migration, operational, or service-role credential appears in the 12 client build
files; accepted files and the Git index are unchanged; UI/Runner remain empty.

New tests cover DAG/root/AND behavior; duplicate/missing/invalid content; exact-byte
and ordering digests; unresolved/mutable/unsafe catalog metadata; draft/publication
idempotency and version conflicts; published immutability; pinning/concurrent
enrollment; atomic rollback; inactive/partial enrollment; read grants/write denial;
own/foreign/inactive membership access; explicit operator/admin previews; subject
denial; and persistence across refresh. Existing constraint/Auth coverage remains.

Browser fixtures use test-only curriculum keys and explicitly NON-RUNNABLE
metadata, not an approved catalog. Personal/cohort fixtures are cleaned up.
Immutable test curriculum rows remain in the local development database by design.
They never replace or publish `nextera-piscine@0.1.0` and create no Judge work.

Earlier verification issues: Ubuntu stopped accepting commands (`0x8007274c`);
the user-approved Ubuntu-only restart restored it. The interrupted dependency
install was rerun successfully. A negative metadata test needed a deliberately
wide `unknown` input type; its initial TypeScript error was fixed. Windows-written
migration metadata had CRLF whitespace; it was normalized to LF. Automatic review
rejected stopping an old search by PID because of possible PID reuse; that action
was not executed and did not block implementation. No other host storage move or
Docker reset was performed in 002B.

## G. CI

Normal checks retain frozen install, format, lint, typecheck, tests, and build;
they now also validate committed curriculum. New parser/domain tests run in the
normal unit suite. The separate PostgreSQL job discovers the new integration
suite. The existing local Supabase identity job retains the 13 Auth regressions
and additionally runs `test:cohorts`. Administrative environment variables are
cleared from its web server. No deployment automation was added. GitHub-hosted
execution itself remains unverified until the workflow runs there.

## H. Unresolved evaluation-publication boundary

The user confirmed that no approved catalog exists and publication must stay gated.
Both real test packs (`hello-go-v1`, `even-or-odd-v1`) need protected Judge-build
metadata. The publisher accepts JSON with `format_version: 1` and a `test_packs`
map keyed by those IDs. Each entry must contain:

- `test_pack_digest`, and matching immutable `oci://…@sha256:…` artifact reference
  in `test_pack_artifact`;
- distinct `runner_image_digest` and `sandbox_image_digest` SHA-256 identities;
- exact `toolchain_version` (`goX.Y.Z`), `target_platform`, trusted `build_flags`,
  and explicit `dependency_policy: offline`;
- versioned `resource_profile` and complete `resource_limits.compilation` and
  `.execution`, each containing positive CPU, memory bytes, PID, timeout, output
  bytes, temporary-filesystem bytes, and inode limits;
- `protocol_version`, `snapshot_format_version`, and explicit `case_generation`:
  static, or generated with pinned seed and generator version.

Execution timeout/memory/output must match the committed challenge limits.
Unknown fields, duplicate JSON keys, mutable images, and incomplete metadata
are rejected. No defaults supply missing trusted identities. Catalog approval,
artifact provenance/availability, protected build ownership, and retention are
responsibilities of the trusted Judge artifact pipeline; format validation alone
does not prove those properties. Publisher never fetches private images/tests.

The resolved spec binds content/subject/configuration/node/version identities.
The eventual job combines its stored published UUID/Git commit with the learner's
actual artifact identity; none is fabricated ahead of a submission. Hidden tests
remain exclusively in trusted Judge artifacts/images, never YAML/Markdown,
projection payloads, browser responses, or learner feedback. No real cohort is
created now; approval of the metadata is the remaining publication prerequisite.

## I. Deviations and risks

No accepted architecture document or earlier migration was changed. Draft receipts
are the explicitly authorized decision for the missing evaluation boundary,
preserving existing non-null constraints. No new product table was introduced.
Operational credentials are privileged; hosted provisioning must keep them out
of the web. These DML guards do not defend against a database owner deliberately
disabling triggers or rewriting schemas. Cohort row locks serialize controlled
enrollment/pinning, which is appropriate for the pilot's administrative workflow.

The pre-existing Docker Desktop all-interface port-binding limitation still
applies; stop local Supabase after verification on this machine. Jupyter stays
stopped as previously requested; original Go/MySQL services are preserved.
Production enrollment/publication must wait for real approved artifacts; test
fixtures must never be promoted into a trusted catalog.

## J. Resulting tree

```text
apps/web/
  app/app/page.tsx
  app/app/cohorts/[cohortId]/page.tsx
  app/app/cohorts/[cohortId]/challenges/[nodeKey]/page.tsx
  lib/auth/{README.md,server.ts}
  lib/cohorts/server.ts
  package.json
packages/domain/
  access.ts
  curriculum.ts
  index.ts
  tsconfig.json
  tests/curriculum.test.ts
packages/db/
  operations/{curriculum.ts,cohorts.ts}
  queries/cohorts.ts
  migrations/0002_curriculum_enrollment.sql
  migrations/meta/{0002_snapshot.json,_journal.json}
  tests/integration/{access.test.ts,constraints.test.ts,curriculum-enrollment.test.ts}
  README.md
  package.json
  tsconfig.json
scripts/
  curriculum.ts
  curriculum/{load.ts,digest.ts,evaluation.ts,tests/curriculum.test.ts}
  cohort.ts
  operations.ts
  local-env.ts
tests/
  fixtures/curriculum.ts
  e2e/{identity-access.spec.ts,cohort-enrollment.spec.ts}
.github/workflows/checks.yml
.env.example
README.md
package.json
pnpm-lock.yaml
playwright.config.ts
vitest.config.ts
docs/FOUNDATION_002B_REPORT.md
packages/ui/{tokens,primitives}/   (empty)
apps/runner/                      (empty)
```

Existing unrelated source, curriculum, and accepted architecture remain in place.
No files have been staged or committed.

## K. Suggested commit message

```text
feat: add gated curriculum publication and transactional cohort enrollment
```
