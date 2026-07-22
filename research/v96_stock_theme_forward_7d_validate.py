from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

import v96_stock_theme_forward_validate as base

STRATEGY_ID = "V96_STOCK_THEME_FORWARD_7D_V1"
NY = ZoneInfo("America/New_York")


def finite(value: Any) -> Optional[float]:
    return base.finite(value)


def read_jsonl_gz(path: Path) -> Iterable[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def session_name(timestamp_ms: int) -> str:
    local = dt.datetime.fromtimestamp(timestamp_ms / 1000.0, tz=dt.timezone.utc).astimezone(NY)
    minutes = local.hour * 60 + local.minute
    if local.weekday() < 5 and 570 <= minutes < 960:
        return "REGULAR"
    if local.weekday() < 5 and 240 <= minutes < 570:
        return "PREMARKET"
    if local.weekday() < 5 and 960 <= minutes < 1200:
        return "AFTER_HOURS"
    return "CLOSED"


def session_microstructure(input_dir: Path) -> dict:
    by_session: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    symbol_session: Dict[str, Dict[str, Dict[str, List[float]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    for path in sorted(input_dir.rglob("snapshots-*.jsonl.gz")):
        for row in read_jsonl_gz(path):
            symbol = str(row.get("symbol", "")).upper()
            timestamp_ms = int(row.get("capturedAtMs", 0) or 0)
            if not symbol or timestamp_ms <= 0:
                continue
            session = session_name(timestamp_ms)
            derived = row.get("derived") if isinstance(row.get("derived"), dict) else {}
            order_book = derived.get("orderBook") if isinstance(derived.get("orderBook"), dict) else {}
            spread = finite(order_book.get("spreadBps"))
            bands = order_book.get("bands") if isinstance(order_book.get("bands"), dict) else {}
            band10 = bands.get("10") if isinstance(bands.get("10"), dict) else {}
            bid_quote = finite(band10.get("bidQuote"))
            ask_quote = finite(band10.get("askQuote"))
            depth = (bid_quote + ask_quote) if bid_quote is not None and ask_quote is not None else None
            if spread is not None:
                by_session[session]["spread"].append(spread)
                symbol_session[symbol][session]["spread"].append(spread)
            if depth is not None:
                by_session[session]["depth10"].append(depth)
                symbol_session[symbol][session]["depth10"].append(depth)

    def summarize(values: Dict[str, List[float]]) -> dict:
        spreads = values.get("spread", [])
        depths = values.get("depth10", [])
        return {
            "samples": max(len(spreads), len(depths)),
            "spreadBpsMedian": statistics.median(spreads) if spreads else None,
            "spreadBpsP95": base.percentile(spreads, 0.95),
            "depth10BpsQuoteMedian": statistics.median(depths) if depths else None,
            "zeroDepth10Pct": (sum(value <= 0 for value in depths) / len(depths) * 100.0) if depths else None,
        }

    return {
        "sessions": {session: summarize(values) for session, values in sorted(by_session.items())},
        "symbols": {
            symbol: {session: summarize(values) for session, values in sorted(sessions.items())}
            for symbol, sessions in sorted(symbol_session.items())
        },
    }


def analyze(input_dir: Path) -> dict:
    result = base.analyze(input_dir)
    result["strategyId"] = STRATEGY_ID
    result["collectionWindowDays"] = 7
    result["profitabilityStatus"] = "PRELIMINARY_FORWARD_PNL_EVALUATED_SEPARATELY"
    result["sessionMicrostructure"] = session_microstructure(input_dir)
    result["interpretation"] = {
        "allowedConclusion": (
            "Seven days may support a preliminary Shadow PnL and execution-feasibility review "
            "across roughly five U.S. trading sessions."
        ),
        "forbiddenConclusion": (
            "Seven days cannot establish robust profitability, statistical significance, regime stability, "
            "or Production eligibility."
        ),
        "retuningAllowedDuringWindow": False,
        "promotionAllowed": False,
    }
    return result


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-theme-forward-7d.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    coverage = result["coverage"]
    regular = result.get("sessionMicrostructure", {}).get("sessions", {}).get("REGULAR", {})
    after_hours = result.get("sessionMicrostructure", {}).get("sessions", {}).get("AFTER_HOURS", {})
    lines = [
        "# V96 stock-theme seven-day Forward evidence",
        "",
        f"Status: **{result['status']}**",
        f"Profitability: **{result['profitabilityStatus']}**",
        "",
        f"- snapshots: {result['input']['snapshots']}",
        f"- REST success: {coverage['restSuccessPct']:.4f}%",
        f"- expected / observed symbols: {len(coverage['expectedSymbols'])} / {len(coverage['observedSymbols'])}",
        f"- collector errors: {result['input']['collectorErrors']}",
        f"- liquidation events: {result['input']['liquidationEvents']}",
        f"- crypto overlap: {len(result['safety']['cryptoSymbolOverlap'])}",
        f"- regular-session median spread: {regular.get('spreadBpsMedian')}",
        f"- after-hours median spread: {after_hours.get('spreadBpsMedian')}",
        "",
        "Seven days permits only preliminary Shadow PnL and execution-feasibility review. It cannot approve a trading edge.",
    ]
    (output_dir / "v96-stock-theme-forward-7d.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    regular = int(dt.datetime(2026, 7, 22, 14, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
    closed = int(dt.datetime(2026, 7, 22, 21, 0, tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert session_name(regular) == "REGULAR"
    assert session_name(closed) == "CLOSED"
    assert not (set(base.EXPECTED_SYMBOLS) & base.CRYPTO_SYMBOLS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".research-state/v96-stock-theme-forward-data")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-theme-forward-report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock-theme seven-day Forward validator self-test: PASS")
        return 0
    result = analyze(Path(args.input_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "status": result["status"],
        "snapshots": result["input"]["snapshots"],
        "restSuccessPct": result["coverage"]["restSuccessPct"],
        "profitabilityStatus": result["profitabilityStatus"],
    }, ensure_ascii=False))
    return 0 if result["dataQualityPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
