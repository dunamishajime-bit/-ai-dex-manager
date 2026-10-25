#!/usr/bin/env python3
"""Read-only fourth-root patch-closure audit for RENDER #4427 research.
This is NOT a trust-root attestation, Native8 replay, or order authorization.
Never imports or executes the inspected research modules.
"""
from __future__ import annotations
import ast
import dis
import hashlib
import json
import pathlib
import subprocess
import types

THIRD = pathlib.Path(r"C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research/long_two_axis_latest_full8_20261019.py")
UPSTREAM = pathlib.Path(r"C:/Users/dis/Desktop/disdex-exit-overlay-handoff-20261017/research/exit_overlays_20261017/scripts")
TARGET = UPSTREAM / "bt120_integrated_5minute_full8_20261017.py"
HELPER = UPSTREAM / "bt120_idle_gross_q102hype_20261017.py"
ARCHIVE = r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/idle-exit-deep-research-20261016/bt120_5m_20261017"
OUT = r"C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research_runs/long_two_axis_latest_full8_20261019"
OBSERVED_SHA = {
    "third": "f861140de0a123aef0e4ce93f21e6b0b83ec9f9594921c4bca0439fc65f56108",
    "target": "6fd448cc4dae0feb336c349ca1debdc7d74e22499650bdc65739cbf6ab12ca53",
    "helper": "61b2f1e7167231e68ba9cb764cb2695511cfc246d0c99c9a9c86aa514839501d",
    "transformed": "56dc1efc8add5f8c82767089b4410daa8e98f33de5fc98ebad3d8d2654a57f92",
}
OBSERVED_HEAD = "6c9b9d032a18c44c82fcfd2f5a74226d71d68160"


def fail(condition: bool, reason: str) -> None:
    if not condition:
        raise RuntimeError(reason)


def main() -> None:
    raw = {"third": THIRD.read_bytes(), "target": TARGET.read_bytes(), "helper": HELPER.read_bytes()}
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in raw.items()}
    fail(hashes == {k: OBSERVED_SHA[k] for k in raw}, "REJECT_OBSERVED_SOURCE_DRIFT")
    head = subprocess.run(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    status = subprocess.run(["git", "-C", str(UPSTREAM), "status", "--porcelain", "--", str(TARGET), str(HELPER)], capture_output=True, text=True, check=True).stdout.strip()
    fail(head == OBSERVED_HEAD and not status, "REJECT_UPSTREAM_CHECKOUT_DRIFT")
    source = raw["third"].decode("utf-8-sig")
    tree = ast.parse(source)
    bootstrap = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "bootstrap")
    literals = {}
    for node in bootstrap.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("find", "findout"):
            literals[node.targets[0].id] = ast.literal_eval(node.value)
    fail(set(literals) == {"find", "findout"}, "REJECT_PATCH_LITERAL_NOT_UNIQUE")
    original = raw["target"].decode("utf-8")
    count1 = original.count(literals["find"])
    changed = original.replace(literals["find"], "ROOT=Path(" + repr(ARCHIVE) + ")")
    count2 = changed.count(literals["findout"])
    changed = changed.replace(literals["findout"], "OUT=Path(" + repr(OUT + "/discarded_study_integration") + ")")
    assert_lines = sorted(n.lineno for n in ast.walk(bootstrap) if isinstance(n, ast.Assert))
    compile_lines = sorted(n.lineno for n in ast.walk(bootstrap) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "compile")
    fail(count1 == count2 == 1 and assert_lines == [28, 31] and compile_lines == [37], "REJECT_PATCH_CONTRACT_DRIFT")
    transformed_sha = hashlib.sha256(changed.encode("utf-8")).hexdigest()
    fail(transformed_sha == OBSERVED_SHA["transformed"], "REJECT_TRANSFORMED_SOURCE_DRIFT")
    for opt in (0, 1, 2):
        compile(changed, str(TARGET), "exec", optimize=opt)
    counts = {}
    for opt in (0, 1, 2):
        compiled = compile(source, str(THIRD), "exec", optimize=opt)
        code = next(x for x in compiled.co_consts if isinstance(x, types.CodeType) and x.co_name == "bootstrap")
        counts[str(opt)] = sum(x.opname == "LOAD_ASSERTION_ERROR" for x in dis.get_instructions(code))
    fail(counts == {"0": 2, "1": 0, "2": 0}, "REJECT_ASSERT_BYTECODE_MISMATCH")
    audit = {
        "status": "BLOCKED_TRANSITIVE_DYNAMIC_PATCH_ROOT_NOT_INDEPENDENTLY_ATTESTED",
        "third_sha256": hashes["third"],
        "upstream_git_head": head,
        "target_sha256": hashes["target"],
        "helper_sha256": hashes["helper"],
        "targeted_git_status": status,
        "patch_count_1": count1,
        "patch_count_2": count2,
        "patch_assert_lines": assert_lines,
        "compile_call_lines": compile_lines,
        "patched_source_sha256": transformed_sha,
        "compile_optimize_0_1_2": "PASS",
        "bootstrap_assert_bytecode_counts": counts,
        "runtime_exec_performed": False,
        "independent_source_pin": False,
        "native8_authorized": False,
    }
    canonical = json.dumps(audit, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    print(json.dumps({"audit": audit, "canonical_json_sha256": hashlib.sha256(canonical).hexdigest()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
