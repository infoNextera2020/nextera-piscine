# Staff capability inventory — 29 October 2026

Source audit began at `6928ce0d49f78acf613fbdb966da6e4b317b81f4`. The staff presentation changes described below are local, uncommitted source. This is not evidence of a running authenticated staff environment.

## Roles and access

The current role is one scalar value: `learner`, `operator`, or `admin` (`packages/domain/states.ts:32`; `packages/db/schema/index.ts:40`, `:61`). There is no separate mentor or owner role and no multi-role grant/switch model. “Mentor” means an assigned operator or admin; “owner preview” means an admin read view. Navigation between pages must not mutate the role.

`apps/web/lib/auth/server.ts:19` verifies Supabase identity with `auth.getUser()`. Its active domain-user, exact-role and cohort guards are at lines 26–49. `packages/domain/access.ts:25` requires active cohort membership for a non-admin; admin preview is separately permitted. Page denial redirects rather than returning protected data.

## Existing operational contracts

| Route                            | Capability and enforcement                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/operator`                      | Operator/admin page guard. Now presents mentor work or the minimal admin overview.                                                                        |
| `/operator/raids`                | Operator/admin guard; the DB queue scopes records to authorized teams. A selected team is resolved from that queue before its detail is read.             |
| `/api/raids` GET                 | Verified active domain user; cohort/node/team validation; `readRaid` and SQL enforce record access.                                                       |
| `/api/raids` review              | Operator/admin API guard, then SQL requires the exact assigned mentor, a current immutable attempt and automated PASS. Admin is not an approval override. |
| `/api/raids` assign              | Admin-only API action. Exactly three distinct active learners, one eligible reviewing mentor and a published project in the same cohort.                  |
| `/api/raids/artifact`            | Existing artifact endpoint requires assigned-mentor access and an automated PASS. An unrelated admin preview cannot download merely by being admin.       |
| `/app` and cohort subject routes | Learner projection; staff can have authorized read-only subject previews. Staff do not acquire learner progression by visiting them.                      |

Source mapping:

- `packages/db/queries/raids.ts:6` authorized detail; `:55` review; `:80` queue; `:85` artifact context.
- `apps/web/app/api/raids/route.ts:97` review validation; `:120` admin assignment.
- `packages/db/migrations/0009_raid_operations.sql:2` assignment; `:166` queue; `:177` artifact permission; `:194` exact-attempt review.
- `apps/web/lib/raids/panel.tsx:250` exported `RaidHistory`, including existing review UI, idempotency, uncertain-result messages and download controls. The new staff detail reuses it rather than introducing another approval mutation.
- `apps/web/lib/learning/projection.ts:41` excludes staff from learner state projection.

A frozen member losing access creates an owner hold. It does not silently award or exclude a member. No owner-hold resolution API was found, so the staff UI does not offer an override.

## Confirmed missing capabilities

- Quest review release/mastery, nonreciprocal peer and automatic mentor proposal logic exists in `packages/domain/quest-release-review.ts`, but there is no persisted Quest review queue, artifact/review API or staff consumer in the audited web/DB source. It must not be represented by Raid records.
- Quest opening is scheduled independently from mentor mastery/XP eligibility. The approved five-question policy exists in `packages/domain/piscine-pilot-policy.ts`; this does not create a persisted question sample.
- There are no authenticated portal screens/APIs for people/roles, cohort management, invitation issuance or calendar editing. Existing cohort/provisioning operations are CLI/service functions, not automatically safe web actions.
- There are no authoritative staff analytics aggregates. The planning baseline of 60 learners / 3 mentors is not shown as live data.
- A real multi-role switch requires a reviewed model; the UI has view links and a current-role label only.

## Local staff UI implementation

Approved design source: Library `libfile_b3d5a765c8e08191847b35270aeb0d38`, version 0. Official native WSL helper materialization verified Library ID/version xattrs and ZIP integrity. ZIP SHA256: `a92e4a33a2975873a448eb22e6644710bb264d504767450848395ebfd614d135`. Queue, mobile, detail and admin image pixels were inspected before source work.

The two existing operator pages now consume reusable `apps/web/components/operator/` components: X01-only top header, black palette, responsive queue records, progressive disclosures, focused Raid detail and a minimal admin overview. Existing Home/Journey/learner pages were not edited.

Protected detail is selected only from the authorized queue. A mismatched response is hidden. A refresh failure pauses approval/download; a 401/403 hides protected records. Current review forms retain the existing server-backed action, exact revision, frozen roster, idempotency and receipt semantics. This change does not enable a backend or create permissions.

Quest detail/approval and admin people/schedule controls remain explicitly unavailable. These approved visual concepts are not operationally implemented because their backend contracts do not exist. The role-switch concept is intentionally absent under the scalar role model.

## Verification and remaining gates

Focused command: `vitest run --config tests/operator-ui.vitest.config.ts`.
It runs 28 SSR/mocked-route tests for authorization-before-read, queue/detail scoping, missing vs empty capabilities, admin-only assignment and guarded review reuse. Mocked tests do not exercise PostgreSQL, Supabase, Storage, review mutation delivery or a browser.

The parent integration owner runs the combined source/build checks after parallel work completes. This worker has not started a preview/service, applied SQL, read a real environment file, created accounts/credentials, or run real staff approval. Responsive browser rendering, keyboard/interaction checks and authenticated end-to-end staff behavior remain unverified.
