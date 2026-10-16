# Pilot Runner Security Profile

Status: design baseline, go-functions-pilot-v1. No container configuration or
Runner implementation is created by this document.

## Execution boundary

The Go Runner control plane lives on dedicated Judge infrastructure, separate
from the product deployment. It downloads and verifies artifacts, launches
sandboxes, enforces deadlines/output limits, and invokes restricted database
operations. Its credentials and container-runtime access remain outside every
learner sandbox.

Both compilation and execution happen inside disposable isolated containers.
Use a fresh compilation container and a fresh execution container per attempt,
with pinned images and phase-specific limits. The trusted Runner transfers only
the bounded expected compiled artifact between phases; it does not execute it
on the host. Required input filenames and transfer paths are fixed by the
trusted profile and cannot follow learner-controlled paths or symlinks.

## Mandatory container controls

| Control | Pilot requirement |
| --- | --- |
| Network | No network interface connectivity, published ports, or access to host/service/metadata networks; no dependency downloads |
| Identity | Fixed non-root UID/GID 65532; no supplemental privileged groups |
| Root filesystem | Read-only image root; only explicitly bounded temporary mounts are writable |
| Privileges | Drop all Linux capabilities; no-new-privileges; never privileged |
| Kernel policy | Seccomp enabled; enforced host AppArmor/SELinux policy where supplied by the chosen host; no host namespaces or extra devices |
| CPU | Hard cgroup quota, not a scheduling weight |
| Memory | Hard cgroup limit including temporary-filesystem pages; no swap allowance; preserve OOM enforcement |
| PIDs | Hard process/thread count per container |
| Time | Runner-controlled wall deadline for each phase; kill the entire container/process tree on expiry |
| Output | Bounded stdout/stderr collection; terminate on limit instead of buffering indefinitely |
| Temporary storage | Explicit aggregate byte and inode caps on all writable temporary mounts, including shared memory |
| Secrets and sockets | No product secrets, DB URLs, Auth keys, storage credentials, notification credentials, registry credentials, or Docker/runtime control socket |
| Mounts | No product/repository/home mounts, shared caches writable by learners, host root, host process filesystem, or runtime sockets |
| Cleanup | Destroy containers and temporary artifacts after success, failure, timeout, cancellation of ownership, or Runner recovery |

The Judge host must support and verify these controls before accepting work.
Missing enforcement is an infrastructure failure; it never causes a fallback to
unrestricted execution. Limit concurrency so the host retains memory/CPU for
the supervisor and recovery. Start the pilot with one active evaluation per
worker and increase only after measured validation.

## Initial resolved phase limits

These are initial pilot policy values to validate with trusted correct fixtures
before publishing the first immutable evaluation environment.

| Limit | Compilation | Learner test execution |
| --- | --- | --- |
| CPU quota | 1 CPU | 1 CPU |
| Memory, including tmpfs | 512 MiB | 64 MiB |
| PID/thread limit | 64 | 32 |
| Wall timeout | 20,000 ms | 2,000 ms across the execution test suite |
| Combined stdout/stderr cap | 64 KiB | 64 KiB across the execution test suite |
| Aggregate temporary storage | 256 MiB | 16 MiB |
| Temporary inode cap | 16,384 | 1,024 |
| Swap | Disabled | Disabled |

If public/hidden cases use multiple containers or invocations, the Runner also
enforces the aggregate execution deadline/output budget across them; splitting
tests must not multiply the published allowance.

Bound every writable location: compilation allocates at most 240 MiB to its
workspace, 15 MiB to temporary files, and 1 MiB to shared memory; execution uses
12 MiB, 3 MiB, and 1 MiB respectively. Temporary files/shared memory are
non-executable, nosuid, and nodev. The workspace permits executing the compiled
binary and remains nosuid/nodev. Set appropriate UID/GID ownership for the
non-root process. Writable mount capacities do not increase the memory limit.

For the current curriculum, interpret max_size_kb/output_kb as KiB and memory_mb
as MiB during normalization: maximum submission 262,144 bytes, execution memory
67,108,864 bytes, and output 65,536 bytes. Record explicit normalized bytes in
the evaluation snapshot. Compilation has a separate trusted budget; do not try
to compile Go inside the learner's 64 MiB execution allowance.

Use the exact pinned Go toolchain and target platform with offline dependencies,
automatic toolchain download disabled, CGO disabled, GOMAXPROCS=1, and bounded
build parallelism. Build caches shipped read-only in the image are trusted;
temporary build caches are isolated per attempt. Source code cannot change the
trusted command, toolchain selection, host paths, or environment forwarding.

If good fixtures cannot pass these limits reliably, revise and validate a new
profile before publication. Never loosen the environment silently during a
retry. The four-second median product target must be measured with the actual
build/test path and is not inferred from these maximum budgets.

## Verdicts and hidden feedback

- Trusted harness completion and comparison produce the verdict. Learner output,
  an exit code alone, or a printed test-runner message cannot establish a pass.
- Execution timeout is timeout; learner execution OOM/output/PID/storage abuse is
  runtime_error with a safe reason. Learner compile errors or compile resource
  exhaustion are compile_error. Infrastructure failures remain system_error.
- Hidden packs remain private trusted Judge artifacts/images. The web has only
  metadata/digests, never private registry credentials or hidden pack bytes.
- For the pilot, raw learner stdout/stderr from any phase is omitted from product
  results. Feedback uses approved verdicts, public-test summaries, safe compile
  categories, and a fixed hidden-test failure message. Internal hidden output,
  harness paths, and expected/actual hidden values never enter the web system.
- Operator diagnostics contain safe infrastructure classifications, IDs,
  measurements, and correlations. Do not forward raw hidden traces to operator
  pages or web logs.

## Database and notification boundary

The Runner invokes only claim_job, renew_lease, heartbeat,
record_execution_attempt, record_result, and record_infrastructure_failure.
Each call is bound to its authenticated worker and, where relevant, its live
claim. It cannot directly access tables or learner progression.

After successful persistence, notification carries a durable result identifier
to a dedicated authenticated product endpoint. The product reads PostgreSQL and
applies the result/progression transaction. Lost notifications are repaired by
scheduled reconciliation, not by another execution.

## Verification and limitations

Runner integration tests must inspect effective limits and exercise network
access, root writes, privilege escalation, process creation, resource exhaustion,
output flooding, secret/socket discovery, spoofed pass output, hidden-output
exfiltration, stale ownership, and cleanup after abnormal termination. Correct
fixtures must pass alongside these adversarial cases.

Containers share the Judge host kernel. This profile requires a maintained,
dedicated host and validated isolation; it is not a claim that arbitrary code
has no kernel attack surface. Judge infrastructure remains separate from the
web application and production secrets.

References: [Docker container controls](https://docs.docker.com/engine/containers/run/),
[resource limits](https://docs.docker.com/engine/containers/resource_constraints/),
[tmpfs accounting](https://docs.docker.com/engine/storage/tmpfs/),
[Go module environment](https://go.dev/ref/mod#environment-variables), and
[Go toolchain selection](https://go.dev/doc/toolchain).

Related: [ADR-008](adr/ADR-008-judge-job-protocol.md) and
[ADR-009](adr/ADR-009-immutable-evaluation-environment.md).
