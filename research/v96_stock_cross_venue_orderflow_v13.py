from __future__ import annotations

import argparse
import asyncio
import json
import time
import urllib.parse
from pathlib import Path
from typing import Optional

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None

from v96_stock_cross_venue_orderflow_v13_engine import (
    ASTER, ASTER_WS, Engine, SYMBOLS, Writer, XYZ, XYZ_WS,
    finite, iso, now_ms, request_json,
)


def parse_aster_book(data: dict, received: int) -> Optional[tuple]:
    symbol = str(data.get("s", "")).upper().removesuffix("USDT")
    values = [finite(data.get(k)) for k in ("b", "B", "a", "A")]
    if symbol not in SYMBOLS or any(v is None for v in values):
        return None
    return symbol, int(data.get("E") or data.get("T") or received), *values


def parse_aster_trade(data: dict, received: int) -> Optional[tuple]:
    symbol = str(data.get("s", "")).upper().removesuffix("USDT")
    price, quantity = finite(data.get("p")), finite(data.get("q"))
    if symbol not in SYMBOLS or price is None or quantity is None:
        return None
    return symbol, int(data.get("T") or data.get("E") or received), price, quantity, "SELL" if data.get("m") else "BUY"


def parse_xyz_book(data: dict, received: int) -> Optional[tuple]:
    symbol = str(data.get("coin", "")).split(":")[-1].upper()
    levels = data.get("levels")
    if symbol not in SYMBOLS or not isinstance(levels, list) or len(levels) < 2:
        return None
    bids = [(finite(r.get("px")), finite(r.get("sz"))) for r in levels[0] if isinstance(r, dict)]
    asks = [(finite(r.get("px")), finite(r.get("sz"))) for r in levels[1] if isinstance(r, dict)]
    bids = [(p, q) for p, q in bids if p and q]
    asks = [(p, q) for p, q in asks if p and q]
    if not bids or not asks:
        return None
    bid, bid_qty = max(bids)
    ask, ask_qty = min(asks)
    return symbol, int(data.get("time") or received), bid, bid_qty, ask, ask_qty


def parse_xyz_trade(data: dict, received: int) -> Optional[tuple]:
    symbol = str(data.get("coin", "")).split(":")[-1].upper()
    price, quantity, side = finite(data.get("px")), finite(data.get("sz")), str(data.get("side", "")).upper()
    if symbol not in SYMBOLS or price is None or quantity is None or side not in ("A", "B", "ASK", "BID", "BUY", "SELL"):
        return None
    aggressor = "BUY" if side in ("B", "BID", "BUY") else "SELL"
    return symbol, int(data.get("time") or received), price, quantity, aggressor


async def seed(engine: Engine) -> None:
    async def one_aster(symbol: str) -> None:
        received = now_ms()
        try:
            query = urllib.parse.urlencode({"symbol": ASTER[symbol]})
            data = await asyncio.to_thread(request_json, f"https://fapi.asterdex.com/fapi/v1/ticker/bookTicker?{query}")
            parsed = parse_aster_book({"s": ASTER[symbol], "E": received, **data}, received)
            if parsed:
                engine.book("ASTER", parsed[0], parsed[1], received, *parsed[2:])
        except Exception as exc:
            engine.record({"recordType": "collector_error", "venue": "ASTER_REST", "symbol": symbol, "error": repr(exc)})

    async def one_xyz(symbol: str) -> None:
        received = now_ms()
        try:
            data = await asyncio.to_thread(request_json, "https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": XYZ[symbol]})
            parsed = parse_xyz_book(data, received)
            if parsed:
                engine.book("XYZ", parsed[0], parsed[1], received, *parsed[2:])
        except Exception as exc:
            engine.record({"recordType": "collector_error", "venue": "XYZ_REST", "symbol": symbol, "error": repr(exc)})
    await asyncio.gather(*(one_aster(s) for s in SYMBOLS), *(one_xyz(s) for s in SYMBOLS))


async def collect_aster(engine: Engine, stop: float) -> None:
    streams = [f"{ASTER[s].lower()}@{kind}" for s in SYMBOLS for kind in ("bookTicker", "aggTrade")]
    url = f"{ASTER_WS}/stream?streams={'/'.join(streams)}"
    while time.monotonic() < stop:
        try:
            async with websockets.connect(url, open_timeout=15, ping_interval=15, ping_timeout=15, max_size=2**22) as ws:
                while time.monotonic() < stop:
                    try:
                        payload = json.loads(await asyncio.wait_for(ws.recv(), timeout=min(10, max(.1, stop - time.monotonic()))))
                    except asyncio.TimeoutError:
                        continue
                    received, data = now_ms(), payload.get("data", payload)
                    if not isinstance(data, dict):
                        continue
                    if data.get("e") == "bookTicker":
                        parsed = parse_aster_book(data, received)
                        if parsed:
                            engine.book("ASTER", parsed[0], parsed[1], received, *parsed[2:])
                    elif data.get("e") == "aggTrade":
                        parsed = parse_aster_trade(data, received)
                        if parsed:
                            engine.trade("ASTER", parsed[0], parsed[1], received, *parsed[2:])
        except Exception as exc:
            engine.record({"recordType": "collector_error", "venue": "ASTER_WS", "error": repr(exc)})
            await asyncio.sleep(min(2, max(0, stop - time.monotonic())))


async def collect_xyz(engine: Engine, stop: float) -> None:
    while time.monotonic() < stop:
        try:
            async with websockets.connect(XYZ_WS, open_timeout=15, ping_interval=15, ping_timeout=15, max_size=2**22) as ws:
                for symbol in SYMBOLS:
                    for kind in ("l2Book", "trades"):
                        await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": kind, "coin": XYZ[symbol]}}))
                while time.monotonic() < stop:
                    try:
                        payload = json.loads(await asyncio.wait_for(ws.recv(), timeout=min(10, max(.1, stop - time.monotonic()))))
                    except asyncio.TimeoutError:
                        continue
                    received, channel, data = now_ms(), payload.get("channel"), payload.get("data")
                    if channel == "l2Book" and isinstance(data, dict):
                        parsed = parse_xyz_book(data, received)
                        if parsed:
                            engine.book("XYZ", parsed[0], parsed[1], received, *parsed[2:])
                    elif channel == "trades" and isinstance(data, list):
                        for row in data:
                            parsed = parse_xyz_trade(row, received) if isinstance(row, dict) else None
                            if parsed:
                                engine.trade("XYZ", parsed[0], parsed[1], received, *parsed[2:])
        except Exception as exc:
            engine.record({"recordType": "collector_error", "venue": "XYZ_WS", "error": repr(exc)})
            await asyncio.sleep(min(2, max(0, stop - time.monotonic())))


async def probe(duration: int, output: Path) -> dict:
    if websockets is None:
        raise RuntimeError("websockets is required")
    output.mkdir(parents=True, exist_ok=True)
    writer = Writer(output / "v13-events.jsonl.gz")
    result: Optional[dict] = None
    try:
        engine = Engine(writer)
        engine.record({"recordType": "run_start", "startedAt": iso(), "durationSeconds": duration,
                       "symbols": list(SYMBOLS), "safety": {"orderSubmissionAllowed": False}})
        await seed(engine)
        stop = time.monotonic() + max(1, duration)
        await asyncio.gather(collect_aster(engine, stop), collect_xyz(engine, stop))
        result = engine.result()
        engine.record({"recordType": "run_result", **result})
    finally:
        writer.close()
    if result is None:
        raise RuntimeError("V13 probe ended without a result")
    (output / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def self_test() -> None:
    assert parse_aster_trade({"s": "AMZNUSDT", "p": "100", "q": "1", "m": True}, 1)[-1] == "SELL"
    assert parse_xyz_trade({"coin": "xyz:AMZN", "px": "100", "sz": "1", "side": "B"}, 1)[-1] == "BUY"
    path = Path(".research-state/v13-self-test.jsonl.gz")
    writer = Writer(path)
    engine = Engine(writer)
    engine.book("ASTER", "AMZN", 1000, 1000, 99, 1, 101, 1)
    engine.book("XYZ", "AMZN", 1000, 1000, 100, 2, 102, 2)
    quote = engine.quotes["AMZN"]
    assert quote["status"] == "OPEN" and quote["queueAheadUsd"] == 99
    engine.trade("ASTER", "AMZN", 1001, 1001, 99, 0.5, "SELL")
    assert quote["status"] == "OPEN" and quote["filledUsd"] == 0
    engine.trade("ASTER", "AMZN", 1002, 1002, 99, 2.0, "SELL")
    assert quote["status"] == "FILLED_AND_HEDGED" and engine.stats["fills"] == 1
    assert engine.result()["costScenarios"]["NORMAL"]["averageNetBps"] > 0
    writer.close()
    path.unlink(missing_ok=True)
    print("V96 Stock Cross-Venue Maker Hedge V13 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--duration-seconds", type=int, default=60)
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cross-venue-orderflow-v13")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = asyncio.run(probe(args.duration_seconds, Path(args.output_dir)))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
