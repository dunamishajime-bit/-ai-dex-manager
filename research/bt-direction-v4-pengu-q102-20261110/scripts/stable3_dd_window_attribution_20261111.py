#!/usr/bin/env python3
from pathlib import Path
import csv,datetime as dt,collections,json,hashlib

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON_20261111"
OUT=R/"DIRECTION_RESEARCH_20261109"/"stable3_dd_window_attribution_20261111.json"

def parse(s):return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
def load_csv(p):
 with p.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
result={}
for bps in (10,30):
 eqp=next(D.glob(f"*_{bps}BPS_EQUITY_30MIN.csv"))
 fp=next(D.glob(f"*_{bps}BPS_FILLS.csv"))
 eq=load_csv(eqp);fills=load_csv(fp)
 vals=[float(x["compounded_mtm_equity_jpy"]) for x in eq]
 peak=-1.;peak_i=0;mdd=0.;mi=(0,0)
 for i,v in enumerate(vals):
  if v>peak:peak=v;peak_i=i
  dd=v/peak-1
  if dd<mdd:mdd=dd;mi=(peak_i,i)
 a,b=mi;pt=parse(eq[a]["utc"]);tt=parse(eq[b]["utc"])
 ex=[z for z in fills if pt<=parse(z["exit_utc"])<=tt]
 by=collections.defaultdict(lambda:{"n":0,"netPnlJpy":0.,"grossPnlJpy":0.,"wins":0})
 groups=collections.defaultdict(lambda:{"n":0,"netPnlJpy":0.})
 for z in ex:
  q=by[z["strategy"]];q["n"]+=1;q["netPnlJpy"]+=float(z["net_pnl_jpy"]);q["grossPnlJpy"]+=float(z["pnl_before_cost_jpy"]);q["wins"]+=float(z["net_pnl_jpy"])>0
  g=groups[(z["strategy"],z["symbol"],z["route"])];g["n"]+=1;g["netPnlJpy"]+=float(z["net_pnl_jpy"])
 worst_groups=[{"strategy":k[0],"symbol":k[1],"route":k[2],**v} for k,v in sorted(groups.items(),key=lambda kv:kv[1]["netPnlJpy"])[:20]]
 worst_trades=[{"exitUtc":z["exit_utc"],"strategy":z["strategy"],"symbol":z["symbol"],"side":z["side"],"route":z["route"],
                "netPnlJpy":float(z["net_pnl_jpy"]),"reason":z["exit_model_reason"]} for z in sorted(ex,key=lambda z:float(z["net_pnl_jpy"]))[:20]]
 result[str(bps)]={
  "peakUtc":eq[a]["utc"],"peakEquityJpy":vals[a],"troughUtc":eq[b]["utc"],"troughEquityJpy":vals[b],
  "maxDrawdownPct":mdd*100,"durationDays":(tt-pt).total_seconds()/86400,
  "exitAttributionByStrategy":dict(by),"worstGroups":worst_groups,"worstTrades":worst_trades,
  "hashes":{"equity":hashlib.sha256(eqp.read_bytes()).hexdigest(),"fills":hashlib.sha256(fp.read_bytes()).hexdigest()}
 }
out={"status":"TARGET_DIAGNOSTIC_ONLY_DO_NOT_SELECT_RULES","case":"STABLE3","results":result,
     "warning":"This target-year attribution is for prioritizing pretarget research only. No gate/threshold may be selected from these losses."}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print(json.dumps({"10":{k:v for k,v in result["10"].items() if k in ("peakUtc","troughUtc","maxDrawdownPct","exitAttributionByStrategy")},
                  "30":{k:v for k,v in result["30"].items() if k in ("peakUtc","troughUtc","maxDrawdownPct","exitAttributionByStrategy")}},ensure_ascii=False))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
