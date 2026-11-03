import subprocess
import json
from pathlib import Path

candidate_path = Path("C:/Users/NEXTERA/nextera-judge-artifacts/candidate.json")
candidate = json.loads(candidate_path.read_bytes())
packs = candidate["catalog"]["test_packs"]

failed = 0
for pack_id in packs:
    layout = f"/mnt/c/Users/NEXTERA/nextera-judge-artifacts/{pack_id}"
    cmd = [
        "wsl",
        "/mnt/c/Users/NEXTERA/Desktop/nextera-piscine/.tools/runner",
        "verify-artifact",
        "--layout", layout,
        "--candidate", "/mnt/c/Users/NEXTERA/nextera-judge-artifacts/candidate.json",
        "--pack-id", pack_id
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"[OK] {pack_id}: {res.stdout.strip()}")
    else:
        print(f"[FAIL] {pack_id}: {res.stderr.strip() or res.stdout.strip()}")
        failed += 1

print(f"\nTotal: {len(packs)} verified, {failed} failed.")
