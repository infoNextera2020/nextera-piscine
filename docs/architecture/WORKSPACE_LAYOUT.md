# Workspace and File Layout — Vertical Slice 001

Status: intended implementation layout. This review creates documentation only;
code, package manifests, configuration, migrations, fixtures, and workflows in
the tree below are planned and are not implemented yet.

## Workspace configuration

Use a private pnpm workspace with one lockfile. Initial JavaScript packages are
apps/web, packages/domain, and packages/db. Workspace patterns select apps/web
and packages/*; an empty reserved directory is not a package until it has a
manifest. apps/runner is an independent Go module/deployment, outside pnpm.

- Node.js 24 LTS, pinned patch in development/CI; exact pnpm packageManager pin.
- Supported patched Next.js 16, compatible React, TypeScript, Tailwind CSS, and
  mutually compatible stable Drizzle packages, locked during bootstrap.
- Shared strict TypeScript options, including noUncheckedIndexedAccess and
  exactOptionalPropertyTypes; package-specific Next.js/library settings.
- Internal dependencies use workspace:* and explicit package exports.
- Consume internal TypeScript as workspace source; Next.js transpiles domain/db
  packages explicitly. Database exports stay server-only and cannot enter client
  components. Database tooling executes TypeScript independently of Next.js.
- Root tasks cover development, lint, formatting, type checking, build, domain
  tests, database tests, E2E, curriculum validation/publication, and migrations.
  Runner build/test tasks use Go on its dedicated environment.
- ESLint flat configuration and Prettier. pnpm handles workspace task execution.
- Drizzle uses postgres with a server-only bounded connection pool. Supabase
  transaction pooling disables prepared statements; migrations use a separate
  direct/session connection and migration identity.

## Module and UI boundaries

apps/web composes application services, server authorization, Supabase, private
storage, and persistence. Domain rules have no Next.js, Supabase, Drizzle, React,
filesystem, or container-runtime dependency. packages/db implements persistence
interfaces; it may depend on domain contracts, never the reverse. Cross-module
imports use public interfaces. Next.js route handlers remain thin adapters.

Tailwind CSS styles the application. Initial forms, status views, and page
components stay local to apps/web. packages/ui/tokens and packages/ui/primitives
remain empty. Introduce shared primitives only when actual reuse warrants them.
Radix is optional for accessible behavior that is needed; Motion is optional for
an intentional interaction. Neither is an initial default dependency. Do not
generate a shadcn visual system or introduce a full component library.

Server Components render subjects/dashboard/history. Small Client Components
handle file selection, upload feedback, and polling. Supabase SSR cookie refresh
uses the supported Next.js Proxy integration; each protected operation verifies
identity and domain authorization. Database/storage routes use the Node runtime.
Service-authenticated internal endpoints identify durable results and invoke
product application/reconciliation services; they do not accept caller verdicts.

## Target tree

Documentation files listed below are present after this review. Application and
configuration filenames show intended locations after implementation approval.
Existing reserved directories remain empty until their responsibility is needed.

```text
nextera-piscine/
|-- README.md
|-- package.json                         [planned]
|-- pnpm-workspace.yaml                  [planned]
|-- pnpm-lock.yaml                       [planned]
|-- tsconfig.base.json                   [planned]
|-- eslint.config.mjs                    [planned]
|-- .prettierrc.json                      [planned]
|-- .gitignore                           [planned]
|-- .github/workflows/                   [checks planned]
|-- apps/
|   |-- web/
|   |   |-- package.json                 [planned]
|   |   |-- tsconfig.json                [planned]
|   |   |-- next.config.ts               [planned]
|   |   |-- postcss.config.mjs            [planned: Tailwind]
|   |   |-- .env.example                 [planned: names only]
|   |   |-- proxy.ts                     [planned: session refresh]
|   |   |-- app/                         [routes below planned]
|   |   |   |-- layout.tsx
|   |   |   |-- page.tsx
|   |   |   |-- (auth)/login/page.tsx
|   |   |   |-- auth/callback/route.ts
|   |   |   |-- (learner)/cohorts/[cohortId]/
|   |   |   |   |-- page.tsx
|   |   |   |   |-- challenges/[nodeKey]/page.tsx
|   |   |   |   `-- submissions/[submissionId]/page.tsx
|   |   |   |-- (operator)/operator/cohorts/[cohortId]/page.tsx
|   |   |   `-- api/
|   |   |       |-- cohorts/[cohortId]/submissions/route.ts
|   |   |       |-- submissions/[submissionId]/route.ts
|   |   |       `-- internal/judge/
|   |   |           |-- results/[resultId]/apply/route.ts
|   |   |           `-- reconcile/route.ts
|   |   |-- features/                    [local product modules]
|   |   |-- lib/                         [server adapters/composition]
|   |   |-- components/                  [local reused components only]
|   |   `-- styles/globals.css           [planned: Tailwind entry/local theme]
|   `-- runner/
|       |-- go.mod                       [planned]
|       |-- go.sum                       [planned]
|       |-- cmd/runner/
|       |-- internal/
|       |   |-- executor/
|       |   |-- heartbeat/
|       |   |-- queue/
|       |   |-- results/
|       |   `-- sandbox/
|       `-- testpacks/                   [reserved; no hidden pack bytes in web checkout]
|-- packages/
|   |-- domain/
|   |   |-- package.json                 [planned]
|   |   |-- tsconfig.json                [planned]
|   |   |-- submissions/                [pure rules and unit tests planned]
|   |   |-- progression/                [four-state rules and unit tests planned]
|   |   `-- mastery/                     [reserved for broader rubrics]
|   |-- db/
|   |   |-- package.json                 [planned]
|   |   |-- tsconfig.json                [planned]
|   |   |-- drizzle.config.ts            [planned]
|   |   |-- schema/
|   |   |-- queries/
|   |   |-- migrations/                 [reviewed generated/custom SQL planned]
|   |   `-- tests/integration/            [planned]
|   `-- ui/                              [reserved; no manifest needed yet]
|       |-- tokens/                      [empty]
|       `-- primitives/                  [empty]
|-- content/piscine-v1/
|   |-- manifest.yaml
|   |-- challenges/
|   |   |-- hello-go/challenge.yaml
|   |   |-- hello-go/subject.md
|   |   |-- even-or-odd/challenge.yaml
|   |   `-- even-or-odd/subject.md
|   |-- quests/                          [existing reserved folder]
|   |-- checkpoints/                     [existing reserved folder]
|   `-- projects/                        [existing reserved folder]
|-- docs/
|   |-- product/
|   |   |-- PRODUCT_SPEC_v0.1.md
|   |   `-- VERTICAL_SLICE_001.md
|   |-- architecture/
|   |   |-- SYSTEM_CONTEXT.md
|   |   |-- DATABASE_SCHEMA_v0.1.md
|   |   |-- RUNNER_SECURITY_PROFILE.md
|   |   |-- WORKSPACE_LAYOUT.md
|   |   `-- adr/                         [ADR-001 through ADR-009]
|   `-- runbooks/                        [existing reserved folder]
|-- tests/e2e/                           [planned: first slice and recovery]
|-- playwright.config.ts                 [planned]
`-- infra/
    |-- docker/                          [sandbox image build planned]
    |-- runner/                          [dedicated host/profile planned]
    `-- scripts/                         [publication/maintenance planned]
```

The application deployment excludes Runner build contexts and private Judge
artifacts. A protected Judge build pipeline supplies test-pack images and a
metadata-only digest catalog. Production reconciliation is a scheduled invocation
of the monolith, including authorized lease recovery; it is not another product
service or an in-process background loop.

Related: [schema](DATABASE_SCHEMA_v0.1.md),
[security](RUNNER_SECURITY_PROFILE.md), and
[slice acceptance/testing](../product/VERTICAL_SLICE_001.md).
