"""Prove Q102 decision-layer byte parity across archived scan and audited source commits.

The archived Q102 fast scan records a research/runtime commit SHA that differs from
runtime_source_manifest.runtime_sha. This audit follows the actual TypeScript import
closure used by the full Q102 signal/observability path and proves that every source
file in that closure is byte-identical in:
1. the frozen audited runtime_source_snapshot,
2. the archived fast-scan Git commit, and
3. the verified repository commit recorded by runtime_source_manifest.

Runner, portfolio planner, and venue execution files are intentionally outside this
decision-layer proof and remain covered by separate execution/margin evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Any

IMPORT_RE = re.compile(
    r"""(?:from\s+|import\s*\(\s*)["']([^"']+)["']""",
    re.MULTILINE,
)

ROOTS = (
    "lib/disdex-quality102-causal-v4-signal.ts",
    "lib/disdex-quality102-causal-v4-observability.ts",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def git_bytes(repo: Path, commit: str, path: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), "show", f"{commit}:{path}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"GIT_SOURCE_MISSING:{commit}:{path}:{result.stderr.decode(errors='replace')[:160]}"
        )
    return result.stdout


def resolve_import(source_path: str, spec: str, available: set[str]) -> str | None:
    if spec.startswith("@/"):
        candidate = PurePosixPath(spec[2:])
    elif spec.startswith("."):
        candidate = PurePosixPath(source_path).parent / spec
    else:
        return None
    stack: list[str] = []
    for part in candidate.parts:
        if part in ("", "."):
            continue
        if part == "..":
            if stack:
                stack.pop()
        else:
            stack.append(part)
    base = PurePosixPath(*stack)
    candidates = (
        str(base),
        str(base) + ".ts",
        str(base) + ".tsx",
        str(base) + ".json",
        str(base / "index.ts"),
    )
    return next((item for item in candidates if item in available), None)


def import_closure(repo: Path, commit: str, available: set[str]) -> list[str]:
    pending = list(ROOTS)
    seen: set[str] = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        require(path in available, f"Q102_DECISION_ROOT_OR_DEP_MISSING:{path}")
        seen.add(path)
        if not path.endswith((".ts", ".tsx")):
            continue
        text = git_bytes(repo, commit, path).decode("utf-8")
        for spec in IMPORT_RE.findall(text):
            resolved = resolve_import(path, spec, available)
            if resolved and resolved not in seen:
                pending.append(resolved)
    return sorted(seen)


def write_json(path: Path, payload: Any) -> str:
    raw = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return sha256(raw)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    repo = args.repo_root.resolve()
    release = args.release_root.resolve()
    code = release / "all-reconstruction-code-plus-90-file-audited-source"
    source_manifest = load_json(code / "runtime_source_manifest.json")
    fast_manifest = load_json(
        release / "baseline-complete-signal-and-gate-decisions"
        / "baseline-signal-scan-q102" / "signal-scan-manifest.json"
    )
    archived_commit = str(fast_manifest["runtime_sha"])
    verified_commit = str(source_manifest["verified_repository_commit"])

    manifest_hashes = {
        str(row["path"]): str(row["sha256"])
        for row in source_manifest.get("files", [])
        if row.get("path") and row.get("sha256")
    }
    available = set(manifest_hashes)
    closure = import_closure(repo, verified_commit, available)
    require(bool(closure), "Q102_DECISION_IMPORT_CLOSURE_EMPTY")
    rows = []
    for rel in closure:
        archived = git_bytes(repo, archived_commit, rel)
        verified = git_bytes(repo, verified_commit, rel)
        frozen_sha = manifest_hashes[rel]
        archived_sha = sha256(archived)
        verified_sha = sha256(verified)
        rows.append({
            "path": rel,
            "frozen_sha256": frozen_sha,
            "archived_scan_commit_sha256": archived_sha,
            "verified_repository_commit_sha256": verified_sha,
            "all_equal": frozen_sha == archived_sha == verified_sha,
        })

    mismatches = [row for row in rows if not row["all_equal"]]
    require(not mismatches, f"Q102_DECISION_SOURCE_BYTE_MISMATCH:{[r['path'] for r in mismatches[:8]]}")

    payload = {
        "schema_version": 1,
        "status": "PASS_Q102_DECISION_SOURCE_BYTE_PARITY",
        "archived_fast_scan_runtime_commit": archived_commit,
        "frozen_manifest_runtime_sha": source_manifest.get("runtime_sha"),
        "verified_repository_commit": verified_commit,
        "root_sources": list(ROOTS),
        "closure_file_count": len(rows),
        "files": rows,
        "ruling": (
            "The Q102 full signal/observability import closure is byte-identical between "
            "the archived fast-scan Git commit, the audited frozen source snapshot, and "
            "the manifest-verified repository commit. Runner/planner/execution parity is "
            "not implied by this decision-layer proof."
        ),
    }
    digest = write_json(args.output.resolve(), payload)
    print(json.dumps({
        "status": payload["status"],
        "closure_file_count": len(rows),
        "archived_fast_scan_runtime_commit": archived_commit,
        "verified_repository_commit": verified_commit,
        "manifest_sha256": digest,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
