# Foundation 003 — Trusted Evaluation Artifacts

Status: local implementation and verification complete; catalog **CANDIDATE**.
Private registry availability and explicit catalog approval remain blocked.
No registry publication or curriculum approval is authorized by this report.

## A. Runner foundation

`apps/runner` is an independent, standard-library-only Go module pinned to
**Go 1.27.2**, linux/amd64. `runner version` and `capabilities` identify the build,
source digest, toolchain/profile, protocol 1, and snapshot format 1.
`verify-artifact` verifies a private OCI layout against the expected pack ID and
candidate environment; `verify-catalog` checks local metadata without approving it.
Errors are fixed `system_error` feedback. No database/queue/lease/result/progression
operations or learner-facing evaluation API are implemented.

## B. Sandbox image and controls

Both images build from the official `golang:1.27.2-bookworm` linux/amd64 manifest
`sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad`.
The Runner final image is scratch with a static non-root binary. The sandbox
contains the exact Go toolchain and a read-only cache for this profile's standard
imports. CGO, automatic toolchain switching, Go environment files, dependency
downloads and module networking are disabled; GOMAXPROCS and build parallelism
are 1. Trusted flags are `-trimpath -buildvcs=false -p=1 -ldflags=-buildid=`.

Compilation and execution use separate disposable UID/GID 65532 containers:
network none, read-only root, all capabilities dropped, no-new-privileges,
default seccomp, hard CPU/memory/PID limits, zero swap allowance, no log driver,
three bounded tmpfs mounts and unconditional cleanup. No product/repository/home
mount or credentials/socket enters them. The test supervisor verifies Docker
configuration and actual cgroup/proc/mount policy before starting learner code.

Approved hard limits are unchanged: compilation 1 CPU / 512 MiB / 64 PIDs /
20 seconds / 64 KiB output / 256 MiB tmpfs / 16,384 inodes; execution 1 CPU /
64 MiB / 32 PIDs / 2 seconds / 64 KiB output / 16 MiB tmpfs / 1,024 inodes.
One execution invocation holds the full suite, preserving aggregate allowances.
Go heap soft targets are 384 MiB for compilation, 48 MiB for execution, inside
the hard bounds. Only a bounded regular ELF transfers between phases; it is
never executed by the host. The Docker socket stays exclusively in the trusted
local control plane.

## C. Test packs and private build boundary

Private inputs and outputs are retained under
`/home/anas/.local/share/nextera-judge/foundation003/`, outside the checkout,
with private directory/file permissions. They must be backed up into protected
Judge build storage before host replacement. This location is not a production
registry or a substitute for retention/availability policy.

Each pack separates public cases, private cases, trusted bridge, safe feedback
vocabulary and metadata. The trusted external comparator holds expected answers;
containers receive only inputs and the compiled function adapter. Hello contains
two public examples plus ten private cases covering additional input shapes.
Even or Odd contains two public examples plus 73 static private cases covering
zero, signs, integer boundaries and deterministic additional values. Generated
authoring values are materialized as immutable static JSON; evaluations do not
generate random cases. No private values/source are reproduced in this report.

Public product files contain generic build/verification/test tooling, public
examples and metadata only. Challenge-specific private bridges/cases, OCI layouts,
image archives and detailed local measurements stay outside the checkout. The
web, Git curriculum and database projection receive no private pack bytes.
Public CI has no private inputs and neither builds nor uploads private packs.

## D. Exact artifact/image identities

Verified local OCI manifest identities:

| Artifact       | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| Runner         | `cd43a71d16696215a23d52c02b39143d081e6a704264185cabbb302ac3c4ce89` |
| Go sandbox     | `206f032819cd2c12d39ce92540a374c3319324c67c981b51031bf62f20e5b2d2` |
| hello-go-v1    | `aac95987005f11928a2359089bf11411be11590c7b300df99702fc6bd5705c93` |
| even-or-odd-v1 | `5ff83545dbd710044b0f2263649e507b41f756281205fd5fd6defb6728f6be66` |

Each has the `sha256:` digest prefix when used as an OCI descriptor. Catalog pack
digests use bare lowercase hex, as required by 002B. Repeating the image/pack
build produced byte-identical candidate metadata and all four identities.
Both pack layouts passed `runner verify-artifact`; candidate completeness and
compatibility checks passed without granting publication approval. A pack
identity is SHA-256 of its OCI manifest, transitively binding an empty config and
deterministic sorted USTAR layer. USTAR fixes mode 0400, UID/GID 0 and mtime 0.
Image identities are OCI manifest digests. Docker's OCI/containerd store executes
those verified manifest IDs; config digests are a separate domain and are never
substituted into catalog image fields.

## E. Registry/OCI status

The user explicitly selected **local artifacts only**. There is no registry login,
push or fabricated `oci://` reference. Immutable private registry references are
unresolved. Local OCI exports/layouts and their verified blobs are retained.

## F. Metadata-only catalog candidate

`infra/runner/catalog/candidate.json` is wrapped with
`status: CANDIDATE` and blockers. Its inner catalog uses the exact Foundation 002B
field vocabulary, with null artifact references until actual private immutable
OCI references exist. Both wrapper and unresolved references are rejected by the
publisher, including regression tests. Local hashes do not establish approval.

The exact login/copy/remote-byte-verification and review steps are in
`infra/runner/README.md`. The future protected registry needs explicit access and
retention policy. Remote manifests/blobs must match the retained local bytes;
registry rewriting requires review, not silently changed identities. Human catalog
approval remains separate from successful upload. No real curriculum publication
or real cohort creation is performed by this milestone.

## G. Security and resource validation

The final Docker integration suite passed **34 fixture checks plus two correct
preflights** in **266.316 seconds**. The suite includes correct/wrong answers,
compilation failure, infinite loop, output flood, process creation, network/root
write attempts, fake PASS, hidden-input output, stack traces, private file reads,
memory/tmpfs/inode exhaustion and secret/socket checks. Every malicious fixture
executes only inside the dedicated sandbox test containers.

| Correct fixture | Compilation | Execution | Diagnostic total |
| --------------- | ----------- | --------- | ---------------- |
| Hello Go        | 2.482 s     | 0.337 s   | 8.751 s          |
| Even or Odd     | 1.219 s     | 0.181 s   | 6.518 s          |

Both correct fixtures recorded zero PID-limit hits, zero OOM kills, and no storage
exhaustion. The PID probes recorded 12/75 cgroup limit hits, OOM probes each
recorded one kernel OOM kill, and byte/inode probes exhausted their bounded
mounts. All are classified `runtime_error`, even when learner code handles the
failed syscall. Infinite loops produce `timeout`; output floods produce
`runtime_error`; syntax failures produce `compile_error`. Wrong/hard-coded
answers produce `failed`. All limits remained unchanged.

The diagnostic totals include repeated effective-policy inspection and Docker
CLI/container setup. They are not a production latency benchmark and do not
demonstrate the product's under-four-second median target. A dedicated Go
execution path must be measured separately before pilot launch.

## H. Hidden-feedback leakage

Product-safe feedback contains exactly an allowlisted verdict and fixed message;
no raw phase output, paths, case identifiers, values or diagnostics are accepted.
Fake PASS, hidden-input printing, stack traces and private-file probes passed
explicit allowlist/equality checks. Raw stdout/stderr is bounded in trusted memory
and discarded. The final audit found no private pack JSON or bridge bytes across
**492 source/build files**, and no administrative/runtime credential across
**12 client build files**. Hidden expected answers never enter the learner
container. Only opaque digests and public metadata enter this repository.

## I. Tests, commands and CI

Go tests cover metadata ambiguity, protocol/toolchain/platform/limits mismatches,
pack identity, sandbox identity, tampering and safe projection. Packaging tests
cover repeatable exact-byte digests, changed bytes and missing files. Public
metadata checks and publisher-gate regressions run without private source.

| Command/check                                                                         | Final result                                                                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                      | Passed; lockfile/dependencies unchanged                                                                     |
| `pnpm format:check`                                                                   | Passed                                                                                                      |
| `pnpm lint`                                                                           | Passed                                                                                                      |
| `pnpm typecheck`                                                                      | Passed                                                                                                      |
| `pnpm test`                                                                           | Passed: 53 tests                                                                                            |
| `pnpm test:curriculum`                                                                | Passed: 27 tests, including two candidate publication guards                                                |
| `pnpm curriculum:validate`                                                            | Passed; committed curriculum unchanged                                                                      |
| `TEST_DATABASE_URL=… pnpm test:db`                                                    | Passed: 57 tests in new disposable `foundation_test003`, PostgreSQL 16                                      |
| `pnpm build`                                                                          | Passed: independent domain/database compilation and production Next.js build                                |
| `pnpm db:generate`                                                                    | Passed: no schema drift/new migration                                                                       |
| Go format / `go vet ./...` / `go test ./...`                                          | Passed: four Go tests with metadata/mismatch tables                                                         |
| `python3 -m py_compile …` / metadata unittest suite                                   | Passed: three tests                                                                                         |
| Local Runner/sandbox/pack builds and repeated build                                   | Passed; identical four OCI identities                                                                       |
| `runner version`, `capabilities`, `verify-catalog`, both `verify-artifact` operations | Passed; actual Runner image version smoke also passed                                                       |
| Docker sandbox / verdict / leakage / resource suite                                   | Passed: all 34 checks and two correct preflights                                                            |
| Local Supabase start / migrations twice                                               | Passed; three unchanged migration entries                                                                   |
| Combined Auth/cohort Playwright regression                                            | Passed: all 20 tests (13 Auth + 7 cohort), 3.3 minutes                                                      |
| Local product audit                                                                   | Real curriculum remains draft; zero real nodes/cohorts and zero Judge jobs                                  |
| Source/bundle boundary audit                                                          | Passed: counts above                                                                                        |
| `git diff --check`, accepted-file/lockfile comparison, index comparison               | Passed; no staging/commit                                                                                   |
| Development cleanup                                                                   | Supabase/native test PostgreSQL stopped; test containers removed; Go/MySQL running; Jupyter remains stopped |

Resolved verification issues: Ubuntu connections failed and Docker subsequently
hit stale socket files; user-authorized recovery preserved socket directories and
restored services without moving/changing Docker storage. Initial tests waited
for the generated candidate. Docker CLI information discovery timed out, so the
suite queries the existing local engine API directly. Docker archive-copy into
tmpfs failed, so bounded transfer now uses trusted tar processes inside the
containers. The first resource probes confirmed enforcement but returned ordinary
answer verdicts for handled exhaustion; kernel-event/storage observations now
force the approved `runtime_error` classification, and the complete suite was
rerun. Root-created tool/cache permissions and a root Git ownership check were
corrected by restoring ownership and checking Git as the repository user. A
Windows formatter attempt could not resolve Linux package links; Linux formatting
passed. No final required check remains failing.

CI retains existing JS/database/Auth/cohort jobs and adds pinned Go format/vet/
unit tests, public metadata/tool checks and both public image builds. Private
sandbox integration remains an explicit protected-host check; private artifacts
and raw output are never uploaded by this workflow. No deployment is added.
Hosted GitHub Actions itself remains unverified until the workflow runs there.

## J. Remaining blockers and scope

Private immutable OCI references and explicit post-review catalog approval remain
required. This development Docker Desktop host shares resources with existing
services; passing local tests will not certify a dedicated production Judge host,
kernel maintenance or an AppArmor/SELinux policy. Docker reports default seccomp
but no host MAC policy here. A production Judge host must enforce its supplied
host policy and repeat all checks before receiving work.

The Python sandbox supervisor is explicitly integration-test tooling, not the
deployable Go queue/executor implementation. Adding the future Runner protocol
will change its image identity and require a new reviewed catalog. Once a real
curriculum is published, changed evaluation identities require a new curriculum
version under ADR-009; this milestone does not bypass that rule.

Accepted architecture, curriculum and database schema/migrations are unchanged.
No submission intake/upload, queue functions, leases, Runner DB privileges,
durable result processing, mastery/checkpoints, final UI or shared UI is added.

## K. Resulting tree

```text
apps/runner/
  go.mod
  .dockerignore
  cmd/runner/main.go
  internal/artifact/{artifact.go,artifact_test.go}
  internal/feedback/{feedback.go,feedback_test.go}
infra/docker/{runner.Dockerfile,sandbox.Dockerfile}
infra/runner/
  README.md
  artifacts.py
  sandbox_test.py
  test_metadata.py
  public-cases/{hello-go-v1.json,even-or-odd-v1.json}
  catalog/candidate.json
scripts/curriculum/tests/candidate.test.ts
.github/workflows/checks.yml
.gitignore
.prettierignore
README.md
docs/FOUNDATION_003_REPORT.md
packages/ui/{tokens,primitives}/  (empty)
```

`git diff --stat` reports four tracked files changed, 45 insertions. Eighteen
additional new files are untracked because no staging is permitted. Private build
inputs, OCI exports/layouts and measurements are outside this tree.

## L. Suggested commit message

```text
feat: add trusted local evaluation artifacts and gated catalog candidate
```

No staging or commit is performed.
