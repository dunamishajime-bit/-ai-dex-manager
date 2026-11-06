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
STAGING_BASE = Path("/var/lib/disdex/ops-audit")
MARGIN_RUNTIME_SOURCES = (
    "disdex_v96_v52_margin_guard_runtime.py",
    "disdex_v96_v52_margin_guard.py",
    "disdex_v96_v52_margin_risk_policy.py",
    "disdex_v13d_v11eq_stock_live_engine.py",
)


def _margin_source_digests(root: Path) -> dict[str, str]:
    scripts = root / "scripts"
    digests = {}
    for name in MARGIN_RUNTIME_SOURCES:
        path = scripts / name
        try:
            parent = scripts.lstat()
            metadata = path.lstat()
        except FileNotFoundError as error:
            raise ValueError("MARGIN_RUNTIME_MISSING:" + name) from error
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0
                or parent.st_mode & 0o222 or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != 0 or metadata.st_mode & 0o222):
            raise ValueError("MARGIN_RUNTIME_UNTRUSTED:" + name)
        digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return digests


def _assert_staging_output(sha: str, output: Path) -> Path:
    if (not output.is_absolute() or '..' in output.parts or output.name != sha
            or not output.is_relative_to(STAGING_BASE) or output == STAGING_BASE):
        raise ValueError('STAGING_OUTPUT_UNTRUSTED')
    if output.resolve(strict=True) != output:
        raise ValueError('STAGING_OUTPUT_SYMLINK')
    current = output
    while True:
        meta = current.lstat()
        if (not stat.S_ISDIR(meta.st_mode) or current.is_symlink()
                or meta.st_uid != 0 or meta.st_gid != 0 or meta.st_mode & 0o022
                or (current == output and meta.st_mode & 0o077)):
            raise ValueError('STAGING_OUTPUT_METADATA')
        if current == STAGING_BASE:
            break
        current = current.parent
    for name in ['route-source-parity.json', 'v4-execution-tests.json']:
        if (output / name).exists() or (output / name).is_symlink():
            raise ValueError('STAGING_OUTPUT_ALREADY_EXISTS')
    return output

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
    passed=0
    if '--test' in argv:
        summary={}
        for field in ['tests','pass','fail']:
            rows=re.findall(r'^# '+field+r' (\d+)\s*$',result.stdout,re.MULTILINE)
            if len(rows)!=1:raise ValueError('STATIC_EVIDENCE_TEST_SUMMARY_MISSING_OR_AMBIGUOUS')
            summary[field]=int(rows[0])
        if summary['tests']<=0 or summary['pass']<=0 or summary['fail']!=0 or summary['tests']<summary['pass']:
            raise ValueError('STATIC_EVIDENCE_TEST_SUMMARY_NOT_PASS')
        passed=summary['pass']
    return {"sha256": hashlib.sha256(output).hexdigest(), "returnCode": result.returncode,"testsPassed":passed}

def _atomic(path: Path, value: dict, *, exclusive: bool = False) -> None:
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
        if exclusive:
            os.link(temp, path, follow_symlinks=False)
            temp.unlink()
        else:
            os.replace(temp, path)
        os.chmod(path, 0o640)
    finally:
        try: temp.unlink()
        except FileNotFoundError: pass

def certify(sha: str, *, output_root: Path | None = None) -> dict:
    root = _assert_release(sha)
    destination = EVIDENCE_ROOT if output_root is None else _assert_staging_output(sha, output_root)
    margin_sources = _margin_source_digests(root)
    node = "/usr/bin/node"
    tsx = str(root / "node_modules/tsx/dist/cli.mjs")
    tsc = str(root / "node_modules/typescript/bin/tsc")
    for required in (tsx, tsc):
        if not Path(required).is_file():
            raise ValueError("CANDIDATE_RUNTIME_DEPENDENCY_MISSING:" + required)
    commands = [
        [node, tsx, "--test", "--test-reporter=tap",
         "tests/v12-v4-independent-route-audit.test.ts",
         "tests/v12-v4-historical-all41-coverage.test.ts",
         "tests/v12-v4-direct-certified-without-mandatory-canary.test.ts"],
        [node, tsx, "--test", "--test-reporter=tap",
         "tests/v12-v4-certified-gates.test.ts",
         "tests/v12-v4-recoverable-safety.test.ts",
         "tests/v12-v4-evidence-preflight.test.mjs",
         "tests/v12-v4-flat-lineage-migration.test.ts",
         "tests/v12-v4-state-publication.test.ts",
         "tests/v12-v4-migration-readonly.test.ts"],
        [node, tsc, "--noEmit", "--incremental", "false", "-p", "tsconfig.v4-release-candidate.json", "--pretty", "false"],
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
        "testPasses": sum(row['testsPassed'] for row in results), "commandCount":len(results), "failCount": 0, "typecheck": True,
        "proofSource": "IMMUTABLE_RELEASE_LOCAL_TESTS",
        "marginRuntimeSourceSha256": margin_sources,
        "commandDigests": [row["sha256"] for row in results],
    }
    if output_root is None:
        _atomic(destination / "route-source-parity.json", route)
        _atomic(destination / "v4-execution-tests.json", tests)
    else:
        _assert_staging_output(sha, destination)
        _atomic(destination / "route-source-parity.json", route, exclusive=True)
        _atomic(destination / "v4-execution-tests.json", tests, exclusive=True)
    return {"status": "V4_STATIC_EVIDENCE_CERTIFIED" if output_root is None else "V4_STATIC_EVIDENCE_STAGED_NOT_LIVE", "candidateSha": sha,
            "routeCount": 41, "typecheck": True, "testPasses": tests['testPasses'],"commandCount":len(results),
            "authorizesTrading": False,
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--staging-output", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(certify(args.sha, output_root=args.staging_output), sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "V4_STATIC_EVIDENCE_BLOCKED",
                         "reason": str(exc)[:240],
                         "ordersSent": 0, "cancelsSent": 0,
                         "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
