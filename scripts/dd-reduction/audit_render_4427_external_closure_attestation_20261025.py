#!/usr/bin/env python3
"""RESEARCH ONLY: read-only #4427 import/patch dependency boundary audit.
Never imports research runners, evaluates a wallet, or authorizes orders.
"""
from __future__ import annotations
import argparse
import ast
import collections
import hashlib
import json
import subprocess
from pathlib import Path

COMMIT = "0391c680a15e946ea0a56195670bbd91697ef830"
REPO = Path(__file__).resolve().parents[2]
DD = REPO / "scripts" / "dd-reduction"
SPINE = (
    "run-render-4427-independent-profit-sell55-native8-20261024.py",
    "run-render-4427-native8-shared-wallet-20261024.py",
    "run-render-2024-triple-native-full8-20261024.py",
    "run-render-two-regime-native-full8-20261024.py",
    "run-idle-three-entry-native-full8-20261024.py",
    "research-pengu-combined-normal8-recovery24-full8-20261024.py",
    "research-pengu-recovery-initial-native-full8-20261024.py",
    "research-pengu-initial-negative-native-full8-20261024.py",
    "research-pengu-long-native-full8-after-short-dual-20261024.py",
    "research-pengu-timed-negative-native-full8-20261023.py",
)
BRAIN = Path("C:/tmp/render-mtf-study-20261024/render_4427_independent_rolling_profit_gate_20261024.py")
BANK = Path("C:/tmp/render-mtf-study-20261024/RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz")
EXPECTED_BRAIN_SHA = "2ffb72b8707a3f32e68270b7e89c2ee01d2c2484922057f0037cefdc17c2d230"
EXPECTED_BANK_SHA = "d5234a91155afa2e232b0c2372b4a929a875ee79ef23d085a6417ecfab334c07"
EXPECTED_TRANSFORMED_SHA = "6eb3008a7f40bd1577d22f8daf8baa94f2a8ae0b87f1f58f81c6cf739860677b"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError("FAIL_CLOSED_EXTERNAL_CLOSURE: " + msg)

def git(args: list[str]) -> bytes:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True)
    must(p.returncode == 0, "git read failed: " + repr(args))
    return p.stdout

def referenced_py(name: str) -> list[str]:
    tree = ast.parse((DD / name).read_text(encoding="utf-8"))
    names = {node.value for node in ast.walk(tree)
             if isinstance(node, ast.Constant) and isinstance(node.value, str)
             and node.value.endswith(".py") and Path(node.value).name == node.value
             and (DD / node.value).is_file()}
    return sorted(names - {name})

def scan():
    must(BRAIN.is_file() and BANK.is_file(), "external research dependencies absent")
    must(sha(BRAIN.read_bytes()) == EXPECTED_BRAIN_SHA, "external brain bytes changed")
    must(sha(BANK.read_bytes()) == EXPECTED_BANK_SHA, "external bank bytes changed")
    files = {p: (DD / p).read_bytes() for p in SPINE}
    for path, data in files.items():
        original = git(["show", COMMIT + ":scripts/dd-reduction/" + path])
        must(data.replace(b"\r\n", b"\n") == original and b"\r" not in data.replace(b"\r\n", b""), "tracked source differs beyond CRLF checkout conversion: " + path)
    main = files[SPINE[0]].decode("utf-8")
    brain = BRAIN.read_text(encoding="utf-8")
    must("brain=load('render4427_asof_profit_rank_indep',HERE/'render_4427_independent_rolling_profit_gate_20261024.py')" in main,
         "untracked module import call changed")
    must("with gzip.open(ROOT/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz'" in brain,
         "untracked compressed bank read changed")
    tracked = set(git(["ls-tree", "-r", "--name-only", COMMIT]).decode("utf-8").splitlines())
    must(not any(p.endswith("/" + BRAIN.name) or p == BRAIN.name for p in tracked),
         "brain now in Git tree; re-audit provenance")
    bank_git_path = "docs/research/results/render-three-regime-20261024/" + BANK.name
    must(bank_git_path in tracked, "tracked bank source missing")
    must(git(["show", COMMIT + ":" + bank_git_path]) == BANK.read_bytes(),
         "external bank differs from pinned Git object")
    q = collections.deque([SPINE[0]])
    visited = set()
    edges = set()
    while q:
        item = q.popleft()
        if item in visited:
            continue
        visited.add(item)
        for nxt in referenced_py(item):
            edges.add((item, nxt))
            q.append(nxt)
    must(len(visited) > len(SPINE), "no extra literal-linked modules; re-audit")
    must(all(p in visited for p in SPINE), "spine not represented in literal graph")
    base = (DD / SPINE[-1]).read_text(encoding="utf-8")
    patch = (DD / SPINE[5]).read_text(encoding="utf-8")
    patch_ast = ast.parse(patch)
    def literal(name):
        found = [node for node in patch_ast.body if isinstance(node, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)]
        must(len(found) == 1, "patch literal missing/duplicate: " + name)
        return ast.literal_eval(found[0].value)
    node = [x for x in ast.parse(base).body if isinstance(x, ast.FunctionDef) and x.name == "main"]
    must(len(node) == 1, "main not unique")
    original = ast.get_source_segment(base, node[0])
    old, new = literal("old"), literal("new")
    must(original.count(old) == 1, "patch target count changed")
    transformed = original.replace(old, new, 1)
    compile(transformed, "<STATIC_RESEARCH_ONLY>", "exec")
    must(sha(transformed.encode()) == EXPECTED_TRANSFORMED_SHA, "patched main digest changed")
    return {
        "status": "BLOCKED_UNTRACKED_BRAIN_SOURCE_RESEARCH_ONLY",
        "gitSourceCommit": COMMIT,
        "spineFilesVerifiedAgainstGitObjects": len(SPINE),
        "spineSourceSha256": {n: sha(files[n]) for n in SPINE},
        "literalLinkedModuleCountOverapprox": len(visited),
        "literalLinkedEdgeCountOverapprox": len(edges),
        "literalLinkedAdditionalModules": sorted(visited - set(SPINE)),
        "graphCaveat": "Literal .py references may be optional or dead branches; this is NOT a verified runtime execution closure.",
        "mandatoryExternalInputs": [
            {"kind": "top_level_loaded_brain_module", "relativeLocation": "C:/tmp/render-mtf-study-20261024/" + BRAIN.name,
             "bytes": BRAIN.stat().st_size, "sha256": sha(BRAIN.read_bytes()), "trackedInPinnedGitCommit": False},
            {"kind": "top_level_loaded_gzip_shadow_bank", "relativeLocation": "C:/tmp/render-mtf-study-20261024/" + BANK.name,
             "bytes": BANK.stat().st_size, "sha256": sha(BANK.read_bytes()), "trackedInPinnedGitCommit": True,
             "gitObjectPath": bank_git_path, "gitObjectBytesMatch": True},
        ],
        "patchedMainSha256": sha(transformed.encode()),
        "externalInputsIndependentlyPrePinned": False,
        "runtimeExecutionAttested": False,
        "nativeOwnerRegistered": False,
        "thirteenAsOfGateProofsCertified": False,
        "actualAsterFillsCertified": False,
        "newEconomicBt": False,
        "liveChanges": 0,
    }

def self_test(r):
    assert r["spineFilesVerifiedAgainstGitObjects"] == 10
    assert r["literalLinkedModuleCountOverapprox"] >= 11
    assert len(r["mandatoryExternalInputs"]) == 2
    assert [x["trackedInPinnedGitCommit"] for x in r["mandatoryExternalInputs"]] == [False, True]
    assert r["patchedMainSha256"] == EXPECTED_TRANSFORMED_SHA
    assert r["status"].startswith("BLOCKED")
    assert r["runtimeExecutionAttested"] is False
    assert r["nativeOwnerRegistered"] is False
    assert r["thirteenAsOfGateProofsCertified"] is False
    assert r["liveChanges"] == 0
    return 10

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    r = scan()
    if args.self_test:
        print("RESEARCH_CLOSURE_ASSERTIONS", self_test(r), "PASS")
    payload = json.dumps(r, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        must(args.output.resolve().is_relative_to(Path("C:/tmp").resolve()), "output outside research area")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(payload.encode("utf-8"))
    print("AUDIT_JSON_SHA256", sha(payload.encode("utf-8")))
    print("LITERAL_LINKED_FILES_OVERAPPROX", r["literalLinkedModuleCountOverapprox"])
    print("STATUS", r["status"])

if __name__ == "__main__":
    main()
