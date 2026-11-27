"""Read-only source-verified Binance PENGU/BTC hourly historical research data.

Requires no API key; never contacts order/account endpoints. Writes only new
research-state files in a caller-controlled directory. Throws on missing,
duplicate, stale, malformed or impossible candles. No autofix/interpolation.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import time
import urllib.parse
import urllib.request
import sys

H=3_600_000
UTC=dt.timezone.utc
START=int(dt.datetime(2025,7,20,tzinfo=UTC).timestamp()*1000)
END=int(dt.datetime(2026,10,1,tzinfo=UTC).timestamp()*1000)
BASE="https://fapi.binance.com"
MAX_REQUESTS=40


def public_get(route:str,params:dict)->list:
    query=urllib.parse.urlencode(params)
    req=urllib.request.Request(
        BASE+route+"?"+query,
        headers={"User-Agent":"DisDex-Source-Only-Research/1.0"})
    with urllib.request.urlopen(req,timeout=18) as response:
        if response.status != 200:
            raise RuntimeError("BINANCE_PUBLIC_DATA_HTTP_NOT_200")
        body=response.read(1_400_000)
    rows=json.loads(body)
    if not isinstance(rows,list):
        raise ValueError("BINANCE_PUBLIC_DATA_NOT_ARRAY")
    return rows


def h1(symbol:str)->list[dict]:
    if symbol not in ("BTCUSDT","PENGUUSDT"):
        raise ValueError("SYMBOL_NOT_ALLOWLISTED")
    cursor=START
    candles=[]
    count=0
    while cursor<END:
        if count>=MAX_REQUESTS:
            raise RuntimeError("H1_PAGE_BUDGET_EXHAUSTED")
        rows=public_get("/fapi/v1/klines",{
            "symbol":symbol,"interval":"1h",
            "startTime":cursor,"endTime":END-1,"limit":1000})
        count+=1
        if not rows:
            raise ValueError("H1_COVERAGE_MISSING:"+symbol+":"+str(cursor))
        for row in rows:
            if not isinstance(row,list) or len(row)<7:
                raise ValueError("H1_ROW_MALFORMED")
            stamp=int(row[0])
            if stamp!=cursor or stamp%H!=0:
                raise ValueError("H1_CANDLE_GAP_OR_DUP:"+symbol+":"+str(cursor))
            o,high,low,close,volume=(float(row[k]) for k in (1,2,3,4,5))
            if (not all(math.isfinite(v) for v in (o,high,low,close,volume))
                or o<=0 or low<=0 or volume<0 or low>min(o,close)
                or high<max(o,close) or int(row[6])!=stamp+H-1):
                raise ValueError("H1_INVALID_EXCHANGE_CANDLE:"+symbol+":"+str(stamp))
            candles.append({"openTime":stamp,"open":o,"high":high,"low":low,
                            "close":close,"volume":volume,"closeTime":stamp+H-1})
            cursor+=H
        if count>1 and len(rows)==0:
            raise ValueError("H1_NO_PROGRESS")
        time.sleep(.25)
    if len(candles)!=(END-START)//H or candles[-1]["openTime"]!=END-H:
        raise ValueError("H1_1Y_AND_WARMUP_COVERAGE_INCOMPLETE")
    return candles


def funding()->list[dict]:
    cursor=START
    out=[]
    pages=0
    while cursor<END:
        if pages>=MAX_REQUESTS:
            raise RuntimeError("FUNDING_PAGE_BUDGET_EXHAUSTED")
        rows=public_get("/fapi/v1/fundingRate",{
            "symbol":"PENGUUSDT","startTime":cursor,"endTime":END-1,"limit":1000})
        pages+=1
        if not rows:
            break
        for row in rows:
            stamp=int(row["fundingTime"])
            rate=float(row["fundingRate"])
            if stamp<cursor or stamp>=END or not math.isfinite(rate) or(
                out and stamp<=out[-1]["fundingTime"]):
                raise ValueError("FUNDING_INVALID_OR_NOT_ASCENDING")
            out.append({"fundingTime":stamp,"fundingRate":rate})
        cursor=out[-1]["fundingTime"]+1
        time.sleep(.25)
        if len(rows)<1000:
            break
    if not out or out[0]["fundingTime"]>START+8*H or out[-1]["fundingTime"]<END-8*H:
        raise ValueError("FUNDING_TIME_COVERAGE_INCOMPLETE")
    return out


def save_new(directory:pathlib.Path,name:str,obj:object)->dict:
    raw=(json.dumps(obj,separators=(",",":"),ensure_ascii=False)+"\n").encode("utf8")
    path=directory/name
    with path.open("xb") as f:
        f.write(raw)
    return {"file":str(path),"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw),
            "rows":len(obj) if isinstance(obj,list) else None}


def main()->None:
    if len(sys.argv)!=2:
        raise RuntimeError("OUTPUT_DIRECTORY_REQUIRED")
    directory=pathlib.Path(sys.argv[1]).expanduser().resolve()
    if not directory.is_dir():
        raise ValueError("OUTPUT_DIRECTORY_MUST_EXIST")
    print("RESEARCH_PUBLIC_GET_ONLY=true",flush=True)
    data={symbol:h1(symbol) for symbol in ("BTCUSDT","PENGUUSDT")}
    fees=funding()
    outputs={}
    for symbol,candles in data.items():
        outputs[symbol]=save_new(directory,
            "disdex_pr676_binance_"+symbol+"_h1_20250720_20260930.json",candles)
    outputs["PENGU_FUNDING"]=save_new(directory,
        "disdex_pr676_binance_PENGUUSDT_funding_20250720_20260930.json",fees)
    print(json.dumps({
        "status":"PUBLIC_BINANCE_RESEARCH_H1_COMPLETE_NO_ORDERS",
        "source":BASE,"utcStart":START,"utcEndExclusive":END,
        "initialDaysWarmupBeforeTarget":73,
        "outputs":outputs,
        "orderAuthority":False,
    },ensure_ascii=False))


if __name__=="__main__":
    main()
