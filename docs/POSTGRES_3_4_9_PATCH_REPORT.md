# postgres 3.4.9 closed-socket patch

Verified locally on 2026-10-20 (Africa/Cairo). All changes remain unstaged and uncommitted.

## Scope

This change fixes the driver failure that made a passing PostgreSQL fault-recovery suite exit unsuccessfully. It leaves the Foundation 005 recovery test, all migrations, checkpoint policy, Judge behavior and result application logic unchanged. Earlier unstaged UI work is preserved.

Files added or changed by this fix:

- [patches/postgres@3.4.9.patch](../patches/postgres@3.4.9.patch)
- [pnpm-workspace.yaml](../pnpm-workspace.yaml): exact-version `patchedDependencies` registration.
- [pnpm-lock.yaml](../pnpm-lock.yaml): patch hash and corresponding postgres/Drizzle resolutions.
- This report.

No package version or registry artifact integrity was changed. No exception handler, test skip, test configuration workaround or application-side recovery change was introduced.

## Exact failure reproduced before patching

Environment: Node 24.19.0, pnpm 11.22.0, unpatched postgres 3.4.9, PostgreSQL 17.11 in a dedicated loopback-only test container. The existing native PostgreSQL and local Supabase services were not started or changed.

With `TEST_DATABASE_URL` pointing to the disposable test database, ran:

```sh
pnpm test:db packages/db/tests/integration/result-application.test.ts \
  -t 'recovers after the actual application connection dies before commit'
```

The original test took the real application connection down with `pg_terminate_backend` while its transaction waited to insert an activity event. Its assertions passed, including rollback and later successful application. Nevertheless, the run exited **1** with one uncaught error:

```text
TypeError: Cannot read properties of null (reading 'write')
  at Immediate.nextWrite (.../postgres/src/connection.js:255:22)
```

A deferred driver write ran after the connection's close handler had cleared its socket. The error escaped the query promise. This matches [upstream issue #1208](https://github.com/porsager/postgres/issues/1208) and the [proposed guard in PR #1209](https://github.com/porsager/postgres/pull/1209/files).

The focused selector only selected this existing test; it did not modify or disable any test. The subsequent full run executed all 114 database tests.

## Narrow driver fix

The patch implements the same behavior as upstream #1209 inside `nextWrite()`:

1. Check whether the socket is absent.
2. Cancel a pending write immediate.
3. Clear both the pending chunk and the immediate reference.
4. Call `error(Errors.connection('CONNECTION_CLOSED', options, socket))` to reject pending work through the driver's established error path.
5. Return false after settling that work.

A bare false return would lose the write without rejecting the waiting query. This patch keeps the normal `socket.write` path unchanged.

The npm package ships separate implementations, so the identical guard is patched in:

| Package file          | Export/use         |
| --------------------- | ------------------ |
| src/connection.js     | ESM/import and Bun |
| cjs/src/connection.js | CommonJS/default   |
| cf/src/connection.js  | Cloudflare/workerd |

Node ESM and CommonJS were each exercised against a real terminated, in-flight transaction. Both rejected with **CONNECTION_CLOSED**, settled promptly, and exited normally without any global exception handler. Cloudflare's shipped copy was inspected for the same guard; a Cloudflare runtime E2E run is not claimed.

## Deterministic package-manager integration

Used pnpm's supported [patch](https://pnpm.io/cli/patch) and [patch-commit](https://pnpm.io/cli/patch-commit) workflow. The latter generates a dependency patch; it does not create a Git commit.

```yaml
patchedDependencies:
  postgres@3.4.9: patches/postgres@3.4.9.patch
```

Patch SHA-256 / pnpm lockfile patch hash:

```text
f95ef9e7ff3a00e287cd9f69d0a7995a95389740f3b6491c89471f5ddc679114
```

Both the root and database workspace resolve the patched postgres 3.4.9, including Drizzle's postgres dependency context. Existing dependency versions remain pinned.

Verified a normal frozen offline install in the workspace. Also made a fresh dependency installation from copies of the exact workspace manifests, lockfile and patch, with no existing node_modules:

```sh
pnpm install --frozen-lockfile --offline --ignore-scripts
```

The clean-install check reused the repository's package store. Build scripts were disabled only for that additional dependency-install proof; the primary workspace install and production build used their normal settings. No dependency package files were edited after installation.

Both ESM and CommonJS real-connection probes passed again from the fresh installation, and all three installed runtime copies contained the guard. Thus the fix comes from the registered patch and lockfile, rather than a one-off edit to node_modules.

## Verification results

| Check                                                 | Result                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Unpatched existing recovery test                      | Assertions passed, one uncaught TypeError, exit 1                              |
| Patched existing recovery test                        | Pass, no unhandled errors, exit 0                                              |
| Full pnpm test:db                                     | **114/114 passed**, six test files, no unhandled errors, exit 0                |
| ESM and CommonJS connection-termination probes        | Both reject with CONNECTION_CLOSED and exit 0                                  |
| Fresh frozen offline installation and repeated probes | Pass                                                                           |
| Typecheck                                             | Pass                                                                           |
| ESLint                                                | Pass                                                                           |
| Production build                                      | Pass                                                                           |
| Unit suite                                            | **101/101 passed**                                                             |
| Curriculum validation                                 | Pass; unchanged draft curriculum, publication still requires approved metadata |
| Formatting                                            | Pass                                                                           |
| Protected-file audit                                  | All 26 captured database test/migration/operation files byte-identical         |

Local verification logs and the additional smoke-test harnesses are retained under ignored `.tools/postgres-fix-*` paths. The dedicated PostgreSQL test container is stopped after verification; its data are retained.

## GitHub Actions status — not green yet

Read the actual [Repository checks run #5](https://github.com/infoNextera2020/nextera-piscine/actions/runs/39318308225), on unpatched commit `95fcd7eb6dfffe14c1fe84cfaa4a3170e9701f8d`, and the [database job](https://github.com/infoNextera2020/nextera-piscine/actions/runs/39318308225/job/118285458805).

That job reports **114 passing tests**, then the same uncaught `Immediate.nextWrite` error and exit 1. Its actual conclusion remains **failure**. The run's checks, runner and identity-e2e jobs succeeded.

The existing workflow triggers on push/pull_request and installs with `pnpm install --frozen-lockfile`. Its standard install will apply this patch once the patch file, workspace configuration and updated lockfile reach the tested commit. No workflow change is needed for the driver fix.

The patched repository checks have **not** been run on hosted GitHub Actions: Actions cannot read this local unstaged patch, and the instruction explicitly keeps all changes uncommitted. Rerunning the old commit would test the unpatched driver again. No commit, push, remote workflow edit or misleading green-CI claim was made.

The local repository checks and full database suite are green. Hosted CI validation remains pending a separately authorized commit/push.
