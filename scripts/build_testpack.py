#!/usr/bin/env python3
import io
import json
import hashlib
import os
from pathlib import Path
import tarfile

TYPE = "application/vnd.nextera.testpack.v1"

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def descriptor(data, media, directory):
    digest = sha(data)
    (directory / "blobs" / "sha256" / digest).write_bytes(data)
    return dict(mediaType=media, digest="sha256:" + digest, size=len(data))

def make_pack(artifacts_dir: Path, pack_id: str, contract: dict, public_cases: list, private_cases: list):
    candidate_path = artifacts_dir / "candidate.json"
    candidate = json.loads(candidate_path.read_bytes())
    base_entry = candidate["catalog"]["test_packs"]["hello-go-v1"]
    
    env = {k: v for k, v in base_entry.items() 
           if k not in ("test_pack_digest", "test_pack_artifact", "runner_image_digest", "execution_contract")}
    
    records = {
        "metadata.json": encoded(dict(
            format_version=1,
            test_pack_id=pack_id,
            execution_contract=contract,
            **env
        )),
        "cases/public.json": encoded(public_cases),
        "cases/private.json": encoded(private_cases),
        "harness/bridge.go": b"package main\nfunc main() {}\n",
        "feedback.json": encoded({"passed": "All required checks passed.", "failed": "Required checks did not pass."})
    }
    
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(records.items()):
            item = tarfile.TarInfo(name)
            item.mode, item.size, item.mtime = 0o400, len(data), 0
            item.uid = item.gid = 0
            archive.addfile(item, io.BytesIO(data))
            
    layout = artifacts_dir / pack_id
    (layout / "blobs" / "sha256").mkdir(parents=True, exist_ok=True)
    config = descriptor(b"{}", "application/vnd.oci.empty.v1+json", layout)
    layer = descriptor(buffer.getvalue(), TYPE + ".tar", layout)
    manifest = descriptor(encoded(dict(
        schemaVersion=2,
        mediaType="application/vnd.oci.image.manifest.v1+json",
        artifactType=TYPE,
        config=config,
        layers=[layer]
    )), "application/vnd.oci.image.manifest.v1+json", layout)
    
    (layout / "oci-layout").write_bytes(encoded({"imageLayoutVersion": "1.0.0"}))
    (layout / "index.json").write_bytes(encoded(dict(schemaVersion=2, manifests=[manifest])))
    
    entry = dict(
        test_pack_digest=manifest["digest"][7:],
        test_pack_artifact=None,
        runner_image_digest=base_entry["runner_image_digest"],
        execution_contract=contract,
        **env
    )
    
    candidate["catalog"]["test_packs"][pack_id] = entry
    candidate_path.write_bytes(encoded(candidate) + b"\n")
    print(f"Created pack {pack_id} with digest {entry['test_pack_digest']}")
    return entry

def main():
    artifacts = Path("C:/Users/NEXTERA/nextera-judge-artifacts")
    # Test creating greeting-card-v2 (Contract version 2: main.go stdout_utf8_exact)
    contract_greeting = {
        "version": 2,
        "item_key": "greeting-card",
        "learner_file": "main.go",
        "function": "",
        "input_type": "stdin_utf8",
        "output_type": "stdout_utf8_exact"
    }
    greeting_expected = "Hello, Go learner!\nI can run a program.\n"
    cases = [{"input": "", "expected": greeting_expected}]
    make_pack(artifacts, "greeting-card-v2", contract_greeting, cases, cases)

if __name__ == "__main__":
    main()
