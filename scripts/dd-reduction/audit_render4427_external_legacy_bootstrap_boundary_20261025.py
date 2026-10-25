#!/usr/bin/env python3
"""Static, read-only RENDER #4427 external legacy bootstrap boundary audit.

Never imports target research modules, opens venue connections, or authorizes orders.
A Git commit pins only the repository-side sources; the .codex legacy root
remains UNTRUSTED unless independently attested by a separate authority.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import subprocess
from pathlib import Path

PINNED_REF = "4e367621338ef1a120f46d727e65c48200b445d6"
TASK9 = "scripts/dd-reduction/task9_initial_adverse_stop_20261020.py"
CALLER = "scripts/dd-reduction/run-q102-adopted2-plus-hvlong-h1-2h-20261022.py"
EXPECTED_BLOBS = {
    TASK9: "3a5e60577caab87a8eebb0aff22dbd6be7207255",
    CALLER: "bbfa393348869a0227897bf0c4785df501cc1229",
}
LEGACY_MODULES = (
    "task8_v12_long_noncanonical_20261020.py",
    "task8_v12_long_compound_20261020.py",
)


def git_bytes(repo: Path, ref: str, path: str) -> bytes:
    p = subprocess.run(["git", "-C", str(repo), "show", f"{ref}:{path}"],
                       capture_output=True, check=True)
    return p.stdout


def git_blob_sha(data: bytes) -> str:
    import hashlib as _hashlib
    return _hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def audit(task9_source: str, caller_source: str) -> dict:
    """AST-only inspection; no target code is executed."""
    a = ast.parse(task9_source)
    b = ast.parse(caller_source)
    task8_import = [
        n.lineno for n in a.body if isinstance(n, ast.Import)
        and any(alias.name == "task8_v12_long_noncanonical_20261020"
                for alias in n.names)
    ]
    caller_import = [
        n.lineno for n in b.body if isinstance(n, ast.Import)
        and any(alias.name == "task9_initial_adverse_stop_20261020"
                for alias in n.names)
    ]
    legacy_assign = [
        n for n in a.body if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "LEGACY_DIR"
                for t in n.targets)
    ]
    legacy_path = None
    if len(legacy_assign) == 1:
        val = legacy_assign[0].value
        if isinstance(val, ast.Call) and len(val.args) == 1:
            try:
                legacy_path = ast.literal_eval(val.args[0])
            except (ValueError, TypeError):
                pass
    path_insert = [
        n.lineno for n in a.body if isinstance(n, ast.Expr)
        and isinstance(n.value, ast.Call)
        and isinstance(n.value.func, ast.Attribute)
        and n.value.func.attr == "insert"
        and "sys.path" in ast.unparse(n.value.func)
        and "LEGACY_DIR" in ast.unparse(n.value)
    ]
    patch_assign = [
        n.lineno for n in a.body if isinstance(n, ast.Assign)
        and any(ast.unparse(t) == "Path.write_text" for t in n.targets)
    ]
    bootstrap_calls = [
        n.lineno for n in ast.walk(a) if isinstance(n, ast.Call)
        and ast.unparse(n.func) in
        ("task8.legacy.bootstrap", "task8.legacy.ensure_baseline")
    ]
    legacy_sha_calls = [
        n.lineno for n in ast.walk(a) if isinstance(n, ast.Call)
        and ast.unparse(n.func) == "sha256_file"
        and any("LEGACY_DIR" in ast.unparse(arg) for arg in n.args)
    ]
    structural = (
        len(task8_import) == len(caller_import) == len(legacy_assign) == 1
        and len(path_insert) == 1
        and bool(legacy_path) and ".codex/worktrees/" in legacy_path.replace("\\", "/")
        and len(patch_assign) >= 2
        and len(bootstrap_calls) >= 2
        and len(legacy_sha_calls) >= 2
        and path_insert[0] < task8_import[0]
    )
    return {
        "status": "BLOCKED_EXTERNAL_LEGACY_ROOT_NOT_INDEPENDENTLY_PINNED",
        "static_chain_confirmed": structural,
        "task9_import_line": caller_import,
        "task8_external_import_line": task8_import,
        "legacy_path_insert_line": path_insert,
        "legacy_dir_declared": legacy_path,
        "path_write_text_assignment_lines": patch_assign,
        "task8_bootstrap_call_lines": sorted(bootstrap_calls),
        "legacy_hash_observation_lines": sorted(legacy_sha_calls),
        "independent_legacy_bytes_available": False,
        "independent_trust_root_available": False,
        "native_order_authorized": False,
        "research_only": True,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, required=True)
    ap.add_argument("--ref", default=PINNED_REF)
    args = ap.parse_args()
    if args.ref != PINNED_REF:
        raise SystemExit("REJECT_UNPINNED_GIT_REF")
    raw = {p: git_bytes(args.repo, args.ref, p) for p in EXPECTED_BLOBS}
    if any(git_blob_sha(raw[p]) != EXPECTED_BLOBS[p] for p in raw):
        raise SystemExit("REJECT_SOURCE_GIT_BLOB_DRIFT")
    report = audit(raw[TASK9].decode("utf-8"), raw[CALLER].decode("utf-8"))
    report["git_ref"] = args.ref
    report["git_blob_sha1"] = EXPECTED_BLOBS
    report["source_byte_sha256"] = {
        p: hashlib.sha256(raw[p]).hexdigest() for p in raw
    }
    if not report["static_chain_confirmed"]:
        raise SystemExit("REJECT_STATIC_CHAIN_UNPROVEN")
    print(json.dumps(report, sort_keys=True, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
