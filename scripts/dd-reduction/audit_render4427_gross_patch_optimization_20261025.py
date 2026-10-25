#!/usr/bin/env python3
"""RENDER #4427 research-only static/isolated gross-patch optimization audit.

Reads two legacy research Python files without importing them. Only an extracted
pure source-rewrite function runs against synthetic strings with a stub upstream.
Never touches Native8, LIVE, Production, orders, or existing worktrees.
"""
import ast
import dis
import hashlib
import json
import types
from pathlib import Path

R = Path(r"C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts")
N = {
    "gross": ("idle_gross_fractional_isolated_full8_20261016.py", "9f2d713bc7d0efed73923e3839e43c39fcdc318baec9c58f9c3244e42c53ab8c"),
    "helper": ("bt120_idle_gross_q102hype_20261017.py", "61b2f1e7167231e68ba9cb764cb2695511cfc246d0c99c9a9c86aa514839501d"),
}
trees = {}
for k, (fn, sha) in N.items():
    b = (R / fn).read_bytes()
    assert hashlib.sha256(b).hexdigest() == sha, (k, "SOURCE_DRIFT")
    trees[k] = ast.parse(b.decode("utf-8-sig"))

patch = next(x for x in trees["gross"].body if isinstance(x, ast.FunctionDef) and x.name == "researched_source_patch")
assert len([x for x in ast.walk(patch) if isinstance(x, ast.Assert)]) == 2

def assert_op_count(c):
    return (sum(ins.opname == "LOAD_ASSERTION_ERROR" for ins in dis.get_instructions(c))
            + sum(assert_op_count(v) for v in c.co_consts if isinstance(v, types.CodeType)))

bytecode = {str(o): {k: assert_op_count(compile(t, N[k][0], "exec", optimize=o))
                     for k, t in trees.items()} for o in (0, 1, 2)}
assert bytecode["0"]["gross"] >= 3 and bytecode["0"]["helper"] >= 3
assert all(v == 0 for k, vals in bytecode.items() if k != "0" for v in vals.values())

one = "                    requested = 1.0\n"
two = "                    elif room + 1e-9 < 1.0:\n"
cases = {
    "valid": one + two,
    "missing_requested": two,
    "duplicate_requested": one + one + two,
    "missing_room": one,
    "duplicate_room": one + two + two,
}
verdict = {}
for opt in (0, 1, 2):
    module = ast.fix_missing_locations(ast.Module(body=[patch], type_ignores=[]))
    ns = {"originalPatch": lambda s, strict: s}
    exec(compile(module, "isolated_function_only", "exec", optimize=opt), ns)
    verdict[str(opt)] = {}
    for name, source in cases.items():
        try:
            result = ns["researched_source_patch"](source, False)
            verdict[str(opt)][name] = {
                "status": "PASS",
                "old_requested_remaining": result.count(one),
                "old_room_remaining": result.count(two),
            }
        except AssertionError:
            verdict[str(opt)][name] = {"status": "REJECT_ASSERT"}

assert verdict["0"]["valid"]["status"] == "PASS"
assert all(verdict["0"][k]["status"] == "REJECT_ASSERT" for k in cases if k != "valid")
assert all(verdict[str(o)][k]["status"] == "PASS" for o in (1, 2) for k in cases)
assert verdict["1"]["duplicate_requested"]["old_requested_remaining"] == 1
assert verdict["1"]["duplicate_room"]["old_room_remaining"] == 1

assert_counts = {k: [x.lineno for x in ast.walk(t) if isinstance(x, ast.Assert)]
                 for k, t in trees.items()}
output = {
    "status": "RESEARCH_ONLY_GROSS_PATCH_FAIL_OPEN_UNDER_OPTIMIZE",
    "verified_source_sha256": {k: v[1] for k, v in N.items()},
    "assert_lines": {k: sorted(v) for k, v in assert_counts.items()},
    "assert_bytecode": bytecode,
    "isolated_patch_cases": verdict,
    "limitations": "Only isolated function AST executed with identity stub; no research modules imported; no Native8 runtime or economic BT.",
}
canonical = json.dumps(output, sort_keys=True, separators=(",", ":"))
print(canonical)
print("AUDIT_SHA256", hashlib.sha256(canonical.encode()).hexdigest())
