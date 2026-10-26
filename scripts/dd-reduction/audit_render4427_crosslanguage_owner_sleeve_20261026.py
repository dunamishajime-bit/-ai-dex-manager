#!/usr/bin/env python3
"""RENDER #4427: pinned, research-only cross-language Owner/sleeve audit.

No repository imports, filesystem writes, venue calls, order calls, or LIVE mutations.
Only exact SHA256-pinned source bytes are fetched and isolated pure functions executed.
"""
from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
import urllib.request

REPO = "dunamishajime-bit/-ai-dex-manager"
SOURCE_REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "lib/disdex-pending-exposure-registry.ts": "09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100",
    "lib/disdex-account-order-lock.ts": "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
    "scripts/disdex_pending_exposure_registry.py": "0ca274dcbe5fd35b3b6fde7c200c65f70532e360994958cb78141ba626ae5e3d",
    "scripts/disdex_account_order_lock.py": "839fff2b49b0b679d13391ee9b1a2ad6fd2df759db9128fbd47eeae6c34bb17e",
}
OWNERS = [
    "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH",
    "IDLE_PRIORITY_SHORT",
    "V12_V4",
    "HYPE_LONG",
    "V52",
]


def require(condition: bool, code: str) -> None:
    if not condition:
        raise RuntimeError(code)


def pinned_sources() -> dict[str, str]:
    result: dict[str, str] = {}
    for path, digest in PINS.items():
        url = f"https://raw.githubusercontent.com/{REPO}/{SOURCE_REF}/{path}"
        with urllib.request.urlopen(url, timeout=25) as response:
            data = response.read()
        require(hashlib.sha256(data).hexdigest() == digest, "SOURCE_PIN_MISMATCH:" + path)
        result[path] = data.decode("utf-8", "strict")
    return result


def isolated_function(source: str, name: str, namespace: dict | None = None):
    tree = ast.parse(source)
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
    require(len(nodes) == 1, "PY_FUNCTION_CLOSURE_AMBIGUOUS:" + name)
    # No module-level import or other module-scope statement is executed.
    module = ast.fix_missing_locations(ast.Module(body=[nodes[0]], type_ignores=[]))
    ns = dict(namespace or {})
    exec(compile(module, "<sha256-pinned-function>", "exec"), ns)
    return ns[name]


def python_lock_sleeve_expression(source: str):
    tree = ast.parse(source)
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "AccountOrderLock"]
    require(len(classes) == 1, "PY_LOCK_CLASS_AMBIGUOUS")
    methods = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and n.name == "reserve"]
    require(len(methods) == 1, "PY_RESERVE_AMBIGUOUS")
    values = [
        value for node in ast.walk(methods[0]) if isinstance(node, ast.Dict)
        for key, value in zip(node.keys, node.values)
        if isinstance(key, ast.Constant) and key.value == "sleeve"
    ]
    require(len(values) == 1, "PY_LOCK_SLEEVE_EXPRESSION_AMBIGUOUS")
    return compile(ast.fix_missing_locations(ast.Expression(values[0])), "<sha256-pinned-expression>", "eval")


def typescript_owner_results(source: str) -> dict[str, str]:
    marker = "function expectedSleeve("
    start = source.find(marker)
    end = source.find("\nfunction normalizeEntry(", start)
    require(start >= 0 and end > start and source.count(marker) == 1, "TS_OWNER_FUNCTION_AMBIGUOUS")
    snippet = source[start:end]
    # Original TS pure function, stripped in-memory, no source module import.
    node = r"""
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(0, 'utf8');
const expectedSleeve = vm.runInNewContext(
  stripTypeScriptTypes(source) + '\nexpectedSleeve', {}
);
const owners = JSON.parse(process.argv[1]);
const result = owners.map(owner => {
  try { return [owner, expectedSleeve(owner)]; }
  catch (error) { return [owner, 'ERROR:' + String(error.message)]; }
});
console.log(JSON.stringify(result));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", node, json.dumps(OWNERS)],
        input=snippet, text=True, capture_output=True, timeout=30, check=False,
    )
    require(result.returncode == 0, "NODE_PURE_TS_FUNCTION_FAILED:" + result.stderr[-300:])
    rows = json.loads(result.stdout)
    require(len(rows) == len(OWNERS), "TS_OWNER_COUNT_MISMATCH")
    return dict(rows)


def main() -> None:
    sources = pinned_sources()
    py_source = sources["scripts/disdex_pending_exposure_registry.py"]
    py_owner = isolated_function(py_source, "_expected_sleeve")
    py_validate = isolated_function(
        py_source, "_validate_entry",
        {"_expected_sleeve": py_owner, "ACTIVE_STATUSES": {"PENDING", "SUBMITTED", "UNKNOWN"}},
    )
    py_lock_expr = python_lock_sleeve_expression(sources["scripts/disdex_account_order_lock.py"])
    ts = typescript_owner_results(sources["lib/disdex-pending-exposure-registry.ts"])
    ts_lock = sources["lib/disdex-account-order-lock.ts"]
    require('sleeve: "CRYPTO"' in ts_lock, "TS_LOCK_CRYPTO_LITERAL_MISSING")
    require(ts_lock.count('sleeve: "CRYPTO"') == 1, "TS_LOCK_CRYPTO_LITERAL_AMBIGUOUS")

    rows = []
    for owner in OWNERS:
        try:
            registry = py_owner(owner)
        except Exception as error:
            registry = "ERROR:" + str(error)
        lock_sleeve = eval(py_lock_expr, {"__builtins__": {}}, {"strategy_id": owner})
        example = {
            "reservationId": "synthetic-only", "strategyId": owner,
            "sleeve": lock_sleeve, "symbol": "RENDERUSDT",
            "side": "SHORT", "status": "PENDING",
            "gross": 0.25, "notionalUsd": 25,
            "createdAt": 1, "updatedAt": 1,
        }
        try:
            py_validate(example)
            py_lock_entry = "ACCEPT"
        except Exception as error:
            py_lock_entry = "REJECT:" + str(error)
        rows.append({
            "owner": owner,
            "ts_registry": ts[owner],
            "ts_lock_sleeve_literal": "CRYPTO",
            "py_registry": registry,
            "py_lock_generated_sleeve": lock_sleeve,
            "py_registry_on_py_lock_row": py_lock_entry,
        })
    index = {row["owner"]: row for row in rows}
    target = index["IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH"]
    require(target["ts_registry"] == "ERROR:PENDING_EXPOSURE_OWNER_UNKNOWN:IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH", "TARGET_TS_UNEXPECTED")
    require(target["py_registry"] == "CRYPTO", "TARGET_PY_REGISTRY_UNEXPECTED")
    require(target["py_lock_generated_sleeve"] == "STOCK", "TARGET_PY_LOCK_UNEXPECTED")
    require(target["py_registry_on_py_lock_row"] == "REJECT:PENDING_EXPOSURE_OWNER_SLEEVE_MISMATCH:IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH", "TARGET_PY_REJECTION_UNEXPECTED")
    require(index["IDLE_PRIORITY_SHORT"]["py_registry_on_py_lock_row"].startswith("REJECT:"), "BASELINE_IDLE_UNEXPECTED")
    require(index["V12_V4"]["py_registry_on_py_lock_row"] == "ACCEPT", "V12_CONTROL_UNEXPECTED")
    require(index["V52"]["py_registry_on_py_lock_row"] == "ACCEPT", "STOCK_CONTROL_UNEXPECTED")
    require(index["V12_V4"]["ts_registry"] == "CRYPTO", "TS_V12_CONTROL_UNEXPECTED")
    require(index["V52"]["ts_registry"] == "STOCK", "TS_STOCK_CONTROL_UNEXPECTED")

    result = {
        "schema": "render4427-crosslanguage-owner-sleeve-research/v1",
        "source_ref": SOURCE_REF,
        "source_sha256": dict(sorted(PINS.items())),
        "owners": rows,
        "verified_cases": len(rows),
        "conclusion": "RESEARCH_OWNER_REJECTED_BY_TS_AND_PY_LOCK_REGISTRY_SLEEVE_MISMATCH",
        "status": "NEED_NATIVE_ALLOCATOR",
        "order_authorized": False,
        "real_native8_proof": False,
        "real_venue_test": False,
        "synthetic_entry_only": True,
    }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
