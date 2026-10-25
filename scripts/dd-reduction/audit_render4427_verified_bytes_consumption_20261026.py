#!/usr/bin/env python3
"""Deterministic synthetic-only verified-byte boundary audit; no target imports."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

FILES = (
    "render4427_signed_composed_patch_research_20261026.py",
    "render4427_verified_bytes_consumption_research_20261026.py",
    "test_render4427_verified_bytes_consumption_research_20261026.py",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scratch", type=Path, required=True)
    args = parser.parse_args()
    if not args.scratch.is_dir():
        raise SystemExit("REJECT_NO_AUTHORIZED_SCRATCH_ROOT")
    here = Path(__file__).resolve().parent
    digests = {}
    for filename in FILES:
        data = (here / filename).read_bytes()
        digests[filename] = hashlib.sha256(data).hexdigest()
    results = []
    for mode in ("normal", "-O", "-OO"):
        for replica in ("A", "B"):
            command = [sys.executable]
            if mode != "normal":
                command.append(mode)
            command += ["-m", "unittest", "-q",
                        "test_render4427_verified_bytes_consumption_research_20261026"]
            env = os.environ.copy()
            env["RENDER4427_TEST_SCRATCH"] = str(args.scratch.resolve())
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            p = subprocess.run(command, cwd=here, env=env, text=True,
                               capture_output=True, timeout=45)
            output = p.stdout + p.stderr
            m = re.search(r"Ran (\d+) tests", output)
            count = int(m.group(1)) if m else 0
            passed = p.returncode == 0 and count == 12 and re.search(r"^OK$", output, re.M)
            if not passed:
                raise SystemExit("REJECT_INDEPENDENT_TEST_FAILURE " + mode + " " + replica
                                 + "\n" + output[-1000:])
            results.append({"mode": mode, "replica": replica, "tests": count, "pass": True})
    record = {
        "schema": "RENDER4427_VERIFIED_BYTES_SYNTHETIC_AUDIT_V1",
        "scope": "RESEARCH_ONLY_SYNTHETIC",
        "file_sha256": digests,
        "runs": results,
        "tests_total": sum(x["tests"] for x in results),
        "source_path_re_read_proven_safe": False,
        "operator_trust_root_authenticated": False,
        "native_dynamic_import_closure_authenticated": False,
        "native_owner_registered": False,
        "gateproofs_authenticated": 0,
        "order_authorized": False,
        "economic_bt_performed": False,
    }
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False).encode("utf-8")
    print(canonical.decode("utf-8"))
    print("CANONICAL_SHA256", hashlib.sha256(canonical).hexdigest())


if __name__ == "__main__":
    main()
