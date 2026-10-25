#!/usr/bin/env python3
"""RESEARCH ONLY. Static root-identity and literal dependency parity audit.
Never imports or executes any Native8 runner; never authorizes orders.
"""
from __future__ import annotations
import argparse
import ast
import collections
import hashlib
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RUNNER = "run-render-4427-independent-profit-sell55-native8-20261024.py"
EXEC_ROOT = Path("C:/tmp/render-multiregime-study-20261024")
BRAIN_ROOT = Path("C:/tmp/render-mtf-study-20261024")
EXPECTED_BRAIN = "2ffb72b8707a3f32e68270b7e89c2ee01d2c2484922057f0037cefdc17c2d230"
EXPECTED_BANK = "d5234a91155afa2e232b0c2372b4a929a875ee79ef23d085a6417ecfab334c07"

def must(condition, message):
    if not condition:
        raise RuntimeError("FAIL_CLOSED_RUNTIME_ROOT: " + message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, timeout=30)
    must(p.returncode == 0, "git read failed " + repr(args))
    return p.stdout.decode("utf-8", "replace").strip()

def get_assign(tree, name):
    matches = [n.value for n in tree.body if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
    must(len(matches) == 1, "assignment missing/ambiguous " + name)
    return matches[0]

def path_literal(expr):
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id == "Path" and len(expr.args) == 1 and not expr.keywords:
        must(isinstance(expr.args[0], ast.Constant) and isinstance(expr.args[0].value, str), "nonliteral Path")
        return Path(expr.args[0].value)
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Div):
        must(isinstance(expr.right, ast.Constant) and isinstance(expr.right.value, str), "nonliteral path component")
        return path_literal(expr.left) / expr.right.value
    if isinstance(expr, ast.Name):
        must(expr.id in ("ROOT", "REPO", "DD", "HERE"), "unexpected name")
        return expr.id
    raise RuntimeError("FAIL_CLOSED_RUNTIME_ROOT: nonliteral path expression")

def resolve_paths(source):
    tree = ast.parse(source)
    cache = {}
    for key in ("ROOT", "REPO", "DD", "HERE"):
        expr = get_assign(tree, key)
        if key == "ROOT":
            must(isinstance(expr, ast.Call), "ROOT not literal")
            val = path_literal(expr)
        else:
            # Only known linear bindings, not arbitrary expression evaluation.
            must(isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Div), "unexpected binding")
            lhs = expr.left
            must(isinstance(lhs, ast.Name) and lhs.id in cache, "unexpected binding parent")
            must(isinstance(expr.right, ast.Constant) and isinstance(expr.right.value, str), "nonliteral suffix")
            val = cache[lhs.id] / expr.right.value
        cache[key] = val
    must(cache["REPO"] == cache["ROOT"] / "render-multiregime-study-20261024", "unexpected REPO root")
    must(cache["DD"] == cache["REPO"] / "scripts/dd-reduction", "unexpected DD root")
    must(cache["HERE"] == cache["ROOT"] / "render-mtf-study-20261024", "unexpected external brain root")
    for name, var, filename in (
        ("base", "DD", "run-render-4427-native8-shared-wallet-20261024.py"),
        ("brain", "HERE", "render_4427_independent_rolling_profit_gate_20261024.py"),
    ):
        call = get_assign(tree, name)
        must(isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "load"
             and len(call.args) == 2, "unexpected dynamic loader " + name)
        path = call.args[1]
        must(isinstance(path, ast.BinOp) and isinstance(path.op, ast.Div)
             and isinstance(path.left, ast.Name) and path.left.id == var
             and isinstance(path.right, ast.Constant) and path.right.value == filename,
             "unexpected load path " + name)
    return {k: str(v).replace("\\", "/") for k, v in cache.items()}

def graph(dd):
    queue = collections.deque([RUNNER])
    seen, edges = set(), set()
    while queue:
        name = queue.popleft()
        if name in seen:
            continue
        file = dd / name
        must(file.is_file(), "missing literal-linked module " + name)
        seen.add(name)
        tree = ast.parse(file.read_text(encoding="utf8"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                    and node.value.endswith(".py") and Path(node.value).name == node.value
                    and (dd / node.value).is_file()):
                edges.add((name, node.value))
                queue.append(node.value)
    return sorted(seen), sorted(edges)

def equal_source_bytes(a, b):
    # Allow Windows checkout CRLF only; reject all other byte differences.
    return a.replace(b"\r\n", b"\n") == b.replace(b"\r\n", b"\n")

def require_isolated_root(actual, isolated):
    must(actual.resolve() == isolated.resolve(), "execution root not identical to pinned audit checkout")
    return True

def scan():
    must(EXEC_ROOT.is_dir() and REPO.is_dir(), "checkout missing")
    source = (REPO / "scripts/dd-reduction" / RUNNER).read_text(encoding="utf8")
    bindings = resolve_paths(source)
    must(Path(bindings["REPO"]).resolve() == EXEC_ROOT.resolve(), "actual runner REPO not expected")
    names, edges = graph(REPO / "scripts/dd-reduction")
    audited_head = git(REPO, "rev-parse", "HEAD")
    mismatches, missing = [], []
    for name in names:
        isolated = REPO / "scripts/dd-reduction" / name
        active = EXEC_ROOT / "scripts/dd-reduction" / name
        obj = subprocess.run(["git", "-C", str(REPO), "show", audited_head + ":scripts/dd-reduction/" + name], capture_output=True, timeout=30)
        must(obj.returncode == 0 and equal_source_bytes(isolated.read_bytes(), obj.stdout), "audit checkout differs from pinned Git object " + name)
        if not active.is_file():
            missing.append(name)
        elif not equal_source_bytes(isolated.read_bytes(), active.read_bytes()):
            mismatches.append(name)
    must(not missing and not mismatches, "current literal-linked source parity failed")
    brain = BRAIN_ROOT / "render_4427_independent_rolling_profit_gate_20261024.py"
    bank = BRAIN_ROOT / "RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz"
    must(brain.is_file() and bank.is_file(), "brain or shadow bank missing")
    must(sha(brain.read_bytes()) == EXPECTED_BRAIN, "brain SHA changed")
    must(sha(bank.read_bytes()) == EXPECTED_BANK, "shadow bank SHA changed")
    active_head = git(EXEC_ROOT, "rev-parse", "HEAD")
    must(audited_head != active_head, "root divergence resolved, re-audit")
    try:
        require_isolated_root(EXEC_ROOT, REPO)
    except RuntimeError as exc:
        must(str(exc).startswith("FAIL_CLOSED_RUNTIME_ROOT:"), "wrong guard exception")
        guard = "REJECT_EXECUTION_ROOT_NOT_PINNED"
    else:
        raise RuntimeError("expected execution root mismatch")
    return {
        "status": "BLOCKED_HARDCODED_UNPINNED_EXECUTION_ROOT_RESEARCH_ONLY",
        "auditCheckoutGitHead": audited_head,
        "runnerExecutionCheckoutGitHead": active_head,
        "entryRunnerBindings": bindings,
        "entryRunnerBaseLoadPath": str(EXEC_ROOT / "scripts/dd-reduction" / "run-render-4427-native8-shared-wallet-20261024.py").replace("\\", "/"),
        "entryRunnerBrainLoadPath": str(brain).replace("\\", "/"),
        "runtimeRootIsAuditedCheckout": False,
        "strictRootGuard": guard,
        "literalLinkedFilesCompared": len(names),
        "literalReferenceEdgesOverapprox": len(edges),
        "literalLinkedFilesByteParity": len(names),
        "literalLinkedGitObjectBytesVerified": len(names),
        "literalLinkedFilesMissing": missing,
        "literalLinkedFilesDifferent": mismatches,
        "literalGraphNotRuntimeClosure": True,
        "externalBrainSha256": sha(brain.read_bytes()),
        "externalBankSha256": sha(bank.read_bytes()),
        "independentTrustRootAvailable": False,
        "nativeOwnerRegistered": False,
        "thirteenGateProofsCertified": False,
        "newEconomicBt": False,
        "liveChanges": 0,
    }

def self_test(result):
    assert result["literalLinkedFilesCompared"] == 47
    assert result["literalReferenceEdgesOverapprox"] == 69
    assert result["literalLinkedFilesByteParity"] == 47
    assert result["literalLinkedGitObjectBytesVerified"] == 47
    assert result["strictRootGuard"] == "REJECT_EXECUTION_ROOT_NOT_PINNED"
    assert not result["runtimeRootIsAuditedCheckout"]
    assert result["auditCheckoutGitHead"] != result["runnerExecutionCheckoutGitHead"]
    assert result["entryRunnerBindings"]["REPO"].endswith("render-multiregime-study-20261024")
    assert result["externalBrainSha256"] == EXPECTED_BRAIN
    assert result["externalBankSha256"] == EXPECTED_BANK
    assert not result["independentTrustRootAvailable"]
    assert not result["nativeOwnerRegistered"]
    assert not result["thirteenGateProofsCertified"]
    assert not result["newEconomicBt"]
    assert result["liveChanges"] == 0
    return 15

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    result = scan()
    if args.self_test:
        print("ASSERTIONS", self_test(result), "PASS")
    payload = (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf8")
    if args.output:
        must(args.output.resolve().is_relative_to(Path("C:/tmp").resolve()), "output outside C:/tmp")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(payload)
    print("AUDIT_JSON_SHA256", sha(payload))
    print("STATUS", result["status"])

if __name__ == "__main__":
    main()
