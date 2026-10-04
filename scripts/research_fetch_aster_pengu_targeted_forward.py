import json, time, urllib.parse, urllib.request
from pathlib import Path

HOUR=3_600_000
WARM=1752969600000   # 2025-07-20
END=1790899200000    # 2026-10-02T00:00:00Z
OUT=Path(".research-state/aster-pengu-targeted-forward")
OUT.mkdir(parents=True,exist_ok=True)

def get(url,params,tries=7):
    q=url+"?"+urllib.parse.urlencode(params); last=None
    for i in range(tries):
        try:
            req=urllib.request.Request(q,headers={"Accept":"application/json","User-Agent":"DisDex-PENGU-Targeted-Forward/1.0"})
            with urllib.request.urlopen(req,timeout=30) as r:return json.loads(r.read().decode())
        except Exception as e:
            last=e; time.sleep(.6*(i+1))
    raise RuntimeError(f"Aster request failed {q}: {last}")

def candles(symbol):
    by={}; cursor=WARM
    while cursor<END:
        rows=get("https://fapi.asterdex.com/fapi/v3/klines",{"symbol":symbol,"interval":"1h","startTime":str(cursor),"endTime":str(END-1),"limit":"1500"})
        if not rows: break
        for r in rows:
            ts=int(r[0])
            if WARM<=ts<END:
                by[ts]={"openTime":ts,"open":float(r[1]),"high":float(r[2]),"low":float(r[3]),"close":float(r[4]),"volume":float(r[5]),"closeTime":int(r[6])}
        nxt=int(rows[-1][0])+HOUR
        if nxt<=cursor: raise RuntimeError(f"{symbol} pagination stalled")
        cursor=nxt; time.sleep(.04)
    return sorted(by.values(),key=lambda x:x["openTime"])

def funding():
    by={}; cursor=WARM
    while cursor<END:
        rows=get("https://fapi.asterdex.com/fapi/v3/fundingRate",{"symbol":"PENGUUSDT","startTime":str(cursor),"endTime":str(END-1),"limit":"1000"})
        if not rows: break
        for r in rows:
            ts=int(r["fundingTime"])
            if WARM<=ts<END: by[ts]={"fundingTime":ts,"fundingRate":float(r["fundingRate"])}
        nxt=int(rows[-1]["fundingTime"])+1
        if nxt<=cursor: raise RuntimeError("funding pagination stalled")
        cursor=nxt; time.sleep(.04)
    return sorted(by.values(),key=lambda x:x["fundingTime"])

p=candles("PENGUUSDT"); b=candles("BTCUSDT"); f=funding()
bs={x["openTime"] for x in b}; p=[x for x in p if x["openTime"] in bs]
ps={x["openTime"] for x in p}; b=[x for x in b if x["openTime"] in ps]
if len(p)<10000: raise RuntimeError(f"Insufficient Aster common rows={len(p)}")
for name,obj in [("PENGUUSDT-candles.json",p),("BTCUSDT-candles.json",b),("PENGUUSDT-funding.json",f)]:
    (OUT/name).write_text(json.dumps(obj))
meta={"venue":"ASTER","warmMs":WARM,"endMs":END,"commonH1Rows":len(p),"fundingRows":len(f),"availableStart":p[0]["openTime"],"availableEndExclusive":p[-1]["openTime"]+HOUR}
(OUT/"meta.json").write_text(json.dumps(meta,indent=2))
print("ASTER_TARGETED_DATA="+json.dumps(meta,separators=(",",":")))
