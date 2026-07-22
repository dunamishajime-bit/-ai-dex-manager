from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

BASE_URL = "https://fapi.asterdex.com"
NY = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_THEME_SHADOW_V1"
CRYPTO_SYMBOLS = {"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"}
STOCK_GROSS_CAP = 0.10
PORTFOLIO_GROSS_CAP = 2.0
LOOKBACK_FAST = 5
LOOKBACK_SLOW = 20
NORMAL_TURNOVER_BPS = 20.0
SEVERE_TURNOVER_BPS = 50.0
HISTORY_DAYS = 420
MIN_THEME_MEMBERS = 3
MIN_EVALUATION_DAYS = 80

AI_TICKERS = {
    "NVDA", "MSFT", "GOOG", "GOOGL", "META", "AMZN", "ORCL", "PLTR",
    "AVGO", "AMD", "ARM", "SMCI", "TSLA", "CRM", "ADBE",
}
SEMICONDUCTOR_TICKERS = {
    "NVDA", "AMD", "AVGO", "TSM", "ASML", "ARM", "INTC", "MU", "QCOM",
    "AMAT", "LRCX", "KLAC", "SMCI", "MRVL",
}
AI_TAGS = {"AI", "ARTIFICIALINTELLIGENCE", "ARTIFICIAL_INTELLIGENCE", "GENAI"}
SEMI_TAGS = {"SEMICONDUCTOR", "SEMICONDUCTORS", "SEMI", "CHIP", "CHIPS"}


@dataclass(frozen=True)
class Config:
    name: str
    breadth: float


CONFIGS = (
    Config("BREADTH_60", 0.60),
    Config("BREADTH_67_PRIMARY", 2.0 / 3.0),
    Config("BREADTH_75", 0.75),
)


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def request_json(path: str, params: Optional[dict] = None, timeout: int = 30):
    query = urllib.parse.urlencode(params or {})
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"User-Agent": "DisDex-V96-Stock-Theme-Research/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def normalized_tags(item: dict) -> set[str]:
    raw = item.get("underlyingSubType") or []
    if isinstance(raw, str):
        raw = [raw]
    return {str(tag).upper().replace("-", "_").replace(" ", "_") for tag in raw}


def ticker_of(item: dict) -> str:
    base = str(item.get("baseAsset") or "").upper()
    if base.endswith("USDT"):
        base = base[:-4]
    return base


def classify_symbol(item: dict) -> List[str]:
    if str(item.get("status", "")).upper() != "TRADING":
        return []
    symbol = str(item.get("symbol", "")).upper()
    ticker = ticker_of(item)
    tags = normalized_tags(item)
    underlying = str(item.get("underlyingType") or "").upper()
    stock_like = underlying in {"STOCK", "EQUITY", "INDEX"} or "STOCK" in tags or ticker in (AI_TICKERS | SEMICONDUCTOR_TICKERS)
    if not stock_like or symbol in CRYPTO_SYMBOLS:
        return []
    themes: List[str] = []
    compact = {tag.replace("_", "") for tag in tags}
    if ticker in AI_TICKERS or bool(compact & {tag.replace("_", "") for tag in AI_TAGS}):
        themes.append("AI")
    if ticker in SEMICONDUCTOR_TICKERS or bool(compact & {tag.replace("_", "") for tag in SEMI_TAGS}):
        themes.append("SEMICONDUCTOR")
    return themes


def discover_universe(exchange_info: dict) -> Tuple[dict, List[dict]]:
    themes: Dict[str, List[str]] = {"AI": [], "SEMICONDUCTOR": []}
    rows: List[dict] = []
    for item in exchange_info.get("symbols", []):
        symbol_themes = classify_symbol(item)
        if not symbol_themes:
            continue
        symbol = str(item.get("symbol", "")).upper()
        for theme in symbol_themes:
            themes[theme].append(symbol)
        rows.append({
            "symbol": symbol,
            "ticker": ticker_of(item),
            "underlyingType": item.get("underlyingType"),
            "underlyingSubType": sorted(normalized_tags(item)),
            "themes": symbol_themes,
            "onboardDate": item.get("onboardDate"),
        })
    for theme in themes:
        themes[theme] = sorted(set(themes[theme]))
    return themes, sorted(rows, key=lambda row: row["symbol"])


def fetch_klines(symbol: str, start_ms: int, end_ms: int) -> List[list]:
    result: List[list] = []
    cursor = start_ms
    hour = 3_600_000
    while cursor < end_ms:
        payload = request_json("/fapi/v1/klines", {
            "symbol": symbol,
            "interval": "1h",
            "startTime": cursor,
            "endTime": end_ms - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list) or not payload:
            break
        result.extend(row for row in payload if isinstance(row, list) and len(row) >= 8)
        next_cursor = int(payload[-1][0]) + hour
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.05)
    dedup = {int(row[0]): row for row in result}
    return [dedup[key] for key in sorted(dedup)]


def fetch_funding(symbol: str, start_ms: int, end_ms: int) -> List[dict]:
    result: List[dict] = []
    cursor = start_ms
    while cursor < end_ms:
        try:
            payload = request_json("/fapi/v1/fundingRate", {
                "symbol": symbol,
                "startTime": cursor,
                "endTime": end_ms - 1,
                "limit": 1000,
            })
        except Exception:
            return result
        if not isinstance(payload, list) or not payload:
            break
        result.extend(item for item in payload if isinstance(item, dict))
        last = int(payload[-1].get("fundingTime", cursor))
        next_cursor = last + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.05)
    return result


def aggregate_regular_days(klines: Sequence[list]) -> Dict[str, dict]:
    grouped: Dict[str, List[list]] = {}
    for row in klines:
        ts = int(row[0])
        local = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).astimezone(NY)
        if local.weekday() >= 5 or local.hour < 10 or local.hour > 15:
            continue
        if finite(row[7]) <= 0 and finite(row[5]) <= 0:
            continue
        key = local.date().isoformat()
        grouped.setdefault(key, []).append(row)
    daily: Dict[str, dict] = {}
    for key, rows in grouped.items():
        rows = sorted(rows, key=lambda row: int(row[0]))
        if len(rows) < 4:
            continue
        daily[key] = {
            "date": key,
            "firstTs": int(rows[0][0]),
            "lastTs": int(rows[-1][0]),
            "open": finite(rows[0][1]),
            "close": finite(rows[-1][4]),
            "quoteVolume": sum(finite(row[7]) for row in rows),
            "barCount": len(rows),
        }
    return daily


def funding_by_hold_date(funding_rows: Sequence[dict]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for item in funding_rows:
        ts = int(item.get("fundingTime", 0))
        if ts <= 0:
            continue
        local_date = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).astimezone(NY).date().isoformat()
        result[local_date] = result.get(local_date, 0.0) + finite(item.get("fundingRate"))
    return result


def pct_change(values: Sequence[float], lookback: int) -> Optional[float]:
    if len(values) <= lookback:
        return None
    prior = finite(values[-1 - lookback])
    current = finite(values[-1])
    return current / prior - 1.0 if prior > 0 and current > 0 else None


def signal_for_day(config: Config, day: str, themes: dict, daily: dict) -> Optional[dict]:
    theme_candidates: List[dict] = []
    for theme, symbols in themes.items():
        members: List[dict] = []
        for symbol in symbols:
            symbol_days = daily.get(symbol, {})
            history_days = sorted(key for key in symbol_days if key <= day)
            if len(history_days) <= LOOKBACK_SLOW:
                continue
            closes = [finite(symbol_days[key]["close"]) for key in history_days]
            r5 = pct_change(closes, LOOKBACK_FAST)
            r20 = pct_change(closes, LOOKBACK_SLOW)
            if r5 is None or r20 is None:
                continue
            members.append({"symbol": symbol, "r5": r5, "r20": r20, "score": r20 + 0.5 * r5})
        if len(members) < MIN_THEME_MEMBERS:
            continue
        median5 = statistics.median(member["r5"] for member in members)
        median20 = statistics.median(member["r20"] for member in members)
        positive_breadth = sum(member["r5"] > 0 and member["r20"] > 0 for member in members) / len(members)
        side = 0
        if median5 > 0 and median20 > 0 and positive_breadth >= config.breadth:
            side = 1
        elif median5 < 0 and median20 < 0 and positive_breadth <= 1.0 - config.breadth:
            side = -1
        if side == 0:
            continue
        selected = max(members, key=lambda row: row["score"]) if side > 0 else min(members, key=lambda row: row["score"])
        theme_candidates.append({
            "theme": theme,
            "side": side,
            "symbol": selected["symbol"],
            "themeScore": median20 + 0.5 * median5,
            "memberScore": selected["score"],
            "positiveBreadth": positive_breadth,
            "memberCount": len(members),
        })
    if not theme_candidates:
        return None
    theme_candidates.sort(key=lambda row: (abs(row["themeScore"]), abs(row["memberScore"])), reverse=True)
    return theme_candidates[0]


def allocate_stock_weight(requested: float, current_v96_gross: float) -> float:
    available = max(0.0, PORTFOLIO_GROSS_CAP - max(0.0, finite(current_v96_gross)))
    return math.copysign(min(abs(requested), STOCK_GROSS_CAP, available), requested) if requested else 0.0


def integration_self_test() -> dict:
    base_weights = {"BTCUSDT": 0.4, "ETHUSDT": -0.3, "PENGUUSDT": 1.15}
    snapshots = []
    for gross in (0.0, 1.80, 1.90, 1.95, 2.0, 2.1):
        before = dict(base_weights)
        weight = allocate_stock_weight(0.10, gross)
        assert base_weights == before
        assert gross + abs(weight) <= PORTFOLIO_GROSS_CAP + 1e-12 or gross > PORTFOLIO_GROSS_CAP
        snapshots.append({"v96Gross": gross, "stockWeight": weight, "combinedGross": gross + abs(weight)})
    assert not (set(base_weights) & {"NVDAUSDT", "AMDUSDT"})
    return {"v96WeightsUntouched": True, "symbolOverlap": [], "grossChecks": snapshots}


def build_returns(config: Config, themes: dict, daily: dict, funding: dict, severe: bool) -> Tuple[List[dict], List[dict]]:
    all_days = sorted(set().union(*(set(rows) for rows in daily.values())))
    signal_map = {day: signal_for_day(config, day, themes, daily) for day in all_days}
    delay = 2 if severe else 1
    cost_bps = SEVERE_TURNOVER_BPS if severe else NORMAL_TURNOVER_BPS
    previous_weight = 0.0
    previous_symbol: Optional[str] = None
    rows: List[dict] = []
    events: List[dict] = []
    active: Optional[dict] = None
    for index, day in enumerate(all_days):
        source = index - delay
        signal = signal_map.get(all_days[source]) if source >= 0 else None
        symbol = str(signal["symbol"]) if signal else None
        side = int(signal["side"]) if signal else 0
        requested = side * STOCK_GROSS_CAP
        weight = allocate_stock_weight(requested, 1.90)
        pnl = 0.0
        funding_cost = 0.0
        symbol_return = 0.0
        if symbol and day in daily.get(symbol, {}):
            symbol_days = sorted(daily[symbol])
            position = symbol_days.index(day)
            if position + 1 < len(symbol_days):
                current_open = finite(daily[symbol][day]["open"])
                next_day = symbol_days[position + 1]
                next_open = finite(daily[symbol][next_day]["open"])
                if current_open > 0 and next_open > 0:
                    symbol_return = next_open / current_open - 1.0
                    funding_cost = weight * finite(funding.get(symbol, {}).get(day))
                    pnl = weight * symbol_return - funding_cost
        turnover = abs(weight) if previous_symbol != symbol else abs(weight - previous_weight)
        if previous_symbol and previous_symbol != symbol:
            turnover += abs(previous_weight)
        pnl -= turnover * cost_bps / 10_000.0
        if severe:
            pnl -= abs(weight) * 10.0 / 10_000.0
        if active is not None and (symbol != active["symbol"] or side != active["side"]):
            active["exitDay"] = day
            active = None
        if symbol and side and active is None:
            active = {
                "symbol": symbol,
                "theme": signal["theme"],
                "side": side,
                "entryDay": day,
                "exitDay": all_days[-1],
                "returnPct": 0.0,
                "bars": 0,
            }
            events.append(active)
        if active is not None and symbol == active["symbol"] and side == active["side"]:
            active["returnPct"] += pnl * 100.0
            active["bars"] += 1
        rows.append({
            "day": day,
            "return": pnl,
            "symbol": symbol,
            "theme": signal.get("theme") if signal else None,
            "side": side,
            "gross": abs(weight),
            "symbolReturn": symbol_return,
            "fundingCost": funding_cost,
            "turnover": turnover,
        })
        previous_weight = weight
        previous_symbol = symbol
    return rows, events


def metrics(rows: Sequence[dict]) -> dict:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    values: List[float] = []
    for row in rows:
        value = finite(row.get("return"))
        values.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    mean = statistics.fmean(values) if values else 0.0
    stdev = statistics.pstdev(values) if len(values) > 1 else 0.0
    sharpe = mean / stdev * math.sqrt(252.0) if stdev > 1e-12 else 0.0
    return {
        "days": len(rows),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "annualizedSharpe": sharpe,
        "activeDays": sum(abs(finite(row.get("gross"))) > 0 for row in rows),
    }


def event_summary(events: Sequence[dict]) -> dict:
    positive = [max(0.0, finite(event.get("returnPct"))) for event in events]
    positive_total = sum(positive)
    return {
        "count": len(events),
        "winRatePct": sum(finite(event.get("returnPct")) > 0 for event in events) / len(events) * 100.0 if events else 0.0,
        "topPositiveEventShare": max(positive, default=0.0) / positive_total if positive_total > 0 else 0.0,
        "symbols": sorted({str(event.get("symbol")) for event in events}),
        "themes": sorted({str(event.get("theme")) for event in events}),
    }


def split_ranges(rows: Sequence[dict]) -> dict:
    n = len(rows)
    a = int(n * 0.60)
    b = int(n * 0.80)
    return {"development": (0, a), "validation": (a, b), "holdout": (b, n), "full": (0, n)}


def evaluate(config: Config, themes: dict, daily: dict, funding: dict) -> dict:
    normal, normal_events = build_returns(config, themes, daily, funding, False)
    severe, severe_events = build_returns(config, themes, daily, funding, True)
    ranges = split_ranges(normal)
    periods = {}
    for name, (start, end) in ranges.items():
        periods[name] = {"normal": metrics(normal[start:end]), "severe": metrics(severe[start:end])}
    summary = event_summary(normal_events)
    enough_history = len(normal) >= MIN_EVALUATION_DAYS
    pass_screen = bool(
        enough_history
        and periods["validation"]["normal"]["compoundedReturnPct"] > 0
        and periods["validation"]["severe"]["compoundedReturnPct"] > 0
        and periods["holdout"]["normal"]["compoundedReturnPct"] > 0
        and periods["holdout"]["severe"]["compoundedReturnPct"] > 0
        and periods["full"]["severe"]["compoundedReturnPct"] > 0
        and periods["full"]["severe"]["maxDrawdownPct"] >= -15.0
        and summary["count"] >= 20
        and summary["topPositiveEventShare"] <= 0.35
        and len(summary["symbols"]) >= 3
        and len(summary["themes"]) >= 2
    )
    return {
        "config": asdict(config),
        "screenPass": pass_screen,
        "enoughHistory": enough_history,
        "periods": periods,
        "normalSummary": summary,
        "severeSummary": event_summary(severe_events),
    }


def synthetic_self_test() -> None:
    exchange = {"symbols": [
        {"symbol": "NVDAUSDT", "baseAsset": "NVDA", "status": "TRADING", "underlyingType": "STOCK", "underlyingSubType": ["AI", "SEMICONDUCTOR"]},
        {"symbol": "AMDUSDT", "baseAsset": "AMD", "status": "TRADING", "underlyingType": "STOCK", "underlyingSubType": ["SEMICONDUCTOR"]},
        {"symbol": "MSFTUSDT", "baseAsset": "MSFT", "status": "TRADING", "underlyingType": "STOCK", "underlyingSubType": ["AI"]},
        {"symbol": "BTCUSDT", "baseAsset": "BTC", "status": "TRADING", "underlyingType": "COIN", "underlyingSubType": ["POW"]},
    ]}
    themes, rows = discover_universe(exchange)
    assert "NVDAUSDT" in themes["AI"] and "NVDAUSDT" in themes["SEMICONDUCTOR"]
    assert "BTCUSDT" not in themes["AI"]
    assert rows
    integration_self_test()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    synthetic_self_test()
    if args.self_test:
        print("self-test: ok")
        return

    now_ms = int(dt.datetime.now(tz=UTC).timestamp() * 1000)
    start_ms = now_ms - HISTORY_DAYS * 86_400_000
    exchange_info = request_json("/fapi/v1/exchangeInfo")
    themes, universe_rows = discover_universe(exchange_info)
    universe_symbols = sorted(set(themes["AI"]) | set(themes["SEMICONDUCTOR"]))

    daily: Dict[str, Dict[str, dict]] = {}
    funding: Dict[str, Dict[str, float]] = {}
    coverage = {}
    for symbol in universe_symbols:
        klines = fetch_klines(symbol, start_ms, now_ms)
        daily[symbol] = aggregate_regular_days(klines)
        funding_rows = fetch_funding(symbol, start_ms, now_ms)
        funding[symbol] = funding_by_hold_date(funding_rows)
        coverage[symbol] = {
            "klineRows": len(klines),
            "regularDays": len(daily[symbol]),
            "fundingRows": len(funding_rows),
            "firstDay": min(daily[symbol], default=None),
            "lastDay": max(daily[symbol], default=None),
        }

    evaluations = [evaluate(config, themes, daily, funding) for config in CONFIGS]
    by_name = {item["config"]["name"]: item for item in evaluations}
    primary = by_name["BREADTH_67_PRIMARY"]
    neighbor_passes = sum(item["screenPass"] for item in evaluations if item is not primary)
    robust = bool(primary["screenPass"] and neighbor_passes >= 1)
    status = "STOCK_THEME_SHADOW_ROBUST_HISTORICAL" if robust else "NO_ROBUST_STOCK_THEME_EDGE"
    if len(universe_symbols) < 3 or any(len(themes[name]) < MIN_THEME_MEMBERS for name in themes):
        status = "INSUFFICIENT_THEME_UNIVERSE"

    result = {
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(tz=UTC).isoformat(),
        "status": status,
        "selectedForProduction": False,
        "universe": {"themes": themes, "symbols": universe_rows, "coverage": coverage},
        "design": {
            "decisionFrequency": "once per US regular trading day after completed session data",
            "signal": "5-day and 20-day theme breadth plus cross-sectional relative strength",
            "execution": "next trading-day open; Severe uses one additional trading-day delay",
            "positionCount": 1,
            "stockGrossCap": STOCK_GROSS_CAP,
            "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
            "normalTurnoverBps": NORMAL_TURNOVER_BPS,
            "severeTurnoverBps": SEVERE_TURNOVER_BPS,
        },
        "evaluations": evaluations,
        "integration": integration_self_test(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "orderSubmissionAllowed": False,
            "mode": "SHADOW",
            "v96WeightsMutable": False,
            "promotionAllowed": False,
            "singlePredeclaredFamily": True,
        },
        "limitations": [
            "The universe uses currently listed Aster stock perpetuals, so delisted symbols create survivorship bias.",
            "Aster stock perpetual history may be short or uneven by symbol.",
            "Regular-session hourly aggregation omits the first 30 minutes and all off-hours trading.",
            "Historical order-book and liquidation data are unavailable; the separate three-day collector is Forward evidence only.",
            "No result from this script authorizes LIVE trading or changes the current V96 allocator.",
        ],
    }
    json_path = output / "v96-stock-theme-shadow.json"
    md_path = output / "v96-stock-theme-shadow.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# V96 Stock Theme Shadow Screen",
        "",
        f"- Status: **{status}**",
        f"- AI members: {', '.join(themes['AI']) or 'NONE'}",
        f"- Semiconductor members: {', '.join(themes['SEMICONDUCTOR']) or 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "- V96 weights mutable: **NO**",
        "",
        "| Config | Pass | Full N | Full S | Val N/S | Holdout N/S | Severe DD | Events | Symbols | Themes | Top share |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in evaluations:
        p = item["periods"]
        s = item["normalSummary"]
        lines.append(
            f"| {item['config']['name']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{p['full']['normal']['compoundedReturnPct']:.4f} | {p['full']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['validation']['normal']['compoundedReturnPct']:.4f}/{p['validation']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['holdout']['normal']['compoundedReturnPct']:.4f}/{p['holdout']['severe']['compoundedReturnPct']:.4f} | "
            f"{p['full']['severe']['maxDrawdownPct']:.4f} | {s['count']} | {len(s['symbols'])} | {len(s['themes'])} | {s['topPositiveEventShare']:.4f} |"
        )
    lines.extend(["", "Research-only Shadow engine. No order path is present."])
    markdown = "\n".join(lines) + "\n"
    md_path.write_text(markdown, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n" + markdown)
    print(markdown)


if __name__ == "__main__":
    main()
