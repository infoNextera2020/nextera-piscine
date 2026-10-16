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

Architecture has been reviewed with required revisions. The repository currently
contains curriculum, architectural documentation, and an empty implementation
skeleton. This update adds documentation only; application implementation waits
for explicit authorization. See
[acceptance criteria and testing](docs/product/VERTICAL_SLICE_001.md).

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

| Location | Responsibility |
| --- | --- |
| apps/web | Product routes, application services, local UI, Auth/storage adapters |
| apps/runner | Independent Go Judge control plane and sandbox orchestration |
| packages/domain | Pure submission/progression rules and persistence interfaces |
| packages/db | Drizzle schema, persistence adapters, reviewed migrations |
| packages/ui/tokens | Reserved future shared design tokens; currently empty |
| packages/ui/primitives | Reserved future reusable NextEra primitives; currently empty |
| content/piscine-v1 | Versioned YAML metadata and Markdown subjects |
| docs/product | Frozen product specification and current slice acceptance |
| docs/architecture | System context, schema, Runner security, workspace, ADRs |
| infra | Future container, Judge host, publication, and maintenance configuration |

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
