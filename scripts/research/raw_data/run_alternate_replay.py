from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any

from .integrated_engine import CapitalContract, run_integrated
from .stock_fetch import load_yahoo_chart_json


START_MS = 1_754_784_000_000
END_MS = 1_786_320_000_000


def _load_bundle(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        bundle = json.load(handle)
    bundle["contracts"] = {
        "V12": {
            "top_n": 3,
            "rank3_gross": 0.10,
            "rank3_minimum_score": 0.70,
            "per_position_gross_cap": 1.0,
            "aggregate_gross_cap": 2.0,
        },
        "Q102": {"selector": "CAUSAL_V4", "maximumPositions": 1, "maximumGross": 3.0},
    }
    return bundle


def _load_stock_directory(path: Path) -> dict[str, list[Any]]:
    result: dict[str, list[Any]] = {}
    for symbol in ("AMZN", "META", "MSFT", "NVDA", "TSLA"):
        candidates = sorted(path.glob(f"{symbol}-60m-*.json"))
        if not candidates:
            continue
        selected = next((item for item in candidates if "2025-07-01-2026-08-10" in item.name), candidates[-1])
        result[symbol] = load_yahoo_chart_json(selected, symbol, START_MS, END_MS)
    return result


def _metrics(result: dict[str, Any]) -> dict[str, Any]:
    entries = {event["positionId"]: event for event in result["events"]
               if event.get("type") == "ENTRY"}
    exits = [event for event in result["events"] if event.get("type") == "EXIT"]
    net_trades = []
    for event in exits:
        entry = entries.get(event.get("positionId"))
        if entry is None:
            raise ValueError("UNMATCHED_EXIT_IN_LEDGER")
        net_trades.append({
            **event,
            "netPnl": float(event.get("pnl", 0.0))
                     - float(event.get("fee", 0.0))
                     + float(event.get("funding", 0.0))
                     - float(entry.get("fee", 0.0)),
        })
    profits = sum(max(0.0, item["netPnl"]) for item in net_trades)
    losses = sum(min(0.0, item["netPnl"]) for item in net_trades)
    peak = None
    max_dd = 0.0
    dd_peak_ts = None
    dd_trough_ts = None
    for point in result["equityTimeline"]:
        equity = float(point["equity"])
        if peak is None or equity > peak:
            peak = equity
            dd_peak_ts = int(point["ts_ms"])
        if peak and equity < peak:
            drawdown = equity / peak - 1.0
            if drawdown < max_dd:
                max_dd = drawdown
                dd_trough_ts = int(point["ts_ms"])
    by_strategy: dict[str, dict[str, Any]] = {}
    for event in net_trades:
        strategy = str(event.get("strategy", "UNKNOWN"))
        item = by_strategy.setdefault(strategy, {"pnl": 0.0, "trades": 0})
        item["pnl"] += event["netPnl"]
        item["trades"] += 1
    deposited = sum(float(event.get("amount", 0.0)) for event in result["events"]
                    if event.get("type") == "DEPOSIT")
    total_net = sum(item["netPnl"] for item in net_trades)
    if len(entries) != len(net_trades) or abs(
        float(result["finalEquity"]) - (deposited + total_net)
    ) > max(0.01, abs(float(result["finalEquity"])) * 1e-10):
        raise ValueError("REPLAY_ACCOUNTING_LEDGER_DOES_NOT_RECONCILE")
    return {
        "profitFactor": (profits / abs(losses)) if losses else None,
        "maxDrawdownPct": max_dd * 100.0,
        "ddPeakTs": dd_peak_ts,
        "ddTroughTs": dd_trough_ts,
        "netClosedPnl": total_net,
        "logic": by_strategy,
        "ledgerReconciled": True,
    }


def run(path: Path, output: Path, stock_dir: Path | None) -> dict[str, Any]:
    bundle = _load_bundle(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    if stock_dir is not None:
        # Yahoo OHLCV is retained as a reference feed only.  It is not a
        # V50 basis/execution pair, so it must not be converted into trades.
        bundle["stock_reference_bars"] = _load_stock_directory(stock_dir)
        bundle["stock_bars"] = {}
    capital = CapitalContract(start_ts_ms=START_MS)
    results: dict[str, Any] = {}
    for mode in ("NORMAL", "SEVERE"):
        for variant in ("CURRENT", "Q60_DD170_H72"):
            scenario = dict(bundle)
            scenario["penguVariant"] = variant
            result = run_integrated(mode, scenario, capital)
            results[f"{mode}_{variant}"] = {
                "mode": mode,
                "penguVariant": variant,
                "candidateCount": result["candidateCount"],
                "acceptedEntryCount": result["acceptedEntryCount"],
                "rejectedEntryCount": result["rejectedEntryCount"],
                "tradeCount": result["tradeCount"],
                "realizedPnl": result["realizedPnl"],
                "fees": result["fees"],
                "funding": result["funding"],
                "finalEquity": result["finalEquity"],
                "preemptions": result["preemptions"],
                "penguState": result["penguState"],
                "metrics": _metrics(result),
                "stressAssumptions": result["stressAssumptions"],
                "formalParity": False,
                "missingSources": ["original_integrated_event_ledger", "production_v12_q102_pengu_adapters", "v52_basis_execution_pair", "aster_price_parity"],
                "source": result["source"],
            }
            (output.parent / f"{mode.lower()}-{variant.lower()}-events.json").write_text(json.dumps(result["events"], ensure_ascii=False, sort_keys=True), encoding="utf-8")
            (output.parent / f"{mode.lower()}-{variant.lower()}-equity.json").write_text(json.dumps(result["equityTimeline"], ensure_ascii=False, sort_keys=True), encoding="utf-8")
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stock-dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.bundle, args.output, args.stock_dir), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
