#!/usr/bin/env python3
"""Read-only exact Aster 1m open needed by old-engine Q102 MTM after V52 B60 replacement.
This is an independently observed additional request from the B60 nonzero-volume
scenario, NOT an assumed replacement for unverified venue execution prices.
"""
from __future__ import annotations
import hashlib,json,urllib.request,urllib.parse,pathlib
SYMBOL="ENAUSDT"
TS=1781717400000
OUT=pathlib.Path("research-results/b60-q102-1m-missing-mark-20260926")
url="https://fapi.asterdex.com/fapi/v3/klines?"+urllib.parse.urlencode({
    "symbol":SYMBOL,"interval":"1m","startTime":TS,"endTime":TS+59999,"limit":1})
req=urllib.request.Request(url,headers={"User-Agent":"DisDexCurrentNativeB60ExactMTM/1.0","Accept":"application/json"})
with urllib.request.urlopen(req,timeout=45) as response: payload=json.load(response)
if not isinstance(payload,list) or len(payload)!=1 or not isinstance(payload[0],list):
    raise RuntimeError("ASTER_MARK_MISSING_OR_AMBIGUOUS")
r=payload[0];ts=int(r[0]);o=float(r[1]);h=float(r[2]);l=float(r[3]);close=float(r[4]);volume=float(r[5])
if ts!=TS or o<=0 or l<=0 or h<max(o,close,l) or l>min(o,close,h) or volume<0:
    raise RuntimeError("ASTER_MARK_NOT_EXACT_OR_INVALID")
doc={"schema":"aster-v3-exact-b60-q102-additional-one-minute-mark/v1",
     "symbol":SYMBOL,"requestedTs":TS,"source":"ASTER_PUBLIC_FUTURES_V3_1M_OPEN",
     "open":o,"high":h,"low":l,"close":close,"volume":volume,
     "sourceCommit":"e1b58060d6263a3af7ced51bec854d3e211d2f35",
     "rejectedMarketSubstitution":True,"bidAskOrLiveFillVerified":False,"ordersSent":0}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/"exact-additional-1m.json").write_text(json.dumps(doc,indent=2)+"\n")
print("NEW_B60_Q102_EXACT_MTM_SOURCE_VERIFIED",json.dumps(doc,sort_keys=True))
