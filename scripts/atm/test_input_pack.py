"""Offline authoring regressions. Synthetic metadata is never an activation claim."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest

import build_input_pack as pack
from cases import PUBLIC, PRIVATE, InputCase


def fixture_metadata():
    # Deliberately synthetic digest/IDs used only in temporary test artifacts.
    return {
        **copy.deepcopy(pack.ENVIRONMENT_FIELDS),
        "sandbox_image_digest": "sha256:" + "a" * 64,
        "format_version": 1, "test_pack_id": "fixture-atm-only",
        "execution_contract": {**pack.CONTRACT_FIELDS, "item_key": "fixture-atm"},
        "semantic_profile_digest": pack.PROFILE,
    }


class InputPackTests(unittest.TestCase):
    def test_actual_source_cases_are_input_only_and_within_approved_line_scope(self):
        files, manifest = pack.case_files({"public": PUBLIC, "private": PRIVATE})
        self.assertEqual([len(PUBLIC), len(PRIVATE)], [6, 23])
        self.assertEqual(len(manifest["cases"]), 29)
        names = set()
        for group in ("public", "private"):
            values = json.loads(files["cases/" + group + ".json"])
            for item, record in zip(values, (r for r in manifest["cases"] if r["group"] == group)):
                self.assertEqual(set(item), {"input"})
                raw = item["input"].encode("utf-8")
                self.assertEqual(record["input_sha256"], hashlib.sha256(raw).hexdigest())
                self.assertEqual(record["input_bytes"], len(raw))
                self.assertNotIn(record["case"], names)
                names.add(record["case"])
                self.assertTrue(all(len(line) <= 20 for line in item["input"].splitlines()))
                self.assertNotIn("\x00", item["input"])
        self.assertEqual(json.loads(files["cases/public.json"])[0], {"input": ""})

    def test_input_bytes_are_not_trimmed_or_normalized(self):
        text = " 0427\r\n\n٢٥\nlast"
        files, manifest = pack.case_files({
            "public": (InputCase("public-byte-test", "readline", text),),
            "private": (InputCase("private-byte-test", "eof", ""),),
        })
        self.assertEqual(json.loads(files["cases/public.json"])[0]["input"], text)
        self.assertEqual(manifest["cases"][0]["input_sha256"],
                         hashlib.sha256(text.encode("utf-8")).hexdigest())

    def test_case_grammar_and_utf8(self):
        for bad in ([], {}, [None], [{"input": None}], [{}], [{"input": 2}],
                    [{"input": "", "expected": ""}], [{"input": "", "unknown": 1}],
                    [{"input": "\ud800"}], [{"input": ""}] * 10001):
            with self.subTest(bad_type=type(bad).__name__), self.assertRaises(pack.InvalidPack):
                pack.validate_cases(bad)
        self.assertEqual(pack.validate_cases([{"input": ""}]), b'[{"input":""}]\n')
        with self.assertRaises(pack.InvalidPack):
            pack.validate_cases([{"input": "x" * pack.FILE_LIMIT}])

    def test_duplicate_unknown_trailing_and_nonfinite_json_rejected(self):
        for raw in (b'{"input":"","input":"x"}', b'{"a":{"x":1,"x":2}}',
                    b'{}{}', b'{"x":NaN}', b'{"x":Infinity}', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(pack.InvalidPack):
                pack.parse_json(raw)
        with self.assertRaises(pack.InvalidPack):
            pack.parse_json(b" " * (pack.FILE_LIMIT + 1))

    def test_labels_and_groups_are_strict(self):
        with self.assertRaises(pack.InvalidPack):
            pack.case_files({"public": PUBLIC})
        with self.assertRaises(pack.InvalidPack):
            pack.case_files({"public": PUBLIC[:1], "private": PUBLIC[:1]})

    def test_source_only_has_real_hashes_and_no_runner_metadata_or_oci(self):
        plan = pack.build_plan()
        info = json.loads(plan["build-info.json"])
        self.assertEqual(info["status"], "SOURCE_ONLY_NOT_RUNNER_PACK")
        self.assertFalse(info["runtime_ready"])
        self.assertFalse(info["published"])
        self.assertNotIn("metadata.json", plan)
        self.assertNotIn("runner-pack.tar", plan)
        self.assertFalse(any(name.startswith("oci/") for name in plan))
        self.assertIsNone(info["oci_manifest_sha256"])
        self.assertGreaterEqual(len(info["blockers"]), 5)
        for name, record in info["files"].items():
            self.assertEqual(record, {"bytes": len(plan[name]),
                                     "sha256": hashlib.sha256(plan[name]).hexdigest()})
        with tarfile.open(fileobj=io.BytesIO(plan["source-bundle.tar"])) as archive:
            self.assertIn("metadata.required.json", archive.getnames())
            self.assertNotIn("metadata.json", archive.getnames())
        with self.assertRaises(pack.InvalidPack):
            pack.build_plan(oci=True)

    def test_metadata_exact_loader_contract(self):
        self.assertEqual(pack.validate_metadata(fixture_metadata()), fixture_metadata())
        mutations = (
            lambda m: m.update(extra=1),
            lambda m: m.pop("resource_limits"),
            lambda m: m.update(format_version=True),
            lambda m: m.update(test_pack_id="hello-go-v1"),
            lambda m: m.update(test_pack_id="Invalid"),
            lambda m: m.update(sandbox_image_digest=""),
            lambda m: m.update(semantic_profile_digest=None),
            lambda m: m.update(semantic_profile_digest="0" * 64),
            lambda m: m.update(protocol_version=True),
            lambda m: m.update(snapshot_format_version=1.0),
            lambda m: m["case_generation"].update(seed=1),
            lambda m: m["resource_limits"]["execution"].update(timeout_ms=3000),
            lambda m: m["build_flags"].reverse(),
            lambda m: m["execution_contract"].update(version=True),
            lambda m: m["execution_contract"].update(item_key=""),
            lambda m: m["execution_contract"].update(output_type="stdout_utf8_exact"),
            lambda m: m["execution_contract"].update(expected="invented"),
        )
        for change in mutations:
            value = fixture_metadata()
            change(value)
            with self.subTest(change=change), self.assertRaises(pack.InvalidPack):
                pack.build_plan(value, oci=True)

    def test_complete_tar_exact_regular_files_and_deterministic_headers(self):
        plan = pack.build_plan(fixture_metadata())
        self.assertNotIn("source-bundle.tar", plan)
        with tarfile.open(fileobj=io.BytesIO(plan["runner-pack.tar"])) as archive:
            expected = ["cases/private.json", "cases/public.json", "feedback.json",
                        "harness/bridge.go", "metadata.json"]
            self.assertEqual(archive.getnames(), expected)
            for member in archive.getmembers():
                self.assertTrue(member.isfile())
                self.assertEqual((member.uid, member.gid, member.mtime, member.mode),
                                 (0, 0, 0, 0o644))
                self.assertEqual((member.uname, member.gname), ("", ""))
                self.assertEqual(archive.extractfile(member).read(), plan[member.name])
        self.assertNotIn("scoring/groups.json", plan)
        self.assertIn(b"no adapter is executed", plan["harness/bridge.go"])
        self.assertEqual(plan["feedback.json"], b"{}\n")

    def test_oci_actual_descriptors_and_content_addresses(self):
        plan = pack.build_plan(fixture_metadata(), oci=True)
        self.assertEqual(plan["oci/oci-layout"], b'{"imageLayoutVersion":"1.0.0"}')
        index = json.loads(plan["oci/index.json"])
        self.assertEqual(set(index), {"schemaVersion", "manifests"})
        self.assertEqual(len(index["manifests"]), 1)

        def read_descriptor(desc):
            self.assertEqual(set(desc), {"mediaType", "digest", "size"})
            value = plan["oci/blobs/sha256/" + desc["digest"].removeprefix("sha256:")]
            self.assertEqual(desc["size"], len(value))
            self.assertEqual(desc["digest"], "sha256:" + hashlib.sha256(value).hexdigest())
            return value

        manifest_bytes = read_descriptor(index["manifests"][0])
        manifest = json.loads(manifest_bytes)
        self.assertEqual(set(manifest), {"schemaVersion", "mediaType", "artifactType",
                                        "config", "layers"})
        self.assertEqual(manifest["artifactType"], "application/vnd.nextera.testpack.v1")
        self.assertEqual(read_descriptor(manifest["config"]), b"{}")
        self.assertEqual(len(manifest["layers"]), 1)
        self.assertEqual(read_descriptor(manifest["layers"][0]), plan["runner-pack.tar"])
        info = json.loads(plan["build-info.json"])
        self.assertEqual(info["oci_manifest_sha256"], hashlib.sha256(manifest_bytes).hexdigest())
        self.assertFalse(info["runtime_ready"])
        self.assertEqual(len(info["blockers"]), 3)

    def test_deterministic_independent_materializations_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            first, second = root / "first", root / "second"
            one, two = pack.build_plan(), pack.build_plan()
            self.assertEqual(one, two)
            pack.write_plan(first, one)
            pack.write_plan(second, two)
            for name in one:
                self.assertEqual((first / name).read_bytes(), (second / name).read_bytes())
            if os.name == "posix":
                for path in (first, *first.rglob("*")):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode),
                                     0o700 if path.is_dir() else 0o600)
            with self.assertRaises(pack.InvalidPack):
                pack.write_plan(first, one)

    def test_output_must_be_unused_external_absolute_and_no_symlink(self):
        plan = pack.build_plan()
        for target in (Path("relative-output"), pack.REPO / "private-test-output"):
            with self.subTest(target=target), self.assertRaises(pack.InvalidPack):
                pack.write_plan(target, plan)
            self.assertFalse(target.exists())
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            if os.name == "posix":
                (root / "link").symlink_to(root, target_is_directory=True)
                with self.assertRaises(pack.InvalidPack):
                    pack.write_plan(root / "link" / "new", plan)
            with self.assertRaises(pack.InvalidPack):
                pack.write_plan(root / "missing-parent" / "new", plan)

    def test_malicious_plan_rejected_before_any_output_or_outside_write(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            outside = root / "outside"
            members = (
                "../outside", str(outside), "nested/../../outside",
                "nested/../outside", r"nested\outside", "C:/outside",
                r"C:\outside", "", ".", "..", "nested/./file",
                "nested//file", "nested/", "/rooted", "nul\x00name",
                "line\nname", "\ud800",
            )
            plans = [{name: b"never write"} for name in members]
            plans += [{"good.txt": b"valid", "../outside": b"invalid"},
                      {"good.txt": b"valid", "bad.txt": "not bytes"},
                      {"bad.txt": bytearray(b"not immutable bytes")},
                      {1: b"invalid path type"}, {}, []]
            for index, plan in enumerate(plans):
                output = root / ("output-" + str(index))
                with self.subTest(index=index), self.assertRaises(pack.InvalidPack):
                    pack.write_plan(output, plan)
                self.assertFalse(output.exists())
                self.assertFalse(outside.exists())
            self.assertEqual(list(root.iterdir()), [])

    def test_archive_bounds_are_enforced_before_materialization(self):
        with self.assertRaises(pack.InvalidPack):
            pack.tar_bytes({"oversized": b"x" * (pack.FILE_LIMIT + 1)})
        with self.assertRaises(pack.InvalidPack):
            pack.tar_bytes({str(i): b"x" * pack.FILE_LIMIT for i in range(8)})


if __name__ == "__main__":
    unittest.main()
