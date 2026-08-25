from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo


UTC = dt.timezone.utc
NEW_YORK = ZoneInfo("America/New_York")
CASH_MINUTES = (570, 630, 690, 750, 810, 870)
SYMBOLS = {
    "AMZN": "AMZN",
    "META": "META",
    "MSFT": "MSFT",
    "NVDA": "NVDA",
    "TSLA": "TSLA",
}
PROVIDER = "HF Market Data public keyless API"
ADJUSTMENT = "adj_splitdiv"


def finite(value: object) -> float:
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ValueError(f"invalid positive price: {value!r}")
    return result


def parse_provider_time(value: str) -> dt.datetime:
    parsed = dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    return parsed.replace(tzinfo=NEW_YORK)


def fetch(symbol: str, start: str, end: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "timeframe": "30min",
            "adjustment": ADJUSTMENT,
            "start": start,
            "end": end,
            "order": "asc",
            "limit": 50000,
            "format": "json",
        }
    )
    url = f"https://www.hfmarketdata.io/v1/bars/stock/{symbol}?{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "DisDex-research-v52/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"HF_MARKETDATA_EMPTY:{symbol}:{payload!r}")
    return [row for row in rows if isinstance(row, dict) and str(row.get("ticker", "")).upper() == symbol]


def build_chart(symbol: str, rows: list[dict]) -> tuple[dict, dict]:
    slots: dict[str, dict[int, dict]] = {}
    for row in rows:
        timestamp = row.get("datetime")
        if not isinstance(timestamp, str):
            continue
        local = parse_provider_time(timestamp)
        minute = local.hour * 60 + local.minute
        if minute < 570 or minute > 900 or minute % 30 != 0:
            continue
        if local.weekday() >= 5:
            continue
        slots.setdefault(local.date().isoformat(), {})[minute] = row

    timestamps: list[int] = []
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    volumes: list[float] = []
    complete_days = 0
    for day in sorted(slots):
        by_minute = slots[day]
        bars: list[tuple[int, dict, dict]] = []
        complete = True
        for minute in CASH_MINUTES:
            first = by_minute.get(minute)
            second = by_minute.get(minute + 30)
            if first is None or second is None:
                complete = False
                break
            bars.append((minute, first, second))
        if not complete:
            continue
        complete_days += 1
        local_day = dt.date.fromisoformat(day)
        for minute, first, second in bars:
            first_open = finite(first["open"])
            second_close = finite(second["close"])
            high = max(finite(first["high"]), finite(second["high"]))
            low = min(finite(first["low"]), finite(second["low"]))
            volume = float(first.get("volume", 0.0)) + float(second.get("volume", 0.0))
            if not math.isfinite(volume) or volume < 0:
                raise ValueError(f"invalid volume: {symbol} {day} {minute}")
            local_ts = dt.datetime.combine(local_day, dt.time(), tzinfo=NEW_YORK) + dt.timedelta(minutes=minute)
            timestamps.append(int(local_ts.timestamp()))
            opens.append(first_open)
            highs.append(high)
            lows.append(low)
            closes.append(second_close)
            volumes.append(volume)

    if not timestamps:
        raise RuntimeError(f"HF_MARKETDATA_NO_COMPLETE_DAYS:{symbol}")
    chart = {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": symbol,
                        "provider": PROVIDER,
                        "adjustment": ADJUSTMENT,
                        "sourceInterval": "30min",
                        "outputInterval": "60min",
                        "outputAnchor": "09:30 America/New_York",
                    },
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [
                            {
                                "open": opens,
                                "high": highs,
                                "low": lows,
                                "close": closes,
                                "volume": volumes,
                            }
                        ]
                    },
                    "events": {},
                }
            ],
            "error": None,
        }
    }
    return chart, {
        "provider": PROVIDER,
        "adjustment": ADJUSTMENT,
        "sourceBars": len(rows),
        "sourceInterval": "30min",
        "outputBars": len(timestamps),
        "completeDays": complete_days,
        "firstDay": min(slots),
        "lastDay": max(slots),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    # V52's frozen loader names its cache from the 40-day warm-up start, not
    # from the decision window start.  Keep the warm-up bars so the loader can
    # validate the same lookback that the backtest uses.
    parser.add_argument("--start", default="2024-07-01 00:00:00")
    parser.add_argument("--end", default="2026-08-10 00:00:00")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    start_date = args.start[:10]
    end_date = args.end[:10]
    diagnostics: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SYMBOLS)) as pool:
        futures = {pool.submit(fetch, ticker, args.start, args.end): ticker for ticker in SYMBOLS.values()}
        for future in concurrent.futures.as_completed(futures):
            ticker = futures[future]
            rows = future.result()
            chart, detail = build_chart(ticker, rows)
            path = output / f"{ticker}-60m-{start_date}-{end_date}.json"
            path.write_text(json.dumps(chart, separators=(",", ":")), encoding="utf-8")
            diagnostics[ticker] = detail
            print(json.dumps({"ticker": ticker, **detail}, ensure_ascii=False))
    required = set(SYMBOLS.values())
    if set(diagnostics) != required:
        raise RuntimeError(f"HF_MARKETDATA_SYMBOL_MISMATCH:{sorted(diagnostics)}")
    if min(item["completeDays"] for item in diagnostics.values()) < 499:
        raise RuntimeError(f"HF_MARKETDATA_INSUFFICIENT_DAYS:{diagnostics}")
    print(json.dumps({"provider": PROVIDER, "adjustment": ADJUSTMENT, "symbols": diagnostics}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
