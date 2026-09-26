#!/usr/bin/env python3
"""Retrieve only 15 source-observed Q102 residual MTM timestamps from Aster 1m.
No profit optimization, no historical fill synthesis, no LIVE order path.
Unavailable historical minute bars remain explicit missing evidence.
"""
import datetime,json,pathlib,time,urllib.parse,urllib.request
from collections import Counter
END=int(datetime.datetime(2026,8,10,tzinfo=datetime.timezone.utc).timestamp()*1000)
requests=[
 ("UNIUSDT",1755009000000),("UNIUSDT",1755095400000),
 ("UNIUSDT",1755099000000),("SUIUSDT",1756132200000),
 ("SUIUSDT",1756135800000),("DOGEUSDT",1777473000000),
 ("DOGEUSDT",1778682600000),("ONDOUSDT",1781026200000),
 ("UNIUSDT",1783524600000),("UNIUSDT",1783611000000),
 ("ARBUSTDT",1783960200000),("ARBUSTDT",1784136600000),
 ("NEARUSDT",1784557800000),("UNIUSDT",1784820600000),
 ("UNIUSDT",1785346200000),
]
# Correct the source-recorded ARB symbol spelling; never request a surrogate coin.
requests=[("ARBUSDT" if s=="ARBUSTDT" else s,t) for s,t in requests]
result=[];status=Counter()
for symbol,ts in requests:
 if not (1754784000000<=ts<END and ts%60000==0):raise RuntimeError("INVALID_HISTORICAL_REQUEST")
 params=urllib.parse.urlencode({"symbol":symbol,"interval":"1m",
  "startTime":ts,"endTime":ts+59999,"limit":1})
 url="https://fapi.asterdex.com/fapi/v3/klines?"+params
 rec={"symbol":symbol,"requestedTs":ts,"source":"ASTER_FUTURES_PUBLIC_1M","status":"UNAVAILABLE"}
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"DisDex-Source-Only-Q102-Exact-Mark/20260926"})
   with urllib.request.urlopen(req,timeout=18) as x:payload=json.loads(x.read().decode())
   if not isinstance(payload,list):raise ValueError("INVALID_KLINE_PAYLOAD")
   matching=[x for x in payload if isinstance(x,list) and len(x)>=6 and int(x[0])==ts]
   if not matching:rec["status"]="NO_SOURCE_BAR";break
   candle=matching[0];o=float(candle[1]);vol=float(candle[5])
   if o<=0 or vol<0:raise ValueError("INVALID_SOURCE_OHLC")
   rec.update({"status":"VERIFIED_EXACT_1M","open":o,"volume":vol,
    "timestamp":int(candle[0]),"hasTradeVolume":vol>0});break
  except Exception as e:
   rec["lastErrorType"]=type(e).__name__
   if attempt<2:time.sleep(1.4*(attempt+1))
 result.append(rec);status[rec["status"]]+=1
 time.sleep(.08)
out=pathlib.Path("research-results/old-engine-current-q102-actual-1m-20260926")
out.mkdir(parents=True,exist_ok=True)
obj={"schema":"q102-exact-intrahour-research-only/v1",
 "source":"ASTER_FUTURES_V3_PUBLIC_1M","readOnly":True,
 "priorOnlyRequests":len(requests),"verifiedExactRows":status["VERIFIED_EXACT_1M"],
 "statuses":dict(status),"noSyntheticPrices":True,
 "targetOriginalEngineSha256":"cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d",
 "formalFiveLogicBTCompleted":False,"rows":result}
(out/"exact-intrahour-1m.json").write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
print("Q102_TARGETED_SOURCE_1M",json.dumps({k:obj[k] for k in ("priorOnlyRequests","verifiedExactRows","statuses","noSyntheticPrices")}),flush=True)
