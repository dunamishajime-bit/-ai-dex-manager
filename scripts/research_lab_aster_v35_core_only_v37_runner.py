from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_v35_core_only_v37 as v37

ASTER_BASE = "https://fapi.asterdex.com"


def fetch_json(path: str, params: dict, timeout: int = 30):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{ASTER_BASE}{path}?{query}",
        headers={"User-Agent": "DisDex-V37-Aster-Public/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_candles(symbol: str) -> List[dict]:
    pair = f"{symbol}USDT"
    rows: List[dict] = []
    cursor = v4.DATA_START
    while cursor < v4.END:
        payload = fetch_json("/fapi/v1/klines", {
            "symbol": pair,
            "interval": "1h",
            "startTime": cursor,
            "endTime": v4.END - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Aster kline payload for {pair}.")
        if not payload:
            cursor += 30 * v4.DAY
            continue
        for item in payload:
            if isinstance(item, list) and len(item) >= 6:
                rows.append({
                    "ts": int(item[0]),
                    "open": float(item[1]),
                    "high": float(item[2]),
                    "low": float(item[3]),
                    "close": float(item[4]),
                    "volume": float(item[5]),
                })
        next_cursor = int(payload[-1][0]) + v4.HOUR
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows if v4.DATA_START <= int(row["ts"]) < v4.END}
    result = [unique[key] for key in sorted(unique)]
    if len(result) < 12 * 365:
        raise RuntimeError(f"Insufficient Aster candles for {pair}: {len(result)}")
    return result


def fetch_funding(symbol: str) -> List[dict]:
    pair = f"{symbol}USDT"
    rows: List[dict] = []
    cursor = v4.DATA_START
    while cursor < v4.END:
        payload = fetch_json("/fapi/v1/fundingRate", {
            "symbol": pair,
            "startTime": cursor,
            "endTime": v4.END - 1,
            "limit": 1000,
        })
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected Aster funding payload for {pair}.")
        if not payload:
            cursor += 90 * v4.DAY
            continue
        for item in payload:
            if isinstance(item, dict):
                ts = int(item.get("fundingTime", item.get("time", 0)) or 0)
                rate = float(item.get("fundingRate", item.get("rate", 0)) or 0)
                if v4.DATA_START <= ts < v4.END:
                    rows.append({"ts": ts, "rate": rate})
        next_cursor = int(payload[-1].get("fundingTime", payload[-1].get("time", 0)) or 0) + 1
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1000:
            break
        time.sleep(0.04)
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)]


def load_aster_symbol(_cache_root: Path, symbol: str) -> dict:
    print(f"Fetching Aster public history for {symbol}USDT")
    return {
        "symbol": f"{symbol}USDT",
        "candles": fetch_candles(symbol),
        "funding": fetch_funding(symbol),
    }


if __name__ == "__main__":
    v4.load_symbol = load_aster_symbol
    v37.main()
