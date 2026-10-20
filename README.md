# NextEra Piscine

Production pilot for NextEra's project-based learning and automated assessment
platform. The first Piscine begins on **20 November 2026**.

## Product objective

Validate the evidence-based learning loop with real learners:

**Learn -> Solve -> Submit -> Automated Assessment -> Feedback -> Mastery -> Unlock**

This pilot focuses on reliable assessment, useful feedback, progression, and
operator visibility. The full launch scope is in the
[product specification](docs/product/PRODUCT_SPEC_v0.1.md).

## Current Vertical Slice

Vertical Slice 001 proves:

Sign in -> access cohort -> read Hello Go -> upload a locally written solution
-> isolated automated assessment -> feedback -> master Hello Go -> unlock Even
or Odd.

The required first E2E starts with Hello Go available and Even or Odd locked.
An incorrect Hello submission fails and leaves Even or Odd locked. A correct
submission passes, Hello becomes mastered, and Even or Odd becomes available.

Architecture V0.1 is approved. Foundation 005 adds the trusted product transaction
for durable Judge results: terminal submission state, mastery, prerequisite unlocks,
immutable processing receipts, safe events, and restartable reconciliation.
Foundation 004's Runner remains unchanged and cannot write progression. The real
curriculum remains draft and the catalog remains CANDIDATE. Execution verification
uses only isolated local fixtures. See [the Foundation 005 report](docs/FOUNDATION_005_REPORT.md).

## Local setup

Use **Node.js 24.19.0** (pinned in `.node-version`) and **pnpm 11.22.0** (pinned
in `package.json`). For a WSL checkout, run commands in Ubuntu with that pinned
toolchain. From the repository root:

```sh
pnpm install --frozen-lockfile
```

Start Docker Desktop (with Ubuntu WSL integration for a WSL checkout). The pinned
Supabase CLI runs local PostgreSQL 17 and Auth; no production project is required:

```sh
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 nextera-piscine-local
pnpm supabase:start
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:migrate
pnpm local:env
pnpm dev
```

Create the named Docker network once; reuse it on subsequent starts. Its host
binding requests localhost-only development services, following the
[Supabase local development guidance](https://supabase.com/docs/guides/local-development).
Verify the actual bindings with `docker port supabase_kong_nextera-piscine`:
Docker Desktop on the verification machine still published all interfaces despite
this network option. Keep local services on a trusted machine/network and stop
them after use; never expose the local stack publicly.

If another service uses port 3000, run
`pnpm --filter @nextera/web dev --port 3100` and open that port instead.

The connection above is the CLI's disposable local development default. Never use
it for hosting. `local:env` reads local CLI status without printing keys, creates a
restricted local runtime login, and writes ignored root `.env` and
`apps/web/.env.local` files. Existing files require explicit `--refresh`; that
rotates the local runtime password and replaces those files. Restart web after it.
Root `.env` contains administrative local tooling credentials and must never enter
a deployment. The web file contains only the runtime connection and public Auth
configuration. Environment variable names are in both `.env.example` files.

`supabase/config.toml` disables application migrations/seeding in Supabase tooling;
Drizzle remains the only application migration history. Do not use Supabase reset,
push, diff, or pull to manage `app`/`judge`. Private schemas are absent from the
Data API. Storage is enabled for the private source bucket; Realtime, Edge runtime,
and analytics remain disabled. Provision the local source bucket explicitly with
`pnpm judge:local storage` after migrations. Web uploads use the learner's Auth
credential, never a service key. Storage policies prohibit source overwrite/delete.
Stop local services with `pnpm supabase:stop` (local data is retained).

### Local login and provisioning

Open [local Studio](http://localhost:54323), choose Authentication → Users → Add
user, and create a confirmed email/password identity. Public signup is disabled.
Copy its Auth UUID, then provision NextEra access explicitly:

```sh
pnpm local:provision --auth-user-id <auth-uuid> --role learner --name 'Local Learner'
```

Use `operator` or `admin` to test those roles. Re-running the command explicitly
updates the name/role and reactivates the local domain account. The script accepts
only a loopback database on the local Supabase port; it is not a production user
administration mechanism. To deactivate locally, an administrator can run
`UPDATE app.users SET active = false, updated_at = now() WHERE auth_user_id = '<auth-uuid>';`.

Visit [login](http://localhost:3000/login). `/` and `/login` remain public. `/app`
requires an active provisioned domain user; `/operator` requires operator/admin.
An authenticated identity without a domain record receives `NOT_PROVISIONED`;
inactive users receive `INACTIVE`. Login does not create domain records or cohort
memberships. Browser metadata never supplies the authoritative role. Sign out is
available from the protected app and the access-denied page.

### Curriculum, cohorts, and enrollment

Run from the repository root:

```sh
pnpm curriculum:validate
pnpm curriculum:import
```

These commands read the five committed Git blobs under `content/piscine-v1/`
from `HEAD`, not uncommitted working files. Use `--ref <commit-or-ref>` to select
another committed revision. Validation reports the resolved source commit and
content digest. `curriculum:import` stores an idempotent **draft source receipt**,
without incomplete node/evaluation projections. A changed version's bytes require
a new declared version; identical imports retain the original source commit.

Operational commands require `OPERATIONS_DATABASE_URL` in the ignored root `.env`.
New `pnpm local:env` output includes it; for an existing 002A setup, add the local
migration connection under that name, or explicitly refresh local environment
files. Refresh rotates runtime credentials and requires restarting web. This
privileged connection never enters `apps/web`. Publication does not require a
learner login. Hosted operations must use explicitly provisioned operational access.

**Current boundary:** `pnpm curriculum:publish` fails with `PUBLICATION_BLOCKED`.
Foundation 003 supplies verified local digests in a gated candidate; private
immutable OCI references and catalog approval remain missing.
Git has test-pack IDs and only timeout/memory/output limits; it has no approved
artifact/image digests, exact toolchain/platform, complete compilation/execution
budgets, or protocol identities. No fake catalog or Judge digest is supplied.
Drafts cannot be pinned to cohorts or enrolled. The exact catalog contract and
digest format are documented in [the 002B report](docs/FOUNDATION_002B_REPORT.md).

After the trusted Judge build owner supplies an approved metadata-only catalog:

```sh
pnpm curriculum:publish --catalog /protected/approved-catalog.json
pnpm cohort:create --slug piscine-nov-2026 --name 'NextEra Piscine — November 2026' --starts-at 2026-11-20T00:00:00Z --version-id <published-version-uuid>
pnpm cohort:list
pnpm cohort:enroll --cohort-id <cohort-uuid> --user-id <domain-learner-uuid>
```

`cohort:pin --cohort-id <uuid> --version-id <published-uuid>` works only before
any membership exists. Enrollment requires an active provisioned domain learner.
It atomically creates the membership and every node's progress: Hello Go becomes
available with the enrollment timestamp; Even or Odd stays locked with null
timestamps. Repeating enrollment preserves progress and timestamps. It never
reactivates inactive memberships or silently repairs partial enrollment.

Visit `/app`, select the real enrolled cohort, and refresh to verify persisted
states. Available/in_progress/mastered challenges expose published Markdown and
submission requirements. Locked learner subjects return 404 even through direct
URLs. Operators need an explicit active cohort membership; administrators have
read-only global cohort preview. Their subject previews are labeled and do not
create learner progress or submission authority. Eligible learner challenges now
offer a local-file upload and the latest 50 safe attempt summaries. Non-runnable
fixtures remain read-only. Cohort start dates are informational; active membership
controls access. There is no public cohort administration.

Open [the foundation page](http://localhost:3000). It identifies NextEra Piscine,
Vertical Slice 001, and Foundation online. [GET /api/health](http://localhost:3000/api/health)
reports application liveness with no secrets or database dependency. It does not
claim database readiness or a working authentication/assessment flow.

## Commands

| Command                                                          | Purpose                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                                                       | Start the Next.js development server                                     |
| `pnpm build`                                                     | Build domain and database packages, then the Next.js production app      |
| `pnpm --filter @nextera/web start`                               | Serve the production build                                               |
| `pnpm format:check`                                              | Check formatting without changing accepted architecture/curriculum       |
| `pnpm lint`                                                      | ESLint/TypeScript/Next.js checks and domain import restrictions          |
| `pnpm typecheck`                                                 | Check all packages and test code                                         |
| `pnpm test`                                                      | Domain vocabulary, schema contracts, and health endpoint tests           |
| `pnpm test:db`                                                   | Real PostgreSQL migration and constraint tests                           |
| `pnpm test:auth`                                                 | Real local Supabase/browser identity and authorization tests             |
| `pnpm test:curriculum`                                           | Curriculum parsing, validation, hashing, and evaluation-boundary tests   |
| `pnpm test:cohorts`                                              | Cohort/enrollment and subject-authorization browser tests                |
| `pnpm test:submissions --credentials … --artifacts … --binary …` | Protected local browser/Go execution suite; private artifacts required   |
| `pnpm judge:fixture --database … --output …`                     | Explicit isolated test database and restricted runtime provisioning      |
| `pnpm judge:local storage`                                       | Provision the private local source bucket through Supabase Storage API   |
| `pnpm judge:local worker --database … --artifacts … --output …`  | Provision one restricted local fixture worker and source-read credential |
| `pnpm judge:maintenance`                                         | Independent bounded expired-lease recovery using its dedicated login     |
| `pnpm db:generate`                                               | Generate a migration for review; does not connect or apply changes       |
| `pnpm db:migrate`                                                | Apply committed migrations with the separate migration identity          |

The domain and database packages also build individually with
`pnpm --filter @nextera/domain build` and `pnpm --filter @nextera/db build`.
No database connection or web application is required for either build.

## Database setup

Copy `.env.example` to an ignored root `.env` when database access is needed.
Set `MIGRATION_DATABASE_URL` to a direct/session connection with migration-owner
privileges. The target must already have Supabase-managed `auth.users`; the
application migration never creates that table. Apply with `pnpm db:migrate`.

`DATABASE_URL` is the separate restricted runtime connection. Supply it through
the web server's environment or an ignored `apps/web/.env.local` when runtime
database access is needed. Do not put migration credentials in the web
deployment, and never prefix database credentials with `NEXT_PUBLIC_`.

`TEST_DATABASE_URL` selects a local disposable database named `foundation_test*`.
The database integration harness supplies a minimal external Auth-table fixture
and random test records there; it does not implement login or validate Supabase
sessions. See [database setup, implemented guarantees, and protocol TODOs](packages/db/README.md).

Migration 0001 creates the NOLOGIN `nextera_web` permission role and grants only
SELECT on the five user-resolution columns. A separately provisioned runtime
LOGIN inherits that role; migration-owner credentials never serve web requests.
Browser roles have no private schema/table access. Production provisioning must
maintain those grants and keep private schemas out of the hosted Data API.
Migration 0002 adds immutable-publication/cohort-pin guards and the narrowly
scoped reads listed in `packages/db/README.md`. Migration 0003 adds three web
operations, six Runner operations, independent lease recovery, and immutable
assessment-history guards. Direct web writes and all direct Runner table access
remain denied. Migration 0004 adds private source Storage policies, including
restrictive overwrite/delete guards. Neither migration grants progression writes.

### Verification

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:curriculum
pnpm curriculum:validate
TEST_DATABASE_URL=postgresql://<local-test-owner>@127.0.0.1:<port>/foundation_test_identity pnpm test:db
pnpm build
pnpm exec playwright install chromium
pnpm test:auth
pnpm test:cohorts
git diff --check
```

Database constraint tests use a disposable native PostgreSQL database with an
external Auth-table fixture; the Auth E2E uses the actual local Supabase stack,
all Drizzle migrations, the restricted runtime connection, and the production
web build. It creates random temporary Auth identities, provisions domain users
through the local script, and removes those fixtures afterwards. Port 3100 must
be free; the suite starts its own production server. Tests cover denial states,
database roles versus editable metadata, persisted/renewed sessions, and logout.
No production credentials are needed. GitHub Actions runs checks, PostgreSQL
integration, and local Supabase Auth E2E in separate jobs; it does not deploy.
The cohort suite uses isolated, explicitly non-runnable test-only projections;
those fixtures are not an approved catalog. Its personal/cohort fixtures are
removed after tests; immutable test curriculum records remain in local development
storage. No real `nextera-piscine@0.1.0` node projection is published by tests.

## Trusted evaluation artifacts and local Judge (Foundation 004)

The independent Go Runner module and pinned Go sandbox can be built and verified
locally. Private test-pack inputs and OCI exports remain outside this product
checkout. The metadata-only `infra/runner/catalog/candidate.json` is explicitly
**CANDIDATE**, with no fabricated registry references. Local builds do not approve
or publish the real curriculum. Private immutable OCI availability and explicit
catalog review are still required. No submission intake or queue execution is
approved for ordinary deployment. The Go executor now implements the durable
local fixture protocol; the public catalog still contains null artifact references.
See [trusted build, protected execution, and registry approval steps](infra/runner/README.md)
and [the Foundation 004 report](docs/FOUNDATION_004_REPORT.md).

## Architecture summary

- Private pnpm workspace; Next.js + TypeScript modular monolith for product logic.
- Framework-independent domain package; PostgreSQL + Drizzle for persistence.
- Supabase Auth; NextEra owns server-side roles and cohort authorization.
- Git-authored curriculum published as immutable, cohort-pinned projections.
- PostgreSQL Judge queue with leases, fencing tokens, and separate execution
  attempts. At-least-once execution; at most two infrastructure retries.
- Separate Go Runner. Compilation and execution both happen inside hardened,
  disposable sandboxes; learner code never executes in the web environment.
- Immutable content/artifact/test-pack/image/toolchain/limit/protocol identities.
  Hidden tests remain exclusively in trusted private Judge artifacts/images.
- Results persist before notification. The product reads authoritative PostgreSQL
  results, applies progression transactionally, and reconciles missed delivery.
- Tailwind CSS with minimal local UI in apps/web. Shared token/primitive folders
  remain empty until real reuse requires them; Radix/Motion are used only as needed.

## Repository map

| Location               | Responsibility                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| apps/web               | Product routes, application services, local UI, Auth/storage adapters    |
| apps/runner            | Independent Go Judge control plane and sandbox orchestration             |
| packages/domain        | Pure submission/progression rules and persistence interfaces             |
| packages/db            | Drizzle schema, persistence adapters, reviewed migrations                |
| packages/ui/tokens     | Reserved future shared design tokens; currently empty                    |
| packages/ui/primitives | Reserved future reusable NextEra primitives; currently empty             |
| content/piscine-v1     | Versioned YAML metadata and Markdown subjects                            |
| docs/product           | Frozen product specification and current slice acceptance                |
| docs/architecture      | System context, schema, Runner security, workspace, ADRs                 |
| infra                  | Future container, Judge host, publication, and maintenance configuration |

The [target workspace tree](docs/architecture/WORKSPACE_LAYOUT.md) distinguishes
planned implementation files from existing documentation and empty folders.

## MVP non-goals

- Microservices or Redis infrastructure.
- Browser IDE, browser terminal, or learner execution in the web environment.
- AI tutor, payments, certificates, or placement engine.
- Native mobile app, advanced community features, or a full peer-review system.
- Curriculum CMS or a speculative shared component/visual design system.
- A shadcn-generated visual system or a full component library before it is needed.

Checkpoints and the wider P0 operator/progress features remain launch work even
where they are outside the first slice.

## Architecture documents

- [System context](docs/architecture/SYSTEM_CONTEXT.md)
- [Initial schema and progress states](docs/architecture/DATABASE_SCHEMA_v0.1.md)
- [ADR-008: Judge lease/result protocol](docs/architecture/adr/ADR-008-judge-job-protocol.md)
- [ADR-009: Immutable evaluation environment](docs/architecture/adr/ADR-009-immutable-evaluation-environment.md)
- [Pilot Runner security profile](docs/architecture/RUNNER_SECURITY_PROFILE.md)
- [Workspace and file layout](docs/architecture/WORKSPACE_LAYOUT.md)
- [Vertical Slice 001 acceptance and testing](docs/product/VERTICAL_SLICE_001.md)

## Trusted result application (Foundation 005)

A separate server-only connection inheriting `nextera_result_application` owns
`applyResult(db, resultId)`. Never grant this role to the learner runtime or a
Runner login. It receives only the SELECT, column UPDATE and event INSERT rights
listed in migration 0005; it has no role/schema administration, source-object access,
publication writes, or Judge-result payload writes. Trusted TypeScript reads and
locks the stored projection, then uses the existing domain prerequisite rules.

`POST /api/internal/results` accepts exactly `{"result_id":"<durable UUID>"}`.
`POST /api/internal/results/reconcile` accepts `{}`. Both require a separate
`Authorization: Bearer <RESULT_APPLICATION_SERVICE_TOKEN>` (at least 32 characters),
not a Supabase session. The server also needs `RESULT_APPLICATION_DATABASE_URL`.
Use distinct random credentials provisioned by the operator; never expose either
value through NEXT_PUBLIC variables. The Runner image need not change: notifications
are optional acceleration; the independently scheduled product reconciler supplies
correctness without any browser.

Run `pnpm results:reconcile --once` from an external scheduler at least every
60 seconds, or supervise `pnpm results:reconcile` for its bounded repeated scans.
Supply `RESULT_APPLICATION_DATABASE_URL` and `MAINTENANCE_DATABASE_URL` in that
process environment. The latter keeps lease recovery on its existing separate role;
continue the existing independent 10-second lease maintenance schedule. Reconciliation
returns only opaque result IDs/statuses. `attention_required` leaves evidence intact
and requires operator investigation. No scheduler or production deployment is installed.

The accepted historical-result policy applies already accepted work even after
user/membership/cohort deactivation. It never reactivates access or relaxes intake
and read authorization. Migration 0005 starts progress on valid intake and backfills
Foundation 004's already accepted work from its original acceptance timestamps.
All browser refresh/history endpoints remain read-only.

## Foundation 006 checkpoint work

Foundation 006 adds trusted 90-minute checkpoint attempts, four frozen checkpoint tasks, 3-of-4 aggregation, immutable outcome evidence, gated progression, bounded retakes and infrastructure replacement grants. See [the implementation report](docs/FOUNDATION_006_REPORT.md) and [accepted checkpoint policy](docs/product/FOUNDATION_006_CHECKPOINT_POLICY.md). The evaluation catalog remains CANDIDATE and real curriculum publication remains blocked.

The independent product command `pnpm results:reconcile` now closes expired checkpoints, applies ready outcomes and announces eligible retakes, in addition to existing result reconciliation. It requires the separate product database connection; it does not depend on an open browser. Protected local checkpoint Judge verification uses `pnpm test:submissions --checkpoints` with the same private fixture/artifact/binary options as ordinary Judge verification.

## Piscine UI review pass

The first production UI pass implements the App Shell, Command Center and the approved V4 Roadmap. See [the A–J implementation report](docs/PISCINE_UI_001_REPORT.md) and [Design Freeze v1 handoff](docs/design/PISCINE_DESIGN_FREEZE_V1_HANDOFF.md). UI 002 continues with Challenge, Checkpoint, authoritative Result and Progress & Evidence inside the same shell; see [the UI 002 report](docs/PISCINE_UI_002_REPORT.md).

Run `pnpm test:learning` after local Supabase setup and a production build. This suite creates an isolated disposable database, uses a restricted web login with real local Auth sessions, captures responsive screenshots, and verifies that reading the UI leaves assessment and progression unchanged. It never publishes the real curriculum or approves the catalog.

Run `pnpm test:assessment-ui` after a production build for UI 002’s isolated Auth/database suite, authoritative result fixtures, keyboard checks, responsive screenshots and read-only navigation fingerprint. Its final test explicitly confirms an irreversible finish in the disposable fixture only. Hairline figures are decorative and do not decide assessment or progression.
