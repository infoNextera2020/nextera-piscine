# Trusted evaluation artifacts

Foundation 004 adds a real Go control plane, PostgreSQL claim/lease/result operations,
and separate compilation/execution containers. The catalog remains CANDIDATE;
ordinary deployment/publication and all progression application remain gated.

## Build boundary

The product repository contains the Go verifier/control-plane binary, pinned
Dockerfiles, OCI packaging code, public example cases, adversarial test generators,
and a metadata-only CANDIDATE. No private cases, expected values, or private bridge
source may be committed here. Both Docker build contexts have narrow scopes;
the Runner context additionally has a deny-by-default `.dockerignore`.

Private build inputs belong in a separately protected Judge repository/directory,
outside this checkout, mode 0700, on the trusted Judge build host. For each
`hello-go-v1` / `even-or-odd-v1` input directory supply:

- `private.json`: reviewed static array of `{input, expected}` records.
- `bridge.go`: trusted Go `package main` adapter accepting an input array on stdin
  and emitting exactly one JSON array of function return strings on stdout.

The private build owner reviews this source. The bridge contains no hidden cases
or expected answers. The comparison harness holds those outside the learner
container. A short-lived compilation container receives only the learner function
and bridge; a different execution container receives only the bounded compiled
ELF and input array. Neither receives the test pack, oracle, registry credentials,
repository, home, database credentials, or container-runtime socket.

For this Go function profile, fixture source declares `package main`; the public
Go transport adapter owns `main` in the real executor. It is generated from the
public function signatures and contains no cases, oracles or assessment decisions.
The private pack's bridge is not copied into either real execution phase. The
legacy Foundation 003 Python regression supervisor still uses its original bridge.
The adapter contract requires the public signature. A malformed signature/package
fails compilation. No arbitrary
Go modules, build commands, or dependencies are accepted. Learner code is always
compiled/run inside disposable sandboxes, never by the web server or host.

## Durable local execution

Build the artifacts using the commands below. The Runner image now contains a
static Go 1.27.2 binary with pgx 5.11.0; Go module download/verification occurs in
the trusted build stage only. Test/build execution is offline. The final scratch
image includes public CA roots for control-plane TLS. Learner dependencies remain
offline exactly as in Foundation 003.

The local executor requires a binary extracted from that verified Runner image,
the protected `local-images.json` receipt, CANDIDATE metadata and both OCI layouts.
It checks binary revision, actual loaded image descriptors, protocol/snapshot/
toolchain/platform/resource policy, exact snapshot/spec digest, and source bytes.
It never substitutes latest or changes limits. Mismatches on an owned job are
infrastructure failures. Incompatible registered workers do not claim the job.

With local Supabase running/migrated and an explicitly created disposable
`foundation_test004_browser` database, run from the repository root:

```sh
pnpm judge:local storage
pnpm judge:fixture --database "$FIXTURE_MIGRATION_URL" --output /private/foundation004/run-001
pnpm judge:local worker --database "$FIXTURE_MIGRATION_URL" --artifacts /private/artifacts --output /private/foundation004/run-001
pnpm test:submissions --credentials /private/foundation004/run-001 --artifacts /private/artifacts --binary /private/bin/runner
```

The fixture command creates only a minimal external Auth FK fixture, applies
reviewed Drizzle migrations, and provisions separate restricted web/maintenance
logins. Browser sessions still use real local Supabase Auth. It creates no domain
users/cohorts; the explicit test fixture does that later. This path accepts only
loopback databases named `foundation_test*`, with credentials outside the checkout.
Use a fresh protected output directory per run. The test wrapper supplies only
the restricted runtime connection to the web server; operational secrets and
artifact paths are cleared. Tests disable retained domain/Auth fixtures and
logins afterward; assessment/source history stays retained in isolated storage.

The local worker command provisions a unique database principal and a one-hour
source-reader JWT. Its only Storage capability is reading the private learner
source bucket; it cannot overwrite/delete sources or administer Auth/Storage.
The JWT signing secret stays in the provisioning process. The worker receives
only its credential, not the signing secret/service key. Token issuance is local
CLI/legacy-HS256 only; hosted issuance/rotation is not implemented. Fixture cohort
assignment starts empty and is set explicitly by the fixture administrator.

The actual worker command is:

```sh
runner work --candidate /private/artifacts/candidate.json --layouts /private/artifacts --runner-image sha256:<actual-runner-manifest> --storage-url http://127.0.0.1:54321 --storage-token-file /private/foundation004/run-001/storage-reader.jwt --local-fixtures
```

Supply `JUDGE_DATABASE_URL` and public `JUDGE_STORAGE_PUBLISHABLE_KEY` from the
protected `runner.env`; never pass product/service credentials. The binary uses
only the existing local Unix Docker socket. No socket/credential/checkout/private
pack source enters a learner container. Approved local OCI fixture references
must match the configured protected layout exactly; the public candidate retains
null artifact references. Normal publication guards are unchanged.

Leases are 30 seconds, renew every 5 seconds, and heartbeat every 10 seconds.
Each short database operation closes its connection before execution. Independent
`MAINTENANCE_DATABASE_URL=… pnpm judge:maintenance` recovers expiry every 10 seconds
(`--once` supports an external scheduler). It has a separate operation-only role,
loads no product .env, and runs independently of workers/pages. Result application
and reconciliation remain future product work; every result receipt stays pending.

Normal phase deadlines remain 20/2 seconds with unchanged resource limits. A
45-second container-lifetime watchdog additionally bounds orphan execution after
a hard supervisor crash. A newly fenced claim removes older attempt containers
for that job; periodic cleanup reaps stopped Judge containers. Normal completion,
cancellation and lease loss destroy the phase container. Graceful idle shutdown
does not manufacture a system_error. Exactly one authoritative terminal result
is durable; duplicate/conflicting/stale recordings follow ADR-008.

The protected browser suite exercises both real packs and public adversarial
fixture generators, plus immutable uploads, replay, authorization, mismatch,
Runner death and independent maintenance recovery. The older Python sandbox
suite remains a separate regression. Neither suite prints/uploads raw hidden
output, private cases or private pack source. Local Docker Desktop remains a
shared development host; production separation/MAC policy and independent service
supervision still need deployment validation. No production deployment is added.

## Local commands

Use Go **1.27.2**, Python 3 stdlib, Docker Engine with Buildx/OCI image support,
Linux amd64, cgroup memory/CPU/PID enforcement, and default seccomp enabled.

```sh
cd apps/runner
GOTOOLCHAIN=local gofmt -l cmd internal
GOTOOLCHAIN=local go vet ./...
GOTOOLCHAIN=local go test ./...
GOTOOLCHAIN=local go build -trimpath -buildvcs=false -o /private/bin/runner ./cmd/runner
/private/bin/runner version
/private/bin/runner capabilities
cd ../..
python3 infra/runner/artifacts.py --inputs /private/inputs --output /private/artifacts
/private/bin/runner verify-artifact --layout /private/artifacts/hello-go-v1 --candidate /private/artifacts/candidate.json --pack-id hello-go-v1
NEXTERA_SANDBOX_TEST=1 python3 infra/runner/sandbox_test.py --output /private/artifacts --verifier /private/bin/runner
```

Run adversarial tests only in the dedicated local sandbox test environment.
Containers use a unique test label, no log driver, and are force-removed in `finally`
after every phase. No malicious code executes on the host or product process.
The integration suite verifies effective container controls before execution.
Compilation uses the approved 20-second/512-MiB profile; one execution invocation
holds all public/hidden cases within the aggregate 2-second/64-MiB/64-KiB budget.
Three tmpfs mounts split the approved byte/inode allowance. Output overrun ends
the entire phase, and no raw phase output is returned as product feedback.

Trusted commands disable CGO, module/network downloads, Go environment files,
automatic toolchain switching, VCS embedding, build IDs, and build parallelism.
An immutable standard-library cache is shipped in the sandbox image; per-attempt
cache directories are writable and contain symlinks to trusted read-only entries.
The cache warms the profile's JSON, formatting, OS, network, process, string and
syscall imports; other standard-library imports still compile offline within the
same compilation budget. Go's soft heap target is 384 MiB during trusted cache
construction/compilation and 48 MiB during execution; hard cgroup limits remain
512/64 MiB. Soft targets never replace cgroup enforcement.
No learner cache is shared. Builds pin the official Go platform manifest and
normalize output image timestamps. Repeating with identical inputs must retain
OCI identities; hashes do not promise timing reproducibility across hosts.

## Pack format and verification

Each private OCI layout has a v1 image manifest with artifact type
`application/vnd.nextera.testpack.v1`, empty `{}` config and one deterministic
uncompressed USTAR layer. Layer files are sorted, mode 0400, uid/gid 0, mtime 0:
`metadata.json`, `cases/public.json`, `cases/private.json`, `harness/bridge.go`,
`feedback.json`. The test-pack digest is SHA-256 of the exact OCI manifest bytes,
not the tarball, config ID, tag, or directory. All referenced blobs are checked.
Metadata binds the pack ID to protocol/snapshot/toolchain/platform/flags/offline
policy/sandbox manifest identity and both exact phase profiles. Mismatches fail
as `system_error`; private payload paths/data never enter verifier diagnostics.

Runner/sandbox catalog identities are OCI manifest digests. `local-images.json`
privately records the distinct config digest and verified manifest ID used by
Docker's OCI/containerd store. Config IDs are not substituted for manifests.
OCI exports, private inputs, and results remain outside
the checkout; only public metadata is copied to `catalog/candidate.json`.

## Candidate and future registry approval

The candidate wrapper contains `status: CANDIDATE`, explicit blockers and `catalog`.
Inner entries match the 002B field vocabulary, with **null** `test_pack_artifact`
until an immutable private registry reference actually exists. This wrapper is
intentionally rejected by `curriculum:publish`; it is never an approved catalog.
There are no placeholder `oci://` URLs. Local image existence does not authorize
publication. No real cohort is created by these tools.

After choosing an authorized private GHCR namespace, the trusted build owner:

1. Creates private packages with read/write permissions and retention protecting
   every referenced digest. Supplies a minimally scoped token using
   `printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin`
   For the copy tools, also run
   `printf '%s' "$GHCR_TOKEN" | oras login ghcr.io --username "$GHCR_USER" --password-stdin`
   and
   `printf '%s' "$GHCR_TOKEN" | skopeo login --username "$GHCR_USER" --password-stdin ghcr.io`.
   Credentials remain on the Judge host; disable shell tracing while handling them.
2. Uses a reviewed OCI-copy tool (for example Skopeo) to copy **the retained OCI
   image archives**, preserving their manifests/digests, into the actual Runner
   and sandbox repositories. Do not rebuild, retag/push from a different format,
   or substitute local config IDs. Example after setting actual repository names:
   `skopeo copy --preserve-digests oci-archive:/private/artifacts/runner.oci.tar docker://ghcr.io/$OWNER/$RUNNER_REPO:foundation-004`;
   repeat for `sandbox.oci.tar` and its private repository.
3. Copies each test-pack layout without repackaging:
   `oras cp --from-oci-layout /private/artifacts/hello-go-v1@sha256:$PACK_DIGEST ghcr.io/$OWNER/$PACK_REPO:hello-go-v1`;
   repeat for Even or Odd. These variables must come from real build outputs.
4. Fetches every remote manifest by digest, hashes exact bytes, verifies every
   referenced blob, and re-runs verifier and sandbox tests against fetched bytes.
   Confirms anonymous/web identities cannot pull private packs. A registry rewrite
   or changed digest invalidates the candidate; never paper over a mismatch.
   For example, after reading the real Runner digest from candidate metadata:
   `oras manifest fetch --output /private/verify/runner-manifest.json ghcr.io/$OWNER/$RUNNER_REPO@sha256:$RUNNER_DIGEST`, then
   `printf '%s  %s\n' "$RUNNER_DIGEST" /private/verify/runner-manifest.json | sha256sum --check`.
   Repeat for the sandbox and both packs. Fetch each manifest's config/layers with
   `oras blob fetch --output /private/verify/blob ghcr.io/$OWNER/$PACK_REPO@sha256:$BLOB_DIGEST`
   and verify its declared size/SHA-256. Keep the retained canonical layout wrapper
   when replacing its blobs with remote bytes; the Go verifier checks that wrapper
   as well as all content. Run the same sandbox suite against those verified bytes.
5. Produces a metadata-only **approved-format proposal** `{format_version:1,
test_packs:{...}}`, replacing null references with the actual
   `oci://ghcr.io/<actual-private-repository>@sha256:<verified-manifest>` values.
   Presents all identities, test evidence, access/retention policy for human review.

Only explicit post-review catalog approval permits a later publication operation.
Registry availability and approval are separate gates; this milestone does not
log in, push, approve, publish curriculum, or enroll real learners.

Command references: [ORAS copy](https://oras.land/docs/commands/oras_cp/),
[Skopeo digest preservation](https://github.com/podman-container-tools/skopeo/blob/main/docs/skopeo-copy.1.md),
and [GHCR authentication/access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
