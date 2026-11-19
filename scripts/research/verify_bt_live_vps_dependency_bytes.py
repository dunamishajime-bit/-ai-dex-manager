#!/usr/bin/env python3
"""Read-only compare pinned Git import-closure hashes to VPS release files."""
from __future__ import annotations
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

def normalize(blob: bytes) -> bytes:
    return blob.removeprefix(b"\xef\xbb\xbf").replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def classify(source: bytes, runtime: bytes) -> str:
    if source == runtime:
        return "EXACT_BYTES"
    if normalize(source) == normalize(runtime):
        return "NEWLINE_OR_BOM_ONLY"
    return "CONTENT_MISMATCH"


def compare_bytes(git: dict, runtime: dict) -> dict:
    expected = git["runners"]
    rows = []
    if set(runtime) != set(expected):
        raise ValueError("Runner coverage differs")
    for name, group in expected.items():
        actual = runtime[name]
        paths = {r["path"]: r for r in group["files"]}
        if set(actual) != set(paths):
            raise ValueError(f"{name}: incomplete file set")
        for path, expected_row in paths.items():
            data = base64.b64decode(actual[path], validate=True) if actual[path] is not None else None
            if data is None:
                kind = "MISSING_VPS_FILE"
            elif hashlib.sha256(data).hexdigest() == expected_row["git_sha256"]:
                kind = "EXACT_BYTES"
            elif hashlib.sha256(normalize(data)).hexdigest() == expected_row["git_normalized_sha256"]:
                kind = "NEWLINE_OR_BOM_ONLY"
            else:
                kind = "CONTENT_MISMATCH"
            rows.append({"runner": name, "path": path, "match_type": kind, "verified": kind in ("EXACT_BYTES", "NEWLINE_OR_BOM_ONLY")})
    return {"rows": rows, "all_files_match": all(r["verified"] for r in rows)}


def remote_payload(group: dict) -> str:
    """Fixed Python snippet reads only files inside the SHA-pinned release."""
    paths = [r["path"] for r in group["files"]]
    data = base64.b64encode(json.dumps({"sha": group["git_commit"], "paths": paths}).encode()).decode()
    return (
        "import base64,json,pathlib\n"
        f"d=json.loads(base64.b64decode({data!r}))\n"
        "root=pathlib.Path('/home/deploy/disdex-trading/releases')/d['sha']\n"
        "out={}\n"
        "for p in d['paths']:\n"
        " f=root/p\n"
        " out[p]=base64.b64encode(f.read_bytes()).decode() if f.is_file() else None\n"
        "print(json.dumps(out))\n"
    )


def verify(git: dict, host: str, key: Path) -> dict:
    if git.get("schema") != "disdex-bt-live-git-dependency-closure/v1":
        raise ValueError("Unknown Git closure schema")
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host) or not key.is_file():
        raise ValueError("Invalid SSH host/key")
    runtime = {}
    for name, group in git["runners"].items():
        command = ["ssh", "-i", str(key), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=10",
                   "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=professional-dismanager.net", f"root@{host}", "python3 -"]
        proc = subprocess.run(command, input=remote_payload(group).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=65)
        if proc.returncode:
            raise RuntimeError(f"{name}: read-only VPS dependency audit failed (exit {proc.returncode})")
        runtime[name] = json.loads(proc.stdout.decode())
    return compare_bytes(git, runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument("--host", required=True)
    parser.add_argument("--key", type=Path, default=Path.home() / "Desktop" / "DisDex.pem")
    parser.add_argument("--closure", type=Path, default=root / "docs/research-results/BT_LIVE_GIT_DEPENDENCY_CLOSURE_20261119_UNCERTIFIED.json")
    parser.add_argument("--output", type=Path, default=root / "docs/research-results/BT_LIVE_VPS_DEPENDENCY_BYTES_20261119_UNCERTIFIED.json")
    args = parser.parse_args()
    evidence = json.loads(args.closure.read_text(encoding="utf-8"))
    # Recalculate normalized Git hashes locally, never substitute a guessed hash.
    for group in evidence["runners"].values():
        for file in group["files"]:
            obj = subprocess.run(["git", "-C", str(root), "show", f"{group['git_commit']}:{file['path']}"],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
            if obj.returncode or hashlib.sha256(obj.stdout).hexdigest() != file["git_sha256"]:
                raise ValueError("Pinned local Git source changed or absent")
            file["git_normalized_sha256"] = hashlib.sha256(normalize(obj.stdout)).hexdigest()
    result = verify(evidence, args.host, args.key)
    report = {"schema": "disdex-bt-live-vps-dependency-bytes/v1", "observed_utc": datetime.now(timezone.utc).isoformat(),
              "scope": "STATIC_GIT_IMPORT_CLOSURE_ONLY", "runtime_dynamic_imports_verified": False,
              "python_imports_verified": False, "external_package_dependencies_verified": False,
              "production_bt_parity_certified": False, **result}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name in evidence["runners"]:
        rows = [r for r in report["rows"] if r["runner"] == name]
        print(f"{name}: files={len(rows)} matched={sum(r['verified'] for r in rows)} mismatched={sum(not r['verified'] for r in rows)}")
    print("CERTIFICATION=BLOCKED_STATIC_DEPENDENCIES_ONLY")
    return 0 if report["all_files_match"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
