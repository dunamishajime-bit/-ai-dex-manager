#!/usr/bin/env python3
"""Read-only Git diff inventory for STABLE4 research versus observed LIVE pins."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess

SHA = re.compile(r"^[a-f0-9]{40}$")
def git(repo: Path, *args: str) -> bytes:
    p = subprocess.run(["git", "-C", str(repo), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=50)
    if p.returncode:
        raise ValueError("Git comparison failed; pinned object may be missing")
    return p.stdout

def changed_files(repo: Path, research: str, live: str) -> list[dict]:
    if not SHA.fullmatch(research) or not SHA.fullmatch(live):
        raise ValueError("Invalid source SHA")
    raw = git(repo, "diff", "--name-status", "-z", "--no-renames", research, live)
    parts = raw.split(b"\x00")
    if parts[-1] != b"":
        raise ValueError("Malformed Git diff output")
    rows = []
    for i in range(0, len(parts)-1, 2):
        status, path = parts[i].decode(), parts[i+1].decode("utf-8", "replace")
        if status not in ("A", "M", "D", "T"):
            raise ValueError("Unexpected Git diff status")
        rows.append({"status": status, "path": path})
    return rows

def report(study: dict, live: dict, repo: Path) -> dict:
    if study.get("schema") != "disdex-bt-stable4-vps-source-comparison/v1" or live.get("schema") != "disdex-bt-vps-entrypoint-parity/v1":
        raise ValueError("Evidence schema mismatch")
    pins = {r["runner"]: r["git_commit"] for r in live["rows"] if r.get("verified")}
    result = {}
    for model in ("V4", "HYPE"):
        items = [m for m in study["scenarios"]["10"]["models"] if m["model"] == model]
        if len(items) != 1 or len(items[0]["source_shas"]) != 1 or model not in pins:
            raise ValueError("Missing research/live source pin")
        research, current = items[0]["source_shas"][0], pins[model]
        files = changed_files(repo, research, current)
        groups = {}
        for row in files:
            prefix = row["path"].split("/")[0]
            groups[prefix] = groups.get(prefix, 0) + 1
        result[model] = {
            "research_sha": research, "observed_live_sha": current,
            "all_repo_changed_files": len(files),
            "changed_paths_by_top_directory": groups,
            "changed_paths": files,
            "production_execution_parity_certified": False,
        }
    return {"schema": "disdex-bt-stable4-v4-hype-git-diff/v1", "generated_utc": datetime.now(timezone.utc).isoformat(),
            "scope": "FULL_REPO_GIT_DIFF_NOT_SEMANTIC_LOGIC_PROOF",
            "full_causal_backtest_reexecuted": False, "production_bt_parity_certified": False, "models": result}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    repo = Path(__file__).resolve().parents[2]
    base = repo/"docs/research-results"
    p.add_argument("--study", type=Path, default=base/"BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json")
    p.add_argument("--live", type=Path, default=base/"BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    p.add_argument("--output", type=Path, default=base/"BT_STABLE4_V4_HYPE_GIT_DIFF_20261119_UNCERTIFIED.json")
    a = p.parse_args()
    result = report(json.loads(a.study.read_text(encoding="utf-8")),json.loads(a.live.read_text(encoding="utf-8")),repo)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for name, row in result["models"].items():
        print(name, "changed_paths", row["all_repo_changed_files"], "groups", row["changed_paths_by_top_directory"])
    print("CERTIFICATION=BLOCKED_NO_TRADE_REEXECUTION")

if __name__=="__main__":
    main()
