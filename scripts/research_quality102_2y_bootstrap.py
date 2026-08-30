from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import json
import re
import subprocess
from pathlib import Path

START = "2024-08-10T00:00:00.000Z"
END = "2026-08-10T00:00:00.000Z"
REFERENCE_SHA256 = "b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead"
SOURCE = Path("scripts/research_latest_v8_dca_1y.py")
OUT = Path(".research-state/quality102-2y-bootstrap")


def run(*args: str) -> str:
    p = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    return p.stdout


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = SOURCE.read_text(encoding="utf-8")
    blobs = re.findall(r"base64\.b64decode\('([^']+)'\)", src)
    if len(blobs) < 2:
        raise SystemExit(f"expected embedded Quality102 candidate + engine, found {len(blobs)} blobs")
    candidate = gzip.decompress(base64.b64decode(blobs[0]))
    digest = hashlib.sha256(candidate).hexdigest()
    if digest != REFERENCE_SHA256:
        raise SystemExit(f"Quality102 frozen reference SHA mismatch: {digest}")
    ref = OUT / "quality102-reference-1y.csv"
    ref.write_bytes(candidate)
    rows = list(csv.DictReader(candidate.decode("utf-8").splitlines()))
    if len(rows) != 102:
        raise SystemExit(f"Quality102 frozen reference count mismatch: {len(rows)}")

    fields = list(rows[0].keys()) if rows else []
    ts_fields = [x for x in fields if "ts" in x.lower() or "time" in x.lower()]
    sample = rows[:3]

    # Search the complete Git history for the source that produced the frozen rows.
    # The two-year BT is forbidden from inventing/copying the missing first year.
    probes = [
        "SUPPLEMENT_QUALITY102", "Quality102", "quality102", "supplement-csv",
        "frozenCandidateCount", "BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT",
    ]
    history_hits: dict[str, str] = {}
    for probe in probes:
        text = run("git", "grep", "-I", "-n", probe, "$(git rev-list --all)", "--", "scripts")
        # git grep does not expand command substitution without a shell; retain a shell-backed fallback below.
        if text.strip():
            history_hits[probe] = text[-12000:]
    shell_scan = subprocess.run(
        ["bash", "-lc", "for c in $(git rev-list --all); do git grep -I -n -E 'SUPPLEMENT_QUALITY102|Quality102|quality102|supplement-csv|frozenCandidateCount' $c -- scripts 2>/dev/null || true; done | sort -u | tail -n 1000"],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False,
    ).stdout

    report = {
        "status": "QUALITY102_2Y_SOURCE_RECOVERY_REQUIRED",
        "requestedPeriod": {"startInclusive": START, "endExclusive": END},
        "capital": {"initialJpy": 10000, "monthlyContributionJpy": 20000, "contributionCountAfterStart": 24, "totalContributedJpy": 490000},
        "reference": {"sha256": digest, "candidateCount": len(rows), "fields": fields, "timestampFields": ts_fields, "sample": sample},
        "historyMatches": shell_scan[-100000:],
        "acceptance": {
            "mustReproduceReferenceRowsExactly": True,
            "mustReproduceReferenceSha256": REFERENCE_SHA256,
            "mustGenerate2024SideCausally": True,
            "copyOrStretchReferenceRowsForbidden": True,
            "fabricatedPrelistingHistoryForbidden": True,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    }
    (OUT / "bootstrap.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "history-matches.txt").write_text(shell_scan, encoding="utf-8")
    print(json.dumps({"status": report["status"], "candidateCount": len(rows), "sha256": digest, "fields": fields, "historyHitBytes": len(shell_scan)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
