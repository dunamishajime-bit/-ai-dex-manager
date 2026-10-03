import json, time, urllib.parse, urllib.request
from pathlib import Path

HOUR=3_600_000
WARM=1725148800000  # 2024-09-01T00:00:00Z
START=1728000000000 # 2024-10-04T00:00:00Z
END=1759536000000   # 2025-10-04T00:00:00Z
OUT=Path(".research-state/okx-pengu-proxy")
OUT.mkdir(parents=True,exist_ok=True)

def get(url,params,tries=7):
    q=url+"?"+urllib.parse.urlencode(params); last=None
    for i in range(tries):
        try:
            req=urllib.request.Request(q,headers={"Accept":"application/json","User-Agent":"DisDex-PENGU-Current-OKX-Proxy/1.0"})
            with urllib.request.urlopen(req,timeout=30) as r:
                p=json.loads(r.read().decode())
            if p.get("code")!="0":
                raise RuntimeError(f"OKX code={p.get('code')} msg={p.get('msg')}")
            return p
        except Exception as e:
            last=e; time.sleep(.6*(i+1))
    raise RuntimeError(f"OKX request failed {q}: {last}")

def candle(r):
    ts=int(r[0])
    return {"openTime":ts,"open":float(r[1]),"high":float(r[2]),"low":float(r[3]),"close":float(r[4]),"volume":float(r[5]),"closeTime":ts+HOUR-1}

def candles(inst):
    by={}; cursor=END
    for _ in range(150):
        p=get("https://www.okx.com/api/v5/market/history-candles",{"instId":inst,"bar":"1H","after":str(cursor),"limit":"100"})
        rows=p.get("data") or []
        if not rows: break
        vals=[]
        for r in rows:
            c=candle(r); vals.append(c["openTime"])
            if WARM<=c["openTime"]<END and (len(r)<9 or str(r[8])=="1"):
                by[c["openTime"]]=c
        old=min(vals); cursor=old-1
        if old<=WARM: break
        time.sleep(.05)
    return sorted(by.values(),key=lambda x:x["openTime"])

def funding(inst):
    by={}; cursor=END
    for _ in range(30):
        p=get("https://www.okx.com/api/v5/public/funding-rate-history",{"instId":inst,"after":str(cursor),"limit":"400"})
        rows=p.get("data") or []
        if not rows: break
        vals=[]
        for r in rows:
            ts=int(r["fundingTime"]); vals.append(ts)
            if WARM<=ts<END:
                by[ts]={"fundingTime":ts,"fundingRate":float(r.get("realizedRate") or r["fundingRate"])}
        old=min(vals); cursor=old-1
        if old<=WARM: break
        time.sleep(.05)
    return sorted(by.values(),key=lambda x:x["fundingTime"])

pengu=candles("PENGU-USDT-SWAP")
btc=candles("BTC-USDT-SWAP")
fund=funding("PENGU-USDT-SWAP")
if not pengu: raise RuntimeError("OKX PENGU candles unavailable")
bt={x["openTime"] for x in btc}
pengu=[x for x in pengu if x["openTime"] in bt]
pt={x["openTime"] for x in pengu}
btc=[x for x in btc if x["openTime"] in pt]
if len(pengu)<250: raise RuntimeError(f"Insufficient OKX common rows={len(pengu)}")
for name,obj in [("PENGUUSDT-candles.json",pengu),("BTCUSDT-candles.json",btc),("PENGUUSDT-funding.json",fund)]:
    (OUT/name).write_text(json.dumps(obj))
meta={
  "venue":"OKX_PROXY","requestedStart":START,"requestedEnd":END,
  "availableStart":pengu[0]["openTime"],"availableEndExclusive":pengu[-1]["openTime"]+HOUR,
  "commonH1Rows":len(pengu),"fundingRows":len(fund),
  "note":"SUPPLEMENTARY_PROXY_ONLY; current Production logic will be replayed on OKX market data. No pre-listing synthesis."
}
(OUT/"meta.json").write_text(json.dumps(meta,indent=2))
print("OKX_PROXY_DATA="+json.dumps(meta,separators=(",",":")))
