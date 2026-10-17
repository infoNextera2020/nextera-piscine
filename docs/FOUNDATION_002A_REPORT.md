# Foundation Commit 002A — Identity & Access

## A. Implemented behavior

Real Supabase email/password login and local-session logout use Next.js Server
Actions and cookie-backed SSR clients. `/` and `/login` remain public. `/app`
requires an active provisioned domain user; `/operator` requires operator/admin.
Denials redirect to login or explicit NOT_PROVISIONED, INACTIVE, or FORBIDDEN
states. The protected views show only safe domain identity/status information.
No login operation creates domain users or cohort memberships.

The existing architecture, sixteen tables, curriculum, empty shared UI folders,
and Runner boundary are retained. No later learning/Judge features are implemented.
Nothing has been staged or committed.

## B. Dependencies

| Dependency            | Exact version | Purpose                                  |
| --------------------- | ------------- | ---------------------------------------- |
| @supabase/ssr         | 0.12.7        | Supported cookie integration             |
| @supabase/supabase-js | 2.118.0       | Auth SDK; local Auth test administration |
| supabase              | 2.121.0       | Local development CLI                    |
| @playwright/test      | 1.64.1        | Browser integration tests                |

Existing versions of server-only 0.0.1, dotenv 18.0.8, postgres 3.4.9, and tsx
4.23.15 are exposed to the workspace packages/scripts that need them. Node
24.19.0, pnpm 11.22.0, Next.js, React, and the Foundation 001 toolchain are retained.
The lockfile pins all transitive dependencies. No component library was added.

## C. Local Supabase

The committed CLI configuration runs PostgreSQL 17, Auth, Studio, and local mail
on the standard local ports. Signup is disabled. Local tokens expire after five
minutes and use refresh-token rotation. Data API schemas exclude app/judge.
Storage, Realtime, analytics, and Edge runtime are disabled for this milestone.
Supabase application migrations and seeds are disabled; Drizzle owns app/judge.
The email provider remains enabled; project-wide `auth.enable_signup = false`
blocks public registration. Both behaviors are verified against real Auth.

README documents startup, reviewed Drizzle migrations, ignored environment files,
Studio identity creation, explicit domain provisioning, and shutdown. Local
tooling requires loopback endpoints and rejects production URLs. It never prints
service keys; only runtime credentials and public Auth configuration enter the
web environment file. The local provisioning command supports all three roles
and explicitly reactivates/updates an existing domain account when re-run.

## D. Authentication and authorization

Proxy follows the supported Supabase SSR refresh pattern: refresh/verify claims,
update request cookies for Server Components, and forward response cookies/cache
headers. Session-aware responses are private/no-store.

Server guards independently verify the current identity through Auth `getUser`,
resolve app.users.auth_user_id with Drizzle, require active status, and evaluate
database roles. Pure domain assertions are independently testable. React caches
lookups only within a render, so deactivation/role changes apply on the next
request. Client metadata and query parameters cannot supply authorization.

There is no service-role web client, fake user, signup enrollment, public
provisioning endpoint, or cross-request authorization cache. Cohort authorization
must be added before cohort data/workflows are introduced.

The implementation follows the official [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
and [local development guidance](https://supabase.com/docs/guides/local-development).

## E. Database privileges

Reviewed migration 0001 is separate from unchanged Foundation 001 SQL. It creates
the restricted NOLOGIN nextera_web permission role; grants schema usage and
SELECT on only id/auth_user_id/display_name/role/active; revokes private access
from PUBLIC, anon, authenticated, and service_role; and removes PUBLIC defaults
for future private objects created by the migration owner. No Judge roles or
functions are created. The custom migration snapshot records no table changes.

Local setup creates a separate random-password runtime LOGIN inheriting that
permission role. The web cannot insert users, change roles, read other product
tables, or access Auth/Judge tables directly. Hosted role provisioning and Data
API configuration remain deployment responsibilities; runtime requests never use
the migration owner.

## F. Tests and verification

Thirteen unit tests include seven new authorization policy cases. Thirty-eight
native PostgreSQL integration tests include twelve new runtime/browser privilege
cases. The database suite migrates/reapplies a disposable database and retains
the existing constraint coverage.

Thirteen browser tests use real local Supabase Auth, PostgreSQL, the production web
build, and the restricted runtime connection. They cover public/unauthenticated
access, disabled signup, invalid credentials, unprovisioned/inactive denial, learner/operator/admin
access, editable metadata rejection, live database authorization changes, refresh
renewal, logout/cookie clearing, private Data API schemas, migration history, and
the real Auth foreign key. Random fixtures are explicitly provisioned and cleaned
up. The test web server does not inherit administrative environment variables.

All required repository checks passed. Verification used Node 24.19.0 and pnpm
11.22.0 in Ubuntu WSL. Database integration used a disposable PostgreSQL 16
database; real Supabase verification used its managed PostgreSQL 17/Auth stack.

| Command / check                                              | Result                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                             | Passed                                                                                                  |
| `pnpm peers check`                                           | Passed; no peer issues                                                                                  |
| `pnpm format:check`                                          | Passed                                                                                                  |
| `pnpm lint`                                                  | Passed                                                                                                  |
| `pnpm typecheck`                                             | Passed; packages, routes, scripts, tests                                                                |
| `pnpm test`                                                  | Passed; 13 tests                                                                                        |
| `TEST_DATABASE_URL=… pnpm test:db`                           | Passed; 38 tests on disposable `foundation_test002a`                                                    |
| `pnpm build`                                                 | Passed; independent domain/database builds and Next.js production build                                 |
| Credential-free `pnpm build`                                 | Passed with local web environment removed and server credentials unset; environment restored afterwards |
| `pnpm db:generate`                                           | Passed; no schema drift or extra migration                                                              |
| `pnpm supabase:start`                                        | Passed with pinned CLI and real Docker stack                                                            |
| `MIGRATION_DATABASE_URL=… pnpm db:migrate`                   | Passed twice on real Supabase; second application made no changes                                       |
| `pnpm local:env`                                             | Passed; generated separate restricted runtime credentials                                               |
| `PLAYWRIGHT_BROWSERS_PATH=… pnpm test:auth --max-failures=1` | Passed; all 13 tests, 40.0 seconds                                                                      |
| `git diff --check`                                           | Passed                                                                                                  |
| `git diff --stat`                                            | 17 tracked files changed, 465 insertions, 22 deletions; 25 additional new files remain untracked        |
| `pnpm supabase:stop`                                         | Passed; local data retained                                                                             |

Additional inspection passed: all 13 source JSON files have unique keys; none of
the 12 client build files contains the local migration, runtime, or service-role
credentials. Accepted architecture/product/curriculum and original migration
files are unchanged; shared UI/Runner folders are empty; the Git index is unchanged.

Earlier failed attempts were resolved:

- Dependency/browser downloads and Docker startup failed when C: was full.
  Downloads and the verified Docker disk were moved to D: with user approval.
  Chromium headless was extracted from the official Playwright download; Linux
  runtime libraries were installed. The passing browser run uses that binary.
- The initial Next.js build could not resolve the domain's `.js` source imports
  with Turbopack. Explicit `.ts` source imports plus TypeScript's
  `rewriteRelativeImportExtensions` preserve compiled ESM `.js` imports. Independent
  builds and the production build pass.
- An explicit formatting attempt on `.env.example` had no matching parser;
  repository formatting checks pass. Deprecated local-mail configuration was
  replaced with the pinned CLI's `local_smtp` section.
- The first browser server could not bind port 3000, occupied by MySQL Workbench.
  The test server now uses isolated loopback port 3100.
- The first full browser run had 8 failures because the CLI email switch also
  disabled login. The provider is now enabled while global signup remains off.
  A new test proves public registration is rejected without creating an identity.
- The next run exposed an operator-test race: navigation preceded the Server
  Action redirect. The helper now waits for login completion. All 13 tests pass.

## G. CI

GitHub Actions has separate normal-check, PostgreSQL integration, and local
Supabase Auth E2E jobs. Each uses the pinned Node/pnpm and a frozen lockfile.
Normal checks run formatting, lint, type checking, unit tests, and build. The
PostgreSQL job uses a disposable PostgreSQL 17 service. The E2E job starts local
Supabase, migrates with Drizzle, prepares restricted local runtime credentials,
builds, runs Chromium tests, and stops the stack. No deployment job or production
secret is required. The workflow itself awaits its first GitHub-hosted run.

## H. Deviations and remaining work

No architecture change is intended. Full Vertical Slice 001 remains unimplemented.
Production user administration, cohort authorization, and broader Auth recovery
flows remain separate work. Preserve least privilege and the private-schema Data
API configuration when provisioning hosted infrastructure.

Host recovery, authorized separately by the user, moved Docker's data to
`D:\DockerDesktopWSL\disk\docker_data.vhdx`. The cold copy was SHA-256 verified
before the original C: copy was removed. Docker's supported `customWslDistroDir`
setting now points to D:. Stale socket-only runtime folders were preserved before
replacement. A brief WSL shutdown and administrator-level bare VHD attachment
resolved the stale Windows disk attachment; no disk was formatted. Go, MySQL,
and MySQL Workbench are running again. Jupyter's original container and bind files
are preserved; it remains stopped at the user's request after a bind-permission
error. Ignored recovery helpers/downloads are not product dependencies.
The Go container also exited with code 137 during verification (`OOMKilled=false`);
its cause is unconfirmed. It was restarted successfully after builds finished.

Automatic approval review rejected an NTFS-junction proposal and a physical-device
attachment variant because of corruption/dual-attachment risks. Neither was
executed. The explicitly approved VHD attachment succeeded using Windows elevation.

The documented named Docker network requests localhost binding according to
[Supabase guidance](https://supabase.com/docs/guides/local-development). On this
Docker Desktop installation actual ports still published on all interfaces.
README records the limitation and the local stack was stopped after verification.
Verify actual bindings before using the stack on an untrusted network.

## I. Resulting identity/access files

```text
.github/workflows/checks.yml
apps/web/
  .env.example
  package.json
  proxy.ts
  app/page.tsx
  app/access-denied/page.tsx
  app/app/page.tsx
  app/login/{actions.ts,page.tsx}
  app/operator/page.tsx
  lib/auth/{README.md,server.ts}
  lib/supabase/{client.ts,config.ts,server.ts}
packages/domain/
  access.ts
  index.ts
  tsconfig.json
  tests/access.test.ts
packages/db/
  README.md
  package.json
  tsconfig.json
  queries/users.ts
  migrations/0001_identity_access.sql
  migrations/meta/0001_snapshot.json
  migrations/meta/_journal.json
  tests/integration/access.test.ts
  tests/integration/constraints.test.ts
scripts/{local-env.ts,local-environment.ts,provision-user.ts}
supabase/config.toml
tests/e2e/identity-access.spec.ts
playwright.config.ts
docs/FOUNDATION_002A_REPORT.md
.env.example
.gitignore
README.md
package.json
pnpm-lock.yaml
tsconfig.base.json
tsconfig.test.json
packages/ui/{tokens,primitives}/  (empty)
apps/runner/                    (empty)
```

Root manifests, lockfile, environment example, README, ignores, and relevant
TypeScript/database test configuration are updated. Shared UI and Runner folders
remain empty. Existing files outside this milestone remain in the repository.

## J. Suggested commit message

```text
feat: add Foundation 002A Supabase identity and server authorization
```
