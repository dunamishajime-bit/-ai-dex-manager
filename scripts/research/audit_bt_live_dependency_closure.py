#!/usr/bin/env python3
"""Fail-closed local Git dependency closure for observed live runner pins (no SSH)."""
from __future__ import annotations
import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

IMPORT = re.compile(r"""(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(?:["'])([^"']+)(?:["'])""")
PY_IMPORT = re.compile(r"^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))", re.M)
EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".py")
MAX_FILES = 4000


def git_file(sha: str, path: str, root: Path) -> bytes | None:
    result = subprocess.run(["git", "-C", str(root), "show", f"{sha}:{path}"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
    return result.stdout if result.returncode == 0 else None


def candidates(origin: str, specifier: str) -> list[str]:
    if not specifier.startswith("."):
        return []
    if specifier.startswith("./") or specifier.startswith("../"):
        base = PurePosixPath(origin).parent
        parts = list(base.parts)
        for part in PurePosixPath(specifier).parts:
            if part == "..":
                if not parts:
                    raise ValueError("Import escapes repository")
                parts.pop()
            elif part not in ("", "."):
                parts.append(part)
        rel = "/".join(parts)
    else:
        # Python relative imports are tracked separately; never assume a runtime module.
        return []
    if not rel or rel.startswith("/"):
        raise ValueError("Invalid import")
    if PurePosixPath(rel).suffix:
        return [rel]
    return [rel + ext for ext in EXTENSIONS] + [rel + "/index" + ext for ext in EXTENSIONS]


def imports_for(path: str, blob: bytes) -> list[str]:
    text = blob.decode("utf-8-sig", errors="replace")
    if path.endswith(".py"):
        return []  # Python module resolution needs separate environment-aware audit.
    return [m.group(1) for m in IMPORT.finditer(text)]


def closure(sha: str, entrypoint: str, root: Path) -> dict:
    queue = deque([entrypoint])
    visited = set()
    files = []
    unresolved = []
    external = set()
    while queue:
        path = queue.popleft()
        if path in visited:
            continue
        if len(visited) >= MAX_FILES:
            raise ValueError("Dependency closure file limit exceeded")
        visited.add(path)
        data = git_file(sha, path, root)
        if data is None:
            raise ValueError(f"Missing pinned Git object: {path}")
        files.append({"path": path, "git_sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)})
        for name in imports_for(path, data):
            if not name.startswith("."):
                external.add(name)
                continue
            options = candidates(path, name)
            found = next((p for p in options if git_file(sha, p, root) is not None), None)
            if found:
                if found not in visited:
                    queue.append(found)
            else:
                unresolved.append({"from": path, "import": name})
    files.sort(key=lambda x: x["path"])
    unresolved.sort(key=lambda x: (x["from"], x["import"]))
    return {
        "git_commit": sha,
        "entrypoint": entrypoint,
        "resolved_repo_files": len(files),
        "files": files,
        "unresolved_relative_imports": unresolved,
        "external_imports": sorted(external),
        "python_dependency_closure_verified": not entrypoint.endswith(".py"),
        "runtime_dependency_bytes_verified": False,
        "full_execution_parity_certified": False,
    }


def audit(evidence: dict, root: Path) -> dict:
    if evidence.get("schema") != "disdex-bt-vps-entrypoint-parity/v1" or evidence.get("all_entrypoints_verified") is not True:
        raise ValueError("Source evidence missing or unverified")
    rows = evidence.get("rows", [])
    if len(rows) != 8 or len({r.get("runner") for r in rows}) != 8:
        raise ValueError("Incomplete or duplicated runner evidence")
    results = {}
    for row in rows:
        if row.get("verified") is not True:
            raise ValueError("Unverified entrypoint")
        sha, path, runner = row["git_commit"], row["entrypoint"], row["runner"]
        if not re.fullmatch("[0-9a-f]{40}", sha) or not path.startswith("scripts/"):
            raise ValueError("Invalid pinned source")
        results[runner] = closure(sha, path, root)
    return {
        "schema": "disdex-bt-live-git-dependency-closure/v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "LOCAL_PINNED_GIT_IMPORT_GRAPH_NOT_VPS_DEPENDENCY_PARITY",
        "all_entrypoints_verified_by_separate_evidence": True,
        "all_runtime_dependencies_verified": False,
        "production_bt_parity_certified": False,
        "runners": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument("--evidence", type=Path, default=root / "docs/research-results/BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    parser.add_argument("--output", type=Path, default=root / "docs/research-results/BT_LIVE_GIT_DEPENDENCY_CLOSURE_20261119_UNCERTIFIED.json")
    args = parser.parse_args()
    report = audit(json.loads(args.evidence.read_text(encoding="utf-8")), root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for name, row in report["runners"].items():
        print(f"{name}: local Git files={row['resolved_repo_files']} unresolved={len(row['unresolved_relative_imports'])} runtime_verified=False")
    print("CERTIFICATION=BLOCKED_LOCAL_GIT_ONLY")


if __name__ == "__main__":
    main()
