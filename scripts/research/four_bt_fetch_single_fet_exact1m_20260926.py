"""Exact read-only Aster V3 1-minute FET public OHLC at 4-strategy conflict.
This is not an executable bid/ask quote or proven historical fill.
"""
import datetime as dt,json,urllib.parse,urllib.request,pathlib,time,hashlib
TS=1777255200000
url="https://fapi.asterdex.com/fapi/v3/klines?"+urllib.parse.urlencode({"symbol":"FETUSDT","interval":"1m","startTime":TS,"endTime":TS+59999,"limit":1})
for attempt in range(6):
 try:
  req=urllib.request.Request(url,headers={"User-Agent":"DisDexFourSourceRuleBT/1.0","Accept":"application/json"})
  with urllib.request.urlopen(req,timeout=20) as f: x=json.load(f)
  assert isinstance(x,list) and len(x)==1 and int(x[0][0])==TS,(attempt,x)
  r=x[0];o,h,l,c,v=(float(r[i]) for i in (1,2,3,4,5))
  assert 0<l<=min(o,c)<=max(o,c)<=h and v>=0
  d={"source":"ASTER_V3_PUBLIC_EXACT_1M","sourceReleaseSha":"e1b58060d6263a3af7ced51bec854d3e211d2f35",
  "symbol":"FETUSDT","ts":TS,"utc":dt.datetime.fromtimestamp(TS/1000,dt.timezone.utc).isoformat(),
  "open":o,"high":h,"low":l,"close":c,"volume":v,
  "historicalExecutableBidAskVerified":False,"historicalFillReadbackVerified":False}
  p=pathlib.Path("research-results/20260926/four/fet-preemption-exact-minute.json");p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2)+"\n")
  print("FET_FOUR_BT_ONE_NEW_CONFLICT_EXACT_PUBLIC_1M_PASS",o,hashlib.sha256(p.read_bytes()).hexdigest());break
 except Exception:
  if attempt==5:raise
  time.sleep(min(2**attempt,12))
