#!/usr/bin/env python3
"""RESEARCH ONLY: audit assert-elision and prelaunch interpreter policy.

Pure static compilation: never imports or executes RENDER/Native8 runner.
This is not a trusted root, allocator adapter, order gate, or LIVE permission.
"""
from __future__ import annotations

import ast
import dis
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types

REPO = Path(__file__).resolve().parents[2]
TARGETS = (
    ("run-render-4427-independent-profit-sell55-native8-20261024.py", 9),
    ("run-render-4427-native8-shared-wallet-20261024.py", 9),
    ("run-render-2024-triple-native-full8-20261024.py", 8),
)
HERE = REPO / "scripts" / "dd-reduction"
RESEARCH_ONLY = "RESEARCH_ONLY_NOT_NATIVE8_AUTHORIZED"


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def assertion_ops(code: types.CodeType) -> int:
    return sum(i.opname == "LOAD_ASSERTION_ERROR" for i in dis.get_instructions(code)) + sum(
        assertion_ops(c) for c in code.co_consts if isinstance(c, types.CodeType)
    )


def scan_source(path: Path) -> dict:
    raw = path.read_bytes()
    source = raw.decode("utf-8")
    nodes = [n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Assert)]
    op_counts = {
        str(opt): assertion_ops(compile(source, str(path), "exec", optimize=opt))
        for opt in (0, 1, 2)
    }
    return {
        "path": path.relative_to(REPO).as_posix(),
        "sha256_observed_not_trust_root": digest(raw),
        "assert_count": len(nodes),
        "bytecode_assertion_counts": op_counts,
        "assertions": [
            {"line": n.lineno, "expression": ast.unparse(n.test)[:260]}
            for n in sorted(nodes, key=lambda n: n.lineno)
        ],
    }


def direct_python_launch_policy(argv: list[str], env: dict[str, str],
                                *, trusted_root: bool) -> str:
    """Conservative direct-interpreter prelaunch contract, not connected to runner."""
    if sys.flags.optimize:
        return "REJECT_RUNNING_INTERPRETER_OPTIMIZED"
    if not trusted_root:
        return "REJECT_NO_INDEPENDENT_TRUST_ROOT"
    if not argv or Path(argv[0]).resolve() != Path(sys.executable).resolve():
        return "REJECT_UNKNOWN_PYTHON_INTERPRETER"
    if env.get("PYTHONOPTIMIZE", "").strip():
        return "REJECT_PYTHONOPTIMIZE_ENV"
    if env.get("PYTHONPATH", "").strip() or env.get("PYTHONHOME", "").strip():
        return "REJECT_UNPINNED_IMPORT_ENVIRONMENT"
    if len(argv) < 2:
        return "REJECT_NO_SCRIPT"
    for arg in argv[1:-1]:
        if arg in ("-O", "-OO") or (arg.startswith("-") and "O" in arg):
            return "REJECT_OPTIMIZED_INTERPRETER"
        if arg != "-u":
            return "REJECT_UNKNOWN_INTERPRETER_ARGUMENT"
    if not argv[-1].endswith("run-render-4427-independent-profit-sell55-native8-20261024.py"):
        return "REJECT_UNEXPECTED_SCRIPT"
    return "RESEARCH_PRELAUNCH_INTERPRETER_ONLY_NOT_AUTHORIZED"


def synthetic_assert_semantics(optimize: int) -> str:
    """Compiles a tiny synthetic invariant, not any real trading code."""
    src = "def invariant(count):\\n    assert count == 3, 'MUST_BE_THREE'\\n    return 'PASSED'\\n"
    namespace = {}
    exec(compile(src.replace("\\n", "\n"), "<synthetic-only>", "exec", optimize=optimize), namespace)
    try:
        return namespace["invariant"](2)
    except AssertionError:
        return "REJECT_ASSERTION"


def subprocess_optimize_probe() -> dict:
    # No imports of runner or Native8. Check interpreter flag behavior only.
    cmd = [sys.executable, "-c", "import sys;print(sys.flags.optimize)"]
    safe_env = dict(os.environ)
    safe_env.pop("PYTHONOPTIMIZE", None)
    baseline = subprocess.run(cmd, env=safe_env, capture_output=True, text=True, timeout=20, check=True).stdout.strip()
    flag = subprocess.run([sys.executable, "-O", *cmd[1:]], env=safe_env,
                          capture_output=True, text=True, timeout=20, check=True).stdout.strip()
    env_probe = dict(safe_env, PYTHONOPTIMIZE="1")
    inherited = subprocess.run(cmd, env=env_probe, capture_output=True,
                               text=True, timeout=20, check=True).stdout.strip()
    return {"without_optimize": baseline, "with_dash_O": flag,
            "with_PYTHONOPTIMIZE_1": inherited}


def audit() -> dict:
    files = [scan_source(HERE / name) for name, _ in TARGETS]
    for observed, (_, count) in zip(files, TARGETS):
        if observed["assert_count"] != count:
            raise RuntimeError(("ASSERTION_SOURCE_DRIFT", observed["path"], observed["assert_count"], count))
        if observed["bytecode_assertion_counts"] != {"0": count, "1": 0, "2": 0}:
            raise RuntimeError(("ASSERTION_ELISION_DRIFT", observed["path"]))
    first = files[0]
    expressions = [x["expression"] for x in first["assertions"]]
    critical = ("len(forward_new) == 3", "len({r['t'] for r in forward_new}) == 3",
                "(t, route) not in origkeys", "t < exit_ts")
    if not all(any(term in expr for expr in expressions) for term in critical):
        raise RuntimeError(("CRITICAL_ASSERTION_DRIFT", expressions))
    if synthetic_assert_semantics(0) != "REJECT_ASSERTION":
        raise RuntimeError("SYNTHETIC_NORMAL_ASSERTION_FAILED")
    if synthetic_assert_semantics(1) != "PASSED" or synthetic_assert_semantics(2) != "PASSED":
        raise RuntimeError("SYNTHETIC_OPTIMIZE_ELISION_FAILED")
    probe = subprocess_optimize_probe()
    if probe != {"without_optimize": "0", "with_dash_O": "1", "with_PYTHONOPTIMIZE_1": "1"}:
        raise RuntimeError(("UNEXPECTED_PYTHON_FLAGS", probe))
    script = str(HERE / TARGETS[0][0])
    clean_env = {"PYTHONOPTIMIZE": "", "PYTHONPATH": "", "PYTHONHOME": ""}
    checks = {
        "no_independent_root": direct_python_launch_policy([sys.executable, script], clean_env, trusted_root=False),
        "optimized_flag": direct_python_launch_policy([sys.executable, "-O", script], clean_env, trusted_root=True),
        "optimized_env": direct_python_launch_policy([sys.executable, script], {**clean_env, "PYTHONOPTIMIZE": "1"}, trusted_root=True),
        "untrusted_pythonpath": direct_python_launch_policy([sys.executable, script], {**clean_env, "PYTHONPATH": "C:/tmp/untrusted"}, trusted_root=True),
        "synthetic_interpreter_only": direct_python_launch_policy([sys.executable, script], clean_env, trusted_root=True),
    }
    if checks != {
        "no_independent_root": "REJECT_NO_INDEPENDENT_TRUST_ROOT",
        "optimized_flag": "REJECT_OPTIMIZED_INTERPRETER",
        "optimized_env": "REJECT_PYTHONOPTIMIZE_ENV",
        "untrusted_pythonpath": "REJECT_UNPINNED_IMPORT_ENVIRONMENT",
        "synthetic_interpreter_only": "RESEARCH_PRELAUNCH_INTERPRETER_ONLY_NOT_AUTHORIZED",
    }:
        raise RuntimeError(("UNEXPECTED_PRELAUNCH_POLICY", checks))
    return {
        "status": "BLOCKED_OPTIMIZED_PYTHON_ELIDES_RESEARCH_INVARIANTS",
        "python": sys.version.split()[0],
        "source_files": files,
        "total_assertions": sum(x["assert_count"] for x in files),
        "synthetic_assert_normal": "REJECT_ASSERTION",
        "synthetic_assert_optimized": "PASSED",
        "interpreter_probe": probe,
        "prelaunch_policy": checks,
        "runner_imported_or_executed": False,
        "native8_owner_registered": False,
        "trusted_root_available": False,
        "native8_economic_bt": False,
        "live_or_production_changes": False,
        "actual_orders": 0,
    }


def main() -> None:
    result = audit()
    payload = (json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    print("STATUS", result["status"])
    print("ASSERTS", result["total_assertions"])
    print("AUDIT_SHA256", digest(payload))
    if len(sys.argv) == 2:
        path = Path(sys.argv[1]).resolve()
        if not path.is_relative_to(Path("C:/tmp").resolve()):
            raise ValueError("RESEARCH_OUTPUT_ONLY_C_TMP")
        path.write_bytes(payload)
    elif len(sys.argv) != 1:
        raise ValueError("USAGE: audit.py [output.json]")


if __name__ == "__main__":
    main()
