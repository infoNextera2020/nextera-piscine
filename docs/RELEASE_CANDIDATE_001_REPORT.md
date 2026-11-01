# Production Readiness / Release Candidate 001

**Recommendation: NO-GO for staging.** Audited on 20 October 2026 at commit
`1062e7d7e616d817bfd1bb3ca9850819cea2c061`. The learner design is frozen.
No application, policy, migration, authorization or Judge/Runner source was changed.
Nothing was staged, committed, published or deployed during this audit.

## A. Working-tree classification

The native Ubuntu Git working tree and index were **clean before verification**.
The previous changes had already been committed; there were no unstaged or
untracked product files to divide into the requested categories.

| Category                     | Uncommitted files at audit start | Existing commit                                                                                                                               |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL driver resilience | None                             | `d2073ba` — `fix(db): harden postgres connection-close handling`                                                                              |
| UI_001                       | None                             | `78d2d18` — shell, Command Center and Roadmap                                                                                                 |
| UI_002                       | None                             | `27f2b16` — Challenge, Checkpoint, Result and Evidence                                                                                        |
| UI_003                       | None                             | `1062e7d` — frozen learner-facing visual polish                                                                                               |
| Unrelated/pre-existing work  | None uncommitted                 | Local-demo work is already bundled into `1062e7d`: `scripts/local-demo.ts`, `docs/LOCAL_DEMO.md`, and the two demo commands in `package.json` |

Windows Git briefly reported mode-only differences for
`apps/web/public/piscine/home-hero.webp` and
`apps/web/public/piscine/sidebar-mountains.webp` (100755 versus 100644).
Native Git reported neither file changed. No image content or mode was altered
to resolve this interoperability discrepancy.

This report is the only new non-ignored deliverable. Audit scripts, logs,
screenshots and the temporary verification copy are under ignored `.tools/rc001/`.
Generated Playwright failure output is under ignored `test-results/`.

## B. Recommended atomic commit plan

1. Preserve the four existing commits and their order. There is nothing left to
   stage from those passes. Do not reset, rebase or recreate them for this audit.
2. Record this report separately, after review, as
   `docs(release): record RC001 readiness audit`.
3. Resolve database/Runner test failures in separately reviewed, narrowly scoped
   commits after identifying their causes. Keep test-selector maintenance separate
   from any reliability fix; do not change assessment rules to make tests pass.
4. The local-demo work is already mixed into a historical UI_003 commit. Do not
   rewrite that commit without explicit authorization. Exclude demo tooling,
   fixtures, `.tools`, local environment files and private artifacts from the
   deployment artifact rather than shipping the whole checkout.

Any later staging should name exact reviewed files. Do not use `git add .`.
The index remains empty in this audit.

## C. Complete verification matrix

Tools: Node 24.19.0, pnpm 11.22.0, Go 1.27.2, Chromium, PostgreSQL 17.
Database integration used a new localhost-only Docker PostgreSQL instance on
port 55442 and disposable `foundation_test_rc001*` databases. Browser tests used
local Supabase; assessment fixtures and protected worker credentials were isolated.

| Requested check                             | Fresh RC001 result                                                                                 | Evidence                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting                                  | PASS                                                                                               | `pnpm format:check`                                                                                                                     |
| Lint                                        | PASS                                                                                               | `pnpm lint`                                                                                                                             |
| Type checks                                 | PASS                                                                                               | Workspace checks and test TypeScript                                                                                                    |
| All unit tests                              | PASS — 113/113                                                                                     | 15 files                                                                                                                                |
| All PostgreSQL integration tests            | **FAIL**                                                                                           | First run 92/114 passed, 22 failed; fresh-database rerun 96/114 passed, 18 failed                                                       |
| Foundation 006 database tests               | PASS in focused run — 25/25; **not reliably green in full suite**                                  | Full-suite checkpoint failures remain blocking                                                                                          |
| Database privilege/evidence audit           | PASS                                                                                               | 20 tables, 8 migrations, 9 restricted checkpoint definers; direct web/Runner checkpoint access denied; snapshot/outcome digests checked |
| Identity/cohort browsers                    | PASS — 20/20                                                                                       | Real local Auth and database                                                                                                            |
| UI_001 browsers                             | PASS — 7/7                                                                                         | Read-only fingerprint and responsive checks                                                                                             |
| UI_002/UI_003 browsers                      | PASS — 10/10                                                                                       | Final frozen implementation, keyboard tabs, disclosures, result colors, time/authorization checks and responsive captures               |
| Judge protocol                              | Go protocol package PASS; PostgreSQL protocol 12/13 initially, **13/13 on fresh full-suite rerun** | Claim/fencing/recovery regressions retained                                                                                             |
| Go executor/artifact/feedback/sandbox tests | PASS                                                                                               | Go formatting, module verification, vet and uncached tests; five tested packages                                                        |
| Protected legacy Runner execution           | **FAIL / incomplete**                                                                              | First browser login assertion failed; 37/38 cases did not run under configured fail-fast                                                |
| Protected checkpoint execution              | **FAIL / incomplete**                                                                              | First browser login assertion failed; 8/9 cases did not run under configured fail-fast                                                  |
| Full sandbox execution matrix               | **FAIL — 33/34 cases matched**                                                                     | Hello Go memory probe returned `timeout`, expected `runtime_error`                                                                      |
| Focused memory-probe rerun                  | PASS — 2/2                                                                                         | Both packs returned `runtime_error`, each with one observed kernel OOM kill; unchanged limits                                           |
| Public artifact metadata tests              | PASS — 3/3                                                                                         | Python unittest suite                                                                                                                   |
| Private layout verification                 | PASS — 6/6                                                                                         | Actual protected OCI layouts verified, publication unapproved                                                                           |
| Artifact/source identity                    | PASS                                                                                               | Current Runner source matches image receipt; retained sandbox and legacy pack bytes unchanged                                           |
| Curriculum validation                       | PASS                                                                                               | Real `nextera-piscine@0.1.0`, 2 nodes, committed source                                                                                 |
| Production build                            | PASS                                                                                               | Existing production route set                                                                                                           |
| Protected-file comparison                   | PASS                                                                                               | No changes since Foundation 006 in migrations, DB operations, Runner source or candidate catalog                                        |
| Credential/source/history scan              | PASS within stated scope                                                                           | 230 text source files; checked local Git history patterns; no credential-pattern findings                                               |
| Browser/public-asset exposure scan          | PASS within stated scope                                                                           | 37 public assets/chunks; 7 configured credential values/fragments checked; no matches or private evaluation fields                      |
| Catalog/publication guard                   | PASS                                                                                               | CANDIDATE retained; all six private artifact references null; missing catalog and candidate wrapper both rejected                       |
| Publication/cohort database audit           | PASS                                                                                               | No real published curriculum; no production cohort                                                                                      |

Logs: [audit directory](../.tools/rc001/), especially
[first database run](../.tools/rc001/logs/db.log),
[fresh database rerun](../.tools/rc001/logs/db-repeat.log),
[checkpoint-only run](../.tools/rc001/logs/checkpoint-db.log),
[legacy Runner](../.tools/rc001/logs/runner-legacy.log),
[checkpoint Runner](../.tools/rc001/logs/runner-checkpoint.log),
[sandbox matrix](../.tools/rc001/logs/sandbox.log),
[memory rerun](../.tools/rc001/logs/memory-recheck.log), and
[bundle audit](../.tools/rc001/logs/bundle-audit.log).
These are local evidence, not approved public upload artifacts.

## D. Failing and flaky checks

- **Database reliability is unresolved.** The first complete run encountered
  `submissions_timestamps_check`, followed by failed job claims. A second fresh
  complete run encountered `attempts_timestamps_check` and subsequent checkpoint
  claim failures. The focused checkpoint run passed. This does not establish
  whether clock movement, test isolation/order or product behavior is responsible.
  Preserve the constraints and investigate on a stable, clock-monitored Linux host.
- **Protected execution never reached its acceptance criteria.** Both suites
  remained at `/login` instead of reaching `/app`. Ordinary Auth tests passed
  earlier, but the protected environment failed later. Do not infer successful
  code execution from metadata verification or the separate UI tests.
- **Sandbox memory classification is intermittent.** The full run failed the
  Hello Go probe; both focused probes subsequently passed with OOM evidence.
  A rerun does not erase the failed full-matrix result.
- **Additional static test drift:**
  `tests/e2e/checkpoint-execution.spec.ts:204` still requires exact lowercase
  `evaluating`; the accepted UI renders `Evaluating`. This assertion was not
  reached because login failed first. Repair the selector separately, not the UI.
- WSL timeouts and Docker HTTP 500/disconnection occurred during setup. The user
  restarted the environment and authorized test Docker access. A later stopped
  Docker backend was restarted. Those setup failures are distinct from completed
  test failures. The disposable fallback container was removed.

No assertions, policies, expected verdicts or production code were weakened.

## E. Production configuration still missing

- Separate hosted staging resources, HTTPS origin, Auth redirect URLs and
  controlled learner/operator provisioning. Current inspected configuration is local.
- Secret-store provisioning for restricted web, migration/operations, product
  application, maintenance and per-worker identities; TLS/pooler validation.
- Hosted private source Storage policy verification and a production worker
  credential issuance/rotation mechanism. Current worker issuance is local-only.
- Actual private registry references, pull/retention controls and explicit catalog
  review. The candidate is deliberately not deployment approval.
- A reviewed web deployment artifact/process and dedicated Linux Judge host;
  local Docker Desktop does not prove production isolation.
- Supervision for lease maintenance and result/checkpoint reconciliation,
  readiness checks beyond liveness, operational alerts, backup/restore rehearsal
  and an exercised rollback procedure.

## F. Security and reliability blockers

The failed full database runs, incomplete protected execution runs, intermittent
sandbox probe and unconfigured production isolation prevent release approval.
Private artifact availability/catalog approval remain separate gates.

Positive evidence: existing authorization and privilege checks remain intact;
private schemas are excluded from the Data API; all six layouts remain protected
outside the product checkout; no exposed private payload files or production
credential patterns were found. Only blank `.env.example` files are tracked.
Ignored inspected environment URLs point to localhost. Pattern scans are scoped
evidence, not a certification of external secret stores or every possible secret format.

Client review and import/bundle checks found no client-side authoritative verdict,
mastery, unlock, eligibility, quota or outcome decisions. The countdown uses
elapsed time only for display. Checkpoint presentation hints run on the server;
PostgreSQL rechecks intake/deadlines and finalizes outcomes. Server actions remain
server boundaries, not browser policy code.

Playwright failure snapshots can contain **temporary test passwords**. They are
ignored, must not be committed or uploaded, and their directory plus the audit
directory were restricted to owner access. Protected fixtures disable their
accounts/workers/runtime logins in cleanup. No production credential was identified.
Do not publish raw local failure artifacts as release evidence.

## G. Deployment architecture recommendation

Retain the accepted architecture: a Node-hosted Next.js product service using
restricted runtime PostgreSQL access and Supabase Auth/private Storage; separate
trusted product reconciliation and lease-maintenance processes; dedicated Linux
Judge hosts with their operation-only identities and disposable compile/run
sandboxes. Keep registry credentials, private test packs and container-runtime
control off the web service and out of learner containers.

Choose hosting only after validating these operational requirements. Do not add
Redis, microservices or redesign the learner UI to address release blockers.

## H. Staging deployment checklist

1. Resolve/reproduce the recorded failures and obtain a clean full verification
   run on the exact frozen release revision and stable target PostgreSQL version.
2. Review test-selector maintenance separately; complete all protected legacy and
   checkpoint execution cases, plus the complete sandbox matrix.
3. Provision isolated staging Auth, DB, private Storage, roles and secret scopes;
   verify anonymous/cross-cohort denial, redirect URLs and TLS connections.
4. Package only reviewed runtime output and public assets; exclude `.env`, `.tools`,
   test diagnostics, fixtures, local-demo commands and private Judge inputs.
5. Verify private registry access/retention and immutable digests; obtain explicit
   catalog approval through the separate accepted review process. Keep this audit's
   catalog CANDIDATE. Do not publish the real curriculum as a staging shortcut.
6. Apply reviewed migrations through the migration identity, rehearse restore,
   install independent maintenance/reconciliation supervision and alerts.
7. Use explicitly authorized staging-only metadata/accounts for a genuine
   upload → Judge → result → mastery/unlock/checkpoint smoke test.
8. Review the immutable deployment manifest, rollback evidence and human approval
   before any later staging deployment. Nothing was deployed here.

## I. Rollback plan

Record the exact web revision, schema version, Runner/sandbox/pack digests and
configuration identifiers before deployment. Retain the prior compatible artifact.
On failure, restrict new intake at ingress under the approved maintenance process,
preserve accepted work, and roll back the web artifact only when schema compatible.

Drain or fence affected workers using existing lease behavior; retain compatible
workers/artifacts for already accepted jobs. Keep independent recovery and product
reconciliation available. Do not reset checkpoint timers, invent replacement
eligibility, delete receipts/history or mark infrastructure failures as learner FAIL.
Prefer a reviewed forward database fix; use a tested backup restore only as an
explicit incident action with its data-loss window understood. No destructive down
migration, database restore or rollback was performed in this audit.

## J. Recommendation

**NO-GO for staging.** Frontend acceptance remains intact, but RC001 does not have
a clean integrated assessment verification result or completed production setup.
Reconsider only after the blockers above are resolved and the full verification
matrix passes. All application sources remain unchanged; this report remains
unstaged and uncommitted. The disposable audit DB container was stopped with
failure data retained, and no orphan sandbox-test containers were found.
