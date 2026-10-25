#!/usr/bin/env python3
"""RESEARCH ONLY: static source-attestation audit for RENDER #4427 Native8.
Does not import or run the wallet, mutate candidate streams, or authorize orders.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path

SOURCE = Path("C:/tmp/render-multiregime-study-20261024/scripts/dd-reduction")
REPO_SCRIPT = Path(__file__).resolve().parent
CHAIN = (
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
PATCH = CHAIN[5]
BASE = CHAIN[-1]

def require(cond, message):
    if not cond:
        raise RuntimeError("FAIL_CLOSED_SOURCE_ATTESTATION: " + message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def extract_literal(tree, name):
    nodes = [n for n in tree.body if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
    require(len(nodes) == 1, "missing/duplicate patch literal " + name)
    result = ast.literal_eval(nodes[0].value)
    require(isinstance(result, str), "nonliteral patch " + name)
    return result

def audit(source=SOURCE):
    paths = [source / name for name in CHAIN]
    require(all(p.is_file() for p in paths), "missing upstream chain source")
    texts = [p.read_text(encoding="utf-8") for p in paths]
    for idx in range(len(CHAIN) - 1):
        require(CHAIN[idx + 1] in texts[idx],
                "upstream import edge not found " + CHAIN[idx])
    patch_text = texts[5]
    require("inspect.getsource(function)" in patch_text, "inspect source hook missing")
    require("exec(compile(src.replace(old,new)" in patch_text, "dynamic exec hook missing")
    require("native.main=loc['main']" in patch_text, "runtime main assignment missing")
    patch_ast = ast.parse(patch_text)
    old = extract_literal(patch_ast, "old")
    new = extract_literal(patch_ast, "new")
    source_ast = ast.parse(texts[-1])
    funcs = [n for n in source_ast.body if isinstance(n, ast.FunctionDef) and n.name == "main"]
    require(len(funcs) == 1, "upstream main function count mismatch")
    original = ast.get_source_segment(texts[-1], funcs[0])
    require(original.count(old) == 1, "runtime replacement target count not 1")
    transformed = original.replace(old, new, 1)
    compile(transformed, "RESEARCH_STATIC_TRANSFORM_ONLY", "exec")
    require(sha(original.encode()) != sha(transformed.encode()), "runtime source unchanged")
    producer = texts[0]
    require("'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_INDEPENDENT_CAUSAL_SCORE_20261024'" in producer,
            "research source label changed")
    require("'generic_accepted':True" in producer and "'route_selected':True" in producer,
            "self-asserted flags changed")
    require("'owner_id':" not in producer, "producer now has owner field; re-audit required")
    return {
        "status": "PASS_STATIC_RUNTIME_SOURCE_REWRITE_PROVEN_RESEARCH_ONLY",
        "upstreamChainFiles": len(CHAIN),
        "upstreamChain": [{"path": name, "fileSha256": sha(path.read_bytes())}
                          for name, path in zip(CHAIN, paths)],
        "runtimePatch": {
            "sourceModule": PATCH,
            "originalMainSourceSha256": sha(original.encode()),
            "transformedMainSourceSha256": sha(transformed.encode()),
            "replacementOccurrences": original.count(old),
            "transformedCompiles": True,
            "isDifferentFromCheckedInMain": True,
        },
        "candidateProducer": {
            "sourceRuntimeShaField": "RESEARCH_ONLY_RENDER_4427_INDEPENDENT_CAUSAL_SCORE_20261024",
            "sourceRuntimeShaIsCryptographicDigest": False,
            "selfAssertedAcceptanceFlags": True,
            "explicitOwnerIdInProducedRow": False,
        },
        "nativeLiveProof": False,
        "thirteenGateProofsCertified": False,
        "venueFillVerified": False,
        "economicBtRun": False,
        "productionChanges": 0,
        "liveChanges": 0,
    }

def self_test():
    r = audit()
    assert r["runtimePatch"]["isDifferentFromCheckedInMain"]
    assert len(r["upstreamChain"]) == 10
    assert r["runtimePatch"]["replacementOccurrences"] == 1
    assert r["candidateProducer"]["sourceRuntimeShaIsCryptographicDigest"] is False
    print("STATIC_RUNTIME_ATTESTATION_TESTS_4_OF_4_PASS")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    result = audit()
    payload = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        require(args.output.resolve().is_relative_to(Path("C:/tmp").resolve()),
                "output must be in C:/tmp research area")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(payload.encode("utf-8"))
    print("AUDIT_JSON_SHA256", sha(payload.encode("utf-8")))
    print("ORIGINAL_MAIN_SHA", result["runtimePatch"]["originalMainSourceSha256"])
    print("TRANSFORMED_MAIN_SHA", result["runtimePatch"]["transformedMainSourceSha256"])

if __name__ == "__main__":
    main()
