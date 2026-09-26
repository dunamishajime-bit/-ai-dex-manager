"""Materialize the verified source-import closure from the audited Git release."""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
from typing import Iterable


_START_FILES = (
    "scripts/disdex-v12-x1-all-live-runner.ts",
    "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
    "scripts/disdex-quality102-causal-v1-live-runner.ts",
    "scripts/disdex-fet-brk48-live-runner.ts",
    "scripts/disdex_v52_aster_only_live_engine.py",
    "scripts/disdex_v96_v52_margin_guard_runtime.py",
)
_SOURCE_SUFFIXES = {".py", ".ts", ".js", ".json"}
_IMPORT_FROM = re.compile(r"\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['\"]([^'\"]+)['\"]", re.S)
_ALLOWED_TOP_LEVEL = {"config", "lib", "scripts", "data"}


def _valid_source_path(path: str) -> str | None:
    normalized = path.replace("\\", "/")
    candidate = PurePosixPath(normalized)
    if candidate.is_absolute() or ".." in candidate.parts or len(candidate.parts) < 2:
        return None
    if candidate.parts[0] not in _ALLOWED_TOP_LEVEL or candidate.suffix.lower() not in _SOURCE_SUFFIXES:
        return None
    if any(part.lower() in {"node_modules", "runtime-state", "secrets", "secret", ".env"} for part in candidate.parts):
        return None
    return candidate.as_posix()


def _ts_import_candidates(source_path: str, specifier: str) -> tuple[str, ...]:
    if specifier.startswith("@/"):
        base = PurePosixPath(specifier[2:])
    elif specifier.startswith("./") or specifier.startswith("../"):
        base = PurePosixPath(source_path).parent / specifier
    else:
        return ()
    normalized = PurePosixPath(posixpath.normpath(base.as_posix()))
    candidates = [normalized.as_posix()]
    if not normalized.suffix:
        candidates.extend(f"{normalized.as_posix()}{suffix}" for suffix in (".ts", ".js", ".json"))
        candidates.extend(f"{normalized.as_posix()}/index{suffix}" for suffix in (".ts", ".js"))
    return tuple(path for candidate in candidates if (path := _valid_source_path(candidate)) is not None)


def _internal_imports(source_path: str, source_text: str, available: set[str]) -> set[str]:
    imports: set[str] = set()
    if source_path.endswith(".py"):
        try:
            tree = ast.parse(source_text)
        except SyntaxError:
            return imports
        for node in ast.walk(tree):
            module_names: list[str] = []
            if isinstance(node, ast.Import):
                module_names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                module_names.append(node.module)
            for module_name in module_names:
                candidate = f"scripts/{module_name.replace('.', '/')}.py"
                if candidate in available:
                    imports.add(candidate)
        return imports

    for specifier in _IMPORT_FROM.findall(source_text):
        for candidate in _ts_import_candidates(source_path, specifier):
            if candidate in available:
                imports.add(candidate)
                break
    return imports


def _git_blob(repo_root: Path, commit: str, relative_path: str) -> bytes:
    result = subprocess.run(
        ["git", "show", f"{commit}:{relative_path}"],
        cwd=repo_root,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout


def capture_runtime_sources(
    repo_root: str | Path,
    snapshot_root: str | Path,
    manifest_path: str | Path,
) -> list[dict[str, str]]:
    """Copy only the source import closure from the exact audited release commit.

    This function reads Git blobs directly, never checks out or modifies the live
    source tree, and never follows paths outside the manifest's allowlisted roots.
    """
    repo = Path(repo_root).resolve()
    snapshot = Path(snapshot_root).resolve()
    manifest_file = Path(manifest_path).resolve()
    payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    commit = payload.get("verified_repository_commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("manifest must contain a verified repository commit")

    tree_result = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", commit], cwd=repo,
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    available = {path for line in tree_result.stdout.splitlines() if (path := _valid_source_path(line))}
    pending = set(_START_FILES)
    included: set[str] = set()
    contents: dict[str, bytes] = {}
    while pending:
        relative = pending.pop()
        relative = _valid_source_path(relative)
        if relative is None or relative in included:
            continue
        if relative not in available:
            raise FileNotFoundError(f"audited release source is missing: {relative}")
        raw = _git_blob(repo, commit, relative)
        included.add(relative)
        contents[relative] = raw
        if Path(relative).suffix.lower() in {".py", ".ts", ".js"}:
            pending.update(_internal_imports(relative, raw.decode("utf-8"), available) - included)

    for relative, raw in sorted(contents.items()):
        destination = (snapshot / relative).resolve()
        try:
            destination.relative_to(snapshot)
        except ValueError as exc:
            raise ValueError(f"source path escapes snapshot root: {relative}") from exc
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)

    records = [
        {"path": relative, "sha256": hashlib.sha256(raw).hexdigest()}
        for relative, raw in sorted(contents.items())
    ]
    payload["files"] = records
    provenance = payload.setdefault("source_provenance", {})
    provenance["import_closure_count"] = len(records)
    provenance["import_closure_roots"] = list(_START_FILES)
    manifest_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return records
