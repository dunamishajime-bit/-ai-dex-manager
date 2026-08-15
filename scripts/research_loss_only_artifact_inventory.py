"""Inventory GitHub Actions artifacts for the Loss-Only Entry Firewall program.

Metadata-only. Does not download artifact ZIP bodies, does not read trade outcomes,
and does not calculate strategy performance. It finds the earliest explicit V96
artifact timestamp and summarizes the artifact population from that point forward.
Research-only; no Fresh OOS, VPS, LIVE, order, deployment, or production mutation.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path

API = "https://api.github.com"
REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
VERSION_RE = re.compile(r"(?i)(?:^|[^a-z0-9])v[_-]?(\d{2,3})(?:[^0-9]|$)")
TRADE_HINT_RE = re.compile(r"(?i)(research|backtest|diagnos|trade|entry|pair|clean|forward|ownership|router|strategy|replay|v\d{2,3})")
EXCLUDE_RE = re.compile(r"(?i)(cache|node_modules|coverage|build|dist|premium-index-archive-probe|artifact-inventory)")


def get_json(url: str):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "loss-only-artifact-inventory",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def versions(name: str):
    return [int(x) for x in VERSION_RE.findall(name or "")]


def main():
    arts = []
    page = 1
    while True:
        data = get_json(f"{API}/repos/{REPO}/actions/artifacts?per_page=100&page={page}")
        batch = data.get("artifacts", [])
        arts.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        if page > 200:
            raise RuntimeError("ARTIFACT_PAGINATION_GUARD")

    explicit96 = [a for a in arts if 96 in versions(a.get("name", ""))]
    if not explicit96:
        raise RuntimeError("NO_EXPLICIT_V96_ARTIFACT_FOUND")
    cutoff = min(a["created_at"] for a in explicit96)
    since = [a for a in arts if a.get("created_at", "") >= cutoff and not a.get("expired", False)]
    likely = [a for a in since if TRADE_HINT_RE.search(a.get("name", "")) and not EXCLUDE_RE.search(a.get("name", ""))]
    explicit_ge96 = [a for a in since if any(v >= 96 for v in versions(a.get("name", "")))]

    branches = {}
    for a in likely:
        b = ((a.get("workflow_run") or {}).get("head_branch") or "UNKNOWN")
        branches[b] = branches.get(b, 0) + 1

    out = {
        "researchLine": "LOSS_ONLY_ARTIFACT_INVENTORY",
        "researchOnly": True,
        "metadataOnly": True,
        "artifactBodiesRead": False,
        "tradeOutcomesRead": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "totalRepositoryArtifacts": len(arts),
        "explicitV96Artifacts": len(explicit96),
        "earliestExplicitV96CreatedAt": cutoff,
        "nonExpiredArtifactsSinceV96": len(since),
        "explicitVersionGe96ArtifactsSinceCutoff": len(explicit_ge96),
        "likelyResearchTradeArtifactsSinceCutoff": len(likely),
        "likelyResearchTradeBytes": sum(int(a.get("size_in_bytes") or 0) for a in likely),
        "branchCounts": dict(sorted(branches.items(), key=lambda kv: (-kv[1], kv[0]))),
        "explicitV96Examples": [
            {"id": a["id"], "name": a["name"], "createdAt": a["created_at"], "runId": (a.get("workflow_run") or {}).get("id")}
            for a in sorted(explicit96, key=lambda x: x["created_at"])[:20]
        ],
        "candidateArtifactManifest": [
            {
                "id": a["id"], "name": a["name"], "size": a.get("size_in_bytes", 0),
                "createdAt": a["created_at"], "runId": (a.get("workflow_run") or {}).get("id"),
                "branch": (a.get("workflow_run") or {}).get("head_branch"),
                "headSha": (a.get("workflow_run") or {}).get("head_sha"),
                "versionsInName": versions(a.get("name", "")),
            }
            for a in sorted(likely, key=lambda x: x["created_at"])
        ],
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "loss-only-artifact-inventory.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "candidateArtifactManifest"}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
