# Public-example Run worker — source-only verification

The additive `public-run-stdio` Runner command accepts exactly one bounded JSON envelope on stdin: `{version:1,generation,executionId,work}`. It requires explicit operator-pinned `runner-image` and absolute Unix `docker-socket` options. There is no implicit socket, image, Run policy, database, lease token, registry, private grading pack or Storage credential. The command must only be invoked by the trusted, server-authorized Run driver; the input itself is not proof of learner access or a valid lease.

The public adapter uses the existing sandbox engine and its fixed supported profile. Policy must explicitly match 20-second compilation, 2-second learner execution, 64 MiB learner memory and 64 KiB output, with separate configured startup/lease/storage/request budgets. These are compatibility checks and synthetic test fixtures, **not approval or installation of a production Run policy**. No default Run allowances are seeded. Only the `go_function_v1` / package `main` profile with string or int64 input and string return is supported. Source bytes are preserved; non-main profiles are rejected rather than silently rewritten.

Only authored public example inputs reach the sandbox transport. Its result is a bounded JSON array of actual return strings in example order. Expected values are not passed to the generated transport or used as a pass/fail oracle. Run cannot grant mastery or consume official graded attempts. Operational errors and compiler/runtime diagnostics are projected to fixed safe messages, with empty infrastructure output.

Every outcome binds run ID, intent digest, generation and execution ID. Cancellation uses an independent bounded cleanup context. A cleanup proof requires exact public-purpose/run/execution label selection, deletion with independent absent inspection and an empty re-list. Ambiguous creation or cleanup yields no proof; the TypeScript driver must retain `recovery_required` capacity until trusted reconciliation. The public scope cannot call the broad Judge reaper. The official Judge purpose remains the default and its Evaluate/private-pack implementation is unchanged.

## Source checks

Existing Go 1.27.2 toolchain; dependency networking disabled (`GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`). `NEXTERA_SANDBOX_INTEGRATION=0` explicitly disables the real engine probe. Fake-engine/fake-HTTP tests cover public-only inputs, exact source preservation, strict envelopes/null/duplicate/unknown-key rejection, policy and digest binding, int64 boundaries, compilation/runtime/timeout/output projection, inaccessible resource checks, cancellation, scope fencing, cleanup uncertainty, forbidden token fields and safe CLI output.

Verification logs are retained outside the repo at `C:\Users\lap\Documents\Codex\2026-10-24\task\verification\public-run-source`. Final command results are in `final-checks.json`. No worker/CLI binary, learner program, container, network listener, database connection or service was run by these tests. The real engine integration test remains skipped; passing source tests are not live isolation evidence.

## Remaining operational gates

- An approved explicit public Run policy and reviewed public example manifests must exist; private grading packs are never a fallback.
- The trusted TypeScript outbox/lease driver still needs its protected subprocess adapter and deployment configuration wired to this command. Current source interfaces must not be treated as a running queue worker.
- Real sandbox image/socket access, resource enforcement, cancellation, cleanup and crash/reconciliation require a separately scoped runtime rehearsal. No existing Auth/DB/official Judge rehearsal approval authorizes public Run execution.
- No migrations, persistent access, credentials, services, learner records, policy enablement, push or deployment are performed by these checks.
