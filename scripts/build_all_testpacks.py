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
    
    # 2. sign-label-v3 (Contract 3, signlabel.go SignLabel int -> string)
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
        "sign-label-v3",
        {"version": 3, "item_key": "sign-label", "learner_file": "signlabel.go", "function": "SignLabel", "input_type": "int", "output_type": "string"},
        sign_pub, sign_priv
    )

    # 3. count-up-and-down-v3 (Contract 3, counting.go CountUp / CountDown count_up_down -> stdout)
    count_pub = [
        {"input": {"action": "up", "n": 3}, "expected": "1\n2\n3\n"},
        {"input": {"action": "down", "n": 3}, "expected": "3\n2\n1\n"},
        {"input": {"action": "up", "n": 1}, "expected": "1\n"},
        {"input": {"action": "down", "n": 1}, "expected": "1\n"}
    ]
    count_priv = count_pub + [
        {"input": {"action": "up", "n": 0}, "expected": ""},
        {"input": {"action": "down", "n": 0}, "expected": ""},
        {"input": {"action": "up", "n": -2}, "expected": ""},
        {"input": {"action": "down", "n": -2}, "expected": ""},
        {"input": {"action": "up", "n": 4}, "expected": "1\n2\n3\n4\n"},
        {"input": {"action": "down", "n": 4}, "expected": "4\n3\n2\n1\n"}
    ]
    make_pack(
        artifacts,
        "count-up-and-down-v3",
        {"version": 3, "item_key": "count-up-and-down", "learner_file": "counting.go", "function": "CountUpDown", "input_type": "count_up_down", "output_type": "stdout"},
        count_pub, count_priv
    )

    # 4. even-range-v3 (Contract 3, printevens.go PrintEvens int_int -> stdout)
    even_pub = [
        {"input": {"a": -3, "b": 3}, "expected": "-2\n0\n2\n"},
        {"input": {"a": 2, "b": 2}, "expected": "2\n"},
        {"input": {"a": 3, "b": 3}, "expected": ""},
        {"input": {"a": 4, "b": 1}, "expected": ""}
    ]
    even_priv = even_pub + [
        {"input": {"a": 1, "b": 5}, "expected": "2\n4\n"},
        {"input": {"a": -4, "b": 2}, "expected": "-4\n-2\n0\n2\n"},
        {"input": {"a": 0, "b": 0}, "expected": "0\n"},
        {"input": {"a": 1, "b": 1}, "expected": ""},
        {"input": {"a": 10, "b": 2}, "expected": ""}
    ]
    make_pack(
        artifacts,
        "even-range-v3",
        {"version": 3, "item_key": "even-range", "learner_file": "printevens.go", "function": "PrintEvens", "input_type": "int_int", "output_type": "stdout"},
        even_pub, even_priv
    )

    # 5. sum-to-n-v3 (Contract 3, sumto.go SumTo int -> int)
    sum_pub = [
        {"input": 4, "expected": 10},
        {"input": 1, "expected": 1},
        {"input": 0, "expected": 0},
        {"input": -3, "expected": 0}
    ]
    sum_priv = sum_pub + [
        {"input": 5, "expected": 15},
        {"input": -5, "expected": 0},
        {"input": 10, "expected": 55},
        {"input": 20, "expected": 210}
    ]
    make_pack(
        artifacts,
        "sum-to-n-v3",
        {"version": 3, "item_key": "sum-to-n", "learner_file": "sumto.go", "function": "SumTo", "input_type": "int", "output_type": "int"},
        sum_pub, sum_priv
    )

    # 6. star-rectangle-v3 (Contract 3, printrectangle.go PrintRectangle int_int -> stdout)
    rect_pub = [
        {"input": {"a": 2, "b": 3}, "expected": "***\n***\n"},
        {"input": {"a": 1, "b": 1}, "expected": "*\n"},
        {"input": {"a": 0, "b": 3}, "expected": ""},
        {"input": {"a": 2, "b": 0}, "expected": ""},
        {"input": {"a": -1, "b": 2}, "expected": ""}
    ]
    rect_priv = rect_pub + [
        {"input": {"a": 3, "b": 2}, "expected": "**\n**\n**\n"},
        {"input": {"a": 4, "b": 1}, "expected": "*\n*\n*\n*\n"},
        {"input": {"a": 1, "b": 4}, "expected": "****\n"},
        {"input": {"a": -2, "b": -3}, "expected": ""},
        {"input": {"a": 3, "b": 5}, "expected": "*****\n*****\n*****\n"}
    ]
    make_pack(
        artifacts,
        "star-rectangle-v3",
        {"version": 3, "item_key": "star-rectangle", "learner_file": "printrectangle.go", "function": "PrintRectangle", "input_type": "int_int", "output_type": "stdout"},
        rect_pub, rect_priv
    )

    # 7. ordered-pairs-v3 (Contract 3, printorderedpairs.go PrintOrderedPairs int -> stdout)
    pairs_pub = [
        {"input": 2, "expected": "0 1\n0 2\n1 2\n"},
        {"input": 1, "expected": "0 1\n"},
        {"input": 0, "expected": ""},
        {"input": -1, "expected": ""}
    ]
    pairs_priv = pairs_pub + [
        {"input": 3, "expected": "0 1\n0 2\n0 3\n1 2\n1 3\n2 3\n"},
        {"input": -5, "expected": ""},
        {"input": 4, "expected": "0 1\n0 2\n0 3\n0 4\n1 2\n1 3\n1 4\n2 3\n2 4\n3 4\n"}
    ]
    make_pack(
        artifacts,
        "ordered-pairs-v3",
        {"version": 3, "item_key": "ordered-pairs", "learner_file": "printorderedpairs.go", "function": "PrintOrderedPairs", "input_type": "int", "output_type": "stdout"},
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

    # 15. str-rev-v3 (Contract 3, strrev.go StrRev string -> string)
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
        "str-rev-v3",
        {"version": 3, "item_key": "str-rev", "learner_file": "strrev.go", "function": "StrRev", "input_type": "string", "output_type": "string"},
        strrev_pub, strrev_priv
    )

if __name__ == "__main__":
    build_all()
