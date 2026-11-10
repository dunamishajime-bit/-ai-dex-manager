#!/usr/bin/env python3
"""Exact modeled portfolio MTM contributions by runner, independent of realized lifetime trade sums."""
from pathlib import Path
from collections import defaultdict
import csv,datetime as dt,gzip,json,hashlib
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=ROOT/"DIRECTION_RESEARCH_20261109"
B=ROOT/"VPS_DD_V4_SORT_PINNED_STOCK15_20261110"
BASE="Y06_NATIVE_LIFECYCLE_M5_AB_";H=3600000
def unix(t):return int(dt.datetime.fromisoformat(t.replace("Z","+00:00")).timestamp()*1000)
def load(cost,name):
 p=B/f"{BASE}{cost}BPS_{name}.csv"
 with p.open(encoding="utf-8-sig",newline="") as f:return p,list(csv.DictReader(f))
h1_cache={}
def bar(symbol,ts):
 if symbol not in h1_cache:
  p=ROOT/"aster-public-v3-h1"/f"{symbol}-1h-20250924-20261001.jsonl.gz"
  with gzip.open(p,"rt",encoding="utf8") as f:h1_cache[symbol]={int(x[0]):float(x[4]) for l in f if l.strip() for x in [json.loads(l)]}
 return h1_cache[symbol].get(ts)
def mtm_open(z,t,partial,fun):
 entry=unix(z["entry_utc"]);assert entry<=t<unix(z["exit_utc"])
 enprice=float(z["model_entry_price"]);originalN=float(z["notional_jpy"]);liveN=originalN;part=0.
 for e in partial.get(z["trade_id"],[]):
  if unix(e["utc"])<=t:
   frac=float(e["closed_fraction_of_current"])
   part+=float(e["realized_gross_pnl_jpy"])-float(e["exit_fee_jpy"])
   liveN*=1-frac
 funded=sum(float(e["modeled_wallet_cashflow_jpy"]) for e in fun.get(z["trade_id"],[]) if unix(e["timestamp_utc"])<=t)
 mark=bar(z["symbol"],(t//H)*H-H)
 if mark is None:raise RuntimeError("MISSING_MARK:"+z["symbol"]+":"+str(t))
 if (t//H)*H<=entry:mark=enprice
 sg=1 if z["side"]=="LONG" else -1
 unreal=liveN*sg*(mark/enprice-1)
 return part+funded-float(z["entry_fee_jpy"])+unreal,{"mark":mark,"entryPrice":enprice,
  "open_notional":liveN,"partials_pnl_net":part,"funded_to_timestamp":funded,
  "entry_fee":float(z["entry_fee_jpy"]),"unrealized":unreal}
audit={"status":"INTEGRATED_MODELED_BOOK_DD_RECONCILIATION_PENDING",
       "source":"research stock1.5 integrated model, pinned V4 order, V2 shadow candidate exits",
       "accounting":"10K + closed net PnL + open marked partial/funding/fees = modeled equity",
       "limitations":["Applies only to old integrated V2 research book, not a certified clean V4 or venue fill history",
        "Runner allocation is arithmetic, not an independent causal proof",
        "If any trade has a reversal before an observed peak or trough, entry snapshot must be rebuilt from reversal event"],
       "cost":{}}
for cost in (10,30):
 fp,fills=load(cost,"FILLS");ep,equity=load(cost,"EQUITY_30MIN")
 pp,partials=load(cost,"PENGU_PARTIAL_EVENTS");fu,funds=load(cost,"FUNDING")
 pmap=defaultdict(list);fmap=defaultdict(list)
 for z in partials:pmap[z["trade_id"]].append(z)
 for z in funds:fmap[z["trade_id"]].append(z)
 eidx={unix(z["utc"]):z for z in equity}
 def snapshot(t):
  classified=defaultdict(float);ongoing=[];closed=0;pending=0;openByRunner=defaultdict(float);byroute=defaultdict(float)
  for z in fills:
   a=unix(z["entry_utc"]);b=unix(z["exit_utc"]);s=z["strategy"]
   if b<=t:
    v=float(z["net_pnl_jpy"]);classified[s]+=v;byroute[s+"|"+z["route"]+"|"+z["side"]]+=v;closed+=1
   elif a<t<b:  # engine snapshots before processing candidates whose entryTs == t
    v,details=mtm_open(z,t,pmap,fmap)
    classified[s]+=v;openByRunner[s]+=v;byroute[s+"|"+z["route"]+"|"+z["side"]]+=v
    ongoing.append({"id":z["source_signal_id"],"runner":s,"symbol":z["symbol"],"side":z["side"],
     "entry":z["entry_utc"],"exit":z["exit_utc"],"contribution":v,**details})
   else:pending+=1
  measured=float(eidx[t]["compounded_mtm_equity_jpy"])
  predicted=10000+sum(classified.values())
  return {"at":dt.datetime.fromtimestamp(t/1000,dt.timezone.utc).isoformat(),
   "measuredEquity":measured,"reconstructedEquity":predicted,"difference":predicted-measured,
   "closedCount":closed,"openCount":len(ongoing),"futureEntries":pending,
   "byRunnerTotalContribution":dict(classified),"openPositions":ongoing,
   "byRunnerOpenContribution":dict(openByRunner),"byRouteTotalContribution":dict(byroute)}
 pmax=-float("inf");peakIdx=None;trough=None;worst=0;peakAt=None
 for t,z in eidx.items():
  v=float(z["compounded_mtm_equity_jpy"])
  if v>pmax:pmax=v;peakIdx=t
  d=v/pmax-1
  if d<worst:worst=d;peakAt=peakIdx;trough=t
 x=snapshot(peakAt);y=snapshot(trough)
 delta={"byRunnerNetJPY":{k:y["byRunnerTotalContribution"].get(k,0)-x["byRunnerTotalContribution"].get(k,0)
  for k in sorted(set(x["byRunnerTotalContribution"])|set(y["byRunnerTotalContribution"]))}}
 delta["byRouteNetJPY"]={k:y["byRouteTotalContribution"].get(k,0)-x["byRouteTotalContribution"].get(k,0)
  for k in sorted(set(x["byRouteTotalContribution"])|set(y["byRouteTotalContribution"]))}
 assert abs(sum(delta["byRouteNetJPY"].values())-sum(delta["byRunnerNetJPY"].values()))<1e-6
 delta["sum"]=sum(delta["byRunnerNetJPY"].values())
 delta["measured"]=y["measuredEquity"]-x["measuredEquity"]
 delta["difference"]=delta["sum"]-delta["measured"]
 if abs(x["difference"])>1e-6 or abs(y["difference"])>1e-6 or abs(delta["difference"])>1e-6:
  print("RECONCILIATION_FAIL",cost,x["difference"],y["difference"],delta["difference"])
 else:print("RECONCILIATION_PASS",cost)
 audit["cost"][str(cost)]={"peak":x,"trough":y,"delta":delta,
  "maxDDPct":100*worst,"sourceHashes":{
     "fills":hashlib.sha256(fp.read_bytes()).hexdigest(),
     "equity":hashlib.sha256(ep.read_bytes()).hexdigest(),
     "partials":hashlib.sha256(pp.read_bytes()).hexdigest(),
     "funding":hashlib.sha256(fu.read_bytes()).hexdigest()}}
 print("COST",cost,"peak",x["at"],"trough",y["at"],"DD",100*worst)
 print("RUNNER_DELTA",[(k,round(v,1)) for k,v in sorted(delta["byRunnerNetJPY"].items(),key=lambda kv:kv[1])])
 print("TOP_LOSERS_BY_ROUTE",[(k,round(v,1)) for k,v in sorted(delta["byRouteNetJPY"].items(),key=lambda kv:kv[1])[:18]])
 print("OPEN_PEAK",[(z["runner"],z["symbol"],round(z["contribution"],2)) for z in x["openPositions"]])
 print("OPEN_TROUGH",[(z["runner"],z["symbol"],round(z["contribution"],2)) for z in y["openPositions"]])
out=D/"integrated_model_peak_trough_route_exact_mtm_attribution_20261110.json"
audit["status"]="RECONCILED" if all(abs(a["peak"]["difference"])<=1e-6 and abs(a["trough"]["difference"])<=1e-6 and abs(a["delta"]["difference"])<=1e-6 for a in audit["cost"].values()) else "UNRECONCILED_DO_NOT_CLAIM_EXACT"
out.write_text(json.dumps(audit,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("FILE",out,"STATUS",audit["status"])
