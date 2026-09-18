from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import research_quality102_gross_cap_sweep as q102
import research_quality102_mtm_50_v2 as mtm


EXPECTED_FORMAL_NORMAL = 18442769.03585051
EXPECTED_FORMAL_SEVERE = 2827282.1410372
EXPECTED_SELECTED_NORMAL = 66059488.04343018
EXPECTED_SELECTED_SEVERE = 8729157.74295382


def replace_float_assignment(source: str, name: str, value: float) -> str:
    pattern = re.compile(rf"^(\s*{re.escape(name)}\s*=\s*)(-?\d+(?:\.\d+)?)\s*$", re.M)
    replacement = rf"\g<1>{value:g}"
    out, count = pattern.subn(replacement, source, count=1)
    if count != 1:
        raise RuntimeError(f"expected one assignment for {name}, found {count}")
    return out


def filter_pengu_hard24(path: Path, out: Path) -> Path:
    payload = json.loads(path.read_text(encoding="utf-8"))
    for mode in ("normal", "stress"):
        rows = sorted(payload["modes"][mode]["trades"], key=lambda x: int(x["entryTs"]))
        kept = []
        blocked_until = -1
        for row in rows:
            if int(row["entryTs"]) < blocked_until:
                continue
            kept.append(row)
            if row.get("exitReason") == "hard" or "HARD_STOP" in str(row.get("engineExitReason", "")):
                blocked_until = int(row["exitTs"]) + 24 * 3600_000
        payload["modes"][mode]["trades"] = kept
        payload["modes"][mode]["metrics"]["trades"] = len(kept)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def build_source(base_args: list[str], *, q102_cap: float, pengu_cap: float, crypto_cap: float, total_cap: float, daily_loss: float) -> str:
    source = q102.capture_grosssafe_generated(base_args)
    source = q102.patch_supplement_cap(source, q102_cap)
    source = mtm.patch_mtm_engine(source)
    for name, value in (
        ("PENGU_MAX_GROSS", pengu_cap),
        ("CRYPTO_GROSS_CAP", crypto_cap),
        ("TOTAL_GROSS_CAP", total_cap),
        ("CRYPTO_DAILY_LOSS_LIMIT", daily_loss),
    ):
        source = replace_float_assignment(source, name, value)
    if "QUALITY102_MTM_PRE_ADMISSION_REBASE" not in source:
        raise RuntimeError("MTM marker missing")
    return source


def run_engine(source: str, args: argparse.Namespace, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = Path("scripts/.research_flat_boost_current.generated.py")
    generated.write_text(source, encoding="utf-8")
    try:
        subprocess.run(
        [
            sys.executable,
            str(generated),
            "--stock-cache-dir",
            args.stock_cache_dir,
            "--v12-ledger",
            args.v12_ledger,
            "--pengu-ledger",
            args.pengu_ledger,
            "--supplement-csv",
            str(q102.FROZEN_SUPPLEMENT),
            "--output-dir",
            str(out_dir / "result"),
        ],
        check=True,
        )
    finally:
        generated.unlink(missing_ok=True)
    result = json.loads((out_dir / "result" / "result.json").read_text(encoding="utf-8"))
    return result


def slice_block(source: str, needle: str, radius: int = 5000) -> str:
    at = source.find(needle)
    if at < 0:
        return f"MISSING:{needle}\n"
    return source[max(0, at - radius):min(len(source), at + radius)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stock-cache-dir", required=True)
    ap.add_argument("--v12-ledger", required=True)
    ap.add_argument("--pengu-ledger", required=True)
    ap.add_argument("--output-root", required=True)
    args = ap.parse_args()

    root = Path(args.output_root)
    root.mkdir(parents=True, exist_ok=True)
    filtered_pengu = filter_pengu_hard24(Path(args.pengu_ledger), root / "pengu-hard24-ledger.json")
    args.pengu_ledger = str(filtered_pengu)
    base_args = [
        "--stock-cache-dir", args.stock_cache_dir,
        "--v12-ledger", args.v12_ledger,
        "--pengu-ledger", args.pengu_ledger,
        "--output-dir", str(root / "_capture"),
    ]

    formal_source = build_source(
        base_args, q102_cap=1.0, pengu_cap=0.75,
        crypto_cap=2.0, total_cap=2.5, daily_loss=-0.075,
    )
    for needle in ("ENTRY_PRIORITY", "supp_trades", "build_stock(", "load_supplement", "SUPPLEMENT_BASE_ACTIVE_BLOCKED", "V12_CAPACITY_BLOCKED", 'kind == "SUPP_ENTRY"', 'kind == "V12_ENTRY"'):
        block = slice_block(formal_source, needle, 6000)
        print(f"ENGINE_CONTEXT::{needle}\n{block}\nEND_ENGINE_CONTEXT::{needle}")
    if os.environ.get("ALLOCATOR_INSPECT_ONLY") == "1":
        return
    formal_result = run_engine(formal_source, args, root / "formal")
    fn = formal_result["results"]["NORMAL"]
    fs = formal_result["results"]["SEVERE"]
    formal_checks = {
        "penguNormal66": fn.get("routingDiagnostics", {}).get("PENGU_ENTERED") == 66,
        "penguSevere66": fs.get("routingDiagnostics", {}).get("PENGU_ENTERED") == 66,
        "q102Normal69": fn.get("routingDiagnostics", {}).get("SUPPLEMENT_ENTERED") == 69,
        "q102Severe69": fs.get("routingDiagnostics", {}).get("SUPPLEMENT_ENTERED") == 69,
        "normalAssetParity": abs(float(fn["endingAssetJpy"]) - EXPECTED_FORMAL_NORMAL) <= 0.05,
        "severeAssetParity": abs(float(fs["endingAssetJpy"]) - EXPECTED_FORMAL_SEVERE) <= 0.05,
    }
    formal_gate = {
        "normal": {"asset": fn["endingAssetJpy"], "pf": fn["profitFactor"], "dd": fn["maxDrawdownPctClosedEventTwr"], "trades": fn["trades"], "routing": fn.get("routingDiagnostics", {})},
        "severe": {"asset": fs["endingAssetJpy"], "pf": fs["profitFactor"], "dd": fs["maxDrawdownPctClosedEventTwr"], "trades": fs["trades"], "routing": fs.get("routingDiagnostics", {})},
        "checks": formal_checks,
    }
    (root / "formal-gate.json").write_text(json.dumps(formal_gate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"FORMAL_GATE": formal_gate}, ensure_ascii=False, indent=2))
    if not all(formal_checks.values()):
        raise RuntimeError(f"FORMAL_BASELINE_MISMATCH:{formal_gate}")

    source = build_source(
        base_args, q102_cap=1.5, pengu_cap=0.85,
        crypto_cap=3.0, total_cap=3.5, daily_loss=-0.075,
    )
    result = run_engine(source, args, root / "baseline")

    normal = result["results"]["NORMAL"]
    severe = result["results"]["SEVERE"]
    baseline = {
        "normal": {
            "asset": normal["endingAssetJpy"],
            "pf": normal["profitFactor"],
            "dd": normal["maxDrawdownPctClosedEventTwr"],
            "trades": normal["trades"],
            "routing": normal.get("routingDiagnostics", {}),
            "gross": normal.get("grossVerification", {}),
        },
        "severe": {
            "asset": severe["endingAssetJpy"],
            "pf": severe["profitFactor"],
            "dd": severe["maxDrawdownPctClosedEventTwr"],
            "trades": severe["trades"],
            "routing": severe.get("routingDiagnostics", {}),
            "gross": severe.get("grossVerification", {}),
        },
    }
    normal_ok = abs(float(normal["endingAssetJpy"]) - EXPECTED_SELECTED_NORMAL) <= 0.05
    severe_ok = abs(float(severe["endingAssetJpy"]) - EXPECTED_SELECTED_SEVERE) <= 0.05

    snippets = {
        "PENGU_ENTRY": slice_block(source, 'kind == "PENGU_ENTRY"'),
        "SUPP_ENTRY": slice_block(source, 'kind == "SUPP_ENTRY"'),
        "observe_entry": slice_block(source, "def observe_entry"),
    }
    (root / "engine-snippets.json").write_text(json.dumps(snippets, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "schema": "flat-boost-preemption-baseline-gate/v1",
        "contract": {
            "penguMaximumGross": 0.85,
            "q102MaximumGross": 1.5,
            "cryptoGrossCap": 3.0,
            "totalGrossCap": 3.5,
            "cryptoDailyLossPct": 7.5,
            "v52Policy": "PRE_FINAL_V52_40BPS",
        },
        "expected": {"normalAsset": EXPECTED_SELECTED_NORMAL, "severeAsset": EXPECTED_SELECTED_SEVERE},
        "actual": baseline,
        "checks": {"normalBaselineParity": normal_ok, "severeBaselineParity": severe_ok},
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
        },
    }
    (root / "baseline-gate.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not (normal_ok and severe_ok):
        raise RuntimeError(
            f"CURRENT_SELECTED_CRYPTO_BASELINE_MISMATCH normal={normal['endingAssetJpy']} severe={severe['endingAssetJpy']}"
        )


if __name__ == "__main__":
    main()
