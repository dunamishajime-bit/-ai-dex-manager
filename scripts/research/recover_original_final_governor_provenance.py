#!/usr/bin/env python3
"""READ-ONLY provenance inventory for original 2026-09-22 14.49億 JPY BT.
Does not simulate trades, access credentials, change VPS state or run orders.
Only enumerates a small set of historical research-state roots and reports
file paths, metadata and cryptographic hashes for matching historical inputs.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
from pathlib import Path

EXPECTED_MARKERS = {
    "final_live_governor_jpy": b"1448665533",
    "final_static_4p25_jpy": b"1479916279",
    "final_live_severe_jpy": b"75982803",
    "historical_740m_jpy": b"740771278",
}
RELEVANT = re.compile(
    r"final|dynamic|govern|top3|integrat|q102|quality102|fet|pengu|v12|"
    r"ledger|stock|cash|source|cache|gross|replay|monthly|research.*state", re.I
)
SAFE_SUFFIXES = {".py", ".ts", ".js", ".json", ".jsonl", ".csv", ".parquet", ".gz", ".md", ".zip"}
SKIP_NAMES = {".git", "node_modules", ".next", ".venv", "venv", "__pycache__", "secrets",
              "credentials", "private", ".ssh", "releases", "runtime-state", ".runtime-state"}
STATIC_DIRS = [
    Path("/home/deploy/ai-dex-manager/.research-state"),
    Path("/home/deploy/ai-dex-manager-v96-paper/.research-state"),
    Path("/home/deploy/disdex-trading/.research-state"),
    Path("/home/deploy/disdex-trading/work"),
    Path("/root/.research-state"),
    Path("/root/disdex-research"),
]
def candidate_roots():
    out = []
    for parent in STATIC_DIRS:
        if parent.name != "work":
            out.append(parent)
            continue
        if not parent.is_dir():
            continue
        for child in sorted(parent.iterdir(), key=lambda p: p.name):
            if not child.is_dir() or child.is_symlink():
                continue
            # A previously audited worktree has a read-only .research-state.
            for suffix in (".research-state", "research-state", "research", "docs/research-results"):
                p = child / suffix
                if p.is_dir() and not p.is_symlink():
                    out.append(p)
        # Occasionally the main work directory itself is a worktree.
        p = parent / ".research-state"
        if p.is_dir() and not p.is_symlink():
            out.append(p)
    # Deduplicate without following symlink targets to unexpected directories.
    return list(dict.fromkeys(out))
def metadata(f):
    st = f.stat()
    result = {"path": str(f), "bytes": st.st_size, "mtime": round(st.st_mtime)}
    if st.st_size <= 25_000_000:
        with f.open("rb") as stream:
            result["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    return result
def scan():
    roots = candidate_roots()
    result = {"schema": "original-final-governor-provenance-inventory/v1",
              "targetOldBtNormalJpy": 1448665533.0239232,
              "targetOriginalCommit": "cd67a007c13c7ea7a51e0e9299dbeac5336e48e9",
              "readOnly": True, "tradingMutation": 0, "roots": [],
              "matchedFiles": [], "originalResultMarkers": [], "visitedFiles": 0, "truncated": False}
    for root in roots:
        entry = {"path": str(root), "exists": root.is_dir(), "fileCount": 0}
        result["roots"].append(entry)
        if not root.is_dir():
            continue
        for parent, dirs, files in os.walk(root, followlinks=False):
            rel = Path(parent).relative_to(root)
            depth = len(rel.parts)
            dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES
                             and not (Path(parent) / d).is_symlink())
            if depth >= 5:
                dirs[:] = []
            for name in sorted(files):
                f = Path(parent) / name
                if f.is_symlink() or f.suffix.lower() not in SAFE_SUFFIXES:
                    continue
                entry["fileCount"] += 1
                result["visitedFiles"] += 1
                if result["visitedFiles"] > 15000:
                    result["truncated"] = True
                    return result
                if len(result["matchedFiles"]) < 350 and RELEVANT.search(str(f)):
                    try:
                        result["matchedFiles"].append(metadata(f))
                    except (OSError, PermissionError):
                        continue
                if f.suffix.lower() in {".py", ".ts", ".js", ".json", ".jsonl", ".md"}:
                    try:
                        size = f.stat().st_size
                        if not (0 < size <= 16_000_000):
                            continue
                        raw = f.read_bytes()
                        matches = [key for key, marker in EXPECTED_MARKERS.items() if marker in raw]
                        if matches:
                            result["originalResultMarkers"].append(
                                {"file": str(f), "matches": matches,
                                 "sha256": hashlib.sha256(raw).hexdigest(), "bytes": size}
                            )
                    except (OSError, PermissionError):
                        pass
    return result
if __name__ == "__main__":
    print(json.dumps(scan(), sort_keys=True, ensure_ascii=False))
