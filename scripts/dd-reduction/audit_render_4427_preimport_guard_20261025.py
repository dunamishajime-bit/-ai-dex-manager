#!/usr/bin/env python3
"""RESEARCH ONLY: static audit of import-time effects and pre-import root attestation.
Does not import the candidate runner, call Native8, or authorize any order.
"""
from __future__ import annotations
import ast
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path("C:/tmp")
WORKTREE = Path(__file__).resolve().parents[2]
RUNNER_REL = Path("scripts/dd-reduction/run-render-4427-independent-profit-sell55-native8-20261024.py")
EXTERNAL_BRAIN = ROOT / "render-mtf-study-20261024/render_4427_independent_rolling_profit_gate_20261024.py"
EXTERNAL_BANK = ROOT / "render-mtf-study-20261024/RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def static_import_time(source: str) -> dict:
    tree = ast.parse(source)
    loads = []
    mutations = []
    replay = []
    main_guard = None
    for index, stmt in enumerate(tree.body):
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            value = stmt.value
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
            names = [ast.unparse(x) for x in targets]
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "load":
                loads.append({"index": index, "targets": names, "line": stmt.lineno})
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == "replay":
                save = next((ast.literal_eval(k.value) for k in value.keywords if k.arg == "save"
                             and isinstance(k.value, ast.Constant)), None)
                replay.append({"index": index, "targets": names, "line": stmt.lineno, "save": save})
            for target in names:
                if target.startswith(("previous.CASE_RULES[", "previous.PROFIT_FLOOR[",
                                      "native.NEW_CASES[", "native.research_new_rows")):
                    mutations.append({"index": index, "target": target, "line": stmt.lineno})
        if isinstance(stmt, ast.If) and "__name__" in ast.unparse(stmt.test) and "__main__" in ast.unparse(stmt.test):
            main_guard = {"index": index, "line": stmt.lineno}
    if not loads or not replay or not mutations or main_guard is None:
        raise ValueError("REJECT_UNEXPECTED_RUNNER_AST")
    if not (max(x["index"] for x in loads) < main_guard["index"] and
            min(x["index"] for x in replay) < main_guard["index"] and
            min(x["index"] for x in mutations) < main_guard["index"]):
        raise ValueError("REJECT_UNEXPECTED_EXECUTION_ORDER")
    return {"loadCallsAtModuleScope": loads, "mutationsAtModuleScope": mutations,
            "replayCallsAtModuleScope": replay, "mainGuard": main_guard,
            "moduleEffectsBeforeMain": True}

def declared_runtime_root(source: str) -> Path:
    """Resolve only the exact, expected literal ROOT/REPO assignment shapes."""
    tree = ast.parse(source)
    assigns = {t.id: node.value for node in tree.body if isinstance(node, ast.Assign)
               for t in node.targets if isinstance(t, ast.Name) and t.id in ("ROOT", "REPO")}
    root, repo = assigns.get("ROOT"), assigns.get("REPO")
    if not (isinstance(root, ast.Call) and isinstance(root.func, ast.Name)
            and root.func.id == "Path" and len(root.args) == 1
            and isinstance(root.args[0], ast.Constant) and isinstance(root.args[0].value, str)
            and isinstance(repo, ast.BinOp) and isinstance(repo.op, ast.Div)
            and isinstance(repo.left, ast.Name) and repo.left.id == "ROOT"
            and isinstance(repo.right, ast.Constant) and isinstance(repo.right.value, str)):
        raise ValueError("REJECT_NONLITERAL_DECLARED_RUNTIME_ROOT")
    return Path(root.args[0].value) / repo.right.value

def git_head(root: Path) -> str:
    r = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0 or len(r.stdout.strip()) != 40:
        raise ValueError("REJECT_UNVERIFIED_GIT_ROOT")
    return r.stdout.strip()

def preimport_attest(runner: Path, expected_checkout: Path, independent_pin: dict | None) -> str:
    """Pure preflight. Never imports or executes runner. Manifest is supplied independently."""
    if not independent_pin or not independent_pin.get("independently_trusted"):
        return "REJECT_NO_INDEPENDENT_TRUST_ROOT"
    try:
        source = runner.read_bytes()
        static_import_time(source.decode("utf-8"))
        # Reject before any candidate import if runtime path differs from externally pinned checkout.
        if runner.resolve() != (expected_checkout / RUNNER_REL).resolve():
            return "REJECT_PREIMPORT_EXECUTION_ROOT_NOT_PINNED"
        if declared_runtime_root(source.decode("utf-8")).resolve() != expected_checkout.resolve():
            return "REJECT_PREIMPORT_DECLARED_ROOT_NOT_PINNED"
        if independent_pin.get("runner_sha256") != sha(source):
            return "REJECT_PREIMPORT_RUNNER_DIGEST"
        if independent_pin.get("brain_sha256") != sha(EXTERNAL_BRAIN.read_bytes()):
            return "REJECT_PREIMPORT_BRAIN_DIGEST"
        if independent_pin.get("bank_sha256") != sha(EXTERNAL_BANK.read_bytes()):
            return "REJECT_PREIMPORT_BANK_DIGEST"
        if independent_pin.get("git_head") != git_head(expected_checkout):
            return "REJECT_PREIMPORT_GIT_HEAD"
        return "RESEARCH_PREFLIGHT_PASS_NOT_AUTHORIZED"
    except (OSError, ValueError, UnicodeError):
        return "REJECT_PREIMPORT_MISSING_OR_INVALID_EVIDENCE"

def audit() -> dict:
    source_path = WORKTREE / RUNNER_REL
    source = source_path.read_bytes()
    effect = static_import_time(source.decode("utf-8"))
    # These are observed post-hoc digests, never independent roots.
    actual_runner = ROOT / "render-multiregime-study-20261024" / RUNNER_REL
    observed = {"runner_sha256": sha(source), "brain_sha256": sha(EXTERNAL_BRAIN.read_bytes()),
                "bank_sha256": sha(EXTERNAL_BANK.read_bytes()), "git_head": git_head(WORKTREE)}
    status_no_pin = preimport_attest(actual_runner, WORKTREE, None)
    status_synthetic_pin = preimport_attest(actual_runner, WORKTREE,
                                            {**observed, "independently_trusted": True})
    status_local_runner = preimport_attest(source_path, WORKTREE,
                                           {**observed, "independently_trusted": True})
    if status_local_runner != "REJECT_PREIMPORT_DECLARED_ROOT_NOT_PINNED":
        raise AssertionError(status_local_runner)
    if status_no_pin != "REJECT_NO_INDEPENDENT_TRUST_ROOT":
        raise AssertionError(status_no_pin)
    if status_synthetic_pin != "REJECT_PREIMPORT_EXECUTION_ROOT_NOT_PINNED":
        raise AssertionError(status_synthetic_pin)
    return {
        "status": "BLOCKED_PREIMPORT_SIDE_EFFECT_AND_ROOT_MISMATCH_RESEARCH_ONLY",
        "staticModuleScope": effect,
        "actualRuntimeRoot": str(actual_runner.parent.parent.parent).replace("\\", "/"),
        "auditedWorktree": str(WORKTREE).replace("\\", "/"),
        "preimportWithoutIndependentRoot": status_no_pin,
        "preimportWithSyntheticPostHocRoot": status_synthetic_pin,
        "preimportLocalRunnerDeclaredRoot": status_local_runner,
        "observedDigestsNotTrustedRoot": observed,
        "runnerExecuted": False, "native8EconomicBt": False,
        "ownerRouteRegistered": False, "thirteenGateProofsCertified": False,
        "productionChanges": 0, "liveOrders": 0,
    }

def main() -> None:
    result = audit()
    payload = (json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    print("AUDIT_SHA256", sha(payload))
    print("STATUS", result["status"])
    print("MODULE_SCOPE_LOADS", len(result["staticModuleScope"]["loadCallsAtModuleScope"]))
    print("MODULE_SCOPE_REPLAY", result["staticModuleScope"]["replayCallsAtModuleScope"])
    if __import__("sys").argv[1:]:
        target = Path(__import__("sys").argv[1])
        if not target.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("Output must be in C:/tmp")
        target.write_bytes(payload)

if __name__ == "__main__":
    main()
