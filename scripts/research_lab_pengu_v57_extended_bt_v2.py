from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List

import research_lab_pengu_v57_extended_bt as base
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50

HOUR = v47.HOUR
DAY = 24 * HOUR
BYBIT_BASE = "https://api.bybit.com"
START = int(dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)


def fetch_json(path: str, params: dict, timeout: int = 40):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{BYBIT_BASE}{path}?{query}",
        headers={"User-Agent": "DisDex-PENGU-V57-Bybit-BT/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if int(payload.get("retCode", -1)) != 0:
        raise RuntimeError(f"Bybit API error: {payload.get('retCode')} {payload.get('retMsg')}")
    return payload.get("result", {})


def fetch_bybit_klines(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    empty_windows = 0
    while cursor < end:
        window_end = min(end - 1, cursor + 999 * HOUR)
        result = fetch_json("/v5/market/kline", {
            "category": "linear",
            "symbol": symbol,
            "interval": "60",
            "start": cursor,
            "end": window_end,
            "limit": 1000,
        })
        payload = result.get("list", [])
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Bybit kline payload for {symbol}")
        if not payload:
            cursor = window_end + 1
            empty_windows += 1
            if empty_windows > 36:
                break
            continue
        empty_windows = 0
        latest_ts = cursor
        for item in payload:
            if isinstance(item, list) and len(item) >= 6:
                ts = int(item[0])
                rows.append({
                    "ts": ts,
                    "open": float(item[1]),
                    "high": float(item[2]),
                    "low": float(item[3]),
                    "close": float(item[4]),
                    "volume": float(item[5]),
                    "closeTime": ts + HOUR - 1,
                })
                latest_ts = max(latest_ts, ts)
        next_cursor = latest_ts + HOUR
        if next_cursor <= cursor:
            cursor = window_end + 1
        else:
            cursor = next_cursor
        time.sleep(0.04)
    unique = {
        int(row["ts"]): row
        for row in rows
        if START <= int(row["ts"]) < end and int(row["closeTime"]) < end
    }
    return [unique[key] for key in sorted(unique)]


def fetch_bybit_funding(symbol: str, end: int) -> List[dict]:
    rows: List[dict] = []
    cursor = START
    while cursor < end:
        window_end = min(end - 1, cursor + 60 * DAY)
        result = fetch_json("/v5/market/funding/history", {
            "category": "linear",
            "symbol": symbol,
            "startTime": cursor,
            "endTime": window_end,
            "limit": 200,
        })
        payload = result.get("list", [])
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Bybit funding payload for {symbol}")
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingRateTimestamp", 0) or 0)
                if START <= ts < end:
                    rows.append({"ts": ts, "rate": float(item.get("fundingRate", 0) or 0)})
        cursor = window_end + 1
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR

    print("Fetching complete Aster history")
    aster = base.venue_result(
        "ASTER",
        base.build_fixed_trades(
            v47.fetch_klines("PENGUUSDT", now_end),
            v47.fetch_klines("BTCUSDT", now_end),
            v47.fetch_funding("PENGUUSDT", now_end),
        ),
    )

    print("Fetching complete Bybit Linear history")
    bybit_pengu = fetch_bybit_klines("PENGUUSDT", now_end)
    bybit_btc = fetch_bybit_klines("BTCUSDT", now_end)
    bybit_funding = fetch_bybit_funding("PENGUUSDT", now_end)
    bybit = base.venue_result("BYBIT_LINEAR", base.build_fixed_trades(bybit_pengu, bybit_btc, bybit_funding))

    external_pass = bool(
        bybit["included"]["compoundedReturnPct"] > 0
        and bybit["includedSevere"]["compoundedReturnPct"] > 0
        and bybit["largeWaveProfitsExcluded"]["compoundedReturnPct"] > 0
        and bybit["largeWaveProfitsExcludedSevere"]["compoundedReturnPct"] > 0
        and (bybit["included"]["profitFactor"] or 0) >= 1.10
    )
    result = rounded({
        "version": 57,
        "strategyId": "PENGU_V57_FIXED_EXTENDED_ASTER_BYBIT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "parametersFrozen": True,
        "externalValidationPassed": external_pass,
        "aster": aster,
        "bybitLinear": bybit,
        "comparison": {
            "bybitExtendedDays": (bybit["endTs"] - bybit["startTs"]) / DAY,
            "asterDays": (aster["endTs"] - aster["startTs"]) / DAY,
            "bybitMinusAsterDays": (
                bybit["endTs"] - bybit["startTs"] - (aster["endTs"] - aster["startTs"])
            ) / DAY,
            "bybitWaveContributionPctPoints": (
                bybit["included"]["compoundedReturnPct"]
                - bybit["largeWaveProfitsExcluded"]["compoundedReturnPct"]
            ),
            "asterWaveContributionPctPoints": (
                aster["included"]["compoundedReturnPct"]
                - aster["largeWaveProfitsExcluded"]["compoundedReturnPct"]
            ),
        },
        "assumptions": {
            "gross": 0.15,
            "baseRoundTripCostPct": 0.14,
            "severeRoundTripCostPct": 0.28,
            "largeWaveDefinition": "abs 24h move >=20% OR abs 72h move >=35%",
            "largeWaveExcludedMethod": (
                "Positive trade returns overlapping same-direction major events are set to zero; "
                "losses, funding and costs remain."
            ),
            "execution": (
                "completed 1h candles, signal close then next-open execution; "
                "no parameter retuning on Bybit"
            ),
            "binanceAttempt": "HTTP 451 from GitHub runner; replaced by Bybit Linear external validation",
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v57-extended-bt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# PENGU V57 Fixed Extended Aster + Bybit BT",
        "",
        f"- External validation: **{'PASS' if external_pass else 'FAIL'}**",
        "- Parameters frozen before Bybit test: **YES**",
        "",
        "## Bybit Linear extended period",
        f"- Period: {bybit['startIso']} to {bybit['endIso']}",
        f"- Included: {bybit['included']['compoundedReturnPct']}% / PF {bybit['included']['profitFactor']} / DD {bybit['included']['maxDrawdownPct']}% / N {bybit['included']['trades']}",
        f"- Included Severe: {bybit['includedSevere']['compoundedReturnPct']}% / DD {bybit['includedSevere']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {bybit['largeWaveProfitsExcluded']['compoundedReturnPct']}% / PF {bybit['largeWaveProfitsExcluded']['profitFactor']} / DD {bybit['largeWaveProfitsExcluded']['maxDrawdownPct']}%",
        f"- Excluded Severe: {bybit['largeWaveProfitsExcludedSevere']['compoundedReturnPct']}% / DD {bybit['largeWaveProfitsExcludedSevere']['maxDrawdownPct']}%",
        f"- Wave contribution: {result['comparison']['bybitWaveContributionPctPoints']} percentage points",
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
