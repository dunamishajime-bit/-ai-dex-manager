#!/usr/bin/env python3
"""RENDER #4427: read-only AST audit of transitive legacy import side effects.

Never imports or executes research targets; reads and hashes source bytes only.
No LIVE, Production, or original-worktree changes.
"""
import ast
import hashlib
import json
from pathlib import Path

FOURTH = Path("C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts")
THIRD = Path("C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research/long_two_axis_latest_full8_20261019.py")
FILES = {
    "third": (THIRD, "f861140de0a123aef0e4ce93f21e6b0b83ec9f9594921c4bca0439fc65f56108"),
    "integrated": (FOURTH / "bt120_integrated_5minute_full8_20261017.py", "6fd448cc4dae0feb336c349ca1debdc7d74e22499650bdc65739cbf6ab12ca53"),
    "combo": (FOURTH / "bt120_combined_and_slippage_stress_20261017.py", "ee67b9325d0a7c058a350c25f98517579d77baf4dde226ce4ae6e2db3d37c5b1"),
    "gross": (FOURTH / "idle_gross_fractional_isolated_full8_20261016.py", "9f2d713bc7d0efed73923e3839e43c39fcdc318baec9c58f9c3244e42c53ab8c"),
    "helper": (FOURTH / "bt120_idle_gross_q102hype_20261017.py", "61b2f1e7167231e68ba9cb764cb2695511cfc246d0c99c9a9c86aa514839501d"),
    "base": (FOURTH / "idle_profit_trailing_full8_20261016.py", "393c63bca56e6597d05302e7e20cb0b719bebf00917e54982f91af1068a69f6c"),
}

def require(value, message):
    if not value:
        raise RuntimeError(message)

def scan(tree):
    result = {"imports": [], "assignments": [], "mkdir": []}
    for node in tree.body:
        if isinstance(node, ast.Import):
            result["imports"] += [(a.name, node.lineno) for a in node.names]
        if isinstance(node, ast.Assign):
            result["assignments"] += [
                (ast.unparse(t), node.lineno)
                for t in node.targets if isinstance(t, (ast.Attribute, ast.Subscript))
            ]
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Attribute)
                and node.value.func.attr == "mkdir"):
            result["mkdir"].append((ast.unparse(node.value.func), node.lineno))
    return result

def main():
    trees, evidence = {}, {}
    for name, (path, expected) in FILES.items():
        data = path.read_bytes()
        require(hashlib.sha256(data).hexdigest() == expected, "SOURCE_DRIFT:" + name)
        trees[name] = ast.parse(data.decode("utf-8-sig"))
        evidence[name] = scan(trees[name])

    def has(name, kind, target):
        require(any(x[0] == target for x in evidence[name][kind]),
                "MISSING:" + name + ":" + kind + ":" + target)

    for name, target in [
        ("integrated", "OUT.mkdir"), ("combo", "COMBOS.mkdir"),
        ("helper", "OUT.mkdir"), ("third", "OUT.mkdir"), ("third", "COMPARE.mkdir")
    ]:
        has(name, "mkdir", target)
    for name, target in [
        ("integrated", "base.causal_exit"), ("combo", "base.causal_exit"),
        ("helper", "base.wrapped_filter"), ("helper", "base.OUTROOT"),
        ("gross", "base.BASE_ADMISSION_PATCH"), ("gross", "base.wrapped_filter"),
        ("gross", "base.s.w.base.quantity_ok")
    ]:
        has(name, "assignments", target)
    for name, target in [
        ("helper", "bt120_combined_and_slippage_stress_20261017"),
        ("helper", "idle_gross_fractional_isolated_full8_20261016"),
        ("combo", "bt120_integrated_5minute_full8_20261017"),
        ("gross", "idle_profit_trailing_full8_20261016"),
        ("integrated", "idle_profit_trailing_full8_20261016")
    ]:
        has(name, "imports", target)

    bootstrap = next(n for n in trees["third"].body
                     if isinstance(n, ast.FunctionDef) and n.name == "bootstrap")
    imports = [n.lineno for n in ast.walk(bootstrap) if isinstance(n, ast.Import)
               and any(a.name == "bt120_idle_gross_q102hype_20261017" for a in n.names)]
    rebinds = [n.lineno for n in ast.walk(bootstrap) if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Attribute) and
                       ast.unparse(t) in ("original_helper.OUT", "original_helper.base.OUTROOT")
                       for t in n.targets)]
    require(len(imports) == 1 and len(rebinds) == 2 and
            all(n > imports[0] for n in rebinds), "IMPORT_REBIND_ORDER")

    output = {
        "status": "RESEARCH_ONLY_IMPORT_SIDE_EFFECTS_CONFIRMED",
        "source_hashes_verified": len(FILES),
        "mkdir": {k: v["mkdir"] for k, v in evidence.items() if v["mkdir"]},
        "mutations": {k: v["assignments"] for k, v in evidence.items()
                      if k in ("integrated", "combo", "gross", "helper")},
        "helper_import_line": imports[0],
        "rebind_lines": sorted(rebinds),
        "limitations": "No target import/exec. No Native8 authenticated root or GateProof.",
    }
    canonical = json.dumps(output, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    print(canonical)
    print("AUDIT_SHA256", hashlib.sha256(canonical.encode()).hexdigest())

if __name__ == "__main__":
    main()
