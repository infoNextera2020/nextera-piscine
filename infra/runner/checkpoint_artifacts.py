#!/usr/bin/env python3
"""Build only Foundation 006 fixture packs and Runner; preserve prior OCI bytes.
All evaluation inputs and OCI layouts stay in the build owner's private tree.
"""
import argparse
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
from artifacts import ROOT, TYPE, encoded, sha, descriptor, image, private_path


def build(previous, inputs, output):
    prior = json.loads((previous / 'candidate.json').read_bytes())
    identities = json.loads((previous / 'local-images.json').read_bytes())
    for name in ('sandbox.oci.tar','sandbox-build.json'):
        if (previous / name).exists():
            shutil.copyfile(previous / name, output / name)
    entries = prior['catalog']['test_packs']
    if set(entries) != {'hello-go-v1', 'even-or-odd-v1'}:
        raise ValueError('Expected accepted Foundation 004 fixture catalog')
    runner = image('runner', ROOT / 'infra/docker/runner.Dockerfile', ROOT / 'apps/runner', output)
    env = {k: v for k, v in entries['hello-go-v1'].items()
           if k not in ('test_pack_digest', 'test_pack_artifact', 'runner_image_digest')}
    for pack_id, entry in entries.items():
        # Copy immutable legacy layouts, without repacking or rebuilding the sandbox.
        shutil.copytree(previous / pack_id, output / pack_id, dirs_exist_ok=True)
        entry['runner_image_digest'] = runner['manifest']
    for source in sorted(inputs.iterdir()):
        if not source.is_dir():
            continue
        pack_id = source.name
        contract = json.loads((source / 'contract.json').read_bytes())
        if contract['version'] != 1 or contract['input_type'] not in ('string', 'int64') or contract['output_type'] != 'string':
            raise ValueError('Unsupported contract')
        records = {}
        for visibility in ('public', 'private'):
            cases = json.loads((source / (visibility + '.json')).read_bytes())
            if not cases or (visibility == 'private' and len(cases) < 8):
                raise ValueError('Reviewed private coverage required')
            for case in cases:
                if set(case) != {'input', 'expected'} or not isinstance(case['expected'], str):
                    raise ValueError('Invalid case')
                value = case['input']
                if not (isinstance(value, str) if contract['input_type'] == 'string' else type(value) is int and -(1 << 63) <= value < (1 << 63)):
                    raise ValueError('Input contract mismatch')
            records['cases/' + visibility + '.json'] = encoded(cases)
        records.update({'metadata.json': encoded(dict(format_version=1, test_pack_id=pack_id, execution_contract=contract, **env)),
                        'harness/bridge.go': (source / 'bridge.go').read_bytes(),
                        'feedback.json': encoded({'passed': 'All required checks passed.', 'failed': 'Required checks did not pass.'})})
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(records.items()):
                item = tarfile.TarInfo(name)
                item.mode, item.size, item.mtime = 0o400, len(data), 0
                item.uid = item.gid = 0
                archive.addfile(item, io.BytesIO(data))
        layout = output / pack_id
        (layout / 'blobs/sha256').mkdir(parents=True, exist_ok=True)
        config = descriptor(b'{}', 'application/vnd.oci.empty.v1+json', layout)
        layer = descriptor(buffer.getvalue(), TYPE + '.tar', layout)
        manifest = descriptor(encoded(dict(schemaVersion=2, mediaType='application/vnd.oci.image.manifest.v1+json', artifactType=TYPE, config=config, layers=[layer])), 'application/vnd.oci.image.manifest.v1+json', layout)
        (layout / 'oci-layout').write_bytes(encoded({'imageLayoutVersion': '1.0.0'}))
        (layout / 'index.json').write_bytes(encoded(dict(schemaVersion=2, manifests=[manifest])))
        entries[pack_id] = dict(test_pack_digest=manifest['digest'][7:], test_pack_artifact=None, runner_image_digest=runner['manifest'], execution_contract=contract, **env)
    candidate = dict(status='CANDIDATE', blockers=['No private registry references; not approved for publication'], catalog=dict(format_version=1, test_packs=entries))
    (output / 'candidate.json').write_bytes(encoded(candidate) + b'\n')
    (ROOT / 'infra/runner/catalog/candidate.json').write_bytes(encoded(candidate) + b'\n')
    (ROOT / 'infra/runner/catalog/candidate.json').chmod(0o644)
    (output / 'local-images.json').write_bytes(encoded(dict(sandbox=identities['sandbox'], runner=runner)) + b'\n')
    print('Foundation 006 local artifacts built. Catalog remains CANDIDATE.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('previous', 'inputs', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    build(private_path(args.previous), private_path(args.inputs), private_path(args.output))
