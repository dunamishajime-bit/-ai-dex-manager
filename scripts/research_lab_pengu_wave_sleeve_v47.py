from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, List, Optional

ASTER_BASE = "https://fapi.asterdex.com"
HOUR = 3_600_000
DAY = 24 * HOUR
START = 1704067200000
DECISION_HOURS = 3
BASE_COST_PCT = 0.14
SEVERE_COST_PCT = 0.28


@dataclass(frozen=True)
class Candidate:
    family: str
    side: int
    lookback: int
    mom3: float
    mom6: float
    volume_floor: float
    range_expansion: float
    hold_hours: int
    stop_atr: float
    trail_atr: float
    cooldown_hours: int = 6

    @property
    def candidate_id(self) -> str:
        side = "L" if self.side > 0 else "S"
        return (
            f"{side}_{self.family}_LB{self.lookback}_M3{self.mom3:g}_M6{self.mom6:g}"
            f"_V{self.volume_floor:g}_R{self.range_expansion:g}_H{self.hold_hours}"
            f"_SL{self.stop_atr:g}_TR{self.trail_atr:g}_CD{self.cooldown_hours}"
        ).replace(".", "p")


@dataclass
class Trade:
    candidate_id: str
    signal_ts: int
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    gross_pct: float
    funding_pct: float
    base_pct: float
    severe_pct: float
    exit_reason: str


def fetch_json(path: str, params: dict, timeout: int = 40):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{ASTER_BASE}{path}?{query}",
        headers={"User-Agent": "DisDex-PENGU-Wave-Sleeve-V47/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_klines(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    empty = 0
    while cursor < end:
        payload = fetch_json("/fapi/v1/klines", {
            "symbol": symbol,
            "interval": "1h",
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected kline payload for {symbol}")
        if not payload:
            cursor += 30 * DAY
            empty += 1
            if empty > 24:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, list) and len(item) >= 7:
                rows.append({
                    "ts": int(item[0]),
                    "open": float(item[1]),
                    "high": float(item[2]),
                    "low": float(item[3]),
                    "close": float(item[4]),
                    "volume": float(item[5]),
                    "closeTime": int(item[6]),
                })
        next_cursor = int(payload[-1][0]) + HOUR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows if START <= int(row["ts"]) < end}
    return [unique[key] for key in sorted(unique)]


def fetch_funding(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    empty = 0
    while cursor < end:
        payload = fetch_json("/fapi/v3/fundingRate", {
            "symbol": symbol,
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1000,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected funding payload for {symbol}")
        if not payload:
            cursor += 90 * DAY
            empty += 1
            if empty > 12:
                break
            continue
        empty = 0
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingTime", 0) or 0)
                rate = float(item.get("fundingRate", 0) or 0)
                if START <= ts < end:
                    rows.append({"ts": ts, "rate": rate})
        next_cursor = int(payload[-1].get("fundingTime", 0) or 0) + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def rolling_mean(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= length:
            total -= values[index - length]
        if index >= length - 1:
            result[index] = total / length
    return result


def momentum(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length, len(values)):
        prior = values[index - length]
        if prior > 0:
            result[index] = (values[index] / prior - 1.0) * 100.0
    return result


def true_range(rows: List[dict]) -> List[float]:
    result = [float(rows[0]["high"]) - float(rows[0]["low"])]
    for index in range(1, len(rows)):
        previous = float(rows[index - 1]["close"])
        high = float(rows[index]["high"])
        low = float(rows[index]["low"])
        result.append(max(high - low, abs(high - previous), abs(low - previous)))
    return result


def volume_ratio(volumes: List[float], recent: int = 6, base: int = 72) -> List[Optional[float]]:
    recent_mean = rolling_mean(volumes, recent)
    base_mean = rolling_mean(volumes, base)
    result: List[Optional[float]] = [None] * len(volumes)
    for index in range(len(volumes)):
        if recent_mean[index] is not None and base_mean[index] and base_mean[index] > 0:
            result[index] = recent_mean[index] / base_mean[index]
    return result


def latest_funding(points: List[dict], ts: int) -> Optional[float]:
    value: Optional[float] = None
    for point in points:
        if int(point["ts"]) > ts:
            break
        value = float(point["rate"])
    return value


def funding_between(points: List[dict], start: int, end: int) -> float:
    return sum(float(point["rate"]) * 100.0 for point in points if start <= int(point["ts"]) < end)


def candidate_space() -> List[Candidate]:
    result: List[Candidate] = []
    for side, family, lookback, mom3, mom6, volume_floor, range_expansion, hold_hours, stop_atr, trail_atr in itertools.product(
        (1, -1),
        ("BREAK", "IMPULSE"),
        (12, 24, 48),
        (1.5, 3.0),
        (3.0, 5.0),
        (1.0, 1.5),
        (1.0, 1.5),
        (12, 24, 48),
        (1.5, 2.5),
        (2.0, 3.5),
    ):
        result.append(Candidate(
            family=family,
            side=side,
            lookback=lookback,
            mom3=mom3,
            mom6=mom6,
            volume_floor=volume_floor,
            range_expansion=range_expansion,
            hold_hours=hold_hours,
            stop_atr=stop_atr,
            trail_atr=trail_atr,
        ))
    return result


def prepare_features(rows: List[dict], btc: List[dict]) -> dict:
    close = [float(row["close"]) for row in rows]
    volume = [float(row["volume"]) for row in rows]
    tr = true_range(rows)
    btc_close = [float(row["close"]) for row in btc]
    return {
        "mom3": momentum(close, 3),
        "mom6": momentum(close, 6),
        "volumeRatio": volume_ratio(volume, 6, 72),
        "atr24": rolling_mean(tr, 24),
        "range72": rolling_mean(tr, 72),
        "btcMom24": momentum(btc_close, 24),
        "btcSma168": rolling_mean(btc_close, 168),
        "btcClose": btc_close,
    }


def btc_risk_allows(side: int, features: dict, btc_index: int) -> bool:
    mom = features["btcMom24"][btc_index]
    sma = features["btcSma168"][btc_index]
    close = features["btcClose"][btc_index]
    if mom is None or sma is None:
        return False
    if side > 0:
        return not (close < sma and mom < -4.0)
    return not (close > sma and mom > 6.0)


def entry_signal(candidate: Candidate, rows: List[dict], index: int, features: dict, btc_index: int) -> bool:
    if index < max(200, candidate.lookback):
        return False
    m3 = features["mom3"][index]
    m6 = features["mom6"][index]
    vr = features["volumeRatio"][index]
    atr = features["atr24"][index]
    baseline = features["range72"][index]
    if m3 is None or m6 is None or vr is None or atr is None or baseline is None or baseline <= 0:
        return False
    if candidate.side * m3 < candidate.mom3 or candidate.side * m6 < candidate.mom6:
        return False
    if vr < candidate.volume_floor:
        return False
    current_range = float(rows[index]["high"]) - float(rows[index]["low"])
    if current_range / baseline < candidate.range_expansion:
        return False
    close = float(rows[index]["close"])
    if candidate.family == "BREAK":
        prior = rows[index - candidate.lookback:index]
        boundary = max(float(row["high"]) for row in prior) if candidate.side > 0 else min(float(row["low"]) for row in prior)
        if candidate.side > 0 and close <= boundary:
            return False
        if candidate.side < 0 and close >= boundary:
            return False
    else:
        previous = float(rows[index - 1]["close"])
        if candidate.side > 0 and close <= previous:
            return False
        if candidate.side < 0 and close >= previous:
            return False
    return btc_risk_allows(candidate.side, features, btc_index)


def run_candidate(candidate: Candidate, rows: List[dict], btc: List[dict], funding: List[dict], features: dict) -> List[Trade]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[Trade] = []
    next_free_ts = 0
    for index in range(200, len(rows) - 2):
        ts = int(rows[index]["ts"])
        if ts < next_free_ts or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None or not entry_signal(candidate, rows, index, features, btc_index):
            continue
        funding_now = latest_funding(funding, int(rows[index]["closeTime"]))
        if candidate.side > 0 and (funding_now is None or funding_now > 0.0015):
            continue
        entry_index = index + 1
        entry_ts = int(rows[entry_index]["ts"])
        entry_price = float(rows[entry_index]["open"])
        atr = features["atr24"][index]
        if atr is None or atr <= 0:
            continue
        fixed_stop = entry_price - candidate.side * candidate.stop_atr * atr
        best_price = entry_price
        maximum_exit_index = min(entry_index + candidate.hold_hours, len(rows) - 1)
        exit_index = maximum_exit_index
        exit_price = float(rows[exit_index]["close"])
        exit_reason = "TIME"
        for cursor in range(entry_index, maximum_exit_index + 1):
            high = float(rows[cursor]["high"])
            low = float(rows[cursor]["low"])
            if candidate.side > 0:
                best_price = max(best_price, high)
                active_stop = max(fixed_stop, best_price - candidate.trail_atr * atr)
                if low <= active_stop:
                    exit_index = cursor
                    exit_price = active_stop
                    exit_reason = "TRAIL_OR_STOP"
                    break
            else:
                best_price = min(best_price, low)
                active_stop = min(fixed_stop, best_price + candidate.trail_atr * atr)
                if high >= active_stop:
                    exit_index = cursor
                    exit_price = active_stop
                    exit_reason = "TRAIL_OR_STOP"
                    break
        exit_ts = int(rows[exit_index]["ts"]) + HOUR
        gross_pct = candidate.side * (exit_price / entry_price - 1.0) * 100.0
        paid_funding = candidate.side * funding_between(funding, entry_ts, exit_ts)
        trades.append(Trade(
            candidate_id=candidate.candidate_id,
            signal_ts=ts,
            entry_ts=entry_ts,
            exit_ts=exit_ts,
            side=candidate.side,
            entry_price=entry_price,
            exit_price=exit_price,
            gross_pct=gross_pct,
            funding_pct=paid_funding,
            base_pct=gross_pct - paid_funding - BASE_COST_PCT,
            severe_pct=gross_pct - paid_funding - SEVERE_COST_PCT,
            exit_reason=exit_reason,
        ))
        next_free_ts = exit_ts + candidate.cooldown_hours * HOUR
    return trades


def split_bounds(rows: List[dict]) -> tuple[int, int, int, int]:
    start = int(rows[0]["ts"])
    end = int(rows[-1]["ts"]) + HOUR
    span = end - start
    return start, start + span // 2, start + span * 3 // 4, end


def metrics(trades: Iterable[Trade], start: int, end: int, severe: bool = False) -> dict:
    active = [trade for trade in trades if start <= trade.entry_ts and trade.exit_ts <= end]
    equity = peak = 1.0
    max_dd = 0.0
    values: List[float] = []
    for trade in active:
        value = (trade.severe_pct if severe else trade.base_pct) / 100.0
        values.append(value)
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    gains = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    return {
        "trades": len(active),
        "longTrades": sum(trade.side > 0 for trade in active),
        "shortTrades": sum(trade.side < 0 for trade in active),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "profitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "winRatePct": sum(value > 0 for value in values) / len(values) * 100.0 if values else None,
        "maxDrawdownPct": max_dd * 100.0,
        "averageTradePct": statistics.fmean(values) * 100.0 if values else None,
    }


def wave_events(rows: List[dict], horizon_hours: int, threshold_pct: float) -> List[dict]:
    candidates = []
    for index in range(200, len(rows) - horizon_hours - 1):
        if (int(rows[index]["ts"]) // HOUR) % DECISION_HOURS != 0:
            continue
        start_index = index + 1
        end_index = start_index + horizon_hours
        start_price = float(rows[start_index]["open"])
        end_price = float(rows[end_index]["open"])
        move = (end_price / start_price - 1.0) * 100.0
        if abs(move) >= threshold_pct:
            candidates.append({
                "startTs": int(rows[start_index]["ts"]),
                "endTs": int(rows[end_index]["ts"]),
                "side": 1 if move > 0 else -1,
                "movePct": move,
            })
    events: List[dict] = []
    for item in candidates:
        if events and events[-1]["side"] == item["side"] and item["startTs"] <= events[-1]["endTs"]:
            events[-1]["endTs"] = max(events[-1]["endTs"], item["endTs"])
            if abs(item["movePct"]) > abs(events[-1]["maxMovePct"]):
                events[-1]["maxMovePct"] = item["movePct"]
                events[-1]["peakWindowStartTs"] = item["startTs"]
        else:
            events.append({
                "startTs": item["startTs"],
                "endTs": item["endTs"],
                "side": item["side"],
                "maxMovePct": item["movePct"],
                "peakWindowStartTs": item["startTs"],
            })
    return events


def capture_metrics(trades: List[Trade], events: List[dict], early_hours: int) -> dict:
    details = []
    for event in events:
        matching = [
            trade for trade in trades
            if trade.side == event["side"] and event["startTs"] <= trade.entry_ts <= event["endTs"]
        ]
        early = [trade for trade in matching if trade.entry_ts <= event["startTs"] + early_hours * HOUR]
        details.append({
            **event,
            "captured": bool(matching),
            "earlyCaptured": bool(early),
            "profitableCaptured": any(trade.base_pct > 0 for trade in matching),
            "matchingTrades": len(matching),
            "tradeEntries": [trade.entry_ts for trade in matching],
            "tradeReturnsPct": [trade.base_pct for trade in matching],
        })
    return {
        "events": len(details),
        "capturedEvents": sum(item["captured"] for item in details),
        "earlyCapturedEvents": sum(item["earlyCaptured"] for item in details),
        "profitableCapturedEvents": sum(item["profitableCaptured"] for item in details),
        "captureRatePct": sum(item["captured"] for item in details) / len(details) * 100.0 if details else None,
        "earlyCaptureRatePct": sum(item["earlyCaptured"] for item in details) / len(details) * 100.0 if details else None,
        "details": details,
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


def gate(item: dict, prefix: str, minimum_trades: int) -> bool:
    normal = item[prefix]
    severe = item[f"{prefix}Severe"]
    return bool(
        normal["trades"] >= minimum_trades
        and normal["compoundedReturnPct"] > 0
        and (normal["profitFactor"] or 0) >= 1.10
        and normal["maxDrawdownPct"] >= -25
        and severe["compoundedReturnPct"] > -5
    )


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history")
    pengu = fetch_klines("PENGUUSDT", now_end)
    btc = fetch_klines("BTCUSDT", now_end)
    funding = fetch_funding("PENGUUSDT", now_end)
    if len(pengu) < 3000 or len(btc) < 3000:
        raise RuntimeError("Insufficient history")
    features = prepare_features(pengu, btc)
    start, dev_end, validation_end, end = split_bounds(pengu)
    wave24 = wave_events(pengu, 24, 20.0)
    wave72 = wave_events(pengu, 72, 35.0)
    candidates = candidate_space()
    results = {}

    for position, candidate in enumerate(candidates, start=1):
        if position % 500 == 0:
            print(f"Evaluated {position}/{len(candidates)} candidates")
        trades = run_candidate(candidate, pengu, btc, funding, features)
        split_trades = {
            "development": [trade for trade in trades if start <= trade.entry_ts < dev_end],
            "validation": [trade for trade in trades if dev_end <= trade.entry_ts < validation_end],
            "holdout": [trade for trade in trades if validation_end <= trade.entry_ts < end],
        }
        item = {
            "candidate": asdict(candidate),
            "development": metrics(trades, start, dev_end),
            "developmentSevere": metrics(trades, start, dev_end, True),
            "validation": metrics(trades, dev_end, validation_end),
            "validationSevere": metrics(trades, dev_end, validation_end, True),
            "holdout": metrics(trades, validation_end, end),
            "holdoutSevere": metrics(trades, validation_end, end, True),
            "full": metrics(trades, start, end),
            "fullSevere": metrics(trades, start, end, True),
            "developmentWave24": capture_metrics(split_trades["development"], [event for event in wave24 if start <= event["startTs"] < dev_end], 12),
            "developmentWave72": capture_metrics(split_trades["development"], [event for event in wave72 if start <= event["startTs"] < dev_end], 24),
            "validationWave24": capture_metrics(split_trades["validation"], [event for event in wave24 if dev_end <= event["startTs"] < validation_end], 12),
            "validationWave72": capture_metrics(split_trades["validation"], [event for event in wave72 if dev_end <= event["startTs"] < validation_end], 24),
            "holdoutWave24": capture_metrics(split_trades["holdout"], [event for event in wave24 if validation_end <= event["startTs"] < end], 12),
            "holdoutWave72": capture_metrics(split_trades["holdout"], [event for event in wave72 if validation_end <= event["startTs"] < end], 24),
            "fullWave24": capture_metrics(trades, wave24, 12),
            "fullWave72": capture_metrics(trades, wave72, 24),
            "trades": [asdict(trade) for trade in trades],
        }
        results[candidate.candidate_id] = item

    development_passed = [
        key for key, item in results.items()
        if gate(item, "development", 6)
        and item["developmentWave24"]["capturedEvents"] + item["developmentWave72"]["capturedEvents"] >= 1
    ]
    validation_passed = [key for key in development_passed if gate(results[key], "validation", 2)]
    validation_passed.sort(key=lambda key: (
        results[key]["validationWave24"]["earlyCapturedEvents"] + results[key]["validationWave72"]["earlyCapturedEvents"],
        results[key]["validationWave24"]["capturedEvents"] + results[key]["validationWave72"]["capturedEvents"],
        results[key]["validation"]["compoundedReturnPct"],
        results[key]["developmentWave24"]["capturedEvents"] + results[key]["developmentWave72"]["capturedEvents"],
        results[key]["development"]["compoundedReturnPct"],
    ), reverse=True)
    selected = validation_passed[0] if validation_passed else None
    selected_item = results[selected] if selected else None

    result = rounded({
        "version": 47,
        "strategyId": "PENGU_WAVE_SLEEVE_V47_RESEARCH",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "CANDIDATE_FOUND" if selected else "NO_ROBUST_WAVE_CANDIDATE",
        "basePr": 42,
        "baseCommit": "ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "selected": selected,
        "period": {
            "start": iso(start),
            "developmentEnd": iso(dev_end),
            "validationEnd": iso(validation_end),
            "end": iso(end),
        },
        "candidateCount": len(candidates),
        "developmentPassedCount": len(development_passed),
        "validationPassedCount": len(validation_passed),
        "developmentPassed": development_passed,
        "validationPassed": validation_passed,
        "selectedResult": selected_item,
        "largeWaveEventCounts": {"wave24h20pct": len(wave24), "wave72h35pct": len(wave72)},
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
        "limitations": [
            "Research-only Wave Sleeve; not integrated into the live runner.",
            "Chronological 50/25/25 split; holdout is reported only after development and validation selection.",
            "Next-open execution, V3 funding, base and severe costs, same-bar stop conservatism.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v47.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V47 Research",
        "",
        f"- Status: **{result['status']}**",
        f"- Base: PR #42 / `{result['baseCommit']}`",
        f"- Candidates: {result['candidateCount']}",
        f"- Development passed: {result['developmentPassedCount']}",
        f"- Validation passed: {result['validationPassedCount']}",
        f"- Selected: **{selected or 'NONE'}**",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    if selected_item:
        report.extend([
            "",
            "## Selected metrics",
            "",
            f"- Development: {selected_item['development']['compoundedReturnPct']}% / PF {selected_item['development']['profitFactor']} / DD {selected_item['development']['maxDrawdownPct']}% / N {selected_item['development']['trades']}",
            f"- Validation: {selected_item['validation']['compoundedReturnPct']}% / PF {selected_item['validation']['profitFactor']} / DD {selected_item['validation']['maxDrawdownPct']}% / N {selected_item['validation']['trades']}",
            f"- Holdout: {selected_item['holdout']['compoundedReturnPct']}% / PF {selected_item['holdout']['profitFactor']} / DD {selected_item['holdout']['maxDrawdownPct']}% / N {selected_item['holdout']['trades']}",
            f"- Full: {selected_item['full']['compoundedReturnPct']}% / PF {selected_item['full']['profitFactor']} / DD {selected_item['full']['maxDrawdownPct']}% / N {selected_item['full']['trades']}",
            f"- Full 24h waves: {selected_item['fullWave24']['capturedEvents']}/{selected_item['fullWave24']['events']} captured; early {selected_item['fullWave24']['earlyCapturedEvents']}/{selected_item['fullWave24']['events']}",
            f"- Full 72h waves: {selected_item['fullWave72']['capturedEvents']}/{selected_item['fullWave72']['events']} captured; early {selected_item['fullWave72']['earlyCapturedEvents']}/{selected_item['fullWave72']['events']}",
        ])
    (state_dir / "pengu-wave-sleeve-v47.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
