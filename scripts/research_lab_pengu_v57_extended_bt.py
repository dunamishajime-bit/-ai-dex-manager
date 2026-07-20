from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, replace
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52
import research_lab_pengu_wave_sleeve_v56 as v56
import research_lab_pengu_wave_sleeve_v57 as v57

HOUR = v47.HOUR
DAY = 24 * HOUR
BINANCE_BASE = "https://fapi.binance.com"
BINANCE_START = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)


def fetch_json(base: str, path: str, params: dict, timeout: int = 40):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{base}{path}?{query}",
        headers={"User-Agent": "DisDex-PENGU-V57-Extended-BT/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_binance_klines(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = BINANCE_START
    empty_windows = 0
    while cursor < end:
        payload = fetch_json(BINANCE_BASE, "/fapi/v1/klines", {
            "symbol": symbol,
            "interval": "1h",
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Binance kline payload for {symbol}")
        if not payload:
            cursor += 30 * DAY
            empty_windows += 1
            if empty_windows > 36:
                break
            continue
        empty_windows = 0
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
    unique = {
        int(row["ts"]): row
        for row in rows
        if BINANCE_START <= int(row["ts"]) < end and int(row["closeTime"]) < end
    }
    return [unique[key] for key in sorted(unique)]


def fetch_binance_funding(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = BINANCE_START
    empty_windows = 0
    while cursor < end:
        payload = fetch_json(BINANCE_BASE, "/fapi/v1/fundingRate", {
            "symbol": symbol,
            "startTime": cursor,
            "endTime": end - 1,
            "limit": 1000,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Binance funding payload for {symbol}")
        if not payload:
            cursor += 90 * DAY
            empty_windows += 1
            if empty_windows > 12:
                break
            continue
        empty_windows = 0
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingTime", 0) or 0)
                if BINANCE_START <= ts < end:
                    rows.append({"ts": ts, "rate": float(item.get("fundingRate", 0) or 0)})
        next_cursor = int(payload[-1].get("fundingTime", 0) or 0) + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def intersect_rows(pengu: List[dict], btc: List[dict]) -> tuple[List[dict], List[dict]]:
    p_map = {int(row["ts"]): row for row in pengu}
    b_map = {int(row["ts"]): row for row in btc}
    common = sorted(set(p_map) & set(b_map))
    if not common:
        return [], []
    return [p_map[ts] for ts in common], [b_map[ts] for ts in common]


def combine_same_side(*groups: List[v50.Trade]) -> List[v50.Trade]:
    return v56.combine_same_side(*groups)


def build_fixed_trades(pengu: List[dict], btc: List[dict], funding: List[dict]) -> dict:
    pengu, btc = intersect_rows(pengu, btc)
    if len(pengu) < 500 or len(btc) < 500:
        raise RuntimeError("Insufficient aligned PENGU/BTC history")
    features = v52.prepare_features(pengu, btc)
    base_long, _ = v50.run_candidate(v56.BASE_LONG, pengu, btc, funding, features)
    washout, armed = v56.run_candidate(v57.FIXED_WASHOUT, pengu, btc, funding, features)
    long_trades = combine_same_side(washout, base_long)
    flash, _ = v52.run_candidate(v56.SHORT_FLASH, pengu, btc, funding, features)
    distribution, _ = v52.run_candidate(v56.SHORT_DISTRIBUTION, pengu, btc, funding, features)
    short_trades = combine_same_side(distribution, flash)
    combined = v50.combine_sides(long_trades, short_trades)
    return {
        "pengu": pengu,
        "btc": btc,
        "long": long_trades,
        "short": short_trades,
        "combined": combined,
        "washout": washout,
        "washoutArmed": armed,
    }


def metrics_for(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def annual_metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    start_year = dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).year
    end_year = dt.datetime.fromtimestamp((end - 1) / 1000, tz=dt.timezone.utc).year
    for year in range(start_year, end_year + 1):
        year_start = max(start, int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000))
        year_end = min(end, int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000))
        if year_start < year_end:
            result[str(year)] = metrics_for(trades, year_start, year_end, severe)
    return result


def wave_events(pengu: List[dict]) -> dict:
    return {
        "major24": v50.wave_events(pengu, 24, 20.0),
        "major72": v50.wave_events(pengu, 72, 35.0),
    }


def overlaps_same_side(trade: v50.Trade, events: List[dict]) -> bool:
    return any(
        int(event["side"]) == trade.side
        and trade.entry_ts < int(event["endTs"])
        and trade.exit_ts > int(event["startTs"])
        for event in events
    )


def exclude_large_wave_profits(trades: List[v50.Trade], events: List[dict]) -> tuple[List[v50.Trade], dict]:
    excluded: List[v50.Trade] = []
    excluded_count = 0
    removed_base_pct = 0.0
    removed_severe_pct = 0.0
    for trade in trades:
        if overlaps_same_side(trade, events) and (trade.base_pct > 0 or trade.severe_pct > 0):
            base_pct = 0.0 if trade.base_pct > 0 else trade.base_pct
            severe_pct = 0.0 if trade.severe_pct > 0 else trade.severe_pct
            if trade.base_pct > 0:
                removed_base_pct += trade.base_pct
            if trade.severe_pct > 0:
                removed_severe_pct += trade.severe_pct
            excluded_count += 1
            excluded.append(replace(trade, base_pct=base_pct, severe_pct=severe_pct))
        else:
            excluded.append(trade)
    return excluded, {
        "excludedPositiveTrades": excluded_count,
        "removedBaseTradePctSum": removed_base_pct,
        "removedSevereTradePctSum": removed_severe_pct,
    }


def capture_audit(trades: List[v50.Trade], events: dict) -> dict:
    return {
        "major24": v50.capture_metrics(trades, events["major24"], 6),
        "major72": v50.capture_metrics(trades, events["major72"], 12),
    }


def venue_result(name: str, rows: dict) -> dict:
    pengu = rows["pengu"]
    combined = rows["combined"]
    start = int(pengu[0]["ts"])
    end = int(pengu[-1]["ts"]) + HOUR
    events = wave_events(pengu)
    all_events = [*events["major24"], *events["major72"]]
    no_wave, exclusion = exclude_large_wave_profits(combined, all_events)
    return {
        "venue": name,
        "startTs": start,
        "endTs": end,
        "startIso": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
        "endIso": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
        "hours": len(pengu),
        "longTrades": len(rows["long"]),
        "shortTrades": len(rows["short"]),
        "washoutTrades": len(rows["washout"]),
        "washoutArmedWithoutOrder": rows["washoutArmed"],
        "included": metrics_for(combined, start, end),
        "includedSevere": metrics_for(combined, start, end, True),
        "largeWaveProfitsExcluded": metrics_for(no_wave, start, end),
        "largeWaveProfitsExcludedSevere": metrics_for(no_wave, start, end, True),
        "includedAnnual": annual_metrics(combined, start, end),
        "excludedAnnual": annual_metrics(no_wave, start, end),
        "waveEvents": {"major24": len(events["major24"]), "major72": len(events["major72"])},
        "waveCapture": capture_audit(combined, events),
        "exclusion": exclusion,
        "trades": [asdict(trade) for trade in combined],
        "excludedTrades": [asdict(trade) for trade in no_wave],
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR

    print("Fetching complete Aster history")
    aster_pengu = v47.fetch_klines("PENGUUSDT", now_end)
    aster_btc = v47.fetch_klines("BTCUSDT", now_end)
    aster_funding = v47.fetch_funding("PENGUUSDT", now_end)
    aster = venue_result("ASTER", build_fixed_trades(aster_pengu, aster_btc, aster_funding))

    print("Fetching complete Binance USD-M history")
    binance_pengu = fetch_binance_klines("PENGUUSDT", now_end)
    binance_btc = fetch_binance_klines("BTCUSDT", now_end)
    binance_funding = fetch_binance_funding("PENGUUSDT", now_end)
    binance = venue_result("BINANCE_USDM", build_fixed_trades(binance_pengu, binance_btc, binance_funding))

    external_pass = bool(
        binance["included"]["compoundedReturnPct"] > 0
        and binance["includedSevere"]["compoundedReturnPct"] > 0
        and binance["largeWaveProfitsExcluded"]["compoundedReturnPct"] > 0
        and binance["largeWaveProfitsExcludedSevere"]["compoundedReturnPct"] > 0
        and (binance["included"]["profitFactor"] or 0) >= 1.10
    )
    result = rounded({
        "version": 57,
        "strategyId": "PENGU_V57_FIXED_EXTENDED_CROSS_VENUE",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "parametersFrozen": True,
        "externalValidationPassed": external_pass,
        "aster": aster,
        "binanceUsdM": binance,
        "comparison": {
            "binanceExtendedDays": (binance["endTs"] - binance["startTs"]) / DAY,
            "asterDays": (aster["endTs"] - aster["startTs"]) / DAY,
            "binanceMinusAsterDays": (binance["endTs"] - binance["startTs"] - (aster["endTs"] - aster["startTs"])) / DAY,
            "binanceWaveContributionPctPoints": binance["included"]["compoundedReturnPct"] - binance["largeWaveProfitsExcluded"]["compoundedReturnPct"],
            "asterWaveContributionPctPoints": aster["included"]["compoundedReturnPct"] - aster["largeWaveProfitsExcluded"]["compoundedReturnPct"],
        },
        "assumptions": {
            "gross": 0.15,
            "baseRoundTripCostPct": 0.14,
            "severeRoundTripCostPct": 0.28,
            "largeWaveDefinition": "abs 24h move >=20% OR abs 72h move >=35%",
            "largeWaveExcludedMethod": "Positive trade returns overlapping same-direction major events are set to zero; losses, funding and costs remain.",
            "execution": "completed 1h candles, signal close then next-open execution; no parameter retuning on Binance",
        },
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v57-extended-bt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU V57 Fixed Extended Cross-venue BT",
        "",
        f"- External validation: **{'PASS' if external_pass else 'FAIL'}**",
        "- Parameters frozen before Binance test: **YES**",
        "",
        "## Binance USD-M extended period",
        f"- Period: {binance['startIso']} to {binance['endIso']}",
        f"- Included: {binance['included']['compoundedReturnPct']}% / PF {binance['included']['profitFactor']} / DD {binance['included']['maxDrawdownPct']}% / N {binance['included']['trades']}",
        f"- Included Severe: {binance['includedSevere']['compoundedReturnPct']}% / DD {binance['includedSevere']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {binance['largeWaveProfitsExcluded']['compoundedReturnPct']}% / PF {binance['largeWaveProfitsExcluded']['profitFactor']} / DD {binance['largeWaveProfitsExcluded']['maxDrawdownPct']}%",
        f"- Excluded Severe: {binance['largeWaveProfitsExcludedSevere']['compoundedReturnPct']}% / DD {binance['largeWaveProfitsExcludedSevere']['maxDrawdownPct']}%",
        f"- Wave contribution: {result['comparison']['binanceWaveContributionPctPoints']} percentage points",
        "",
        "## Aster replication",
        f"- Period: {aster['startIso']} to {aster['endIso']}",
        f"- Included: {aster['included']['compoundedReturnPct']}% / PF {aster['included']['profitFactor']} / DD {aster['included']['maxDrawdownPct']}% / N {aster['included']['trades']}",
        f"- Included Severe: {aster['includedSevere']['compoundedReturnPct']}% / DD {aster['includedSevere']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {aster['largeWaveProfitsExcluded']['compoundedReturnPct']}% / PF {aster['largeWaveProfitsExcluded']['profitFactor']} / DD {aster['largeWaveProfitsExcluded']['maxDrawdownPct']}%",
        f"- Excluded Severe: {aster['largeWaveProfitsExcludedSevere']['compoundedReturnPct']}% / DD {aster['largeWaveProfitsExcludedSevere']['maxDrawdownPct']}%",
        f"- Wave contribution: {result['comparison']['asterWaveContributionPctPoints']} percentage points",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v57-extended-bt.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
