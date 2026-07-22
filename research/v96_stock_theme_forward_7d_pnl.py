from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

BASE_URL = "https://fapi.asterdex.com"
UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
START_UTC = dt.datetime(2026, 7, 22, 1, 0, tzinfo=UTC)
END_UTC = dt.datetime(2026, 7, 29, 1, 0, tzinfo=UTC)
NORMAL_TURNOVER_BPS = 20.0
SEVERE_TURNOVER_BPS = 50.0
STOCK_GROSS_CAP = 0.10
PORTFOLIO_GROSS_CAP = 2.0
ASSUMED_V96_GROSS = 1.90
LOOKBACK_FAST = 5
LOOKBACK_SLOW = 20

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
THEMES = {"AI": AI_SYMBOLS, "SEMICONDUCTOR": SEMICONDUCTOR_SYMBOLS}
SYMBOLS = tuple(sorted(set(AI_SYMBOLS) | set(SEMICONDUCTOR_SYMBOLS)))


@dataclass(frozen=True)
class DirectionalConfig:
    breadth: float = 2.0 / 3.0


@dataclass(frozen=True)
class NeutralConfig:
    slow: int = 20
    fast: int = 5


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def request_json(path: str, params: Optional[dict] = None, timeout: int = 30):
    query = urllib.parse.urlencode(params or {})
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"User-Agent": "DisDex-V96-Stock-Theme-Forward-7D/1.0"})
    last_error: Optional[Exception] = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            if attempt < 4:
                time.sleep(0.75 * (attempt + 1))
    raise RuntimeError(f"GET {path} failed: {last_error}")


def fetch_klines(symbol: str, start_ms: int, end_ms: int) -> List[list]:
    rows: List[list] = []
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
        rows.extend(row for row in payload if isinstance(row, list) and len(row) >= 8)
        next_cursor = int(payload[-1][0]) + hour
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.05)
    dedup = {int(row[0]): row for row in rows}
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
        local = dt.datetime.fromtimestamp(int(row[0]) / 1000.0, tz=UTC).astimezone(NY)
        if local.weekday() >= 5 or local.hour < 10 or local.hour > 15:
            continue
        if finite(row[7]) <= 0 and finite(row[5]) <= 0:
            continue
        grouped.setdefault(local.date().isoformat(), []).append(row)
    daily: Dict[str, dict] = {}
    for day, rows in grouped.items():
        rows = sorted(rows, key=lambda item: int(item[0]))
        if len(rows) < 4:
            continue
        daily[day] = {
            "open": finite(rows[0][1]),
            "close": finite(rows[-1][4]),
            "barCount": len(rows),
        }
    return daily


def funding_by_date(rows: Sequence[dict]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for item in rows:
        ts = int(item.get("fundingTime", 0) or 0)
        if ts <= 0:
            continue
        day = dt.datetime.fromtimestamp(ts / 1000.0, tz=UTC).astimezone(NY).date().isoformat()
        result[day] = result.get(day, 0.0) + finite(item.get("fundingRate"))
    return result


def pct_change(values: Sequence[float], lookback: int) -> Optional[float]:
    if len(values) <= lookback:
        return None
    previous = finite(values[-1 - lookback])
    current = finite(values[-1])
    return current / previous - 1.0 if previous > 0 and current > 0 else None


def directional_signal(day: str, daily: dict, config: DirectionalConfig) -> Optional[dict]:
    candidates: List[dict] = []
    for theme, symbols in THEMES.items():
        members: List[dict] = []
        for symbol in symbols:
            history_days = sorted(key for key in daily.get(symbol, {}) if key <= day)
            if len(history_days) <= LOOKBACK_SLOW:
                continue
            closes = [finite(daily[symbol][key]["close"]) for key in history_days]
            r5 = pct_change(closes, LOOKBACK_FAST)
            r20 = pct_change(closes, LOOKBACK_SLOW)
            if r5 is None or r20 is None:
                continue
            members.append({"symbol": symbol, "r5": r5, "r20": r20, "score": r20 + 0.5 * r5})
        if len(members) < 3:
            continue
        median5 = statistics.median(row["r5"] for row in members)
        median20 = statistics.median(row["r20"] for row in members)
        positive = sum(row["r5"] > 0 and row["r20"] > 0 for row in members) / len(members)
        side = 0
        if median5 > 0 and median20 > 0 and positive >= config.breadth:
            side = 1
        elif median5 < 0 and median20 < 0 and positive <= 1.0 - config.breadth:
            side = -1
        if side == 0:
            continue
        selected = max(members, key=lambda row: row["score"]) if side > 0 else min(members, key=lambda row: row["score"])
        candidates.append({
            "theme": theme,
            "side": side,
            "symbol": selected["symbol"],
            "themeScore": median20 + 0.5 * median5,
            "memberScore": selected["score"],
        })
    if not candidates:
        return None
    candidates.sort(key=lambda row: (abs(row["themeScore"]), abs(row["memberScore"])), reverse=True)
    return candidates[0]


def neutral_signal(day: str, daily: dict, config: NeutralConfig) -> Optional[dict]:
    candidates: List[dict] = []
    for theme, symbols in THEMES.items():
        members: List[dict] = []
        for symbol in symbols:
            history_days = sorted(key for key in daily.get(symbol, {}) if key <= day)
            if len(history_days) <= config.slow:
                continue
            closes = [finite(daily[symbol][key]["close"]) for key in history_days]
            fast = pct_change(closes, config.fast)
            slow = pct_change(closes, config.slow)
            if fast is None or slow is None:
                continue
            members.append({"symbol": symbol, "score": slow + 0.5 * fast})
        if len(members) < 4:
            continue
        strongest = max(members, key=lambda row: row["score"])
        weakest = min(members, key=lambda row: row["score"])
        spread = strongest["score"] - weakest["score"]
        if strongest["score"] <= 0 or weakest["score"] >= 0 or spread <= 0:
            continue
        candidates.append({"theme": theme, "long": strongest["symbol"], "short": weakest["symbol"], "spread": spread})
    if not candidates:
        return None
    candidates.sort(key=lambda row: row["spread"], reverse=True)
    return candidates[0]


def all_days(daily: dict) -> List[str]:
    return sorted(set().union(*(set(rows) for rows in daily.values())))


def next_open_return(daily: dict, symbol: str, day: str) -> Tuple[Optional[float], Optional[str]]:
    days = sorted(daily.get(symbol, {}))
    if day not in daily.get(symbol, {}):
        return None, None
    index = days.index(day)
    if index + 1 >= len(days):
        return None, None
    next_day = days[index + 1]
    current_open = finite(daily[symbol][day]["open"])
    next_open = finite(daily[symbol][next_day]["open"])
    if current_open <= 0 or next_open <= 0:
        return None, next_day
    return next_open / current_open - 1.0, next_day


def open_to_close_return(daily: dict, symbol: str, day: str) -> Optional[float]:
    item = daily.get(symbol, {}).get(day)
    if not item:
        return None
    open_price = finite(item.get("open"))
    close_price = finite(item.get("close"))
    return close_price / open_price - 1.0 if open_price > 0 and close_price > 0 else None


def weight_capacity(requested: float) -> float:
    available = max(0.0, PORTFOLIO_GROSS_CAP - ASSUMED_V96_GROSS)
    return math.copysign(min(abs(requested), STOCK_GROSS_CAP, available), requested) if requested else 0.0


def metrics(rows: Sequence[dict]) -> dict:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    completed = [row for row in rows if row.get("completed")]
    for row in completed:
        equity *= max(0.001, 1.0 + finite(row.get("return")))
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    values = [finite(row.get("return")) for row in completed]
    return {
        "completedIntervals": len(completed),
        "activeIntervals": sum(bool(row.get("active")) for row in completed),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "positiveIntervalRatePct": (sum(value > 0 for value in values) / len(values) * 100.0) if values else 0.0,
        "markedToMarketReturnPct": sum(finite(row.get("markedToMarketReturn")) for row in rows) * 100.0,
    }


def evaluate_directional(daily: dict, funding: dict, severe: bool) -> dict:
    days = all_days(daily)
    signals = {day: directional_signal(day, daily, DirectionalConfig()) for day in days}
    delay = 2 if severe else 1
    cost_bps = SEVERE_TURNOVER_BPS if severe else NORMAL_TURNOVER_BPS
    previous_symbol: Optional[str] = None
    previous_weight = 0.0
    rows: List[dict] = []
    start_day = START_UTC.astimezone(NY).date().isoformat()
    end_day = END_UTC.astimezone(NY).date().isoformat()
    for index, day in enumerate(days):
        if not (start_day <= day <= end_day):
            continue
        source_index = index - delay
        signal = signals.get(days[source_index]) if source_index >= 0 else None
        symbol = str(signal["symbol"]) if signal else None
        side = int(signal["side"]) if signal else 0
        weight = weight_capacity(side * STOCK_GROSS_CAP)
        raw_return, next_day = next_open_return(daily, symbol, day) if symbol else (None, None)
        completed = bool(raw_return is not None and next_day is not None and next_day <= end_day)
        pnl = weight * raw_return if completed and raw_return is not None else 0.0
        funding_cost = weight * finite(funding.get(symbol, {}).get(day)) if symbol else 0.0
        pnl -= funding_cost
        turnover = abs(weight) if previous_symbol != symbol else abs(weight - previous_weight)
        if previous_symbol and previous_symbol != symbol:
            turnover += abs(previous_weight)
        pnl -= turnover * cost_bps / 10_000.0
        if severe:
            pnl -= abs(weight) * 10.0 / 10_000.0
        mtm = 0.0
        if not completed and symbol:
            partial = open_to_close_return(daily, symbol, day)
            if partial is not None:
                mtm = weight * partial - funding_cost
        rows.append({
            "day": day,
            "sourceDay": days[source_index] if source_index >= 0 else None,
            "theme": signal.get("theme") if signal else None,
            "symbol": symbol,
            "side": side,
            "gross": abs(weight),
            "active": bool(symbol and side),
            "completed": completed,
            "nextDay": next_day,
            "rawSymbolReturn": raw_return,
            "fundingCost": funding_cost,
            "turnover": turnover,
            "return": pnl if completed else 0.0,
            "markedToMarketReturn": mtm,
        })
        previous_symbol = symbol
        previous_weight = weight
    return {"scenario": "SEVERE" if severe else "NORMAL", "metrics": metrics(rows), "rows": rows}


def week_end_days(days: Sequence[str]) -> List[str]:
    result: Dict[Tuple[int, int], str] = {}
    for day in days:
        date = dt.date.fromisoformat(day)
        iso = date.isocalendar()
        result[(iso.year, iso.week)] = day
    return sorted(result.values())


def latest_decision(decisions: Sequence[str], source_day: str) -> Optional[str]:
    eligible = [day for day in decisions if day <= source_day]
    return eligible[-1] if eligible else None


def evaluate_neutral(daily: dict, funding: dict, severe: bool) -> dict:
    days = all_days(daily)
    decisions = week_end_days(days)
    signals = {day: neutral_signal(day, daily, NeutralConfig()) for day in decisions}
    delay = 2 if severe else 1
    cost_bps = SEVERE_TURNOVER_BPS if severe else NORMAL_TURNOVER_BPS
    previous: Dict[str, float] = {}
    rows: List[dict] = []
    start_day = START_UTC.astimezone(NY).date().isoformat()
    end_day = END_UTC.astimezone(NY).date().isoformat()
    for index, day in enumerate(days):
        if not (start_day <= day <= end_day):
            continue
        source_index = index - delay
        source_day = days[source_index] if source_index >= 0 else None
        decision_day = latest_decision(decisions, source_day) if source_day else None
        signal = signals.get(decision_day) if decision_day else None
        requested: Dict[str, float] = {}
        if signal:
            requested[str(signal["long"])] = 0.05
            requested[str(signal["short"])] = -0.05
        gross = sum(abs(value) for value in requested.values())
        available = max(0.0, PORTFOLIO_GROSS_CAP - ASSUMED_V96_GROSS)
        scale = min(1.0, available / gross) if gross > 0 else 0.0
        weights = {symbol: value * scale for symbol, value in requested.items()}
        next_days: List[str] = []
        completed = bool(weights)
        raw_returns: Dict[str, float] = {}
        pnl = 0.0
        funding_cost = 0.0
        mtm = 0.0
        for symbol, weight in weights.items():
            raw, next_day = next_open_return(daily, symbol, day)
            if raw is None or next_day is None or next_day > end_day:
                completed = False
                partial = open_to_close_return(daily, symbol, day)
                if partial is not None:
                    mtm += weight * partial
            else:
                raw_returns[symbol] = raw
                next_days.append(next_day)
                pnl += weight * raw
            symbol_funding = weight * finite(funding.get(symbol, {}).get(day))
            funding_cost += symbol_funding
            pnl -= symbol_funding
            mtm -= symbol_funding
        turnover = sum(abs(weights.get(symbol, 0.0) - previous.get(symbol, 0.0)) for symbol in set(weights) | set(previous))
        pnl -= turnover * cost_bps / 10_000.0
        if severe:
            pnl -= sum(abs(value) for value in weights.values()) * 10.0 / 10_000.0
        rows.append({
            "day": day,
            "sourceDay": source_day,
            "decisionDay": decision_day,
            "theme": signal.get("theme") if signal else None,
            "long": signal.get("long") if signal else None,
            "short": signal.get("short") if signal else None,
            "gross": sum(abs(value) for value in weights.values()),
            "net": sum(weights.values()),
            "active": bool(weights),
            "completed": completed,
            "nextDays": sorted(set(next_days)),
            "rawReturns": raw_returns,
            "fundingCost": funding_cost,
            "turnover": turnover,
            "return": pnl if completed else 0.0,
            "markedToMarketReturn": mtm if not completed else 0.0,
        })
        previous = weights
    return {"scenario": "SEVERE" if severe else "NORMAL", "metrics": metrics(rows), "rows": rows}


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-theme-forward-7d-pnl.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    d_normal = result["directional"]["normal"]["metrics"]
    d_severe = result["directional"]["severe"]["metrics"]
    n_normal = result["neutral"]["normal"]["metrics"]
    n_severe = result["neutral"]["severe"]["metrics"]
    lines = [
        "# V96 stock-theme seven-day preliminary Shadow PnL",
        "",
        f"Status: **{result['status']}**",
        "",
        "## Frozen directional rule",
        f"- Normal: {d_normal['compoundedReturnPct']:.6f}% over {d_normal['completedIntervals']} completed intervals",
        f"- Severe: {d_severe['compoundedReturnPct']:.6f}% over {d_severe['completedIntervals']} completed intervals",
        "",
        "## Frozen same-theme market-neutral rule",
        f"- Normal: {n_normal['compoundedReturnPct']:.6f}% over {n_normal['completedIntervals']} completed intervals",
        f"- Severe: {n_severe['compoundedReturnPct']:.6f}% over {n_severe['completedIntervals']} completed intervals",
        "",
        "This is a preliminary observation across roughly five U.S. sessions. It is not a robustness or Production approval.",
    ]
    (output_dir / "v96-stock-theme-forward-7d-pnl.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(SYMBOLS) == 22
    assert abs(weight_capacity(0.10) - 0.10) < 1e-12
    assert pct_change([1, 2, 3, 4, 5, 6], 5) == 5.0
    assert week_end_days(["2026-07-20", "2026-07-24", "2026-07-27"]) == ["2026-07-24", "2026-07-27"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-stock-theme-forward-report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock-theme seven-day PnL self-test: PASS")
        return 0

    history_start = START_UTC - dt.timedelta(days=90)
    history_end = END_UTC + dt.timedelta(days=1)
    start_ms = int(history_start.timestamp() * 1000)
    end_ms = int(history_end.timestamp() * 1000)
    daily: Dict[str, Dict[str, dict]] = {}
    funding: Dict[str, Dict[str, float]] = {}
    coverage: Dict[str, dict] = {}
    for symbol in SYMBOLS:
        klines = fetch_klines(symbol, start_ms, end_ms)
        funding_rows = fetch_funding(symbol, start_ms, end_ms)
        daily[symbol] = aggregate_regular_days(klines)
        funding[symbol] = funding_by_date(funding_rows)
        coverage[symbol] = {"regularDays": len(daily[symbol]), "fundingRows": len(funding_rows)}

    directional_normal = evaluate_directional(daily, funding, False)
    directional_severe = evaluate_directional(daily, funding, True)
    neutral_normal = evaluate_neutral(daily, funding, False)
    neutral_severe = evaluate_neutral(daily, funding, True)
    completed = min(
        directional_normal["metrics"]["completedIntervals"],
        directional_severe["metrics"]["completedIntervals"],
    )
    status = "PRELIMINARY_FORWARD_PNL_ONLY_NOT_ROBUST" if completed >= 2 else "INSUFFICIENT_FORWARD_INTERVALS"
    result = {
        "strategyId": "V96_STOCK_THEME_FORWARD_7D_PNL_V1",
        "status": status,
        "selectedForProduction": False,
        "window": {"startUtc": START_UTC.isoformat(), "endUtc": END_UTC.isoformat()},
        "frozenRules": {
            "directional": "BREADTH_67_PRIMARY, next trading-day execution, Gross 0.10",
            "neutral": "PAIR_L20_PRIMARY, weekly strongest Long 0.05 and weakest Short 0.05",
            "normalTurnoverBps": NORMAL_TURNOVER_BPS,
            "severeTurnoverBps": SEVERE_TURNOVER_BPS,
            "assumedV96Gross": ASSUMED_V96_GROSS,
            "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
            "retuningAllowed": False,
        },
        "directional": {"normal": directional_normal, "severe": directional_severe},
        "neutral": {"normal": neutral_normal, "severe": neutral_severe},
        "coverage": coverage,
        "safety": {
            "mode": "SHADOW",
            "orderSubmissionAllowed": False,
            "v96WeightsMutable": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
        },
        "limitations": [
            "The window contains only about five U.S. regular sessions.",
            "Completed next-open holding intervals are fewer than the number of sessions.",
            "Current-listing survivorship bias remains.",
            "Observed microstructure is reported separately and is not used to retune or select thresholds.",
            "No result from this report can approve profitability, robustness, or Production.",
        ],
    }
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "status": status,
        "directionalNormal": directional_normal["metrics"]["compoundedReturnPct"],
        "directionalSevere": directional_severe["metrics"]["compoundedReturnPct"],
        "neutralNormal": neutral_normal["metrics"]["compoundedReturnPct"],
        "neutralSevere": neutral_severe["metrics"]["compoundedReturnPct"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
