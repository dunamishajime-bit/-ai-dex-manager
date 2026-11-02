#!/usr/bin/env python3
"""Create candidate-SHA-bound static V4 evidence from the immutable release."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

SHA_RE = re.compile(r"^[a-f0-9]{40}$")
RELEASES = Path("/home/deploy/disdex-trading/releases")
EVIDENCE_ROOT = Path("/etc/disdex/v12-v4-evidence")

def _assert_release(sha: str) -> Path:
    if os.geteuid() != 0:
        raise ValueError("ROOT_REQUIRED")
    if not SHA_RE.fullmatch(sha):
        raise ValueError("CANDIDATE_SHA_INVALID")
    root = RELEASES / sha
    st = root.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or root.is_symlink():
        raise ValueError("CANDIDATE_RELEASE_NOT_ROOT_IMMUTABLE")
    marker = root / ".disdex-release-sha"
    mst = marker.lstat()
    if not stat.S_ISREG(mst.st_mode) or mst.st_uid != 0 or mst.st_mode & 0o222:
        raise ValueError("CANDIDATE_RELEASE_MARKER_UNTRUSTED")
    if marker.read_text("ascii").strip() != sha:
        raise ValueError("CANDIDATE_RELEASE_MARKER_MISMATCH")
    return root

def _run(root: Path, argv: list[str]) -> dict:
    result = subprocess.run(argv, cwd=root, capture_output=True, text=True,
                            encoding="utf8", errors="replace", timeout=240)
    output = (result.stdout + "\n" + result.stderr).encode("utf8", errors="replace")
    if result.returncode:
        raise ValueError("STATIC_EVIDENCE_COMMAND_FAILED:" + argv[-1][:120])
    return {"sha256": hashlib.sha256(output).hexdigest(), "returnCode": result.returncode}

def _atomic(path: Path, value: dict) -> None:
    parent = path.parent
    pst = parent.lstat()
    if (not stat.S_ISDIR(pst.st_mode) or parent.is_symlink()
            or pst.st_uid != 0 or pst.st_mode & 0o022):
        raise ValueError("EVIDENCE_ROOT_UNTRUSTED")
    if path.exists() or path.is_symlink():
        st = path.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
            raise ValueError("EVIDENCE_TARGET_UNTRUSTED")
    temp = parent / ("." + path.name + "." + str(os.getpid()) + ".tmp")
    fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as handle:
            json.dump(value, handle, sort_keys=True, indent=2)
            handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        os.chown(temp, 0, pst.st_gid)
        os.chmod(temp, 0o640)
        os.replace(temp, path)
        os.chmod(path, 0o640)
    finally:
        try: temp.unlink()
        except FileNotFoundError: pass

def certify(sha: str) -> dict:
    root = _assert_release(sha)
    node = "/usr/bin/node"
    tsx = str(root / "node_modules/tsx/dist/cli.mjs")
    tsc = str(root / "node_modules/typescript/bin/tsc")
    for required in (tsx, tsc):
        if not Path(required).is_file():
            raise ValueError("CANDIDATE_RUNTIME_DEPENDENCY_MISSING:" + required)
    commands = [
        [node, tsx, "--test",
         "tests/v12-v4-independent-route-audit.test.ts",
         "tests/v12-v4-historical-all41-coverage.test.ts",
         "tests/v12-v4-direct-certified-without-mandatory-canary.test.ts"],
        [node, tsx, "--test",
         "tests/v12-v4-certified-gates.test.ts",
         "tests/v12-v4-recoverable-safety.test.ts",
         "tests/v12-v4-evidence-preflight.test.mjs"],
        [node, tsc, "--noEmit", "-p", "tsconfig.v4-evidence-expiry.json", "--pretty", "false"],
    ]
    results = [_run(root, argv) for argv in commands]
    captured = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    route = {
        "schema": "disdex-v12-v4-evidence/route-source-parity-v1",
        "status": "PASS", "candidateSha": sha, "capturedAt": captured,
        "routeCount": 41, "sourceParity": True,
        "proofSource": "IMMUTABLE_RELEASE_LOCAL_TESTS",
        "commandDigests": [row["sha256"] for row in results[:2]],
    }
    tests = {
        "schema": "disdex-v12-v4-evidence/execution-tests-v1",
        "status": "PASS", "candidateSha": sha, "capturedAt": captured,
        "testPasses": len(results), "failCount": 0, "typecheck": True,
        "proofSource": "IMMUTABLE_RELEASE_LOCAL_TESTS",
        "commandDigests": [row["sha256"] for row in results],
    }
    _atomic(EVIDENCE_ROOT / "route-source-parity.json", route)
    _atomic(EVIDENCE_ROOT / "v4-execution-tests.json", tests)
    return {"status": "V4_STATIC_EVIDENCE_CERTIFIED", "candidateSha": sha,
            "routeCount": 41, "typecheck": True, "testPasses": len(results),
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(certify(args.sha), sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "V4_STATIC_EVIDENCE_BLOCKED",
                         "reason": str(exc)[:240],
                         "ordersSent": 0, "cancelsSent": 0,
                         "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
