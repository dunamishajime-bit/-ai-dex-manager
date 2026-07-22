from __future__ import annotations

import argparse
import gzip
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

STRATEGY_ID = "V96_STOCK_THEME_FORWARD_3D_V1"
AI_SYMBOLS = (
    "ADBEUSDT", "AMDUSDT", "AMZNUSDT", "ARMUSDT", "AVGOUSDT", "CRMUSDT",
    "GOOGLUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "ORCLUSDT",
    "PLTRUSDT", "TSLAUSDT",
)
SEMICONDUCTOR_SYMBOLS = (
    "AMATUSDT", "AMDUSDT", "ARMUSDT", "ASMLUSDT", "AVGOUSDT", "DRAMUSDT",
    "INTCUSDT", "MRVLUSDT", "MUUSDT", "NVDAUSDT", "QCOMUSDT",
    "SNDKUSDT", "TSMUSDT",
)
EXPECTED_SYMBOLS = tuple(sorted(set(AI_SYMBOLS) | set(SEMICONDUCTOR_SYMBOLS)))
CRYPTO_SYMBOLS = {"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"}


def finite(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def percentile(values: List[float], fraction: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl_gz(path: Path) -> Iterable[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def endpoint_payload(row: dict, key: str) -> Optional[dict]:
    item = row.get(key)
    if not isinstance(item, dict) or not item.get("ok"):
        return None
    payload = item.get("payload")
    return payload if isinstance(payload, dict) else None


def themes_for(symbol: str) -> List[str]:
    themes: List[str] = []
    if symbol in AI_SYMBOLS:
        themes.append("AI")
    if symbol in SEMICONDUCTOR_SYMBOLS:
        themes.append("SEMICONDUCTOR")
    return themes


def analyze(input_dir: Path) -> dict:
    summary_paths = sorted(input_dir.rglob("summary-*.json"))
    snapshot_paths = sorted(input_dir.rglob("snapshots-*.jsonl.gz"))
    liquidation_paths = sorted(input_dir.rglob("liquidations-*.jsonl.gz"))
    error_paths = sorted(input_dir.rglob("errors-*.jsonl.gz"))

    summaries = [read_json(path) for path in summary_paths]
    snapshots: List[dict] = []
    for path in snapshot_paths:
        snapshots.extend(read_jsonl_gz(path))
    liquidations: List[dict] = []
    for path in liquidation_paths:
        liquidations.extend(read_jsonl_gz(path))
    collector_errors: List[dict] = []
    for path in error_paths:
        collector_errors.extend(read_jsonl_gz(path))

    by_symbol: Dict[str, List[dict]] = defaultdict(list)
    endpoint_attempts = 0
    endpoint_failures = 0
    for row in snapshots:
        symbol = str(row.get("symbol", "")).upper()
        if symbol:
            by_symbol[symbol].append(row)
        for key in ("premium", "openInterest", "depth", "bookTicker", "lastPrice"):
            endpoint_attempts += 1
            if not bool(row.get(key, {}).get("ok")):
                endpoint_failures += 1

    expected_captures_per_symbol = 0
    for summary in summaries:
        duration = finite(summary.get("durationSecondsActual")) or 0.0
        interval = finite(summary.get("intervalSeconds")) or 60.0
        if str(summary.get("status")) == "collected" and duration > 0 and interval > 0:
            expected_captures_per_symbol += max(1, int(math.floor(duration / interval + 1e-9)))

    symbol_rows: List[dict] = []
    counts = []
    for symbol in EXPECTED_SYMBOLS:
        rows = sorted(by_symbol.get(symbol, []), key=lambda row: int(row.get("capturedAtMs", 0)))
        counts.append(len(rows))
        spreads: List[float] = []
        depth_10: List[float] = []
        imbalances: List[float] = []
        funding: List[float] = []
        premiums: List[float] = []
        open_interest: List[float] = []
        prices: List[float] = []
        timestamps: List[int] = []
        for row in rows:
            timestamps.append(int(row.get("capturedAtMs", 0)))
            derived = row.get("derived") if isinstance(row.get("derived"), dict) else {}
            order_book = derived.get("orderBook") if isinstance(derived.get("orderBook"), dict) else {}
            spread = finite(order_book.get("spreadBps"))
            if spread is not None:
                spreads.append(spread)
            band = order_book.get("bands", {}).get("10", {}) if isinstance(order_book.get("bands"), dict) else {}
            bid_quote = finite(band.get("bidQuote"))
            ask_quote = finite(band.get("askQuote"))
            if bid_quote is not None and ask_quote is not None:
                depth_10.append(bid_quote + ask_quote)
            imbalance = finite(band.get("imbalance"))
            if imbalance is not None:
                imbalances.append(imbalance)
            premium_payload = endpoint_payload(row, "premium")
            if premium_payload:
                rate = finite(premium_payload.get("lastFundingRate"))
                if rate is not None:
                    funding.append(rate)
                mark = finite(premium_payload.get("markPrice"))
                index = finite(premium_payload.get("indexPrice"))
                if mark is not None and index is not None and index > 0:
                    premiums.append((mark / index - 1.0) * 10_000.0)
            oi_payload = endpoint_payload(row, "openInterest")
            if oi_payload:
                value = finite(oi_payload.get("openInterest"))
                if value is not None:
                    open_interest.append(value)
            price_payload = endpoint_payload(row, "lastPrice")
            if price_payload:
                value = finite(price_payload.get("price"))
                if value is not None:
                    prices.append(value)

        monotonic = all(later >= earlier for earlier, later in zip(timestamps, timestamps[1:]))
        oi_change = None
        if len(open_interest) >= 2 and open_interest[0] != 0:
            oi_change = (open_interest[-1] / open_interest[0] - 1.0) * 100.0
        price_change = None
        if len(prices) >= 2 and prices[0] != 0:
            price_change = (prices[-1] / prices[0] - 1.0) * 100.0
        symbol_rows.append({
            "symbol": symbol,
            "themes": themes_for(symbol),
            "snapshots": len(rows),
            "coveragePct": (len(rows) / expected_captures_per_symbol * 100.0) if expected_captures_per_symbol else 0.0,
            "timestampsMonotonic": monotonic,
            "spreadBpsMedian": statistics.median(spreads) if spreads else None,
            "spreadBpsP95": percentile(spreads, 0.95),
            "depth10BpsQuoteMedian": statistics.median(depth_10) if depth_10 else None,
            "imbalance10BpsMedian": statistics.median(imbalances) if imbalances else None,
            "fundingRateMedian": statistics.median(funding) if funding else None,
            "markIndexPremiumBpsMedian": statistics.median(premiums) if premiums else None,
            "openInterestChangePct": oi_change,
            "priceChangePct": price_change,
            "liquidationEvents": sum(1 for item in liquidations if str(item.get("symbol", "")).upper() == symbol),
        })

    expected_set = set(EXPECTED_SYMBOLS)
    observed_set = set(by_symbol)
    rest_success_pct = ((endpoint_attempts - endpoint_failures) / endpoint_attempts * 100.0) if endpoint_attempts else 0.0
    median_count = statistics.median(counts) if counts else 0.0
    min_to_median_ratio = (min(counts) / median_count) if counts and median_count > 0 else 0.0
    summary_safety = all(
        item.get("safety", {}).get("orderSubmissionAllowed") is False
        and item.get("safety", {}).get("liveTradingChanged") is False
        and item.get("safety", {}).get("productionStrategyChanged") is False
        for item in summaries
    ) if summaries else False

    data_quality_pass = bool(
        summaries
        and observed_set == expected_set
        and rest_success_pct >= 98.0
        and min_to_median_ratio >= 0.90
        and all(row["timestampsMonotonic"] for row in symbol_rows)
        and summary_safety
        and not (expected_set & CRYPTO_SYMBOLS)
    )

    return {
        "strategyId": STRATEGY_ID,
        "status": "FORWARD_DATA_QUALITY_PASS" if data_quality_pass else "FORWARD_DATA_QUALITY_INCOMPLETE_OR_FAIL",
        "profitabilityStatus": "NOT_EVALUABLE_FROM_THREE_DAYS",
        "dataQualityPass": data_quality_pass,
        "input": {
            "summaryFiles": len(summary_paths),
            "snapshotFiles": len(snapshot_paths),
            "liquidationFiles": len(liquidation_paths),
            "errorFiles": len(error_paths),
            "snapshots": len(snapshots),
            "liquidationEvents": len(liquidations),
            "collectorErrors": len(collector_errors),
            "expectedCapturesPerSymbol": expected_captures_per_symbol,
        },
        "coverage": {
            "expectedSymbols": list(EXPECTED_SYMBOLS),
            "observedSymbols": sorted(observed_set),
            "missingSymbols": sorted(expected_set - observed_set),
            "unexpectedSymbols": sorted(observed_set - expected_set),
            "restSuccessPct": rest_success_pct,
            "minimumToMedianSnapshotRatio": min_to_median_ratio,
        },
        "symbols": symbol_rows,
        "safety": {
            "cryptoSymbolOverlap": sorted(expected_set & CRYPTO_SYMBOLS),
            "summarySafetyPass": summary_safety,
            "mode": "SHADOW",
            "orderSubmissionAllowed": False,
            "currentV96WeightsMutable": False,
            "portfolioGrossCap": 2.0,
            "stockThemeGrossCap": 0.10,
        },
        "interpretation": {
            "allowedConclusion": "Operational data quality and market-microstructure feasibility only.",
            "forbiddenConclusion": "Three days cannot establish profitability, robustness, or production eligibility.",
            "retuningAllowedDuringWindow": False,
        },
    }


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-theme-forward-3d.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    coverage = result["coverage"]
    lines = [
        "# V96 stock-theme three-day Forward evidence",
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
        "",
        "This report validates collection quality and isolation only. Three days cannot approve a trading edge.",
    ]
    (output_dir / "v96-stock-theme-forward-3d.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(EXPECTED_SYMBOLS) == 22
    assert not (set(EXPECTED_SYMBOLS) & CRYPTO_SYMBOLS)
    assert percentile([1.0, 2.0, 3.0], 0.5) == 2.0
    assert finite("nan") is None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".research-state/v96-stock-theme-forward-data")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-theme-forward-report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock-theme Forward validator self-test: PASS")
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
