from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BASE_URL = "https://fapi.asterdex.com"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT"]
NOTIONALS = [100.0, 500.0, 1000.0, 5000.0]
SAMPLE_COUNT = int(os.environ.get("ASTER_MICROSTRUCTURE_SAMPLES", "20"))
SAMPLE_INTERVAL_SECONDS = float(os.environ.get("ASTER_MICROSTRUCTURE_INTERVAL_SECONDS", "3"))
TAKER_FEE_BPS_PER_SIDE = 3.5
MAKER_FEE_BPS_PER_SIDE = 1.0


def fetch_json(path: str, params: Optional[dict] = None) -> object:
    query = urllib.parse.urlencode(params or {})
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "GoldCat-Research-V17/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def percentile(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * q
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    fraction = index - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def summarize(values: List[float]) -> dict:
    return {
        "count": len(values),
        "median": statistics.median(values) if values else None,
        "p90": percentile(values, 0.90),
        "max": max(values) if values else None,
        "mean": statistics.fmean(values) if values else None,
    }


def walk_book(levels: List[List[str]], notional: float) -> Tuple[Optional[float], Optional[float], float]:
    remaining = notional
    quantity = 0.0
    quote_spent = 0.0
    for price_raw, qty_raw, *_ in levels:
        price = float(price_raw)
        available_qty = float(qty_raw)
        available_quote = price * available_qty
        used_quote = min(remaining, available_quote)
        if used_quote <= 0:
            continue
        quantity += used_quote / price
        quote_spent += used_quote
        remaining -= used_quote
        if remaining <= 1e-9:
            break
    if remaining > 1e-6 or quantity <= 0:
        return None, None, quote_spent
    average_price = quote_spent / quantity
    return average_price, quantity, quote_spent


def snapshot_symbol(symbol: str) -> dict:
    depth = fetch_json("/fapi/v1/depth", {"symbol": symbol, "limit": 20})
    premium = fetch_json("/fapi/v1/premiumIndex", {"symbol": symbol})
    bids = depth.get("bids", [])
    asks = depth.get("asks", [])
    if not bids or not asks:
        raise RuntimeError(f"empty order book for {symbol}")
    best_bid = float(bids[0][0])
    best_ask = float(asks[0][0])
    mid = (best_bid + best_ask) / 2.0
    spread_bps = (best_ask - best_bid) / mid * 10_000.0
    executions: Dict[str, dict] = {}
    for notional in NOTIONALS:
        buy_price, buy_qty, buy_filled = walk_book(asks, notional)
        sell_price, sell_qty, sell_filled = walk_book(bids, notional)
        if buy_price is None or sell_price is None:
            executions[str(int(notional))] = {
                "depthSufficient": False,
                "buyFilledQuote": buy_filled,
                "sellFilledQuote": sell_filled,
            }
            continue
        buy_impact_bps = (buy_price / mid - 1.0) * 10_000.0
        sell_impact_bps = (1.0 - sell_price / mid) * 10_000.0
        taker_round_trip_bps = buy_impact_bps + sell_impact_bps + 2 * TAKER_FEE_BPS_PER_SIDE
        maker_round_trip_fee_bps = 2 * MAKER_FEE_BPS_PER_SIDE
        executions[str(int(notional))] = {
            "depthSufficient": True,
            "buyAveragePrice": buy_price,
            "sellAveragePrice": sell_price,
            "buyQuantity": buy_qty,
            "sellQuantity": sell_qty,
            "buyImpactBps": buy_impact_bps,
            "sellImpactBps": sell_impact_bps,
            "takerRoundTripBps": taker_round_trip_bps,
            "makerRoundTripFeeBps": maker_round_trip_fee_bps,
        }
    return {
        "timestamp": int(time.time() * 1000),
        "symbol": symbol,
        "bestBid": best_bid,
        "bestAsk": best_ask,
        "mid": mid,
        "spreadBps": spread_bps,
        "markPrice": float(premium.get("markPrice", 0) or 0),
        "indexPrice": float(premium.get("indexPrice", 0) or 0),
        "lastFundingRate": float(premium.get("lastFundingRate", 0) or 0),
        "nextFundingTime": int(premium.get("nextFundingTime", 0) or 0),
        "executions": executions,
    }


def recommended_mode(round_trip_p90: Optional[float], depth_ok_rate: float) -> str:
    if round_trip_p90 is None or depth_ok_rate < 0.95:
        return "BLOCK_MARKET_ORDER"
    if round_trip_p90 <= 12:
        return "MARKET_ALLOWED_SMALL_NOTIONAL"
    if round_trip_p90 <= 25:
        return "POST_ONLY_OR_SLICED_IOC"
    return "POST_ONLY_REQUIRED_OR_SKIP"


def build_summary(samples: Dict[str, List[dict]]) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for symbol, rows in samples.items():
        symbol_summary = {
            "samples": len(rows),
            "spreadBps": summarize([float(row["spreadBps"]) for row in rows]),
            "fundingRate": summarize([float(row["lastFundingRate"]) for row in rows]),
            "notionals": {},
        }
        for notional in NOTIONALS:
            key = str(int(notional))
            executions = [row["executions"].get(key, {}) for row in rows]
            valid = [item for item in executions if item.get("depthSufficient")]
            round_trip = [float(item["takerRoundTripBps"]) for item in valid]
            buy_impact = [float(item["buyImpactBps"]) for item in valid]
            sell_impact = [float(item["sellImpactBps"]) for item in valid]
            depth_ok_rate = len(valid) / len(executions) if executions else 0.0
            rt_summary = summarize(round_trip)
            symbol_summary["notionals"][key] = {
                "depthSufficientRate": depth_ok_rate,
                "buyImpactBps": summarize(buy_impact),
                "sellImpactBps": summarize(sell_impact),
                "takerRoundTripBps": rt_summary,
                "recommendedMode": recommended_mode(rt_summary["p90"], depth_ok_rate),
            }
        result[symbol] = symbol_summary
    return result


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    samples: Dict[str, List[dict]] = {symbol: [] for symbol in SYMBOLS}
    errors: List[dict] = []
    start = time.time()
    for sample_index in range(SAMPLE_COUNT):
        for symbol in SYMBOLS:
            try:
                samples[symbol].append(snapshot_symbol(symbol))
            except Exception as error:
                errors.append({
                    "sampleIndex": sample_index,
                    "symbol": symbol,
                    "error": str(error),
                    "timestamp": int(time.time() * 1000),
                })
        if sample_index + 1 < SAMPLE_COUNT:
            time.sleep(SAMPLE_INTERVAL_SECONDS)

    summary = build_summary(samples)
    complete_symbols = sum(1 for rows in samples.values() if len(rows) >= max(5, SAMPLE_COUNT // 2))
    status = "MICROSTRUCTURE_BASELINE_CAPTURED" if complete_symbols == len(SYMBOLS) else "MICROSTRUCTURE_DATA_INCOMPLETE"
    result = rounded({
        "version": 17,
        "strategyId": "ASTER_MICROSTRUCTURE_EXECUTION_V17",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "source": {
            "baseUrl": BASE_URL,
            "depthEndpoint": "/fapi/v1/depth",
            "fundingEndpoint": "/fapi/v1/premiumIndex",
            "authenticationUsed": False,
        },
        "configuration": {
            "symbols": SYMBOLS,
            "notionalsUsd": NOTIONALS,
            "sampleCount": SAMPLE_COUNT,
            "sampleIntervalSeconds": SAMPLE_INTERVAL_SECONDS,
            "takerFeeBpsPerSideAssumption": TAKER_FEE_BPS_PER_SIDE,
            "makerFeeBpsPerSideAssumption": MAKER_FEE_BPS_PER_SIDE,
        },
        "durationSeconds": time.time() - start,
        "summary": summary,
        "samples": samples,
        "errors": errors,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "nextGate": {
            "minimumObservationHours": 168,
            "minimumSamplesPerSymbol": 10000,
            "requiredCoverage": 0.95,
            "purpose": "Use observed p90 spread/impact by symbol, not a universal assumed cost, in a frozen forward execution simulator.",
        },
        "limitations": [
            "This run captures a short current-market baseline and is not a historical backtest.",
            "Public market-data endpoints only; no API key, order placement, account or position access.",
            "Maker execution can miss fills; the 2 bps round-trip figure is fee-only and not a fill guarantee.",
            "No production, VPS, .env or live runner changes were made.",
        ],
    })

    report = [
        "# Aster Microstructure Execution V17",
        "",
        f"- Status: **{status}**",
        f"- Samples requested: {SAMPLE_COUNT} × {len(SYMBOLS)} symbols",
        f"- Duration: {result['durationSeconds']} seconds",
        f"- Errors: {len(errors)}",
        "- Authentication/API key: NOT USED",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Symbol | Spread p90 | $100 RT p90 | $500 RT p90 | $1k RT p90 | $5k RT p90 | $1k mode |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for symbol in SYMBOLS:
        item = result["summary"].get(symbol, {})
        notionals = item.get("notionals", {})
        def p90(key: str):
            return notionals.get(key, {}).get("takerRoundTripBps", {}).get("p90")
        report.append(
            f"| {symbol} | {item.get('spreadBps', {}).get('p90')} | {p90('100')} | {p90('500')} | "
            f"{p90('1000')} | {p90('5000')} | {notionals.get('1000', {}).get('recommendedMode')} |"
        )
    report.extend([
        "",
        "## Verdict",
        "",
        "A short live order-book baseline was captured. This does not authorize Paper or Live trading. The same collector must accumulate at least 7 days before venue-specific execution rules are frozen.",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "aster-microstructure-execution-v17.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "aster-microstructure-execution-v17.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
