"""Read-only bounded Binance USD-M H1 and funding source re-fetch for PENGU native BT.

NO API keys, account endpoints, orders, or exchange writes. Save raw market-only
research data in owner's user-root directory, never git-commit the dataset.
Previously reviewed exact source BYTE hashes remain authoritative and are NEVER
replaced merely because a re-download produces a different byte stream.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

H=3_600_000
START=int(dt.datetime(2025,7,20,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,10,1,tzinfo=dt.timezone.utc).timestamp()*1000)
BASE="https://fapi.binance.com"
PINS={
 "PENGUUSDT_H1":"9f287209dbffc67d447433cdc5f8b159a459659554b2e07282b236bab1676af0",
 "BTCUSDT_H1":"155accb6e2885bdafe72c0eb48c3737f85daca44caaea4272c932c41a826ac6c",
 "PENGUUSDT_FUNDING":"f2220113447f695ffd40a8cd59c4428d3dc9cb9c30ee8b7e3884dd3ee279738a",
}

def get(endpoint:str,query:dict)->list:
    url=BASE+endpoint+"?"+urllib.parse.urlencode(query)
    for k in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"DisDexResearch-ReadOnly/1.0"})
            with urllib.request.urlopen(req,timeout=16) as response:
                if response.status!=200:raise ValueError("BINANCE_NON_200")
                raw=response.read(800_000)
            data=json.loads(raw)
            if not isinstance(data,list):raise ValueError("BINANCE_UNEXPECTED_RESPONSE")
            return data
        except (TimeoutError,urllib.error.HTTPError,urllib.error.URLError) as error:
            if isinstance(error,urllib.error.HTTPError) and error.code in (400,401,403,418,451):raise
            if k==2:raise
            time.sleep(0.5*(k+1))
    raise ValueError("UNREACHABLE")

def candles(symbol:str)->list[dict]:
    out=[];cursor=START
    while cursor<END:
        raw=get("/fapi/v1/klines",{"symbol":symbol,"interval":"1h","startTime":cursor,"endTime":END-1,"limit":1000})
        if not raw:raise ValueError("H1_HISTORY_INCOMPLETE:"+symbol)
        for b in raw:
            if len(b)<7:raise ValueError("H1_ROW_SHAPE")
            ts=int(b[0]);end=int(b[6]);p=[float(b[i]) for i in (1,2,3,4,5)]
            if ts!=cursor or end!=ts+H-1 or any(not math.isfinite(x) for x in p) or min(p[0],p[2],p[3])<=0 or p[1]<max(p[0],p[3]) or p[2]>min(p[0],p[3]) or p[4]<0:
                raise ValueError("H1_INVALID_OR_MISSING:"+symbol+":"+str(cursor))
            out.append({"openTime":ts,"closeTime":end,"open":p[0],"high":p[1],"low":p[2],"close":p[3],"volume":p[4]})
            cursor+=H
        print("FETCH_H1",symbol,len(out),"of",(END-START)//H,flush=True)
        time.sleep(0.15)
    if len(out)!=10512 or out[0]["openTime"]!=START or out[-1]["openTime"]!=END-H:raise ValueError("H1_WINDOW")
    return out

def funding()->list[dict]:
    out=[];cursor=START
    while cursor<END:
        raw=get("/fapi/v1/fundingRate",{"symbol":"PENGUUSDT","startTime":cursor,"endTime":END-1,"limit":1000})
        if not raw:break
        for x in raw:
            ts=int(x["fundingTime"]);rate=float(x["fundingRate"])
            if ts<cursor or ts>=END or not math.isfinite(rate) or out and ts<=out[-1]["fundingTime"]:raise ValueError("FUNDING_NONCAUSAL")
            out.append({"fundingTime":ts,"fundingRate":rate})
        cursor=out[-1]["fundingTime"]+1
        print("FETCH_FUNDING",len(out),flush=True)
        if len(raw)<1000:break
        time.sleep(0.15)
    if not out or out[0]["fundingTime"]>START+8*H or out[-1]["fundingTime"]<END-8*H:raise ValueError("FUNDING_WINDOW")
    return out

def serialize(items:list[dict])->bytes:
    return (json.dumps(items,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode("utf8")

def main(root:Path)->None:
    root=root.resolve()
    if not root.is_relative_to(Path.home().resolve()):raise ValueError("DATA_DIR_MUST_BE_IN_USER_ROOT")
    root.mkdir(parents=True,exist_ok=True)
    reports={}
    for name,data in (("PENGUUSDT_H1",candles("PENGUUSDT")),("BTCUSDT_H1",candles("BTCUSDT")),("PENGUUSDT_FUNDING",funding())):
        raw=serialize(data)
        sha=hashlib.sha256(raw).hexdigest()
        filename=name+"_20250720_20261001.json"
        with (root/filename).open("xb") as f:f.write(raw)
        reports[name]={"file":filename,"rows":len(data),"sha256":sha,"previousBytePin":PINS[name],"byteExactMatch":sha==PINS[name]}
        print("DATASET",name,"rows",len(data),"sha256",sha,"matchesPriorBytes",sha==PINS[name],flush=True)
    manifest={"schema":"stable4-pengu-binance-public-h1-readonly-refetch/v1","utcInterval":["2025-07-20T00:00:00Z","2026-10-01T00:00:00Z"],"endpoint":BASE,"datasets":reports,"orderAuthority":False,"fillsCertified":False,"previousReviewPinsReplaced":False}
    with (root/"manifest.json").open("x",encoding="utf8",newline="\n") as f:json.dump(manifest,f,indent=2);f.write("\n")
    print("RESULT",json.dumps(reports,sort_keys=True),flush=True)

if __name__=="__main__":
    if len(sys.argv)!=2:raise ValueError("USER_ROOT_OUTPUT_DIRECTORY_REQUIRED")
    main(Path(sys.argv[1]))
