from __future__ import annotations

import argparse
import json
from pathlib import Path

import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as v3
import v96_stock_swing_tournament_v3b as v3b


def self_test() -> None:
    symbol = base.SYMBOLS[0]
    sample = {
        symbol: {
            f"2026-01-{day:02d}": v3.DailyBar(f"2026-01-{day:02d}", 1, 1, 1, 1, 1, 1)
            for day in range(1, 32)
        }
    }
    eligible = v3b.common_history_days(sample, minimum_symbols=1, minimum_sessions=10)
    assert eligible[0] == "2026-01-10"
    assert len(v3.CANDIDATES) == 27


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-swing-tournament-v3b")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock swing tournament V3C runner self-test: PASS")
        return 0
    result = v3b.analyze(Path(args.cache_dir).resolve())
    v3b.write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "eligibility": result["eligibility"],
        "validationPassingWinnerIds": result["validationPassingWinnerIds"],
        "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
