#!/usr/bin/env python3
"""Read-only, fail-closed verifier of active VPS runner entrypoints against pinned Git blobs.

Requires a locally controlled SSH key. Never copies that key or fetches credentials.
This checks one entrypoint per runner; it does NOT certify full production BT parity.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ENTRYPOINTS = {
    "V4": ("disdex-v12-v4", "scripts/v12-v4-production-runner.ts"),
    "Q102": ("disdex-quality102-causal-v1", "scripts/disdex-quality102-causal-v1-live-runner.ts"),
    "V52": ("disdex-v52-aster-only", "scripts/disdex_v52_aster_only_live_engine.py"),
    "PENGU": ("disdex-pengu-dual-ls-v2", "scripts/disdex-pengu-dual-ls-v2-live-runner.ts"),
    "HYPE": ("disdex-hype-long", "scripts/disdex-hype-zec-long-live-runner.ts"),
    "SharedRisk": ("disdex-shared-crypto-risk", "scripts/disdex-shared-crypto-risk-writer.ts"),
    "FET": ("disdex-fet-brk48", "scripts/disdex-fet-brk48-live-runner.ts"),
    "IDLE": ("disdex-idle-priority-short", "scripts/disdex-idle-priority-short-live-runner.ts"),
}
RELEASE_ROOT = "/home/deploy/disdex-trading/releases"


def sha256(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def normalize_newlines(blob: bytes) -> bytes:
    return blob.removeprefix(b"\xef\xbb\xbf").replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def classify_blob(git_blob: bytes, runtime_blob: bytes) -> str:
    if git_blob == runtime_blob:
        return "EXACT_BYTES"
    if normalize_newlines(git_blob) == normalize_newlines(runtime_blob):
        return "NEWLINE_OR_BOM_ONLY"
    return "CONTENT_MISMATCH"


def selected_units(unit_listing: str) -> dict[str, tuple[str, str]]:
    names = [line.split()[0] for line in unit_listing.splitlines() if line.strip()]
    result: dict[str, tuple[str, str]] = {}
    for runner, (prefix, _) in ENTRYPOINTS.items():
        pattern = re.compile(r"^" + re.escape(prefix) + r"@([0-9a-f]{40})\.service$")
        found = [(name, match.group(1)) for name in names if (match := pattern.fullmatch(name))]
        if len(found) != 1:
            raise ValueError(f"{runner}: expected exactly one RUNNING versioned service, found {len(found)}")
        result[runner] = found[0]
    return result


def run(argv: list[str], timeout: int = 30) -> bytes:
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        # Deliberately do not echo full stderr; SSH errors can reveal local paths.
        raise RuntimeError(f"read-only command failed (exit {result.returncode}): {argv[0]}")
    return result.stdout


def entrypoint_in_execstart(execstart: str, full_path: str, relative_path: str) -> bool:
    """Accept an absolute path, or a relative script token under the checked WorkingDirectory."""
    return full_path in execstart or bool(
        re.search(r"(?<!\S)" + re.escape(relative_path) + r"(?=\s|;|$)", execstart)
    )

def verify(host: str, key: Path, repo: Path) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
        raise ValueError("Unsafe VPS hostname")
    if not key.is_file():
        raise FileNotFoundError("SSH key not found on owner PC")
    ssh = [
        "ssh", "-i", str(key), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes",
        "-o", "HostKeyAlias=professional-dismanager.net", f"root@{host}",
    ]
    listing = run(ssh + ["systemctl list-units --type=service --state=running --no-legend --plain"]).decode("utf-8", "replace")
    units = selected_units(listing)
    rows = []
    for runner, (_, relpath) in ENTRYPOINTS.items():
        unit, commit = units[runner]
        details = run(ssh + [f"systemctl show {unit} --property=WorkingDirectory,ExecStart,ActiveState,SubState,NRestarts --no-pager"]).decode("utf-8", "replace")
        fields = dict(line.split("=", 1) for line in details.splitlines() if "=" in line)
        release = f"{RELEASE_ROOT}/{commit}"
        expected = f"{release}/{relpath}"
        workdir_matches = fields.get("WorkingDirectory") == release
        entry_matches = entrypoint_in_execstart(fields.get("ExecStart", ""), expected, relpath)
        runtime = run(ssh + [f"cat {expected}"])
        source = run(["git", "-C", str(repo), "show", f"{commit}:{relpath}"])
        result = classify_blob(source, runtime)
        rows.append({
            "runner": runner, "unit": unit, "git_commit": commit, "entrypoint": relpath,
            "service_active": fields.get("ActiveState") == "active",
            "service_substate": fields.get("SubState", "unknown"),
            "historical_systemd_restarts": int(fields.get("NRestarts", "0")),
            "working_directory_matches_release": workdir_matches,
            "execstart_matches_entrypoint": entry_matches,
            "git_sha256": sha256(source),
            "vps_sha256": sha256(runtime),
            "normalized_sha256": sha256(normalize_newlines(runtime)),
            "match_type": result,
            "verified": result != "CONTENT_MISMATCH" and workdir_matches and entry_matches,
        })
    return {
        "schema": "disdex-bt-vps-entrypoint-parity/v1",
        "observed_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "live systemd runner ENTRYPOINT FILES ONLY",
        "production_bt_parity_certified": False,
        "includes_dependent_files": False,
        "includes_exchange_fills": False,
        "makes_live_changes": False,
        "all_entrypoints_verified": all(row["verified"] for row in rows),
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="Existing VPS address (not saved in report)")
    parser.add_argument("--key", type=Path, default=Path.home() / "Desktop" / "DisDex.pem")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, help="Optional JSON report destination on owner PC")
    args = parser.parse_args()
    report = verify(args.host, args.key, args.repo)
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    print(output)
    return 0 if report["all_entrypoints_verified"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
