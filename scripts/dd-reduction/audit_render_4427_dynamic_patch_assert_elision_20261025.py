#!/usr/bin/env python3
"""Research-only static audit. Never imports or executes Native8 or PENGU."""
from __future__ import annotations
import ast, dis, hashlib, json, types
from pathlib import Path

TARGET = Path(__file__).resolve().with_name("research-pengu-combined-normal8-recovery24-full8-20261024.py")
OBSERVED_GIT_BLOB = "1917333c76d8cbe79783d4e32a6951b6419ef3c1"

def count_assert_ops(c: types.CodeType) -> int:
    return sum(x.opname == "LOAD_ASSERTION_ERROR" for x in dis.get_instructions(c)) + sum(
        count_assert_ops(x) for x in c.co_consts if isinstance(x, types.CodeType))

def check_patch(src: str, old: str, new: str, optimize: int, *, explicit: bool) -> str:
    # Synthetic source only; no real research code is executed.
    ns = {"src": src, "old": old, "new": new}
    guard = ("if src.count(old)!=1:\n raise RuntimeError('SOURCE_DRIFT')\n" if explicit
             else "assert src.count(old)==1\n")
    try:
        exec(compile(guard + "patched=src.replace(old,new)\n", "<synthetic>", "exec", optimize=optimize), ns)
    except (AssertionError, RuntimeError):
        return "REJECT"
    return "NO_OP" if ns["patched"] == src else "PATCH_" + str(ns["patched"].count(new))

def main() -> None:
    raw = TARGET.read_bytes()
    blob = hashlib.sha1(("blob %d\0" % len(raw)).encode() + raw).hexdigest()
    if blob != OBSERVED_GIT_BLOB:
        raise RuntimeError("GITHUB_BLOB_DRIFT")
    src = raw.decode("utf-8")
    tree = ast.parse(src)
    guards = [x for x in ast.walk(tree) if isinstance(x, ast.Assert)]
    if len(guards) != 1 or ast.unparse(guards[0].test) != "src.count(old) == 1":
        raise RuntimeError("ASSERT_GUARD_DRIFT")
    assignments = {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body
                   if isinstance(n, ast.Assign) and len(n.targets) == 1
                   and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("old", "new")}
    old, new = assignments["old"], assignments["new"]
    ops = {str(o): count_assert_ops(compile(src, str(TARGET), "exec", optimize=o)) for o in (0,1,2)}
    if ops != {"0": 1, "1": 0, "2": 0}:
        raise RuntimeError("OPTIMIZATION_DRIFT")
    cases = {}
    for n in (0,1,2):
        synthetic = old * n
        cases[str(n)] = {}
        for o in (0,1,2):
            weak = check_patch(synthetic,old,new,o,explicit=False)
            strong = check_patch(synthetic,old,new,o,explicit=True)
            if weak != ("REJECT" if o == 0 and n != 1 else ("NO_OP" if n == 0 else "PATCH_" + str(n))):
                raise RuntimeError(("WEAK_GUARD_UNEXPECTED",n,o,weak))
            if strong != ("REJECT" if n != 1 else "PATCH_1"):
                raise RuntimeError(("STRONG_GUARD_UNEXPECTED",n,o,strong))
            cases[str(n)][str(o)] = {"assert_guard": weak, "explicit_guard": strong}
    result = {"status":"BLOCKED_OPTIMIZED_DYNAMIC_PATCH_GUARD_ELISION_RESEARCH_ONLY",
              "git_blob_observed_not_trust_root":blob,
              "raw_sha256_observed_not_trust_root":hashlib.sha256(raw).hexdigest(),
              "assert_ops":ops,"synthetic_cases":cases,
              "native8_executed":False,"order_authorized":False}
    payload=(json.dumps(result,sort_keys=True,indent=2)+"\n").encode()
    print(payload.decode(),end="")
    print("AUDIT_SHA256",hashlib.sha256(payload).hexdigest())

if __name__ == "__main__":
    main()
