from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v56-root", default=".v56-research")
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(args.v56_root).resolve()
    sys.path.insert(0, str(root / "scripts"))
    import research_v54_structural_alpha_bt as v54  # type: ignore
    import research_v55_risk_adjusted_alpha_bt as v55  # type: ignore

    # The V56 harness defaults to its one-year reference window.  Set the
    # research-only stock engine window before it configures the frozen V11
    # loader so cache misses fetch the requested two-year raw market data.
    target_start = dt.datetime(2024, 8, 10, tzinfo=dt.timezone.utc)
    target_end = dt.datetime(2026, 8, 10, tzinfo=dt.timezone.utc)
    v54.base.START = target_start
    v54.base.END = target_end

    v11_raw, target_days, aligned, diagnostics = v54.load_stock_state(Path(args.stock_cache_dir).resolve())
    v50_raw = v54.build_v50_rows(v55.FIXED_STRUCTURE, target_days, aligned)
    policy = v55.fixed_stock_policy()

    market = diagnostics.get("market", {})
    cash = market.get("cash", {})
    cash_symbols = cash.get("symbols", {})
    alignment_symbols = market.get("alignment", {}).get("symbols", {})
    required = {"AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT"}
    if set(cash_symbols) != required:
        raise RuntimeError(f"V52_CASH_SYMBOL_SET_MISMATCH:{sorted(cash_symbols)}")
    if set(alignment_symbols) != required:
        raise RuntimeError(f"V52_ALIGNMENT_SYMBOL_SET_MISMATCH:{sorted(alignment_symbols)}")
    if len(target_days) < 480:
        raise RuntimeError(f"V52_INSUFFICIENT_TARGET_SESSIONS:{len(target_days)}")

    min_complete_days = min(int(cash_symbols[s].get("completeDays", 0)) for s in required)
    min_common_days = min(int(alignment_symbols[s].get("commonDays", 0)) for s in required)
    min_aligned_days = min(int(alignment_symbols[s].get("alignedDays", 0)) for s in required)
    clock_rejected = sum(int(alignment_symbols[s].get("clockRejected", 0)) for s in required)
    first_days = [str(cash_symbols[s].get("firstDay", "")) for s in required]
    last_days = [str(cash_symbols[s].get("lastDay", "")) for s in required]
    if any(day > "2024-08-10" for day in first_days) or any(day < "2026-08-07" for day in last_days):
        raise RuntimeError(f"V52_DATA_PERIOD_INCOMPLETE:first={first_days},last={last_days}")
    if min_complete_days < 500 or min_aligned_days < 480 or clock_rejected != 0:
        raise RuntimeError(
            f"V52_DATA_QUALITY_FAIL:complete={min_complete_days},aligned={min_aligned_days},clockRejected={clock_rejected}"
        )

    modes: dict[str, dict] = {}
    for scenario, assumptions in v54.base.SCENARIOS.items():
        mode = str(assumptions["ledgerMode"])
        stock_cost = float(assumptions["stockCostBps"])
        prepared_v11 = v54.prepare_v11(list(v11_raw), policy, stock_cost)
        prepared_v50 = v54.prepare_v50(list(v50_raw), policy, stock_cost)

        def with_unit(rows: list[dict]) -> list[dict]:
            out: list[dict] = []
            for raw in rows:
                row = dict(raw)
                unit = v54.base.top2.trade_value(row, stock_cost, 5.0)
                if unit is None:
                    continue
                row["netUnitReturn"] = float(unit)
                out.append(row)
            return out

        v11 = with_unit(prepared_v11)
        v50 = with_unit(prepared_v50)
        modes[mode] = {
            "scenario": scenario,
            "stockCostBps": stock_cost,
            "signalsEvaluated": {"v11": len(v11_raw), "v50": len(v50_raw)},
            "preparedRows": {"v11": len(v11), "v50": len(v50)},
            "engineEvaluated": True,
            "zeroTradesDueToDataFailure": False,
            "v11": v11,
            "v50": v50,
        }

    coverage_pct = 100.0 * min_aligned_days / max(1, min_common_days)
    payload = {
        "schema": "v56-stock-ledger-export/v1",
        "period": {
            "decisionStartInclusive": v54.base.START.isoformat().replace("+00:00", "Z"),
            "decisionEndExclusive": v54.base.END.isoformat().replace("+00:00", "Z"),
        },
        "policy": {
            "structure": v54.asdict(v55.FIXED_STRUCTURE),
            "stockPolicy": policy,
            "globalGrossCap": 2.5,
            "stockGrossCap": 1.5,
            "cryptoGrossCap": 1.5,
            "v50ConcurrentMax": 2,
            "v50DailyMax": 3,
        },
        "dataQuality": {
            "provider": cash.get("source"),
            "symbols": sorted(required),
            "barResolution": "60m cash / 1m Aster stock perp internally aligned to V52 decision windows",
            "targetSessions": len(target_days),
            "minimumCashCompleteDays": min_complete_days,
            "minimumCommonDays": min_common_days,
            "minimumAlignedDays": min_aligned_days,
            "rawFirstDays": first_days,
            "rawLastDays": last_days,
            "decisionWindowCoveragePct": coverage_pct,
            "clockRejected": clock_rejected,
            "duplicateCountAfterNormalization": 0,
            "missingCommonDecisionWindowCount": max(0, min_common_days - min_aligned_days),
            "timezoneNormalization": "Yahoo timestamps normalized to America/New_York cash-session slots; portfolio timestamps UTC",
            "corporateActions": "Yahoo chart corporate-action events are recorded in diagnostics; no synthetic bars or decision-window forward fill",
            "v52RealMarketData": True,
            "dataFetchFailureAcceptedAsZeroTrades": False,
            "rawDiagnostics": diagnostics,
        },
        "modes": modes,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
        },
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "V56_STOCK_LEDGER_PASS",
        "provider": payload["dataQuality"]["provider"],
        "targetSessions": len(target_days),
        "coveragePct": coverage_pct,
        "normalV11": len(modes["normal"]["v11"]),
        "normalV50": len(modes["normal"]["v50"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
