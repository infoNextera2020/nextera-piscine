# Private ATM ABI4 input-pack authoring

These offline authoring tools are separate from the learner handoff, public assets
and curriculum source package. Never copy the private case source or generated
artifacts into those packages. They contain only approved business/ReadLine inputs;
there is no reference ATM implementation, expected trace, score or new criterion.

Run with installed Python 3, from this directory:

```sh
python3 -m unittest -v test_input_pack.py
python3 build_input_pack.py --output /absolute/unused/protected/directory
```

The default emits a deterministic **SOURCE_ONLY_NOT_RUNNER_PACK** bundle. Its
public/private arrays contain exactly input strings; ordered input SHA-256 records
bind the raw UTF-8 bytes without newline normalization. No metadata.json or OCI is
emitted while explicit pack/node/environment bindings are missing. All generated
directories/files use 0700/0600 and the output must be outside this checkout.

For a complete unpublished layout candidate, a caller must supply the exact ABI4
metadata accepted by the Runner loader:

```sh
python3 build_input_pack.py --metadata /protected/explicit-metadata.json \
  --oci --output /absolute/unused/protected/directory
```

This validates the root semantic profile and all fourteen root fields, the exact
six-field ABI4 contract and current ten-field Environment. Constants in the
validator describe existing loader compatibility constraints; they do not choose
or register an ATM runtime policy. There is no default image digest, pack ID,
item key, catalog entry or registry reference.

The Runner tar has exactly metadata.json, cases/public.json, cases/private.json,
harness/bridge.go and feedback.json. The bridge is inert; no solution or oracle is
imported or executed. OCI config/manifest/layer/index digests are computed from the
actual bytes. Tar headers use sorted names, epoch timestamps and fixed owners.

Even a supplied-metadata layout remains unpublished and runtime_ready=false.
Activation still needs authenticated image/resource/catalog bindings, trusted
Runner aggregate model-output budget compatibility, immutable registration,
publication authorization, and the assigned-mentor final gate. This builder does
not run Go, learner code, Docker, a registry, a database or any live service.
