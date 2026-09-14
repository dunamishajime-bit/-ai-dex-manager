from __future__ import annotations

import datetime as dt
import json
import os
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_asymmetric_return_stack_v32 as v32
import research_lab_resilient_profit_stack_v34 as v34

ASTER_BASE = "https://fapi.asterdex.com"
HOUR = 3_600_000
DAY = 24 * HOUR
CORE_START = v4.START_2023
CORE_DEV_END = v4.START_2026
CORE_END = v4.END
PENGU_GROSS = 2.0
DECISION_HOURS = 6


@dataclass(frozen=True)
class CoreConfig:
    strong_mult: float = 1.40
    normal_mult: float = 1.20
    brake_mult: float = 0.35
    gross_cap: float = 2.0


@dataclass
class Trade:
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    gross_pct: float
    funding_pct: float
    base_pct: float
    severe_pct: float
    signal_ts: int


def fetch_json(path: str, params: dict, timeout: int = 40):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{ASTER_BASE}{path}?{query}",
        headers={"User-Agent": "DisDex-V35-PENGU-V46-Gross2-BT/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_klines(pair: str, start: int, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = start
    empty = 0
    while cursor < end:
        payload = fetch_json("/fapi/v1/klines", {
            "symbol": pair, "interval": "1h", "startTime": cursor,
            "endTime": end - 1, "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected kline payload for {pair}")
        if not payload:
            cursor += 30 * DAY
            empty += 1
            if empty > 24:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, list) and len(item) >= 6:
                rows.append({
                    "ts": int(item[0]), "open": float(item[1]),
                    "high": float(item[2]), "low": float(item[3]),
                    "close": float(item[4]), "volume": float(item[5]),
                })
        next_cursor = int(payload[-1][0]) + HOUR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows if start <= int(row["ts"]) < end}
    result = [unique[key] for key in sorted(unique)]
    if len(result) < 1000:
        raise RuntimeError(f"Insufficient candles for {pair}: {len(result)}")
    return result


def fetch_funding(pair: str, start: int, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = start
    empty = 0
    while cursor < end:
        params = {"symbol": pair, "startTime": cursor, "endTime": end - 1, "limit": 1000}
        try:
            payload = fetch_json("/fapi/v3/fundingRate", params)
        except Exception:
            payload = fetch_json("/fapi/v1/fundingRate", params)
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected funding payload for {pair}")
        if not payload:
            cursor += 90 * DAY
            empty += 1
            if empty > 12:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingTime", item.get("time", 0)) or 0)
                rate = float(item.get("fundingRate", item.get("rate", 0)) or 0)
                if start <= ts < end:
                    rows.append({"ts": ts, "rate": rate})
        last = payload[-1]
        next_cursor = int(last.get("fundingTime", last.get("time", 0)) or 0) + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def load_aster_symbol(_cache_root: Path, symbol: str) -> dict:
    pair = f"{symbol}USDT"
    print(f"Fetching Aster core history for {pair}")
    return {
        "symbol": pair,
        "candles": fetch_klines(pair, v4.DATA_START, CORE_END),
        "funding": fetch_funding(pair, v4.DATA_START, CORE_END),
    }


def rolling_mean(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= length:
            running -= values[index - length]
        if index >= length - 1:
            result[index] = running / length
    return result


def momentum(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        prior = values[index - length]
        if prior > 0:
            result[index] = (values[index] / prior - 1.0) * 100.0
    return result


def rsi(values: List[float], length: int = 14) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    gains = [0.0] * len(values)
    losses = [0.0] * len(values)
    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gains[index] = max(change, 0.0)
        losses[index] = max(-change, 0.0)
    gain_sum = loss_sum = 0.0
    for index in range(1, len(values)):
        gain_sum += gains[index]
        loss_sum += losses[index]
        if index > length:
            gain_sum -= gains[index - length]
            loss_sum -= losses[index - length]
        if index >= length:
            if loss_sum <= 0:
                result[index] = 100.0 if gain_sum > 0 else 50.0
            else:
                rs = gain_sum / loss_sum
                result[index] = 100.0 - 100.0 / (1.0 + rs)
    return result


def volume_ratio(values: List[float], recent: int = 12, base: int = 72) -> List[Optional[float]]:
    recent_mean = rolling_mean(values, recent)
    base_mean = rolling_mean(values, base)
    result: List[Optional[float]] = [None] * len(values)
    for index in range(len(values)):
        if recent_mean[index] is not None and base_mean[index] and base_mean[index] > 0:
            result[index] = recent_mean[index] / base_mean[index]
    return result


def latest_funding(points: List[dict], ts: int) -> Optional[float]:
    latest: Optional[float] = None
    for row in points:
        if int(row["ts"]) > ts:
            break
        latest = float(row["rate"])
    return latest


def funding_between(points: List[dict], start: int, end: int) -> float:
    return sum(float(row["rate"]) * 100.0 for row in points if start <= int(row["ts"]) < end)


def btc_risk(side: int, close: float, sma168: Optional[float], mom72: Optional[float]) -> bool:
    if sma168 is None or mom72 is None:
        return False
    if side > 0:
        return not (close < sma168 and mom72 < -2.0)
    return not (close > sma168 and mom72 > 4.0)


def build_pengu_trades(pengu: List[dict], btc: List[dict], funding: List[dict]) -> List[Trade]:
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    common = sorted(set(p_map) & set(b_map))
    p_close = [float(row["close"]) for row in pengu]
    p_volume = [float(row["volume"]) for row in pengu]
    b_close = [float(row["close"]) for row in btc]
    p_sma72 = rolling_mean(p_close, 72)
    p_sma168 = rolling_mean(p_close, 168)
    b_sma168 = rolling_mean(b_close, 168)
    p_mom6 = momentum(p_close, 6)
    p_mom24 = momentum(p_close, 24)
    p_mom48 = momentum(p_close, 48)
    p_mom120 = momentum(p_close, 120)
    b_mom48 = momentum(b_close, 48)
    b_mom72 = momentum(b_close, 72)
    b_mom120 = momentum(b_close, 120)
    p_rsi14 = rsi(p_close, 14)
    p_vol_ratio = volume_ratio(p_volume, 12, 72)
    trades: List[Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        if pi < 220 or bi < 220 or pi + 25 >= len(pengu):
            continue
        p_now = p_close[pi]
        b_now = b_close[bi]
        vol = p_vol_ratio[pi]
        if vol is None or vol < 0.8:
            continue
        prior_lows = [float(row["low"]) for row in pengu[pi - 24:pi]]
        short_signal = bool(
            prior_lows and p_mom6[pi] is not None
            and p_now < min(prior_lows) and p_mom6[pi] < 0.0
            and btc_risk(-1, b_now, b_sma168[bi], b_mom72[bi])
        )
        decision_close_ts = ts + HOUR - 1
        funding_now = latest_funding(funding, decision_close_ts)
        slope_index = pi - 48
        prior_mom_index = pi - 12
        long_signal = bool(
            not short_signal and funding_now is not None and funding_now <= 0.0003
            and p_sma72[pi] is not None and p_sma168[pi] is not None
            and slope_index >= 0 and p_sma168[slope_index] is not None
            and p_mom6[pi] is not None and prior_mom_index >= 0
            and p_mom6[prior_mom_index] is not None
            and p_mom24[pi] is not None and p_mom48[pi] is not None
            and p_mom120[pi] is not None and b_mom48[bi] is not None
            and b_mom120[bi] is not None and p_rsi14[pi] is not None
            and p_now > p_sma72[pi] and p_now > p_sma168[pi]
            and p_sma168[pi] > p_sma168[slope_index]
            and p_mom6[pi] > 1.0 and p_mom6[prior_mom_index] <= 0.0
            and p_mom24[pi] > 0.0 and p_mom120[pi] > 2.0
            and p_mom48[pi] - b_mom48[bi] > 1.0
            and p_mom120[pi] - b_mom120[bi] > 0.0
            and 45.0 <= p_rsi14[pi] <= 72.0
            and btc_risk(1, b_now, b_sma168[bi], b_mom72[bi])
        )
        side = -1 if short_signal else 1 if long_signal else 0
        if side == 0:
            continue
        entry_index = pi + 1
        exit_index = entry_index + 24
        entry_ts = int(pengu[entry_index]["ts"])
        exit_ts = int(pengu[exit_index]["ts"])
        entry_price = float(pengu[entry_index]["open"])
        exit_price = float(pengu[exit_index]["open"])
        gross_pct = side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = side * funding_between(funding, entry_ts, exit_ts)
        base_pct = gross_pct - paid_funding - 0.12 - 0.02
        severe_pct = gross_pct - paid_funding - 0.20 - 0.05
        trades.append(Trade(entry_ts, exit_ts, side, entry_price, exit_price,
                            gross_pct, paid_funding, base_pct, severe_pct, ts))
        next_free = exit_ts
    return trades


def core_rows(config: CoreConfig, times, core, features) -> List[dict]:
    rows = []
    equity = peak = 1.0
    for ts in times:
        c = core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        f = features.get(ts, {})
        core_weight = 1.0
        if c["regime"] > 0:
            strong = (f.get("closeAboveSma20", False)
                      and float(f.get("mom20", 0.0)) >= 10.0
                      and float(f.get("mom3", 0.0)) > 0.0)
            brake = (float(f.get("shock", 0.0)) <= -4.0
                     or float(f.get("skew", 1.0)) > 1.35
                     or not f.get("closeAboveSma20", False))
            core_weight = config.brake_mult if brake else config.strong_mult if strong else config.normal_mult
        raw_gross = c["exposure"] * core_weight
        cap_scale = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
        value = c["return"] * core_weight * cap_scale
        rows.append({"ts": ts, "return": value, "gross": raw_gross * cap_scale})
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    return rows


def pengu_12h_series(rows: List[dict], funding: List[dict], trades: List[Trade], gross: float) -> Dict[int, dict]:
    grouped: Dict[int, List[dict]] = {}
    funding_by_hour: Dict[int, float] = {}
    for point in funding:
        hour = int(point["ts"]) // HOUR * HOUR
        funding_by_hour[hour] = funding_by_hour.get(hour, 0.0) + float(point["rate"])
    for candle in sorted(rows, key=lambda row: int(row["ts"])):
        ts = int(candle["ts"])
        active = next((trade for trade in trades if trade.entry_ts <= ts < trade.exit_ts), None)
        base = severe = exposure = 0.0
        if active:
            side = active.side
            raw = side * (float(candle["close"]) / float(candle["open"]) - 1.0)
            funding_cost = side * funding_by_hour.get(ts, 0.0)
            base_full = raw - funding_cost - 0.0002 / 24.0
            severe_full = raw - funding_cost - 0.0005 / 24.0
            if ts == active.entry_ts:
                base_full -= 0.0006
                severe_full -= 0.0010
            if ts + HOUR == active.exit_ts:
                base_full -= 0.0006
                severe_full -= 0.0010
            base = base_full * gross
            severe = severe_full * gross
            exposure = gross
        bucket = ts // (12 * HOUR) * (12 * HOUR)
        grouped.setdefault(bucket, []).append({"base": base, "severe": severe, "exposure": exposure})
    result: Dict[int, dict] = {}
    for ts, items in grouped.items():
        base_eq = severe_eq = 1.0
        for item in items:
            base_eq *= max(0.001, 1.0 + item["base"])
            severe_eq *= max(0.001, 1.0 + item["severe"])
        result[ts] = {
            "base": base_eq - 1.0, "severe": severe_eq - 1.0,
            "maxExposure": max((item["exposure"] for item in items), default=0.0),
            "averageExposure": statistics.fmean(item["exposure"] for item in items) if items else 0.0,
        }
    return result


def combine_rows(core: List[dict], pengu: Dict[int, dict], severe: bool = False) -> List[dict]:
    result = []
    for row in core:
        p = pengu.get(int(row["ts"]), {"base": 0.0, "severe": 0.0,
                                           "maxExposure": 0.0, "averageExposure": 0.0})
        result.append({
            "ts": int(row["ts"]),
            "return": float(row["return"]) + float(p["severe" if severe else "base"]),
            "gross": float(row["gross"]) + float(p["averageExposure"]),
            "maxGross": float(row["gross"]) + float(p["maxExposure"]),
        })
    return result


def metrics_with_observed_gross(rows: List[dict], start: int, end: int) -> dict:
    metrics = v32.metrics(rows, start, end)
    active = [row for row in rows if start <= int(row["ts"]) < end]
    metrics["observedMaxConcurrentGross"] = max(
        (float(row.get("maxGross", row["gross"])) for row in active), default=0.0)
    return metrics


def trade_metrics(trades: List[Trade], start: int, end: int, gross: float, severe: bool = False) -> dict:
    active = [trade for trade in trades if start <= trade.entry_ts and trade.exit_ts < end]
    equity = peak = 1.0
    max_dd = 0.0
    values = []
    for trade in active:
        value = (trade.severe_pct if severe else trade.base_pct) / 100.0 * gross
        values.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    wins = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    return {
        "trades": len(active), "longTrades": sum(t.side > 0 for t in active),
        "shortTrades": sum(t.side < 0 for t in active),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": wins / losses if losses > 0 else 999.0 if wins > 0 else None,
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
    }


def wave_events(rows: List[dict], horizon_hours: int, threshold_pct: float) -> List[dict]:
    candidates = []
    for index in range(220, len(rows) - horizon_hours - 1):
        ts = int(rows[index]["ts"])
        if (ts // HOUR) % DECISION_HOURS != 0:
            continue
        entry_index = index + 1
        exit_index = entry_index + horizon_hours
        start_price = float(rows[entry_index]["open"])
        end_price = float(rows[exit_index]["open"])
        move = (end_price / start_price - 1.0) * 100.0
        if abs(move) >= threshold_pct:
            candidates.append({"startTs": int(rows[entry_index]["ts"]),
                               "endTs": int(rows[exit_index]["ts"]),
                               "side": 1 if move > 0 else -1, "movePct": move})
    events: List[dict] = []
    for item in candidates:
        if events and events[-1]["side"] == item["side"] and item["startTs"] <= events[-1]["endTs"]:
            events[-1]["endTs"] = max(events[-1]["endTs"], item["endTs"])
            if abs(item["movePct"]) > abs(events[-1]["maxMovePct"]):
                events[-1]["maxMovePct"] = item["movePct"]
                events[-1]["peakWindowStartTs"] = item["startTs"]
        else:
            events.append({"startTs": item["startTs"], "endTs": item["endTs"],
                           "side": item["side"], "maxMovePct": item["movePct"],
                           "peakWindowStartTs": item["startTs"]})
    return events


def audit_waves(rows: List[dict], trades: List[Trade], horizon: int, threshold: float) -> dict:
    events = wave_events(rows, horizon, threshold)
    early_hours = 12 if horizon <= 24 else 24
    details = []
    for event in events:
        matching = [t for t in trades if t.side == event["side"]
                    and event["startTs"] <= t.entry_ts <= event["endTs"]]
        early = [t for t in matching if t.entry_ts <= event["startTs"] + early_hours * HOUR]
        positive = [t for t in matching if t.base_pct > 0]
        captured_gross = sum(max(0.0, t.gross_pct) for t in matching)
        details.append({
            **event, "captured": bool(matching), "earlyCaptured": bool(early),
            "profitableCaptured": bool(positive), "matchingTrades": len(matching),
            "capturedGrossPct": captured_gross,
            "captureRatioPct": captured_gross / abs(event["maxMovePct"]) * 100.0 if event["maxMovePct"] else 0.0,
            "tradeEntries": [t.entry_ts for t in matching],
            "tradeBasePct": [t.base_pct for t in matching],
        })
    magnitude = sum(abs(item["maxMovePct"]) for item in details)
    captured_magnitude = sum(abs(item["maxMovePct"]) for item in details if item["captured"])
    return {
        "definition": f"Non-overlapping clustered {horizon}h windows with absolute move >= {threshold}%",
        "events": len(details), "capturedEvents": sum(item["captured"] for item in details),
        "earlyCapturedEvents": sum(item["earlyCaptured"] for item in details),
        "profitableCapturedEvents": sum(item["profitableCaptured"] for item in details),
        "eventCaptureRatePct": sum(item["captured"] for item in details) / len(details) * 100.0 if details else None,
        "earlyCaptureRatePct": sum(item["earlyCaptured"] for item in details) / len(details) * 100.0 if details else None,
        "magnitudeWeightedCapturePct": captured_magnitude / magnitude * 100.0 if magnitude else None,
        "details": sorted(details, key=lambda item: abs(item["maxMovePct"]), reverse=True),
    }


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    v4.load_symbol = load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
               for symbol, rows in bars.items()}
    core_funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if CORE_START <= int(row["ts"]) < CORE_END]
    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    targets = v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, core_funding)
    base_core = v32.core_series(targets, times, bars, indexes, core_funding, 10, 0, 0)
    severe_core = v32.core_series(targets, times, bars, indexes, core_funding, 50, 1, 3)
    features = v34.features_with_vol(times, targets, bars, indexes, core_funding)
    config = CoreConfig()
    base_core_rows = core_rows(config, times, base_core, features)
    severe_core_rows = core_rows(config, times, severe_core, features)
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    pengu_start = 1704067200000
    print("Fetching PENGU/BTC history for V46")
    pengu_rows = fetch_klines("PENGUUSDT", pengu_start, now_end)
    btc_rows = fetch_klines("BTCUSDT", pengu_start, now_end)
    pengu_funding = fetch_funding("PENGUUSDT", pengu_start, now_end)
    trades = build_pengu_trades(pengu_rows, btc_rows, pengu_funding)
    pengu_series = pengu_12h_series(pengu_rows, pengu_funding, trades, PENGU_GROSS)
    combined = combine_rows(base_core_rows, pengu_series, severe=False)
    combined_severe = combine_rows(severe_core_rows, pengu_series, severe=True)
    overlap_start = max(CORE_START, int(pengu_rows[0]["ts"]))
    overlap_end = min(CORE_END, int(pengu_rows[-1]["ts"]) + HOUR)
    full_trade_start = min((t.entry_ts for t in trades), default=overlap_start)
    full_trade_end = max((t.exit_ts for t in trades), default=overlap_end) + HOUR
    wave24 = audit_waves(pengu_rows, trades, 24, 20.0)
    wave72 = audit_waves(pengu_rows, trades, 72, 35.0)
    for audit in [wave24, wave72]:
        for detail in audit["details"]:
            detail["start"] = iso(detail["startTs"])
            detail["end"] = iso(detail["endTs"])
            detail["peakWindowStart"] = iso(detail["peakWindowStartTs"])
            detail["tradeEntryTimes"] = [iso(ts) for ts in detail.pop("tradeEntries")]
    result = rounded({
        "version": 1, "strategyId": "V35_CORE_PLUS_PENGU_V46_GROSS2_BT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "RESEARCH_ONLY",
        "assumptions": {"core": asdict(config), "penguGross": PENGU_GROSS,
            "totalGrossCapApplied": False,
            "reason": "User requested PENGU Gross 2.0 instead of 0.15; Core remains independently sized.",
            "fixedHistoricalPengu17TradesUsed": False, "shortPriority": True,
            "longFundingFailClosed": True, "shortFundingIndependent": True},
        "period": {"coreStart": iso(CORE_START), "coreEnd": iso(CORE_END),
            "penguDataStart": iso(int(pengu_rows[0]["ts"])),
            "penguDataEnd": iso(int(pengu_rows[-1]["ts"])),
            "combinedOverlapStart": iso(overlap_start), "combinedOverlapEnd": iso(overlap_end)},
        "core": {"full": v32.metrics(base_core_rows, CORE_START, CORE_END),
            "development": v32.metrics(base_core_rows, CORE_START, CORE_DEV_END),
            "reused2026H1": v32.metrics(base_core_rows, CORE_DEV_END, CORE_END),
            "severeFull": v32.metrics(severe_core_rows, CORE_START, CORE_END)},
        "pengu": {"tradeCount": len(trades), "trades": [asdict(t) for t in trades],
            "gross1Full": trade_metrics(trades, full_trade_start, full_trade_end, 1.0),
            "gross2Full": trade_metrics(trades, full_trade_start, full_trade_end, PENGU_GROSS),
            "gross2SevereFull": trade_metrics(trades, full_trade_start, full_trade_end, PENGU_GROSS, True),
            "gross2Overlap": trade_metrics(trades, overlap_start, overlap_end, PENGU_GROSS),
            "gross2OverlapSevere": trade_metrics(trades, overlap_start, overlap_end, PENGU_GROSS, True)},
        "combined": {"fullCorePeriod": metrics_with_observed_gross(combined, CORE_START, CORE_END),
            "development2023To2025": metrics_with_observed_gross(combined, CORE_START, CORE_DEV_END),
            "reused2026H1": metrics_with_observed_gross(combined, CORE_DEV_END, CORE_END),
            "severeFullCorePeriod": metrics_with_observed_gross(combined_severe, CORE_START, CORE_END),
            "severeReused2026H1": metrics_with_observed_gross(combined_severe, CORE_DEV_END, CORE_END),
            "theoreticalMaxGross": config.gross_cap + PENGU_GROSS},
        "largeWaveAudit": {"wave24h20pct": wave24, "wave72h35pct": wave72},
        "safety": {"productionChanged": False, "realTradingEnabled": False, "mode": "RESEARCH_ONLY"},
        "limitations": [
            "PENGU drawdown is marked hourly and combined on 12-hour buckets; this is stricter than exit-only trade DD.",
            "No total Gross cap is applied because the requested PENGU Gross is 2.0 while Core remains independently sized.",
            "The Core 2026H1 period is reused confirmation, not a pristine holdout.",
            "Large-wave definitions are fixed at >=20% over 24h and >=35% over 72h, clustered by overlapping same-direction windows."]})
    c = result["combined"]["fullCorePeriod"]
    cs = result["combined"]["severeFullCorePeriod"]
    p2 = result["pengu"]["gross2Full"]
    w24 = result["largeWaveAudit"]["wave24h20pct"]
    w72 = result["largeWaveAudit"]["wave72h35pct"]
    report = ["# V35 Core + PENGU V46 Gross 2.0 Backtest", "",
        "- Fixed historical PENGU 17 trades: **NOT USED**",
        "- V35 Core: Strong 1.40 / Normal 1.20 / Brake 0.35",
        "- PENGU V46 Gross: **2.0**",
        "- Total Gross cap: **NOT APPLIED** (theoretical max 4.0; observed shown below)",
        "- Short priority / Long funding fail-closed / Short funding-independent: YES", "",
        "## Results", "",
        f"- Core only full: {result['core']['full']['compoundedReturnPct']}% / CAGR {result['core']['full']['cagrPct']}% / DD {result['core']['full']['maxDrawdownPct']}%",
        f"- PENGU Gross 2.0 full: {p2['compoundedReturnPct']}% / PF {p2['profitFactor']} / DD {p2['maxDrawdownPct']}% / N {p2['trades']}",
        f"- Combined full Core period: {c['compoundedReturnPct']}% / CAGR {c['cagrPct']}% / DD {c['maxDrawdownPct']}%",
        f"- Combined Severe full: {cs['compoundedReturnPct']}% / CAGR {cs['cagrPct']}% / DD {cs['maxDrawdownPct']}%",
        f"- Observed max concurrent Gross: {c['observedMaxConcurrentGross']}", "",
        "## Large-wave capture", "",
        f"- 24h >=20% events: {w24['capturedEvents']}/{w24['events']} captured; early {w24['earlyCapturedEvents']}/{w24['events']}",
        f"- 72h >=35% events: {w72['capturedEvents']}/{w72['events']} captured; early {w72['earlyCapturedEvents']}/{w72['events']}", "",
        "- Production changed: NO", "- Real trading: DISABLED"]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-core-pengu-v46-gross2-bt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-core-pengu-v46-gross2-bt.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
