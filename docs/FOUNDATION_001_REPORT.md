# Foundation Commit 001 — Implementation Report

## A. Implemented

- Private pnpm workspace containing web, domain, and database packages, pinned
  Node/pnpm, one lockfile, strict TypeScript, ESLint flat configuration, and Prettier.
- Minimal Next.js App Router/Tailwind shell identifying NextEra Piscine, Vertical
  Slice 001, and Foundation online. Uncached server-side GET /api/health reports
  liveness without database access, credentials, or runtime configuration.
- Framework-independent state/role tuples and TypeScript unions. Domain runtime
  dependencies remain empty; lint restricts prohibited framework/infrastructure imports.
- All approved PostgreSQL tables, enum restrictions, keys, checks, and indexes;
  separate server-only runtime connection and migration connection.
- First reviewed migration plus reproducible generation and standalone migration CLI.
- Authentication boundary documentation and the real external Auth foreign key;
  no login adapter, fake identity, user seed, or protected product workflow.
- Updated setup/commands in the root README. Accepted architecture/product
  documents and curriculum are unchanged.

No Runner, sandbox, queue processor, curriculum publisher, submission endpoint,
progression service, dashboard, or final UI was implemented. Shared UI folders
and the Go Runner directories remain empty. No git commit or staging was performed.

## B. Exact selected versions

| Dependency / tool                  | Version          |
| ---------------------------------- | ---------------- |
| Node.js                            | 24.19.0          |
| pnpm                               | 11.22.0          |
| next                               | 16.4.2           |
| react / react-dom                  | 19.3.1 / 19.3.1  |
| tailwindcss / @tailwindcss/postcss | 4.3.3 / 4.3.3    |
| typescript                         | 5.9.3            |
| drizzle-orm / drizzle-kit          | 0.45.4 / 0.31.11 |
| postgres                           | 3.4.9            |
| server-only                        | 0.0.1            |
| eslint / @eslint/js                | 10.13.0 / 10.0.1 |
| @next/eslint-plugin-next           | 16.4.2           |
| typescript-eslint                  | 8.71.2           |
| prettier                           | 3.9.10           |
| vitest                             | 5.0.5            |
| tsx                                | 4.23.15          |
| dotenv                             | 18.0.8           |
| @types/node                        | 24.19.2          |
| @types/react / @types/react-dom    | 19.3.0 / 19.3.0  |

Internal packages use workspace:* and private version 0.0.0. All registry
dependencies are exact pins; transitive versions/integrity are in pnpm-lock.yaml.
No Supabase SDK, Radix, Motion, shadcn, or component library was installed.

## C. Schema and migration review

The migrated model has 12 app tables and four judge tables, six enums, 16 primary
keys, 18 unique constraints, 36 foreign keys, 54 CHECK constraints, and five
partial indexes. There are no speculative JSONB indexes or protocol functions.

The four progress states enforce their complete timestamp/evidence nullability
matrix and chronological ordering. Composite references enforce version scope,
membership, artifact ownership, matching job/attempt/result context, and the
learner/cohort/version/node context of first-passing evidence. Retry counts are
bounded to 0..2 and infrastructure attempt numbers to 1..3.

`packages/db/migrations/0000_foundation_001.sql` was generated with Drizzle Kit,
reviewed against DATABASE_SCHEMA_v0.1.md, and applied to PostgreSQL 16.15. The
generated snapshot/journal are committed migration artifacts, not a database-push
workflow. Repeated migration application preserves one history entry.

Reviewed SQL additions defer the required active-job foreign key until commit
and revoke PUBLIC schema/table privileges. No nullable escape was added to the
required submission/job relationship. Auth remains an external Supabase table;
the standard Drizzle bookkeeping table is not an additional domain entity.

Cross-row authority, immutable historical updates, legal transitions, monotonic
leases, narrow runtime grants, safe feedback construction, and result application
are explicitly deferred in packages/db/README.md to the appropriate protocol,
authorization, publication, and progression milestones.

## D. Tests

- Six fast tests: exact persisted state vocabulary, distinct Judge states,
  sixteen schema exports, progress evidence/check structure, literal CHECK SQL,
  and the health response contract.
- Twenty-six PostgreSQL integration cases: fresh/repeated migration, valid and
  invalid progress states/timestamps, unknown state rejection, cross-node evidence,
  cross-version progress, external identity FK, prerequisite integrity, active-job
  uniqueness, retry/generation/protocol/resource bounds, incomplete leases,
  fourth-attempt rejection, receipt/measurement checks, and orphan-commit rejection.
- Real production and development HTTP smoke checks: root content, generated
  Tailwind utility CSS, HTTP 200, exact health JSON, and no-store caching.

Database integration uses an isolated local test cluster with a minimal external
auth.users(id) fixture and random records. This tests the PostgreSQL identity FK,
not Supabase authentication or sessions. No existing database service was changed.

## E. Commands and outcomes

Commands ran from the repository root in Ubuntu with Node 24.19.0 and pnpm
11.22.0. Temporary tool/runtime/cache paths are ignored workspace artifacts.

| Command / check                                                   | Final result                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Required repository-document reads and repository inventory       | Passed before implementation                                                   |
| Official package metadata/peer compatibility inspection           | Passed; final dependency selection recorded above                              |
| Node download SHA-256 verification                                | Passed                                                                         |
| pnpm install                                                      | Passed after setup corrections listed below                                    |
| pnpm install --frozen-lockfile                                    | Passed                                                                         |
| pnpm peers check                                                  | Passed; no peer dependency issues                                              |
| pnpm --filter @nextera/domain build                               | Passed independently of Next.js/database access                                |
| pnpm --filter @nextera/db build                                   | Passed independently of Next.js/database access                                |
| pnpm format                                                       | Passed                                                                         |
| pnpm format:check                                                 | Passed                                                                         |
| pnpm lint                                                         | Passed                                                                         |
| pnpm typecheck                                                    | Passed, including tests                                                        |
| pnpm test                                                         | Passed: 6 tests                                                                |
| TEST_DATABASE_URL=<isolated-local-test-db> pnpm test:db           | Passed: 26 PostgreSQL tests                                                    |
| pnpm build                                                        | Passed: independent package compilation and Next.js production build           |
| pnpm db:generate                                                  | Passed; final repeat reports no schema changes                                 |
| MIGRATION_DATABASE_URL=<isolated-local-test-db> pnpm db:migrate   | Passed; committed migration history reapplied safely                           |
| pnpm --filter @nextera/web start --hostname 127.0.0.1 --port 3117 | Passed startup and production HTTP checks; intentionally stopped               |
| pnpm dev --hostname 127.0.0.1 --port 3118                         | Passed root command/startup and development HTTP checks; intentionally stopped |
| python3 .tools/http_smoke.py http://127.0.0.1:3117                | Passed production smoke                                                        |
| python3 .tools/http_smoke.py http://127.0.0.1:3118                | Passed development smoke                                                       |
| PostgreSQL catalog audit                                          | Passed: counts above, deferred FK confirmed, zero protocol functions           |
| git diff --check                                                  | Passed                                                                         |
| git diff --exit-code -- docs/architecture docs/product content    | Passed: approved documents and curriculum unchanged                            |
| Empty shared UI / Runner directory checks                         | Passed                                                                         |

### Earlier failed or corrected attempts

| Attempt                                                           | Outcome and resolution                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial sandboxed WSL command                                     | Wsl/E_ACCESSDENIED; authorized elevated workspace execution succeeded                                                                                     |
| pnpm under Ubuntu's default Node 18.19.1                          | Failed minimum Node requirement; used verified workspace-local Node 24.19.0                                                                               |
| First pnpm install --store-dir .pnpm-store                        | Installation stopped for unapproved unrs-resolver build; final supported lint setup removed that dependency                                               |
| Early package-build commands                                      | pnpm tried to reinstall with a different store setting and aborted without a TTY; explicit workspace storeDir fixed the configuration                     |
| pnpm install / early build retries with duplicate allowBuilds key | Failed YAML parsing after pnpm generated an approval placeholder; placeholder removed                                                                     |
| pnpm peers check with eslint-config-next and ESLint 10            | Reported unsupported React/import/accessibility plugin peers; switched to the official Next plugin plus compatible TypeScript ESLint, retaining ESLint 10 |
| Initial generated migration review                                | Resource checks contained bind placeholders; fixed literal serialization and regenerated before any application                                           |
| Generation after resetting provisional metadata                   | Drizzle printed missing _journal.json despite an outer zero exit; treated as failure and regenerated its empty metadata directory correctly               |
| Windows-to-WSL nested file creation / package-store inspections   | Editor/path errors; created required directories in Ubuntu and verified actual files; no implementation remained partial                                  |
| README patch with stale formatting context                        | Rejected without changes; retried against the current paragraph successfully                                                                              |

No final test, lint, type, build, migration, or HTTP verification remains failing.
Server-stop interruptions are intentional cleanup, not test failures. Drizzle
Kit still reports two deprecated transitive esbuild-kit dependencies; stable
Drizzle versions were retained rather than adopting release candidates.

### Git diff statistics

Ordinary git diff --stat shows the tracked README change; new source/configuration
files are untracked because nothing was staged. A read-only HEAD/worktree snapshot
comparison below includes those new files without touching Git's index.

<!-- BEGIN-DIFF-STAT -->

```text
 /dev/null => .env.example                                      |    9 +
 /dev/null => .gitignore                                        |   13 +
 /dev/null => .node-version                                     |    1 +
 /dev/null => .prettierignore                                   |   14 +
 /dev/null => .prettierrc.json                                  |    5 +
 README.md                                   |   83 +-
 /dev/null => apps/web/app/api/health/route.test.ts             |   13 +
 /dev/null => apps/web/app/api/health/route.ts                  |    9 +
 /dev/null => apps/web/app/layout.tsx                           |   16 +
 /dev/null => apps/web/app/page.tsx                             |   15 +
 /dev/null => apps/web/lib/auth/README.md                       |   12 +
 /dev/null => apps/web/next.config.ts                           |    8 +
 /dev/null => apps/web/package.json                             |   25 +
 /dev/null => apps/web/postcss.config.mjs                       |    2 +
 /dev/null => apps/web/styles/globals.css                       |   11 +
 /dev/null => apps/web/tsconfig.json                            |   20 +
 /dev/null => docs/FOUNDATION_001_REPORT.md                     |  364 +++++++
 /dev/null => eslint.config.mjs                                 |   46 +
 /dev/null => package.json                                      |   31 +
 /dev/null => packages/db/README.md                             |   80 ++
 /dev/null => packages/db/connection.ts                         |   16 +
 /dev/null => packages/db/drizzle.config.ts                     |    9 +
 /dev/null => packages/db/migrate.ts                            |   18 +
 /dev/null => packages/db/migrations/0000_foundation_001.sql    |  471 ++++++++
 /dev/null => packages/db/migrations/meta/0000_snapshot.json    | 2868 ++++++++++++++++++++++++++++++++++++++++++++++++
 /dev/null => packages/db/migrations/meta/_journal.json         |   13 +
 /dev/null => packages/db/package.json                          |   28 +
 /dev/null => packages/db/schema/checks.ts                      |   35 +
 /dev/null => packages/db/schema/index.ts                       |  674 ++++++++++++
 /dev/null => packages/db/tests/integration/constraints.test.ts |  370 +++++++
 /dev/null => packages/db/tests/schema.test.ts                  |   99 ++
 /dev/null => packages/db/tsconfig.json                         |    6 +
 /dev/null => packages/db/vitest.integration.config.ts          |   11 +
 /dev/null => packages/domain/index.ts                          |    1 +
 /dev/null => packages/domain/package.json                      |   13 +
 /dev/null => packages/domain/states.ts                         |   33 +
 /dev/null => packages/domain/tests/states.test.ts              |   35 +
 /dev/null => packages/domain/tsconfig.json                     |   10 +
 /dev/null => pnpm-lock.yaml                                    | 3837 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 /dev/null => pnpm-workspace.yaml                               |   23 +
 /dev/null => tsconfig.base.json                                |   16 +
 /dev/null => tsconfig.test.json                                |   10 +
 /dev/null => vitest.config.ts                                  |   13 +
 43 files changed, 9370 insertions(+), 16 deletions(-)
```

<!-- END-DIFF-STAT -->

### Resulting workspace tree

Generated dependencies, caches, builds, and temporary PostgreSQL files are
excluded. Empty reserved UI/Runner folders are shown explicitly.

<!-- BEGIN-TREE -->

```text
nextera-piscine/
|-- .env.example
|-- .github/
|   `-- workflows/ [empty]
|-- .gitignore
|-- .node-version
|-- .prettierignore
|-- .prettierrc.json
|-- README.md
|-- apps/
|   |-- runner/
|   |   |-- cmd/
|   |   |   `-- runner/ [empty]
|   |   |-- internal/
|   |   |   |-- executor/ [empty]
|   |   |   |-- heartbeat/ [empty]
|   |   |   |-- queue/ [empty]
|   |   |   |-- results/ [empty]
|   |   |   `-- sandbox/ [empty]
|   |   `-- testpacks/ [empty]
|   `-- web/
|       |-- app/
|       |   |-- api/
|       |   |   `-- health/
|       |   |       |-- route.test.ts
|       |   |       `-- route.ts
|       |   |-- layout.tsx
|       |   `-- page.tsx
|       |-- components/ [empty]
|       |-- features/ [empty]
|       |-- lib/
|       |   `-- auth/
|       |       `-- README.md
|       |-- next.config.ts
|       |-- package.json
|       |-- postcss.config.mjs
|       |-- styles/
|       |   `-- globals.css
|       `-- tsconfig.json
|-- content/
|   `-- piscine-v1/
|       |-- challenges/
|       |   |-- even-or-odd/
|       |   |   |-- challenge.yaml
|       |   |   `-- subject.md
|       |   `-- hello-go/
|       |       |-- challenge.yaml
|       |       `-- subject.md
|       |-- checkpoints/ [empty]
|       |-- manifest.yaml
|       |-- projects/ [empty]
|       `-- quests/ [empty]
|-- docs/
|   |-- FOUNDATION_001_REPORT.md
|   |-- architecture/
|   |   |-- DATABASE_SCHEMA_v0.1.md
|   |   |-- RUNNER_SECURITY_PROFILE.md
|   |   |-- SYSTEM_CONTEXT.md
|   |   |-- WORKSPACE_LAYOUT.md
|   |   `-- adr/
|   |       |-- ADR-001-modular-monolith.md
|   |       |-- ADR-002-postgres-job-queue.md
|   |       |-- ADR-003-isolated-judge-runner.md
|   |       |-- ADR-004-curriculum-in-git.md
|   |       |-- ADR-005-no-browser-ide-mvp.md
|   |       |-- ADR-006-supabase-auth.md
|   |       |-- ADR-007-submission-state-machine.md
|   |       |-- ADR-008-judge-job-protocol.md
|   |       `-- ADR-009-immutable-evaluation-environment.md
|   |-- product/
|   |   |-- PRODUCT_SPEC_v0.1.md
|   |   `-- VERTICAL_SLICE_001.md
|   `-- runbooks/ [empty]
|-- eslint.config.mjs
|-- infra/
|   |-- docker/ [empty]
|   |-- runner/ [empty]
|   `-- scripts/ [empty]
|-- package.json
|-- packages/
|   |-- db/
|   |   |-- README.md
|   |   |-- connection.ts
|   |   |-- drizzle.config.ts
|   |   |-- migrate.ts
|   |   |-- migrations/
|   |   |   |-- 0000_foundation_001.sql
|   |   |   `-- meta/
|   |   |       |-- 0000_snapshot.json
|   |   |       `-- _journal.json
|   |   |-- package.json
|   |   |-- queries/ [empty]
|   |   |-- schema/
|   |   |   |-- checks.ts
|   |   |   `-- index.ts
|   |   |-- tests/
|   |   |   |-- integration/
|   |   |   |   `-- constraints.test.ts
|   |   |   `-- schema.test.ts
|   |   |-- tsconfig.json
|   |   `-- vitest.integration.config.ts
|   |-- domain/
|   |   |-- index.ts
|   |   |-- mastery/ [empty]
|   |   |-- package.json
|   |   |-- progression/ [empty]
|   |   |-- states.ts
|   |   |-- submissions/ [empty]
|   |   |-- tests/
|   |   |   `-- states.test.ts
|   |   `-- tsconfig.json
|   `-- ui/
|       |-- primitives/ [empty]
|       `-- tokens/ [empty]
|-- pnpm-lock.yaml
|-- pnpm-workspace.yaml
|-- tsconfig.base.json
|-- tsconfig.test.json
`-- vitest.config.ts
```

<!-- END-TREE -->

## F. Architecture deviations

None. Implementation choices remain within the approved model. The migration's
deferrable foreign key handles its documented circular relationship without
weakening commit-time referential integrity. Protocol functions and full
Supabase integration remain out of scope as requested. Accepted architecture
documents were not rewritten.

## G. Risks and TODOs for Foundation Commit 002

- Validate migration/privileges against the actual local Supabase stack before
  adding Auth-backed runtime data access; the isolated fixture is not Auth E2E.
- Provision restricted web/migration identities and implement verified Supabase
  identity mapping/server authorization before protected application operations.
- Scope Foundation 002 explicitly. Queue functions, leases/retries, immutable
  publication, authoritative result application, and progression remain required
  later milestones, not implied features of these tables.
- Implement operational CI using the pinned runtime and real PostgreSQL checks;
  keep accepted architecture/curriculum outside automatic formatting changes.
- Monitor stable Drizzle tooling updates for its deprecated transitive loaders.
  Calibrate the approved sandbox limits when the separate Runner is implemented.

## H. Suggested commit message

```text
chore: bootstrap Foundation 001 workspace and PostgreSQL schema
```

No git commit was created.
