import json
from pathlib import Path
import tempfile
import unittest
from artifacts import ROOT, environment, pack, resources, sha, case_records


class MetadataTests(unittest.TestCase):
    def test_invalid_trusted_case_formats(self):
        for pack_id, value in [("hello-go-v1",123),("even-or-odd-v1",True),("even-or-odd-v1",1.5),("even-or-odd-v1",1 << 63)]:
            with self.assertRaises(ValueError):
                case_records(json.dumps([dict(input=value,expected="public-only")]).encode(),pack_id)
        with self.assertRaises(ValueError):
            case_records(b'[{"input":"public","input":"duplicate","expected":"public"}]',"hello-go-v1")

    def test_deterministic_pack_and_changed_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs, output = root / "inputs", root / "output"
            source = inputs / "hello-go-v1"
            source.mkdir(parents=True)
            cases = [{"input": "public-only-test-fixture", "expected": "public-only"}] * 8
            (source / "private.json").write_text(json.dumps(cases))
            (source / "bridge.go").write_text("// non-runnable packaging unit fixture\n")
            env = environment("sha256:" + sha(b"unit-only sandbox metadata"))
            first = pack(inputs, output, "hello-go-v1", env)
            self.assertEqual(first, pack(inputs, output, "hello-go-v1", env))
            cases[0] = {"input": "changed", "expected": "changed"}
            (source / "private.json").write_text(json.dumps(cases))
            self.assertNotEqual(first, pack(inputs, output, "hello-go-v1", env))
            (source / "bridge.go").unlink()
            with self.assertRaises(FileNotFoundError):
                pack(inputs, output, "hello-go-v1", env)

    def test_candidate_is_metadata_only_and_gated(self):
        candidate = json.loads((ROOT / "infra/runner/catalog/candidate.json").read_bytes())
        self.assertEqual(candidate["status"], "CANDIDATE")
        self.assertTrue(candidate["blockers"])
        expected = {"test_pack_digest", "test_pack_artifact", "runner_image_digest",
                    "sandbox_image_digest", "toolchain_version", "target_platform",
                    "build_flags", "dependency_policy", "resource_profile", "resource_limits",
                    "protocol_version", "snapshot_format_version", "case_generation"}
        self.assertEqual(set(candidate["catalog"]["test_packs"]), {"hello-go-v1", "even-or-odd-v1", "checkpoint-normalize-label-v1", "checkpoint-count-vowels-v1", "checkpoint-digit-sum-v1", "checkpoint-sign-label-v1"})
        for pack_id, entry in candidate["catalog"]["test_packs"].items():
            self.assertEqual(set(entry), expected | ({"execution_contract"} if pack_id.startswith("checkpoint-") else set()))
            self.assertIsNone(entry["test_pack_artifact"])
            self.assertRegex(entry["test_pack_digest"], r"^[0-9a-f]{64}$")
            self.assertEqual(entry["resource_limits"], resources())
            self.assertEqual(entry["dependency_policy"], "offline")


if __name__ == "__main__":
    unittest.main()
