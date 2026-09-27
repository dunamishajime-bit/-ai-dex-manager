"""Read-only acquisition of 5 native Aster USDT stock-perpetual H1 prices.

These bars do not establish Yahoo equity reference prices or true executable
fills. The user separately authorizes modeled same-price V52 execution without
L2; no account, signed trading endpoint, or runner is touched.
"""
from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from .v52_yahoo import SYMBOLS, LIVE_SHA, aster_stock_h1_to_opens

URL="https://fapi.asterdex.com/fapi/v3/"
BEGIN=int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,8,11,tzinfo=timezone.utc).timestamp()*1000)
HOUR=3_600_000
MAX_REQUESTS_PER_SYMBOL=15

def _get(path:str, params:dict[str,Any]|None=None)->Any:
    uri=URL+path+("?"+urllib.parse.urlencode(params) if params else "")
    req=urllib.request.Request(uri,headers={"Accept":"application/json",
      "User-Agent":"DisDex-BT-public-aster-stock-h1-research/1"})
    try:
        with urllib.request.urlopen(req,timeout=25) as f:
            if f.status!=200:raise ValueError("ASTER_PUBLIC_SOURCE_HTTP_"+str(f.status))
            return json.load(f)
    except urllib.error.HTTPError as e:
        raise ValueError("ASTER_PUBLIC_SOURCE_HTTP_"+str(e.code)) from e

def fetch_history(symbol:str,get:Callable[...,Any]=_get,*,start:int=BEGIN,end:int=END,
                  pause:Callable[[float],None]=time.sleep)->list[list[Any]]:
    if symbol not in SYMBOLS:raise ValueError("ASTER_STOCK_SYMBOL_NOT_ALLOWLISTED")
    if not (0<start<end<=END):raise ValueError("INVALID_STOCK_DATE_RANGE")
    cursor=start;rows=[];calls=0
    while cursor<end:
        calls+=1
        if calls>MAX_REQUESTS_PER_SYMBOL:raise ValueError("ASTER_PAGINATION_BOUND")
        chunk=get("klines",{"symbol":symbol+"USDT","interval":"1h",
            "startTime":cursor,"endTime":end-1,"limit":1000})
        if not isinstance(chunk,list):raise ValueError("ASTER_KLINES_NOT_ARRAY")
        if not chunk:break
        previous=cursor-HOUR
        for row in chunk:
            if not isinstance(row,list) or len(row)<7:raise ValueError("ASTER_KLINE_SCHEMA")
            ts=int(row[0])
            if ts<cursor or ts>=end or ts<=previous or ts%HOUR!=0:
                raise ValueError("ASTER_KLINE_TIMESTAMPS_INVALID")
            previous=ts
            rows.append(row)
        cursor=int(chunk[-1][0])+HOUR
        pause(.5)
    if rows:
        parsed=aster_stock_h1_to_opens(rows,symbol)
        if len(parsed)!=len(rows):raise ValueError("ASTER_STOCK_ROWS_REJECTED")
    return rows

def acquire(output:Path,get:Callable[...,Any]=_get,pause:Callable[[float],None]=time.sleep)->dict:
    output.mkdir(parents=True,exist_ok=True)
    info=get("exchangeInfo")
    instruments={str(z.get("symbol")):z for z in info.get("symbols",[])}
    manifest={"schema":"DISDEX_V52_ASTER_PUBLIC_STOCK_H1_RESEARCH_V1",
      "pin_production_sha":LIVE_SHA,
      "source":"ASTER_PUBLIC_FAPI_V3_H1_NATIVE_USDT_STOCK_PERPETUAL",
      "source_api":URL,
      "period_start_ms":BEGIN,"period_end_exclusive_ms":END,
      "symbols":{},"yahoo_reference_not_included":True,"historical_l2_not_required":True,
      "production_trading_mutation":0}
    for sym in SYMBOLS:
        instrument=instruments.get(sym+"USDT")
        if not instrument or instrument.get("status")!="TRADING":
            raise ValueError("ASTER_STOCK_PERP_SYMBOL_UNAVAILABLE:"+sym)
        onboard=instrument.get("onboardDate")
        if onboard and int(onboard)>BEGIN:raise ValueError("ASTER_STOCK_LISTED_AFTER_BT_START:"+sym)
        rows=fetch_history(sym,get,pause=pause)
        if not rows:raise ValueError("ASTER_STOCK_H1_EMPTY:"+sym)
        p=output/(sym+".json")
        raw=json.dumps(rows,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode()+b"\n"
        p.write_bytes(raw)
        ticks=[int(x[0]) for x in rows]
        gaps=sum(b-a!=HOUR for a,b in zip(ticks,ticks[1:]))
        meta={"status":"ACQUIRED","instrument":sym+"USDT","first_bar_ms":ticks[0],
            "last_bar_ms":ticks[-1],"bars":len(rows),"gaps":gaps,
            "listing_onboard_ms":onboard,
            "relative_path":p.name,"bytes":len(raw),"sha256":sha256(raw).hexdigest()}
        manifest["symbols"][sym]=meta
        # All provider OHLC stays in the private research archive.
        print("ASTER_V52_STOCK_H1_COVERAGE",json.dumps({k:meta[k] for k in
            ("instrument","bars","first_bar_ms","last_bar_ms","gaps","sha256")},sort_keys=True))
    (output/"aster-stock-h1-manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    return manifest

def verify(output:Path)->dict:
    manifest=json.loads((output/"aster-stock-h1-manifest.json").read_text())
    if manifest["pin_production_sha"]!=LIVE_SHA or set(manifest["symbols"])!=set(SYMBOLS):
        raise ValueError("STOCK_SOURCE_MANIFEST_SHA_OR_UNIVERSE_MISMATCH")
    for sym in SYMBOLS:
        meta=manifest["symbols"][sym]
        p=(output/meta["relative_path"]).resolve()
        p.relative_to(output.resolve())
        raw=p.read_bytes()
        if sha256(raw).hexdigest()!=meta["sha256"]:
            raise ValueError("STOCK_SOURCE_HASH_MISMATCH:"+sym)
        rows=json.loads(raw)
        if len(rows)!=meta["bars"]:
            raise ValueError("STOCK_SOURCE_BAR_COUNT_MISMATCH:"+sym)
        aster_stock_h1_to_opens(rows,sym)
    return manifest

def main()->int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--output-root",type=Path,required=True)
    args=parser.parse_args()
    m=acquire(args.output_root)
    verify(args.output_root)
    print("ASTER_V52_STOCK_H1_ACQUISITION_COMPLETE",
      json.dumps({"symbols":len(m["symbols"]),"bars":sum(z["bars"] for z in m["symbols"].values()),
        "live_trading_mutation":0}))
    return 0
if __name__=="__main__":raise SystemExit(main())
