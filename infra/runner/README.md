# Trusted evaluation artifacts

Foundation 003 provides local artifact construction and sandbox verification.
It does not implement job intake, queue operations, results, or progression.

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

For this Go function profile, fixture source declares `package main`; the trusted
adapter owns `main`. A malformed signature/package fails compilation. No arbitrary
Go modules, build commands, or dependencies are accepted. This is test tooling,
not a learner submission endpoint or a general-purpose Runner evaluation API.

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
   `skopeo copy --preserve-digests oci-archive:/private/artifacts/runner.oci.tar docker://ghcr.io/$OWNER/$RUNNER_REPO:foundation-003`;
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
