"""DisDex: causal five-minute exit modifications inside formal eight-strategy replay.
No LIVE, no venue API, no source modification. In-sample research only.
Every scenario includes Q102 MR + V4 G5/X05 existing three approved research tweaks.
"""
from __future__ import annotations
import argparse,bisect,collections,functools,io,json,math,time,traceback,zipfile
from pathlib import Path
import idle_profit_trailing_full8_20261016 as base
H=300000
ROOT=Path.home()/"Desktop"/"idle-exit-deep-research-20261016"/"bt120_5m_20261017"
CACHE=ROOT/"monthly_zip"
OUT=ROOT/"integrated_full8"
OUT.mkdir(parents=True,exist_ok=True)
base.OUTROOT=OUT
CONFIGS=json.loads((ROOT/"bt120_predeclared_profiles.json").read_text(encoding="utf8"))
BY_ID={c["id"]:c for c in CONFIGS}
assert len(BY_ID)==120
_base_causal_exit=base.causal_exit
M5MONTHS=[f"{y}-{m:02}" for y,m in [(2025,v) for v in range(8,13)]+[(2026,v) for v in range(1,9)]]
@functools.lru_cache(maxsize=15)
def getdata(sym):
 rows=[]
 for month in M5MONTHS:
  file=CACHE/sym/f"{sym}-5m-{month}.zip"
  if not file.exists():continue
  with zipfile.ZipFile(file) as z:
   with io.TextIOWrapper(z.open(z.namelist()[0]),encoding="utf8") as f:
    for ln in f:
     if not ln or not ln[0].isdigit():continue
     vals=ln.strip().split(",")
     try:
      p=(int(vals[0]),float(vals[1]),float(vals[2]),float(vals[3]),float(vals[4]),float(vals[5]))
      if min(p[1:5])>0:rows.append(p)
     except (ValueError,IndexError):continue
 rows.sort(key=lambda v:v[0]);unique=[]
 for v in rows:
  if not unique or v[0]!=unique[-1][0]:unique.append(v)
 return (unique,[v[0] for v in unique])
BTC_BARS,BTC_TIMES=getdata("BTCUSDT")
BTC_CLOSE={r[0]:r[4] for r in BTC_BARS}
print("INTEGRATED_DATA_BTC",len(BTC_BARS),flush=True)
CURRENT=None
COUNTS=None
COST=None
def update_obs(typ,reason,trade):
 global COUNTS
 if typ=="changed":
  st=trade.get("strategy_id","UNKNOWN")
  COUNTS["changed"]+=1
  COUNTS["byStrategy"][st]=COUNTS["byStrategy"].get(st,0)+1
  COUNTS["byReason"][reason]=COUNTS["byReason"].get(reason,0)+1
 else:
  COUNTS["warnings"][reason]=COUNTS["warnings"].get(reason,0)+1
def m5_override(original,cfg):
 if cfg["name"]=="BASELINE":return original
 st=int(original["entry_ts_ms"]);end=int(original["exit_ts_ms"])
 sg=1 if original["side"]=="LONG" else -1
 sym=original["symbol"]
 entry=float(original["entry_price"])
 if not(entry>0 and end>st):raise RuntimeError("INVALID_ENTRY")
 data,ts=getdata(sym)
 if not data:
  update_obs("warn","NO_5M_"+sym,original);return original
 idx=bisect.bisect_left(ts,st)
 if idx>=len(data) or ts[idx]>st+H:
  update_obs("warn","ENTRY_GAP_"+sym,original);return original
 first=data[idx]
 dev=first[1]/entry-1
 if abs(dev)>.025:
  update_obs("warn","ENTRY_PRICE_DIFFERENCE_"+sym,original);return original
 scale=entry/first[1]
 gross=float(original.get("accepted_gross") or original.get("requested_gross") or original.get("candidate_requested_gross") or 1.0)
 if not math.isfinite(gross) or gross<=0:
  update_obs("warn","INVALID_GROSS",original);return original
 stop=None
 if "risk" in cfg:
  offset=min(.25,float(cfg["risk"])/gross)
  stop=entry*(1-sg*offset)
 if "atrinit" in cfg and idx>=26:
  prev=data[idx-24:idx];atr=sum(max(r[2]-r[3],abs(r[2]-r[4]),abs(r[3]-r[4])) for r in prev)/len(prev)*scale
  stop_distance=min(.12,max(.005,atr*cfg["atrinit"]/entry))
  s=entry*(1-sg*stop_distance)
  stop=s if stop is None else (max(stop,s) if sg==1 else min(stop,s))
 peak=0.
 past_close=[];past_vol=[]
 jend=bisect.bisect_left(ts,end)
 for j in range(idx,jend):
  t,op,hi,lo,cl,vol=data[j]
  if t>=end:break
  if j>idx and t-data[j-1][0]!=H:
   update_obs("warn","INTERNAL_5M_GAP_"+sym,original)
   return original
  op*=scale;hi*=scale;lo*=scale;cl*=scale
  if stop is not None and (lo<=stop if sg==1 else hi>=stop):
   px=(min(op,stop) if sg==1 else max(op,stop))*(1-sg*float(cfg.get("slip",0))/10000)
   return finish(original,t+H,px,"5M_PROTECTIVE_STOP")
  gain=sg*(cl/entry-1)
  peak=max(peak,gain)
  past_close.append(cl);past_vol.append(vol)
  if "arm" in cfg and peak>=float(cfg["arm"]):
   s=entry*(1+sg*float(cfg["floor"]))
   stop=s if stop is None else (max(stop,s) if sg==1 else min(stop,s))
  if "trail_arm" in cfg and peak>=float(cfg["trail_arm"]):
   if "giveback" in cfg:s=entry*(1+sg*(peak-float(cfg["giveback"])))
   else:
    if j<25:continue
    z=data[j-24:j+1]
    atr=sum(max(v[2]-v[3],abs(v[2]-z[k-1][4]) if k else v[2]-v[3],abs(v[3]-z[k-1][4]) if k else v[2]-v[3]) for k,v in enumerate(z))/len(z)
    s=entry*(1+sg*peak)-sg*float(cfg.get("atrtrail",5))*atr*scale
   stop=s if stop is None else (max(stop,s) if sg==1 else min(stop,s))
  if t+H>=end:continue
  rev=False
  if "rev" in cfg and len(past_close)>=4:
   rev=(sg*(past_close[-1]/past_close[-4]-1)<=-float(cfg["rev"]) and gain<0)
  if "btc" in cfg:
   past=BTC_CLOSE.get(t-int(cfg.get("btcminutes",15))*60000)
   now=BTC_CLOSE.get(t)
   if past and now:
    rev=rev or (sg*(now/past-1)<=-float(cfg["btc"]) and sg*(cl/op-1)<-.002 and gain<0)
  if "volume" in cfg and len(past_vol)>=21:
   avg=sum(past_vol[-21:-1])/20
   rev=rev or (avg>0 and vol/avg>=float(cfg["volume"]) and sg*(cl/op-1)<-.004 and gain<0)
  if rev and j+1<jend and data[j+1][0]==t+H:
   px=data[j+1][1]*scale*(1-sg*float(cfg.get("slip",0))/10000)
   return finish(original,t+H,px,"5M_CAUSAL_REVERSAL")
 return original

def finish(original,t,price,reason):
 if price<=0 or t<=int(original["entry_ts_ms"]):raise RuntimeError("INVALID_EXIT")
 if t>int(original["exit_ts_ms"]):raise RuntimeError("LATE_EXIT")
 if t==int(original["exit_ts_ms"]) and abs(price-float(original["exit_price"]))<1e-12:return original
 sg=1 if original["side"]=="LONG" else -1
 update_obs("changed",reason,original)
 return dict(original,exit_ts_ms=t,exit_price=price,exit_reason=reason,
             unit_price_return=sg*(price/float(original["entry_price"])-1))
def apply_policy(row,policy,obs):
 original=_base_causal_exit(row,"combined_no_residual",obs)
 spec=BY_ID.get(policy)
 if spec is None:raise RuntimeError("BAD_POLICY")
 if original.get("strategy_id")!=spec["strategy"]:return original
 return m5_override(original,spec)
base.causal_exit=apply_policy

def execute(policy,cost):
 global CURRENT,COUNTS,COST
 CURRENT=BY_ID[policy];COST=cost
 COUNTS={"changed":0,"byStrategy":{},"byReason":{},"warnings":{}}
 print("CASE_BEGIN",policy,cost,flush=True)
 start=time.monotonic()
 ret=base.run_one(policy,cost)
 obs=ret["observations"]
 o=ret["output"]
 row={"scenario":policy,"strategy":CURRENT["strategy"],"cost_bps":cost,
     "final_jpy":o["final_equity_jpy"],"pf":o["profit_factor"],
     "max_dd_pct":round(100*o["maximum_mtm_drawdown"],4),
     "win_pct":round(100*o["win_rate"],3),
     "total_trades":o["closed_trades"],"trades_by_strategy":o["strategy_trades"],
     "accounting":o["accounting"],"five_minute":COUNTS,"prior3changes":obs,
     "wall_seconds":round(time.monotonic()-start,2),
     "limitations":"Public Binance Vision USD-M 5m price normalized at original entry, 2.5% mismatch veto, original H1 reference BT costs; not Aster signed fills, in-sample only."}
 loc=OUT/policy/f"{cost}bps"/"bt120_integrated_result.json"
 loc.write_text(json.dumps(row,indent=2,ensure_ascii=False),encoding="utf8")
 print("FULL8_5M_RESULT",json.dumps(row,ensure_ascii=False),flush=True)
 return row

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--profiles",default="")
 p.add_argument("--costs",default="10,30")
 args=p.parse_args()
 names=args.profiles.split(",") if args.profiles else [p["id"] for p in CONFIGS]
 for name in names:
  if name not in BY_ID:raise ValueError(name)
  for cost in [int(x) for x in args.costs.split(",")]:
   if (OUT/name/f"{cost}bps"/"bt120_integrated_result.json").exists():
    print("SKIP_EXISTING",name,cost,flush=True);continue
   try:execute(name,cost)
   except Exception as e:
    traceback.print_exc()
    print("FULL8_5M_FAILED",name,cost,repr(e),flush=True)
    raise
 print("BATCH_COMPLETE",len(names),args.costs,flush=True)
