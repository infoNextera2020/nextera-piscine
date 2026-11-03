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

def make_pack(artifacts_dir: Path, pack_id: str, contract: dict, public_cases: list, private_cases: list, bridge_source: bytes = b"package main\nfunc main() {}\n"):
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
        "harness/bridge.go": bridge_source,
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
    print(f"[OK] Pack {pack_id} created (digest {entry['test_pack_digest'][:12]}...)")
    return entry

def build_all():
    artifacts = Path("C:/Users/NEXTERA/nextera-judge-artifacts")
    
    # 1. greeting-card-v2 (Contract 2, main.go stdout_utf8_exact)
    make_pack(
        artifacts,
        "greeting-card-v2",
        {"version": 2, "item_key": "greeting-card", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        [{"input": "", "expected": "Hello, Go learner!\nI can run a program.\n"}],
        [{"input": "", "expected": "Hello, Go learner!\nI can run a program.\n"}]
    )
    
    # 2. sign-label-v1 (Contract 1, signlabel.go SignLabel int64 -> string)
    sign_pub = [
        {"input": -4, "expected": "negative"},
        {"input": 0, "expected": "zero"},
        {"input": 7, "expected": "positive"}
    ]
    sign_priv = sign_pub + [
        {"input": -100, "expected": "negative"},
        {"input": 100, "expected": "positive"},
        {"input": -1, "expected": "negative"},
        {"input": 1, "expected": "positive"},
        {"input": -42, "expected": "negative"}
    ]
    make_pack(
        artifacts,
        "sign-label-v1",
        {"version": 1, "item_key": "sign-label", "learner_file": "signlabel.go", "function": "SignLabel", "input_type": "int64", "output_type": "string"},
        sign_pub, sign_priv
    )

    # 3. count-up-and-down-v2 (Contract 2, main.go stdin_utf8 -> stdout_utf8_exact)
    count_pub = [
        {"input": "3\n", "expected": "1\n2\n3\n3\n2\n1\n"},
        {"input": "1\n", "expected": "1\n1\n"}
    ]
    count_priv = count_pub + [
        {"input": "0\n", "expected": ""},
        {"input": "-2\n", "expected": ""},
        {"input": "4\n", "expected": "1\n2\n3\n4\n4\n3\n2\n1\n"}
    ]
    make_pack(
        artifacts,
        "count-up-and-down-v2",
        {"version": 2, "item_key": "count-up-and-down", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        count_pub, count_priv
    )

    # 4. even-range-v2 (Contract 2, main.go stdin_utf8 -> stdout_utf8_exact)
    even_pub = [
        {"input": "1 5\n", "expected": "2\n4\n"},
        {"input": "-4 2\n", "expected": "-4\n-2\n0\n2\n"}
    ]
    even_priv = even_pub + [
        {"input": "5 1\n", "expected": ""},
        {"input": "0 0\n", "expected": "0\n"},
        {"input": "2 2\n", "expected": "2\n"},
        {"input": "1 1\n", "expected": ""}
    ]
    make_pack(
        artifacts,
        "even-range-v2",
        {"version": 2, "item_key": "even-range", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        even_pub, even_priv
    )

    # 5. sum-to-n-v2 (Contract 2, main.go stdin_utf8 -> stdout_utf8_exact)
    sum_pub = [
        {"input": "3\n", "expected": "6\n"},
        {"input": "5\n", "expected": "15\n"}
    ]
    sum_priv = sum_pub + [
        {"input": "1\n", "expected": "1\n"},
        {"input": "0\n", "expected": "0\n"},
        {"input": "-5\n", "expected": "0\n"},
        {"input": "10\n", "expected": "55\n"}
    ]
    make_pack(
        artifacts,
        "sum-to-n-v2",
        {"version": 2, "item_key": "sum-to-n", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        sum_pub, sum_priv
    )

    # 6. star-rectangle-v2 (Contract 2, main.go stdin_utf8 -> stdout_utf8_exact)
    rect_pub = [
        {"input": "3 2\n", "expected": "***\n***\n"},
        {"input": "1 1\n", "expected": "*\n"}
    ]
    rect_priv = rect_pub + [
        {"input": "0 2\n", "expected": ""},
        {"input": "4 1\n", "expected": "****\n"},
        {"input": "2 3\n", "expected": "**\n**\n**\n"}
    ]
    make_pack(
        artifacts,
        "star-rectangle-v2",
        {"version": 2, "item_key": "star-rectangle", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        rect_pub, rect_priv
    )

    # 7. ordered-pairs-v2 (Contract 2, main.go stdin_utf8 -> stdout_utf8_exact)
    pairs_pub = [
        {"input": "3\n", "expected": "1 2\n1 3\n2 3\n"},
        {"input": "2\n", "expected": "1 2\n"}
    ]
    pairs_priv = pairs_pub + [
        {"input": "1\n", "expected": ""},
        {"input": "4\n", "expected": "1 2\n1 3\n1 4\n2 3\n2 4\n3 4\n"}
    ]
    make_pack(
        artifacts,
        "ordered-pairs-v2",
        {"version": 2, "item_key": "ordered-pairs", "learner_file": "main.go", "function": "", "input_type": "stdin_utf8", "output_type": "stdout_utf8_exact"},
        pairs_pub, pairs_priv
    )

    # --- QUEST 3 ---
    # 8. strlen-v3 (Contract 3, strlen.go StrLen string -> int)
    strlen_pub = [
        {"input": "Hello World!", "expected": 12},
        {"input": "NextEra", "expected": 7}
    ]
    strlen_priv = strlen_pub + [
        {"input": "", "expected": 0},
        {"input": "a", "expected": 1},
        {"input": "1234567890", "expected": 10},
        {"input": "Go programming", "expected": 14}
    ]
    make_pack(
        artifacts,
        "strlen-v3",
        {"version": 3, "item_key": "strlen", "learner_file": "strlen.go", "function": "StrLen", "input_type": "string", "output_type": "int"},
        strlen_pub, strlen_priv
    )

    # 9. pointone-v1 (Contract 3, pointone.go PointOne pointer_int -> pointer_int)
    pointone_pub = [
        {"input": {"pointer": 7}, "expected": 1},
        {"input": {"pointer": -3}, "expected": 1}
    ]
    pointone_priv = pointone_pub + [
        {"input": {"pointer": 1}, "expected": 1},
        {"input": {"pointer": 0}, "expected": 1},
        {"input": {"pointer": 100}, "expected": 1},
        {"input": {"pointer": -100}, "expected": 1}
    ]
    make_pack(
        artifacts,
        "pointone-v1",
        {"version": 3, "item_key": "pointone", "learner_file": "pointone.go", "function": "PointOne", "input_type": "pointer_int", "output_type": "pointer_int"},
        pointone_pub, pointone_priv
    )

    # 10. swap-v3 (Contract 3, swap.go Swap pointer_pair -> swap)
    swap_pub = [
        {"input": {"a": 3, "b": 8}, "expected": {"a": 8, "b": 3}},
        {"input": {"a": -2, "b": 0}, "expected": {"a": 0, "b": -2}}
    ]
    swap_priv = swap_pub + [
        {"input": {"a": 4, "b": 4}, "expected": {"a": 4, "b": 4}},
        {"input": {"a": 100, "b": -100}, "expected": {"a": -100, "b": 100}},
        {"input": {"a": 0, "b": 42}, "expected": {"a": 42, "b": 0}}
    ]
    make_pack(
        artifacts,
        "swap-v3",
        {"version": 3, "item_key": "swap", "learner_file": "swap.go", "function": "Swap", "input_type": "pointer_pair", "output_type": "swap"},
        swap_pub, swap_priv
    )

    # 11. div-mod-v3 (Contract 3, divmod.go DivMod int_int -> div_mod)
    divmod_pub = [
        {"input": {"a": 13, "b": 2}, "expected": {"div": 6, "mod": 1}},
        {"input": {"a": 12, "b": 3}, "expected": {"div": 4, "mod": 0}}
    ]
    divmod_priv = divmod_pub + [
        {"input": {"a": 0, "b": 5}, "expected": {"div": 0, "mod": 0}},
        {"input": {"a": 3, "b": 5}, "expected": {"div": 0, "mod": 3}},
        {"input": {"a": 100, "b": 10}, "expected": {"div": 10, "mod": 0}},
        {"input": {"a": 100, "b": 7}, "expected": {"div": 14, "mod": 2}},
        {"input": {"a": 1, "b": 1}, "expected": {"div": 1, "mod": 0}}
    ]
    make_pack(
        artifacts,
        "div-mod-v3",
        {"version": 3, "item_key": "div-mod", "learner_file": "divmod.go", "function": "DivMod", "input_type": "int_int", "output_type": "div_mod"},
        divmod_pub, divmod_priv
    )

    # 11. basic-atoi-v3 (Contract 3, basicatoi.go BasicAtoi string -> int)
    batoi_pub = [
        {"input": "12345", "expected": 12345},
        {"input": "0", "expected": 0}
    ]
    batoi_priv = batoi_pub + [
        {"input": "7", "expected": 7},
        {"input": "987654", "expected": 987654},
        {"input": "42", "expected": 42}
    ]
    make_pack(
        artifacts,
        "basic-atoi-v3",
        {"version": 3, "item_key": "basic-atoi", "learner_file": "basicatoi.go", "function": "BasicAtoi", "input_type": "string", "output_type": "int"},
        batoi_pub, batoi_priv
    )

    # 12. basic-atoi2-v3 (Contract 3, basicatoi2.go BasicAtoi2 string -> int)
    batoi2_pub = [
        {"input": "12345", "expected": 12345},
        {"input": "12a34", "expected": 0}
    ]
    batoi2_priv = batoi2_pub + [
        {"input": "", "expected": 0},
        {"input": "   ", "expected": 0},
        {"input": "999", "expected": 999},
        {"input": "0", "expected": 0}
    ]
    make_pack(
        artifacts,
        "basic-atoi2-v3",
        {"version": 3, "item_key": "basic-atoi2", "learner_file": "basicatoi2.go", "function": "BasicAtoi2", "input_type": "string", "output_type": "int"},
        batoi2_pub, batoi2_priv
    )

    # 13. atoi-v3 (Contract 3, atoi.go Atoi string -> int)
    atoi_pub = [
        {"input": "-1234", "expected": -1234},
        {"input": "+1234", "expected": 1234},
        {"input": "1234", "expected": 1234}
    ]
    atoi_priv = atoi_pub + [
        {"input": "--1", "expected": 0},
        {"input": "++1", "expected": 0},
        {"input": "", "expected": 0},
        {"input": "0", "expected": 0},
        {"input": "-0", "expected": 0},
        {"input": "-42", "expected": -42}
    ]
    make_pack(
        artifacts,
        "atoi-v3",
        {"version": 3, "item_key": "atoi", "learner_file": "atoi.go", "function": "Atoi", "input_type": "string", "output_type": "int"},
        atoi_pub, atoi_priv
    )

    # 14. sum-slice-v3 (Contract 3, sumslice.go SumSlice int_slice -> int_slice_preserved)
    sumslice_pub = [
        {"input": [1, 2, 3], "expected": 6},
        {"input": [-1, 1], "expected": 0}
    ]
    sumslice_priv = sumslice_pub + [
        {"input": [], "expected": 0},
        {"input": [10, 20, 30, 40], "expected": 100},
        {"input": [-5, -10], "expected": -15}
    ]
    make_pack(
        artifacts,
        "sum-slice-v3",
        {"version": 3, "item_key": "sum-slice", "learner_file": "sumslice.go", "function": "SumSlice", "input_type": "int_slice", "output_type": "int_slice_preserved"},
        sumslice_pub, sumslice_priv
    )

    # 15. str-rev-v1 (Contract 1, strrev.go StrRev string -> string)
    strrev_pub = [
        {"input": "Hello World!", "expected": "!dlroW olleH"},
        {"input": "NextEra", "expected": "arEtxeN"}
    ]
    strrev_priv = strrev_pub + [
        {"input": "", "expected": ""},
        {"input": "a", "expected": "a"},
        {"input": "ab", "expected": "ba"},
        {"input": "12345", "expected": "54321"}
    ]
    make_pack(
        artifacts,
        "str-rev-v1",
        {"version": 1, "item_key": "str-rev", "learner_file": "strrev.go", "function": "StrRev", "input_type": "string", "output_type": "string"},
        strrev_pub, strrev_priv
    )

if __name__ == "__main__":
    build_all()
