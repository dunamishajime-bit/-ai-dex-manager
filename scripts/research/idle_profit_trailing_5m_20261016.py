"""Public Aster 5m historical data; frozen accepted Idle-only exit replay. No signed account or orders."""
import pathlib,json,urllib.request,urllib.parse,time,datetime,collections,statistics,math
import os
ROOT=pathlib.Path(os.environ["DISDEX_V4_FROZEN_RESEARCH_ROOT"]).resolve()/"docs/research/results/v12-v2-integrated-confirm-20261009/cases/V2_M150_D05_CORE_NATIVE/runs"
OUT=pathlib.Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/idle-profit-trailing-5m-20261016")).resolve()
OUT.mkdir(parents=True,exist_ok=True)
CACHED=OUT/"aster_5m_cached_accepted_trades.json"
TF=300000
cases={}
for cost in (10,30):
 rows=[json.loads(s) for s in (ROOT/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl").read_text(encoding="utf8").splitlines() if s]
 cases[cost]=[r for r in rows if r.get("strategy_id")=="IDLE"]
unique={}
for r in cases[10]+cases[30]:
 key=r["symbol"]+":"+str(r["entry_ts_ms"])
 unique[key]=r
print("UNIQUE_TRADES",len(unique),flush=True)
if CACHED.exists():
 try:cache=json.loads(CACHED.read_text(encoding="utf8"))
 except:cache={}
else:cache={}
failed=[]
for i,(key,r) in enumerate(unique.items(),1):
 if key in cache:continue
 sym=r["symbol"];start=int(r["entry_ts_ms"]);stop=int(r["exit_ts_ms"])
 start_bar=((start+TF-1)//TF)*TF
 end_limit=max(int(x["exit_ts_ms"]) for x in cases[10]+cases[30] if x["symbol"]==sym and x["entry_ts_ms"]==start)
 params={"symbol":sym,"interval":"5m","startTime":start_bar,"endTime":end_limit+TF,"limit":500}
 url="https://fapi.asterdex.com/fapi/v1/klines?"+urllib.parse.urlencode(params)
 data=None
 for attempt in range(2):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":"DisDex-Research-PublicHistorical/1.0"})
   with urllib.request.urlopen(req,timeout=20) as rr:data=json.loads(rr.read().decode())
   break
  except Exception as e:
   if attempt==1:failed.append((key,str(e)[:120]))
   else:time.sleep(2)
 if data is not None:
  cache[key]=[[int(v[0]),float(v[1]),float(v[2]),float(v[3]),float(v[4])] for v in data]
 if i%10==0:
  CACHED.write_text(json.dumps(cache),encoding="utf8")
  print("PUBLIC_DATA_PROGRESS",i,len(unique),"cache",len(cache),"failed",len(failed),flush=True)
 time.sleep(.16)
CACHED.write_text(json.dumps(cache),encoding="utf8")
print("DOWNLOAD_DONE","CACHE",len(cache),"FAILED",failed[:8],flush=True)
scopes={"ALL":None,"DR":{"DOTUSDT","RENDERUSDT"},"DRJ":{"DOTUSDT","RENDERUSDT","JUPUSDT"},"DOT":{"DOTUSDT"}}
variants=[(arm,gap,scope) for scope in scopes for arm in (.03,.04) for gap in (.005,.01,.015,.02)]
def metrics(rowvals,cost):
 a=[]
 for o,new in rowvals:
  g=float(o["accepted_gross"])
  a.append(((o["entry_price"]-new)/o["entry_price"]-cost/10000)*g)
 gain=sum(max(x,0) for x in a);loss=-sum(min(x,0) for x in a)
 return {"n":len(a),"pf":round(gain/loss,4) if loss else None,"sumWeightedPctpoints":round(sum(a)*100,5),"winPct":round(100*sum(x>0 for x in a)/len(a),3) if a else None}
outputs={}
for cost,entries in cases.items():
 x={}
 for arm,gap,scope in variants:
  selections=[];replaced=0;armed=0;gaps=0
  all_original=[]
  for r in entries:
   key=r["symbol"]+":"+str(r["entry_ts_ms"])
   bars=cache.get(key)
   if not bars or (scopes[scope] is not None and r["symbol"] not in scopes[scope]):
    selections.append((r,r["exit_price"]));all_original.append((r,r["exit_price"]));continue
   data={int(v[0]):v for v in bars}
   start=int(r["entry_ts_ms"]);end=int(r["exit_ts_ms"])
   price=float(r["entry_price"]);hiwater=0;stop=None;wasarmed=False;fill=None;missing=False
   for t in range(((start+TF-1)//TF)*TF,end,TF):
    z=data.get(t)
    if z is None:
     gaps+=1;missing=True;break
    op,high,low,close=(z[1],z[2],z[3],z[4])
    if stop is not None and t+TF<end and (op>=stop or high>=stop):
     fill=max(op,stop);break
    hiwater=max(hiwater,(price-close)/price)
    if hiwater>=arm:
     if not wasarmed:armed+=1;wasarmed=True
     proposal=price*(1-hiwater+gap)
     stop=proposal if stop is None else min(stop,proposal)
   if missing:fill=None
   new=r["exit_price"] if fill is None else fill
   if fill is not None:replaced+=1
   selections.append((r,new));all_original.append((r,r["exit_price"]))
  a=metrics(all_original,cost);b=metrics(selections,cost)
  x[f"arm{arm:.3f}_gap{gap:.3f}_{scope}"]={
     "baseline":a,"candidate":b,"deltaWeightedPctpoints":round(b["sumWeightedPctpoints"]-a["sumWeightedPctpoints"],5),
     "stops":replaced,"armed":armed,"gaps":gaps,
     "split":{part:round(sum(100*(o["exit_price"]-new)/o["entry_price"]*float(o["accepted_gross"]) for o,new in selections if (o["entry_ts_ms"]<1769904000000)==(part=="early")),5) for part in ("early","late")}}
 outputs[str(cost)]=x
 print("COST",cost,"BASE",a,flush=True)
 for name,result in sorted(x.items(),key=lambda p:p[1]["deltaWeightedPctpoints"],reverse=True)[:18]:
  print("5M_CASE",cost,name,"DELTA",result["deltaWeightedPctpoints"],"PF",result["candidate"]["pf"],"STOPS",result["stops"],"ARM",result["armed"],"EARLY",result["split"]["early"],"LATE",result["split"]["late"],flush=True)
p=OUT/"aster5m_accepted_idle_trailing_results.json"
p.write_text(json.dumps({"source":"PUBLIC_ASTER_5M","warning":"Accepted entry frozen, no integrated gross, 5m interval gap and execution model; not LIVE certification","errors":failed,"results":outputs},indent=2),encoding="utf8")
print("SAVED",p,p.stat().st_size,flush=True)
