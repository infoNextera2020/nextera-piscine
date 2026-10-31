#!/usr/bin/env python3
"""Offline private ABI4 input-pack authoring. Never publishes or runs a learner."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile

from cases import PUBLIC, PRIVATE

PROFILE = "f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007"
FILE_LIMIT = 1 << 20
BLOB_LIMIT = 8 << 20
CASE_LIMIT = 10000
REPO = Path(__file__).resolve().parents[2]
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
CONTRACT_FIELDS = {
    "version": 4, "learner_file": "main.go", "function": "",
    "input_type": "stdin_utf8", "output_type": "atm_report_events_v1",
}
# Loader compatibility constraints, NOT default active ATM execution policy.
ENVIRONMENT_FIELDS = {
    "toolchain_version": "go1.27.2", "target_platform": "linux/amd64",
    "build_flags": ["-trimpath", "-buildvcs=false", "-p=1", "-ldflags=-buildid="],
    "dependency_policy": "offline", "resource_profile": "go-functions-pilot-v1",
    "resource_limits": {
        "compilation": {
            "cpu_limit": 1, "memory_bytes": 536870912, "pid_limit": 64,
            "timeout_ms": 20000, "output_bytes": 65536,
            "temporary_filesystem_bytes": 268435456,
            "temporary_filesystem_inodes": 16384,
        },
        "execution": {
            "cpu_limit": 1, "memory_bytes": 67108864, "pid_limit": 32,
            "timeout_ms": 2000, "output_bytes": 65536,
            "temporary_filesystem_bytes": 16777216,
            "temporary_filesystem_inodes": 1024,
        },
    },
    "protocol_version": 1, "snapshot_format_version": 1,
    "case_generation": {"mode": "static"},
}
BRIDGE = b"// Inert ABI4 layout member. Runner derives observations; no adapter is executed.\npackage main\n"
FEEDBACK = b"{}\n"
MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json"
BLOCKERS = [
    "approved explicit test_pack_id and item_key binding",
    "authenticated sandbox_image_digest and explicit complete execution metadata",
    "trusted Runner aggregate expected-output budget compatibility",
    "runner_image_digest, immutable catalog/artifact reference and registration",
    "publication authorization and assigned-mentor final gate",
]


class InvalidPack(ValueError):
    pass


def json_bytes(value):
    try:
        return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as error:
        raise InvalidPack("invalid JSON/UTF-8 value") from error


def sha(data):
    return hashlib.sha256(data).hexdigest()


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidPack("duplicate JSON field")
        result[key] = value
    return result


def parse_json(data):
    if len(data) > FILE_LIMIT:
        raise InvalidPack("JSON file exceeds 1 MiB")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_object,
                          parse_constant=lambda value: (_ for _ in ()).throw(
                              InvalidPack("nonfinite JSON number")))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise InvalidPack("invalid JSON document") from error


def exact_keys(value, expected):
    if type(value) is not dict or set(value) != set(expected):
        raise InvalidPack("unexpected or missing fields")


def valid_id(value):
    return type(value) is str and len(value) <= 100 and ID.fullmatch(value) is not None


def validate_metadata(metadata):
    expected = set(ENVIRONMENT_FIELDS) | {
        "sandbox_image_digest", "execution_contract", "semantic_profile_digest",
        "format_version", "test_pack_id",
    }
    exact_keys(metadata, expected)
    if type(metadata["format_version"]) is not int or metadata["format_version"] != 1:
        raise InvalidPack("format_version must be integer 1")
    if not valid_id(metadata["test_pack_id"]) or metadata["test_pack_id"] in (
            "hello-go-v1", "even-or-odd-v1"):
        raise InvalidPack("explicit nonlegacy test_pack_id required")
    if metadata["semantic_profile_digest"] != PROFILE:
        raise InvalidPack("semantic profile mismatch")
    contract = metadata["execution_contract"]
    exact_keys(contract, set(CONTRACT_FIELDS) | {"item_key"})
    if not valid_id(contract["item_key"]):
        raise InvalidPack("explicit item_key required")
    for key, value in CONTRACT_FIELDS.items():
        if json_bytes(contract[key]) != json_bytes(value):
            raise InvalidPack("ABI4 contract mismatch: " + key)
    image = metadata["sandbox_image_digest"]
    if type(image) is not str or DIGEST.fullmatch(image) is None:
        raise InvalidPack("explicit sandbox digest required")
    for key, value in ENVIRONMENT_FIELDS.items():
        if json_bytes(metadata[key]) != json_bytes(value):
            raise InvalidPack("loader environment mismatch: " + key)
    return metadata


def validate_cases(cases):
    if type(cases) is not list or not 1 <= len(cases) <= CASE_LIMIT:
        raise InvalidPack("nonempty bounded case array required")
    for case in cases:
        exact_keys(case, {"input"})
        if type(case["input"]) is not str:
            raise InvalidPack("case input must be a string")
        try:
            case["input"].encode("utf-8")
        except UnicodeError as error:
            raise InvalidPack("case input must be valid UTF-8") from error
    encoded = json_bytes(cases)
    if len(encoded) > FILE_LIMIT:
        raise InvalidPack("case file exceeds 1 MiB")
    return encoded


def case_files(groups):
    if type(groups) is not dict or set(groups) != {"public", "private"}:
        raise InvalidPack("exact public/private groups required")
    result, ordered, names = {}, [], set()
    for group in ("public", "private"):
        values = []
        for index, case in enumerate(groups[group]):
            if not valid_id(case.name) or case.name in names:
                raise InvalidPack("case labels must be unique valid identifiers")
            names.add(case.name)
            values.append({"input": case.input})
            encoded = case.input.encode("utf-8")
            ordered.append({"group": group, "index": index, "case": case.name,
                            "approved_rule": case.rule, "input_bytes": len(encoded),
                            "input_sha256": sha(encoded)})
        result["cases/" + group + ".json"] = validate_cases(values)
    return result, {"format_version": 1, "semantic_profile_digest": PROFILE,
                    "order": "public then private; zero-based index",
                    "cases": ordered}


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(files.items()):
            if len(data) > FILE_LIMIT:
                raise InvalidPack("pack member exceeds 1 MiB")
            header = tarfile.TarInfo(name)
            header.size, header.mode, header.mtime = len(data), 0o644, 0
            header.uid = header.gid = 0
            header.uname = header.gname = ""
            archive.addfile(header, io.BytesIO(data))
    data = output.getvalue()
    if len(data) > BLOB_LIMIT:
        raise InvalidPack("tar exceeds 8 MiB")
    return data


def descriptor(media, data):
    return {"mediaType": media, "digest": "sha256:" + sha(data), "size": len(data)}


def oci_files(layer):
    config = b"{}"
    manifest = json_bytes({
        "schemaVersion": 2, "mediaType": MANIFEST_MEDIA,
        "artifactType": "application/vnd.nextera.testpack.v1",
        "config": descriptor("application/vnd.oci.empty.v1+json", config),
        "layers": [descriptor("application/vnd.nextera.testpack.v1.tar", layer)],
    })
    entries = {
        "oci/oci-layout": b'{"imageLayoutVersion":"1.0.0"}',
        "oci/index.json": json_bytes({"schemaVersion": 2,
                                     "manifests": [descriptor(MANIFEST_MEDIA, manifest)]}),
    }
    for data in (config, layer, manifest):
        entries["oci/blobs/sha256/" + sha(data)] = data
    return entries, sha(manifest)


def build_plan(metadata=None, oci=False, groups=None):
    if oci and metadata is None:
        raise InvalidPack("OCI requires explicit complete metadata; no defaults")
    files, ordered = case_files(groups if groups is not None else {
        "public": PUBLIC, "private": PRIVATE})
    files.update({"harness/bridge.go": BRIDGE, "feedback.json": FEEDBACK})
    manifest = json_bytes(ordered)
    result = dict(files)
    result["input-manifest.json"] = manifest
    mode, digest = "SOURCE_ONLY_NOT_RUNNER_PACK", None
    blockers = list(BLOCKERS)
    if metadata is None:
        requirements = {
            "status": mode, "semantic_profile_digest": PROFILE,
            "unbound_contract_fields": ["item_key"],
            "required_contract_fields": CONTRACT_FIELDS,
            "required_explicit_metadata_fields": sorted(set(ENVIRONMENT_FIELDS) | {
                "sandbox_image_digest", "format_version", "test_pack_id",
                "execution_contract", "semantic_profile_digest"}),
            "blockers": blockers,
        }
        result["metadata.required.json"] = json_bytes(requirements)
        result["source-bundle.tar"] = tar_bytes({
            **files, "input-manifest.json": manifest,
            "metadata.required.json": result["metadata.required.json"]})
    else:
        metadata = validate_metadata(metadata)
        files["metadata.json"] = json_bytes(metadata)
        result["metadata.json"] = files["metadata.json"]
        layer = tar_bytes(files)
        result["runner-pack.tar"] = layer
        mode = "UNPUBLISHED_RUNNER_LAYOUT_CANDIDATE"
        blockers = blockers[2:]
        if oci:
            layout, digest = oci_files(layer)
            result.update(layout)
    result["build-info.json"] = json_bytes({
        "status": mode, "runtime_ready": False, "published": False,
        "semantic_profile_digest": PROFILE, "oci_manifest_sha256": digest,
        "public_case_count": len(PUBLIC if groups is None else groups["public"]),
        "private_case_count": len(PRIVATE if groups is None else groups["private"]),
        "files": {name: {"sha256": sha(data), "bytes": len(data)}
                  for name, data in sorted(result.items())},
        "blockers": blockers,
    })
    return result


def write_plan(output, plan, repo=REPO):
    # Validate the entire plan BEFORE creating the private output root. Callers
    # extending the fixed builder must not introduce extraction-style traversal.
    if type(plan) is not dict or not plan:
        raise InvalidPack("nonempty file plan required")
    for name, data in plan.items():
        if (type(name) is not str or not name or "\\" in name or ":" in name or
                any(part in ("", ".", "..") for part in name.split("/")) or
                any(ord(char) < 32 or ord(char) == 127 for char in name) or
                type(data) is not bytes):
            raise InvalidPack("plan members must be relative POSIX file paths and bytes")
        try:
            name.encode("utf-8")
        except UnicodeError as error:
            raise InvalidPack("plan member path must be valid UTF-8") from error
    output = Path(output)
    if not output.is_absolute():
        raise InvalidPack("output must be an absolute protected directory")
    for parent in (output, *output.parents):
        if parent.is_symlink():
            raise InvalidPack("output path must not contain symlinks")
    resolved = output.resolve()
    if resolved == repo.resolve() or repo.resolve() in resolved.parents:
        raise InvalidPack("private artifacts must remain outside the checkout")
    if output.exists() or not output.parent.is_dir():
        raise InvalidPack("output must be unused, with an existing parent")
    # Exclusive output; no existing data is overwritten. The whole public/private
    # authoring artifact is private on disk, regardless of the tar header modes.
    old_mask = os.umask(0o077)
    try:
        output.mkdir(mode=0o700)
        for name, data in sorted(plan.items()):
            target = output / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(data)
            target.chmod(0o600)
    finally:
        os.umask(old_mask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--oci", action="store_true")
    args = parser.parse_args()
    metadata = None
    if args.metadata is not None:
        if args.metadata.is_symlink() or not args.metadata.is_file():
            parser.error("metadata must be a regular non-symlink file")
        with args.metadata.open("rb") as stream:
            metadata = parse_json(stream.read(FILE_LIMIT + 1))
    try:
        plan = build_plan(metadata, args.oci)
        write_plan(args.output, plan)
    except (InvalidPack, OSError) as error:
        parser.error(str(error))
    info = json.loads(plan["build-info.json"])
    print(json.dumps({"status": info["status"], "output": str(args.output),
                      "build_info_sha256": sha(plan["build-info.json"]),
                      "runtime_ready": False}, sort_keys=True))


if __name__ == "__main__":
    main()
