from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import research_lab_v96_v52_pengu_dual_ls_v1_combined_bt as combined


def compact(result: dict) -> dict:
    return {
        "period": result["period"],
        "normal": result["results"]["NORMAL"],
        "severe": result["results"]["SEVERE"],
        "checks": result["checks"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--pengu-replay", default=".research-state/v96-v52-pengu-dual-ls-v1/pengu-evidence-replay.json")
    parser.add_argument("--output", default=".research-state/v96-v52-pengu-dual-ls-v1/routing-audit.json")
    args = parser.parse_args()

    # Disable the daily-loss latch only for this audit. Gross limits, slot occupancy,
    # same-symbol rejection, cost gates, tie ordering and all strategy returns stay active.
    combined.DAILY_LOSS_LIMIT = -999.0

    pengu_path = Path(args.pengu_replay)
    with_pengu = combined.analyze(Path(args.stock_cache_dir), pengu_path)

    frozen = json.loads(pengu_path.read_text(encoding="utf-8"))
    no_pengu = dict(frozen)
    no_pengu["trades"] = []
    no_pengu["fullMetrics"] = {"trades": 0}
    no_pengu["holdoutMetrics"] = {"trades": 0}
    no_pengu_path = Path(args.output).with_name("no-pengu-replay.json")
    no_pengu_path.parent.mkdir(parents=True, exist_ok=True)
    no_pengu_path.write_text(json.dumps(no_pengu, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    without_pengu = combined.analyze(Path(args.stock_cache_dir), no_pengu_path)

    comparison: dict[str, dict] = {}
    for scenario in ("NORMAL", "SEVERE"):
        comparison[scenario] = {}
        for order in ("CORE_FIRST", "PENGU_FIRST"):
            comparison[scenario][order] = {}
            for window in ("full", "holdoutFreshStart"):
                with_row = with_pengu["results"][scenario][order][window]
                without_row = without_pengu["results"][scenario][order][window]
                comparison[scenario][order][window] = {
                    "v96V52ReturnPct": without_row["compoundedReturnPct"],
                    "v96PenguV52ReturnPct": with_row["compoundedReturnPct"],
                    "deltaPctPoints": with_row["compoundedReturnPct"] - without_row["compoundedReturnPct"],
                    "v96V52MaxDrawdownPct": without_row["maxDrawdownPct"],
                    "v96PenguV52MaxDrawdownPct": with_row["maxDrawdownPct"],
                    "v96V52ProfitFactor": without_row["profitFactor"],
                    "v96PenguV52ProfitFactor": with_row["profitFactor"],
                    "penguSleeve": with_row["bySleeve"]["PENGU_DUAL_LS_V1"],
                    "observedMaximumTotalGross": with_row["observedMaximumTotalGross"],
                    "routingDiagnostics": with_row["routingDiagnostics"],
                }

    payload = {
        "status": "PASS_RESEARCH_ONLY_ROUTING_AUDIT",
        "purpose": "Isolate strategy/routing effect with daily-loss latch disabled; all shared Gross and slot conflict logic retained.",
        "dailyLossLatchEnabled": False,
        "withPengu": compact(with_pengu),
        "withoutPengu": compact(without_pengu),
        "comparison": comparison,
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": payload["status"], "comparison": comparison}, ensure_ascii=False, indent=2))

    # Run the dedicated V52 ablation with the real daily-loss latch restored inside a
    # fresh process. This compares no-stock, V11-only, V50-only and both sleeves across
    # a 0..100 bps stock-cost grid while V96 and frozen PENGU stay fixed.
    ablation_output = out.with_name("v52-value-ablation.json")
    subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "research_lab_v52_value_ablation.py"),
            "--stock-cache-dir",
            args.stock_cache_dir,
            "--pengu-replay",
            args.pengu_replay,
            "--output",
            str(ablation_output),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
