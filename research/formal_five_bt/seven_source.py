"""Immutable, separate HYPE/ZEC research source overlay on audited five-logic LIVE SHA.

The HYPE/ZEC code is a single child commit of the verified five-logic
production release. It was NOT deployed at the last read-only VPS audit.
Keeping both SHA fields prevents a seven-logic hypothetical backtest from
being misrepresented as an observed seven-logic production backtest.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import subprocess

LIVE_FIVE_SHA = "a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
SEVEN_RESEARCH_SHA = "cde62b3909a86e4791a19e78862eeaa37653e03a"
SIDE_CAR_FILES = (
    "config/hypeZecLongPolicy.ts",
    "config/hypeZecLongRuntime.ts",
    "config/integratedProductionRiskPolicy.ts",
    "config/v52V50Runtime.json",
    "lib/hype-zec-long-sleeves.ts",
    "lib/hype-zec-preemption.ts",
)
EXTRA_AUDIT_FILES = (
    "lib/hype-zec-long-market-data.ts",
    "lib/hype-zec-long-runner-state.ts",
    "lib/hype-zec-long-runner.ts",
    "lib/hype-zec-priority-capacity.ts",
    "lib/hype-zec-preemption-executor.ts",
    "lib/v12-live-execution-engine.ts",
    "lib/v12-strict-live-adapter.ts",
    "lib/pengu-dual-ls-v2-portfolio-runner.ts",
    "lib/fet-brk48-live-runner.ts",
    "scripts/disdex-hype-zec-long-live-runner.ts",
)
SEVEN_STRATEGIES = ("V12", "PENGU", "Q102", "FET", "V52", "HYPE", "ZEC")


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, cwd=repo,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=25).stdout


def capture_seven_source(repo_root: str | Path, output_root: str | Path) -> dict:
    repo = Path(repo_root).resolve()
    target = Path(output_root).resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", SEVEN_RESEARCH_SHA):
        raise ValueError("INVALID_RESEARCH_SHA")
    # No moving branch tips, tags or external script downloads.
    parent = _git(repo, "show", "-s", "--format=%P", SEVEN_RESEARCH_SHA).decode().strip()
    if parent != LIVE_FIVE_SHA:
        raise ValueError("SIDE_CAR_PARENT_NOT_FROZEN_LIVE_SHA")
    needed = SIDE_CAR_FILES + EXTRA_AUDIT_FILES
    records = []
    for rel in needed:
        if not rel.startswith(("lib/", "config/", "scripts/")) or ".." in Path(rel).parts:
            raise ValueError("SOURCE_PATH_OUTSIDE_ALLOWLIST")
        raw = _git(repo, "show", f"{SEVEN_RESEARCH_SHA}:{rel}")
        if rel in SIDE_CAR_FILES:
            dest = target / "snapshot" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
        records.append({"path": rel, "sha256": sha256(raw).hexdigest(), "bytes": len(raw),
                        "materialized_for_bridge": rel in SIDE_CAR_FILES})
    manifest = {
        "schema_version": 1, "live_five_runtime_sha": LIVE_FIVE_SHA,
        "seven_research_source_sha": SEVEN_RESEARCH_SHA,
        "source_commit_parent_sha": parent,
        "actual_vps_seven_live_verified": False,
        "production_status": "FIVE_LIVE_PLUS_HYPE_ZEC_UNDEPLOYED_RESEARCH",
        "strategies": list(SEVEN_STRATEGIES),
        "sidecar_mode": "RESEARCH_ONLY_NOT_OPERATOR_ARMED",
        "files": records,
        "extraction_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "no_order_mutation": True,
    }
    target.mkdir(parents=True, exist_ok=True)
    (target / "source-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def verify_seven_source(root: str | Path) -> dict:
    root = Path(root).resolve()
    manifest = json.loads((root / "source-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("live_five_runtime_sha") != LIVE_FIVE_SHA or (
        manifest.get("seven_research_source_sha") != SEVEN_RESEARCH_SHA
        or manifest.get("source_commit_parent_sha") != LIVE_FIVE_SHA
        or manifest.get("actual_vps_seven_live_verified") is not False
        or manifest.get("no_order_mutation") is not True
    ):
        raise ValueError("SEVEN_SOURCE_PROVENANCE_MISMATCH")
    for item in manifest["files"]:
        if not re.fullmatch(r"[0-9a-f]{64}", str(item["sha256"])):
            raise ValueError("SEVEN_SOURCE_HASH_INVALID")
        if item["materialized_for_bridge"]:
            path = (root / "snapshot" / item["path"]).resolve()
            if not path.is_relative_to(root / "snapshot") or not path.is_file():
                raise ValueError("SEVEN_SOURCE_MISSING")
            if sha256(path.read_bytes()).hexdigest() != item["sha256"]:
                raise ValueError("SEVEN_SOURCE_SHA256_MISMATCH")
    return manifest


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--output-root", required=True)
    args = parser.parse_args()
    result = capture_seven_source(args.repo, args.output_root)
    assert verify_seven_source(args.output_root)["files"] == result["files"]
    print(json.dumps({"status": "SIDE_CAR_SOURCE_CAPTURED",
                      "live_five_sha": result["live_five_runtime_sha"],
                      "seven_research_sha": result["seven_research_source_sha"],
                      "files": len(result["files"]),
                      "live_mode": False}, sort_keys=True))
