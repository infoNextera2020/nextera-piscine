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

Architecture V0.1 is approved. **Foundation Commit 002A** adds Supabase identity,
explicit domain-user provisioning, and server authorization to the runnable web
shell and PostgreSQL/Drizzle foundation. The complete learning flow remains future work. See
[acceptance criteria and testing](docs/product/VERTICAL_SLICE_001.md).

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
Data API. Storage, Realtime, Edge runtime, and analytics are disabled for 002A.
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

Open [the foundation page](http://localhost:3000). It identifies NextEra Piscine,
Vertical Slice 001, and Foundation online. [GET /api/health](http://localhost:3000/api/health)
reports application liveness with no secrets or database dependency. It does not
claim database readiness or a working authentication/assessment flow.

## Commands

| Command                            | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                         | Start the Next.js development server                                |
| `pnpm build`                       | Build domain and database packages, then the Next.js production app |
| `pnpm --filter @nextera/web start` | Serve the production build                                          |
| `pnpm format:check`                | Check formatting without changing accepted architecture/curriculum  |
| `pnpm lint`                        | ESLint/TypeScript/Next.js checks and domain import restrictions     |
| `pnpm typecheck`                   | Check all packages and test code                                    |
| `pnpm test`                        | Domain vocabulary, schema contracts, and health endpoint tests      |
| `pnpm test:db`                     | Real PostgreSQL migration and constraint tests                      |
| `pnpm test:auth`                   | Real local Supabase/browser identity and authorization tests        |
| `pnpm db:generate`                 | Generate a migration for review; does not connect or apply changes  |
| `pnpm db:migrate`                  | Apply committed migrations with the separate migration identity     |

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

### Verification

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://<local-test-owner>@127.0.0.1:<port>/foundation_test_identity pnpm test:db
pnpm build
pnpm exec playwright install chromium
pnpm test:auth
git diff --check
```

Database constraint tests use a disposable native PostgreSQL database with an
external Auth-table fixture; the Auth E2E uses the actual local Supabase stack,
both Drizzle migrations, the restricted runtime connection, and the production
web build. It creates random temporary Auth identities, provisions domain users
through the local script, and removes those fixtures afterwards. Port 3100 must
be free; the suite starts its own production server. Tests cover denial states,
database roles versus editable metadata, persisted/renewed sessions, and logout.
No production credentials are needed. GitHub Actions runs checks, PostgreSQL
integration, and local Supabase Auth E2E in separate jobs; it does not deploy.

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
