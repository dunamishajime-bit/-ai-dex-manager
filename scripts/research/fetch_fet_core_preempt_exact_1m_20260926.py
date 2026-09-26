#!/usr/bin/env python3
"""Read-only, fail-closed, EXACT Aster 1m FET open on base-entry conflict timestamps.

Input timestamps were independently derived from checksum-frozen old engine's
16 admitted independent FET rows against current native V12/new PENGU/old V11
entry ledgers, NOT fitted to target profit or queried from future bars.
Actual FET reduction uses live quote and fill read-back. This artifact is
historical 1m OHLC EVIDENCE, not proof that an order would fill.
"""
import datetime as dt,hashlib,json,pathlib,time,urllib.parse,urllib.request
SOURCE_SHA="e1b58060d6263a3af7ced51bec854d3e211d2f35"
TIMES=(1773367200000,1773396000000,1773403200000,1773417600000,
       1773676800000,1773705600000,1773712800000,1773734400000,
       1773741600000,1773748800000,1777910400000,1778054400000,
       1778068800000,1781359200000,1785162600000,1785956400000)
assert TIMES==tuple(sorted(set(TIMES))) and len(TIMES)==16
BASE="https://fapi.asterdex.com/fapi/v3/klines"
def get(t):
    q=urllib.parse.urlencode({"symbol":"FETUSDT","interval":"1m",
      "startTime":t,"endTime":t+59999,"limit":1})
    err=None
    for n in range(5):
        try:
            req=urllib.request.Request(BASE+"?"+q,headers={
             "User-Agent":"DisDexExactHistoricalFetPreemptionEvidence/1.0",
             "Accept":"application/json"})
            with urllib.request.urlopen(req,timeout=24) as f:
                data=json.load(f)
            if not isinstance(data,list) or len(data)!=1 or int(data[0][0])!=t:
                raise ValueError("EXACT_MINUTE_MISSING_OR_WRONG:"+str(t))
            row=data[0]
            if len(row)<6: raise ValueError("ASTER_1M_SCHEMA_SHORT")
            o,h,l,c,v=(float(row[i]) for i in (1,2,3,4,5))
            if not 0<l<=min(o,c)<=max(o,c)<=h or v<0:
                raise ValueError("BAD_ONE_MINUTE_OHLC")
            return {"symbol":"FETUSDT","requestedTs":t,"utc":dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat(),
              "open":o,"high":h,"low":l,"close":c,"volume":v,
              "source":"ASTER_FUTURES_V3_PUBLIC_1M_EXACT",
              "actualExecutableQuoteVerified":False,"historicalMarketOrderFillVerified":False}
        except Exception as e:
            err=e
            time.sleep(min(1+2**n,14))
    raise RuntimeError("FET_EXACT_1M_FAIL_CLOSED:"+str(t)+":"+str(err))
rows=[]
for i,t in enumerate(TIMES):
    rows.append(get(t))
    if (i+1)%4==0:print("FET_EXACT_MARK_PROGRESS",i+1,flush=True)
    time.sleep(.13)
doc={"schema":"source-pinned-current-FET-core-preempt-exact-1m/v1","currentVpsSourceSha":SOURCE_SHA,
    "candidateConflictTimestamps":len(TIMES),"exactRows":len(rows),
    "actualBrokerQuoteAndFillVerified":False,
    "notFormalHistoricalExecution":True,
    "source":"Aster V3 public 1m open; not bid or ask, not validated execution fill","rows":rows}
p=pathlib.Path("research-results/current-five-bt-20260926/fet-core-preempt-exact1m.json")
p.parent.mkdir(parents=True,exist_ok=True)
p.write_text(json.dumps(doc,indent=2)+"\n")
print("SOURCE_NATIVE_FET_EXACT_1M_COMPLETE",len(rows),
      hashlib.sha256(p.read_bytes()).hexdigest(),flush=True)
