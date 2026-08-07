from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import research_lab_v96_v52_pengu_dual_ls_v1_combined_bt as unified

UTC = dt.timezone.utc
START = dt.datetime(2025, 8, 13, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
HOLDOUT = dt.datetime(2026, 3, 11, tzinfo=UTC)
COST_GRID_BPS = list(range(0, 101, 5))
VARIANTS = ("NO_STOCK", "V11_ONLY", "V50_ONLY", "V52_BOTH")


def compact(row: dict) -> dict:
    return {
        "events": row["events"],
        "compoundedReturnPct": row["compoundedReturnPct"],
        "cagrPct": row["cagrPct"],
        "maxDrawdownPct": row["maxDrawdownPct"],
        "profitFactor": row["profitFactor"],
        "observedMaximumTotalGross": row["observedMaximumTotalGross"],
        "routingDiagnostics": row["routingDiagnostics"],
        "bySleeve": row["bySleeve"],
    }


def selected_rows(variant: str, v11_rows: list[dict], v50_rows: list[dict]):
    if variant == "NO_STOCK":
        return [], []
    if variant == "V11_ONLY":
        return v11_rows, []
    if variant == "V50_ONLY":
        return [], v50_rows
    if variant == "V52_BOTH":
        return v11_rows, v50_rows
    raise ValueError(variant)


def run_window(core_rows, v11_rows, v50_rows, pengu_trades, cost_bps, start_ms, end_ms):
    out = {}
    for variant in VARIANTS:
        a, b = selected_rows(variant, v11_rows, v50_rows)
        row = unified.simulate(
            core_rows,
            a,
            b,
            pengu_trades,
            float(cost_bps),
            0.0,
            start_ms,
            end_ms,
            "CORE_FIRST",
        )
        out[variant] = compact(row)
    baseline = out["NO_STOCK"]["compoundedReturnPct"]
    for variant in VARIANTS:
        out[variant]["deltaVsNoStockPctPoints"] = out[variant]["compoundedReturnPct"] - baseline
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--pengu-replay", default=".research-state/v96-v52-pengu-dual-ls-v1/pengu-evidence-replay.json")
    parser.add_argument("--output", default=".research-state/v96-v52-pengu-dual-ls-v1/v52-value-ablation.json")
    args = parser.parse_args()

    unified.configure_period(START, END)
    start_ms = int(START.timestamp() * 1000)
    end_ms = int(END.timestamp() * 1000)
    holdout_ms = int(HOLDOUT.timestamp() * 1000)

    core = unified.build_core(start_ms, end_ms)
    v11_rows, v50_rows, target_days, stock_diag = unified.build_stock(Path(args.stock_cache_dir), START, END)
    pengu = unified.load_pengu(Path(args.pengu_replay))
    pengu_trades = [row for row in pengu["trades"] if start_ms <= int(row["entryTs"]) < end_ms]

    full_core = core["normal"]
    hold_core = [row for row in full_core if int(row["ts"]) >= holdout_ms]
    hold_v11 = [row for row in v11_rows if int(row["entryTs"]) >= holdout_ms]
    hold_v50 = [row for row in v50_rows if int(row["entryTs"]) >= holdout_ms]
    hold_pengu = [row for row in pengu_trades if int(row["entryTs"]) >= holdout_ms]

    matrix = {}
    for cost in COST_GRID_BPS:
        matrix[str(cost)] = {
            "full": run_window(full_core, v11_rows, v50_rows, pengu_trades, cost, start_ms, end_ms),
            "holdout": run_window(hold_core, hold_v11, hold_v50, hold_pengu, cost, holdout_ms, end_ms),
        }

    thresholds = {}
    for window in ("full", "holdout"):
        thresholds[window] = {}
        for variant in ("V11_ONLY", "V50_ONLY", "V52_BOTH"):
            positive = [
                cost for cost in COST_GRID_BPS
                if matrix[str(cost)][window][variant]["deltaVsNoStockPctPoints"] > 1e-9
            ]
            thresholds[window][variant] = {
                "highestTestedCostStillPositiveBps": max(positive) if positive else None,
                "firstTestedCostNotPositiveBps": next(
                    (cost for cost in COST_GRID_BPS if matrix[str(cost)][window][variant]["deltaVsNoStockPctPoints"] <= 1e-9),
                    None,
                ),
            }

    key_costs = [0, 20, 40, 50, 60, 75, 100]
    summary = {
        str(cost): {
            window: {
                variant: {
                    "returnPct": matrix[str(cost)][window][variant]["compoundedReturnPct"],
                    "deltaVsNoStockPctPoints": matrix[str(cost)][window][variant]["deltaVsNoStockPctPoints"],
                    "maxDrawdownPct": matrix[str(cost)][window][variant]["maxDrawdownPct"],
                    "profitFactor": matrix[str(cost)][window][variant]["profitFactor"],
                    "v11Entered": matrix[str(cost)][window][variant]["routingDiagnostics"].get("V11_EQ_ENTERED", 0),
                    "v50Entered": matrix[str(cost)][window][variant]["routingDiagnostics"].get("V50_POST_OPEN_BASIS_ENTERED", 0),
                    "dailyLossLocks": matrix[str(cost)][window][variant]["routingDiagnostics"].get("PORTFOLIO_DAILY_LOSS_LOCKS", 0),
                    "penguEntered": matrix[str(cost)][window][variant]["routingDiagnostics"].get("PENGU_ENTERED", 0),
                    "penguExited": matrix[str(cost)][window][variant]["routingDiagnostics"].get("PENGU_EXITED", 0),
                }
                for variant in VARIANTS
            }
            for window in ("full", "holdout")
        }
        for cost in key_costs
    }

    payload = {
        "status": "PASS_RESEARCH_ONLY",
        "purpose": "Measure whether V52 stock sleeve adds value to fixed V96 Core + fixed PENGU_DUAL_LS_V1 under the real shared-gross and daily-loss routing rules.",
        "period": {
            "startInclusive": START.isoformat(),
            "endExclusive": END.isoformat(),
            "holdoutStartInclusive": HOLDOUT.isoformat(),
        },
        "fixed": {
            "v96": "V96 Core Volume50 / Turnover7.5, legacy PENGU removed",
            "pengu": "Frozen accepted PENGU_DUAL_LS_V1 73-trade ledger, gross 0.75",
            "totalGrossCap": unified.TOTAL_GROSS_CAP,
            "stockGrossCap": unified.STOCK_GROSS_CAP,
            "dailyLossLimit": unified.DAILY_LOSS_LIMIT,
            "tieOrder": "CORE_FIRST (prior unified BT showed zero return sensitivity vs PENGU_FIRST)",
            "cryptoScenario": "NORMAL",
            "penguExtraRoundTripBps": 0.0,
        },
        "stockCostGridBps": COST_GRID_BPS,
        "variants": list(VARIANTS),
        "thresholds": thresholds,
        "summary": summary,
        "matrix": matrix,
        "inputDiagnostics": {
            "v11RawRows": len(v11_rows),
            "v50RawRows": len(v50_rows),
            "targetSessions": len(target_days),
            "stock": stock_diag,
            "core": core["diagnostics"],
            "penguTrades": len(pengu_trades),
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
        },
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "thresholds": thresholds, "summary": summary}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
