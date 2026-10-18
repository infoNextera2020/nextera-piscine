#!/usr/bin/env python3
"""Trusted local OCI builds. Private inputs/output must live outside the checkout.

No publishing, registry authentication, curriculum import, or learner execution.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
IDS = ("hello-go-v1", "even-or-odd-v1")
FLAGS = ["-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="]
TYPE = "application/vnd.nextera.testpack.v1"


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def case_records(data, pack_id):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate trusted case field")
            result[key] = value
        return result
    cases = json.loads(data.decode("utf8"), object_pairs_hook=unique)
    if not isinstance(cases, list) or not cases or pack_id not in IDS:
        raise ValueError("Invalid trusted case array")
    for case in cases:
        if not isinstance(case, dict) or set(case) != {"input", "expected"} or not isinstance(case["expected"], str):
            raise ValueError("Invalid trusted case format")
        value = case["input"]
        if pack_id == "hello-go-v1":
            valid = isinstance(value, str)
        else:
            valid = type(value) is int and -(1 << 63) <= value < (1 << 63)
        if not valid:
            raise ValueError("Trusted case input does not match the pinned Go signature")
    return cases


def sha(data):
    return hashlib.sha256(data).hexdigest()


def private_path(path):
    path = Path(path).resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError("Trusted private inputs/outputs must be outside product checkout")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.stat().st_mode & 0o077:
        raise ValueError("Trusted private directory requires mode 0700")
    return path


def resources():
    def phase(memory, pids, timeout, storage, inodes):
        return dict(cpu_limit=1, memory_bytes=memory << 20, pid_limit=pids,
                    timeout_ms=timeout, output_bytes=65536,
                    temporary_filesystem_bytes=storage << 20,
                    temporary_filesystem_inodes=inodes)
    return dict(compilation=phase(512, 64, 20000, 256, 16384),
                execution=phase(64, 32, 2000, 16, 1024))


def environment(sandbox):
    return dict(sandbox_image_digest=sandbox, toolchain_version="go1.27.2",
                target_platform="linux/amd64", build_flags=FLAGS,
                dependency_policy="offline", resource_profile="go-functions-pilot-v1",
                resource_limits=resources(), protocol_version=1,
                snapshot_format_version=1, case_generation=dict(mode="static"))


def command(args):
    subprocess.run(args, check=True)


def descriptor(data, media, directory):
    digest = sha(data)
    (directory / "blobs" / "sha256" / digest).write_bytes(data)
    return dict(mediaType=media, digest="sha256:" + digest, size=len(data))


def pack(inputs, output, pack_id, env):
    source = inputs / pack_id
    files = {
        "metadata.json": encoded(dict(format_version=1, test_pack_id=pack_id, **env)),
        "cases/public.json": encoded(case_records((ROOT / "infra/runner/public-cases" / (pack_id + ".json")).read_bytes(), pack_id)),
        "cases/private.json": encoded(case_records((source / "private.json").read_bytes(), pack_id)),
        "harness/bridge.go": (source / "bridge.go").read_bytes(),
        "feedback.json": encoded({"passed": "All required checks passed.", "failed": "Required checks did not pass."}),
    }
    private = json.loads(files["cases/private.json"])
    if not isinstance(private, list) or len(private) < 8:
        raise ValueError("Private build owner must supply reviewed hidden coverage")
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(files.items()):
            item = tarfile.TarInfo(name)
            item.mode, item.size, item.mtime = 0o400, len(data), 0
            item.uid = item.gid = 0
            archive.addfile(item, io.BytesIO(data))
    layout = output / pack_id
    (layout / "blobs/sha256").mkdir(parents=True, exist_ok=True)
    config = descriptor(b"{}", "application/vnd.oci.empty.v1+json", layout)
    layer = descriptor(buffer.getvalue(), TYPE + ".tar", layout)
    manifest = descriptor(encoded(dict(schemaVersion=2,
                          mediaType="application/vnd.oci.image.manifest.v1+json",
                          artifactType=TYPE, config=config, layers=[layer])),
                          "application/vnd.oci.image.manifest.v1+json", layout)
    (layout / "oci-layout").write_bytes(encoded({"imageLayoutVersion": "1.0.0"}))
    (layout / "index.json").write_bytes(encoded(dict(schemaVersion=2, manifests=[manifest])))
    return manifest["digest"][7:]


def image(name, dockerfile, context, output):
    metadata = output / (name + "-build.json")
    destination = output / (name + ".oci.tar")
    sources = [(str(p.relative_to(context)), p.read_bytes()) for p in sorted(context.rglob("*")) if p.is_file() and (p.suffix == ".go" or p.name in ("go.mod", "go.sum"))]
    source_digest = "sha256:" + sha(encoded([(name, sha(data)) for name, data in sources]))
    command(["docker", "buildx", "build", "--platform=linux/amd64", "--provenance=false",
             "--sbom=false", "--build-arg=SOURCE_DATE_EPOCH=0", "--output",
             "type=oci,rewrite-timestamp=true,dest=" + str(destination),
             "--build-arg=RUNNER_SOURCE_DIGEST=" + source_digest,
             "--metadata-file", str(metadata), "-f", str(dockerfile), str(context)])
    digest = json.loads(metadata.read_bytes())["containerimage.digest"]
    # Docker's OCI/containerd store retains the manifest as the local image ID.
    # Keep config and manifest identities distinct; never substitute one domain.
    command(["docker", "load", "-i", str(destination)])
    with tarfile.open(destination) as archive:
        raw = archive.extractfile("blobs/sha256/" + digest[7:]).read()
        if sha(raw) != digest[7:]:
            raise ValueError("Image manifest digest mismatch")
        config = json.loads(raw)["config"]["digest"]
    return dict(manifest=digest, config_digest=config, local_ref=digest, source_digest=source_digest)


def build(inputs, output):
    sandbox = image("sandbox", ROOT / "infra/docker/sandbox.Dockerfile", ROOT / "infra/docker", output)
    runner = image("runner", ROOT / "infra/docker/runner.Dockerfile", ROOT / "apps/runner", output)
    env = environment(sandbox["manifest"])
    entries = {}
    for pack_id in IDS:
        digest = pack(inputs, output, pack_id, env)
        entries[pack_id] = dict(test_pack_digest=digest, test_pack_artifact=None,
                                runner_image_digest=runner["manifest"], **env)
    candidate = dict(status="CANDIDATE", blockers=["No private registry references; not approved for publication"],
                     catalog=dict(format_version=1, test_packs=entries))
    (output / "candidate.json").write_bytes(encoded(candidate) + b"\n")
    (output / "local-images.json").write_bytes(encoded(dict(sandbox=sandbox, runner=runner)) + b"\n")
    # Only metadata leaves the private context. It is deliberately rejected by
    # Foundation 002B's exact approved-catalog parser.
    public_metadata = ROOT / "infra/runner/catalog/candidate.json"
    public_metadata.write_bytes(encoded(candidate) + b"\n")
    public_metadata.chmod(0o644)
    print("Local candidate built; publication remains blocked.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    build(private_path(args.inputs), private_path(args.output))
