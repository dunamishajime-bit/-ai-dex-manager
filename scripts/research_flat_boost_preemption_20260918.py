from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import research_quality102_gross_cap_sweep as q102
import research_quality102_mtm_50_v2 as mtm


EXPECTED_NORMAL = 66059488.04343018
EXPECTED_SEVERE = 8729157.74295382


def replace_float_assignment(source: str, name: str, value: float) -> str:
    pattern = re.compile(rf"^(\s*{re.escape(name)}\s*=\s*)(-?\d+(?:\.\d+)?)\s*$", re.M)
    replacement = rf"\g<1>{value:g}"
    out, count = pattern.subn(replacement, source, count=1)
    if count != 1:
        raise RuntimeError(f"expected one assignment for {name}, found {count}")
    return out


def build_current_crypto_source(base_args: list[str]) -> str:
    source = q102.capture_grosssafe_generated(base_args)
    source = q102.patch_supplement_cap(source, 1.5)
    source = mtm.patch_mtm_engine(source)
    for name, value in (
        ("PENGU_MAX_GROSS", 0.85),
        ("CRYPTO_GROSS_CAP", 3.0),
        ("TOTAL_GROSS_CAP", 3.5),
        ("CRYPTO_DAILY_LOSS_LIMIT", -0.075),
    ):
        source = replace_float_assignment(source, name, value)

    # Historical QUALITY102 fixture remains separate; the causal-v4 supplement
    # cap is the patched 1.5x research sleeve above.
    required = (
        "QUALITY102_MTM_PRE_ADMISSION_REBASE",
        "PENGU_MAX_GROSS = 0.85",
        "CRYPTO_GROSS_CAP = 3",
        "TOTAL_GROSS_CAP = 3.5",
        "CRYPTO_DAILY_LOSS_LIMIT = -0.075",
    )
    for marker in required:
        if marker not in source:
            raise RuntimeError(f"current-contract marker missing: {marker}")
    return source


def run_engine(source: str, args: argparse.Namespace, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = out_dir / "current-generated-engine.py"
    generated.write_text(source, encoding="utf-8")
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
    base_args = [
        "--stock-cache-dir",
        args.stock_cache_dir,
        "--v12-ledger",
        args.v12_ledger,
        "--pengu-ledger",
        args.pengu_ledger,
        "--output-dir",
        str(root / "_capture"),
    ]
    source = build_current_crypto_source(base_args)
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
    normal_ok = abs(float(normal["endingAssetJpy"]) - EXPECTED_NORMAL) <= 0.05
    severe_ok = abs(float(severe["endingAssetJpy"]) - EXPECTED_SEVERE) <= 0.05

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
        "expected": {"normalAsset": EXPECTED_NORMAL, "severeAsset": EXPECTED_SEVERE},
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
