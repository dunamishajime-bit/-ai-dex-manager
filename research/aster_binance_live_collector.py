#!/usr/bin/env python3
"""Prospective Aster/Binance microstructure recorder.

Records aggregate trades, mark/funding, book ticker, depth and liquidations from
both venues into newline-delimited JSON. Run continuously before cross-exchange
lead/lag or spread strategies are evaluated.
"""
from __future__ import annotations
import asyncio, json, os, time
from pathlib import Path
import websockets

SYMBOL=os.getenv("SYMBOL","btcusdt").lower()
OUT=Path(os.getenv("OUT_DIR","live_microstructure")); OUT.mkdir(parents=True,exist_ok=True)
VENUES={
 "aster":"wss://fstream.asterdex.com/stream?streams=",
 "binance":"wss://fstream.binance.com/stream?streams=",
}
STREAMS=[f"{SYMBOL}@aggTrade",f"{SYMBOL}@markPrice@1s",f"{SYMBOL}@bookTicker",f"{SYMBOL}@depth10@100ms",f"{SYMBOL}@forceOrder"]

def append(venue,obj):
    row={"recv_ns":time.time_ns(),"venue":venue,**obj}
    with (OUT/f"{venue}-{SYMBOL}.ndjson").open("a",encoding="utf-8") as f:
        f.write(json.dumps(row,separators=(",",":"))+"\n")

async def collect(venue,base):
    url=base+"/".join(STREAMS)
    while True:
        try:
            async with websockets.connect(url,ping_interval=20,ping_timeout=20,max_queue=50000) as ws:
                async for msg in ws:
                    append(venue,json.loads(msg))
        except Exception as exc:
            append(venue,{"collector_error":str(exc)})
            await asyncio.sleep(2)

async def main():
    await asyncio.gather(*(collect(v,b) for v,b in VENUES.items()))
if __name__=="__main__": asyncio.run(main())
