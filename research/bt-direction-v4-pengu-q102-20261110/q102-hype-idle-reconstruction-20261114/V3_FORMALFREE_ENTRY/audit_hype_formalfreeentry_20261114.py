import csv,json,math,hashlib
from pathlib import Path
from collections import Counter,defaultdict
from datetime import datetime,timezone
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
cases={
 "WAIT":R/"S3_P3_HYPEWAIT_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261113",
 "FORMALFREE":R/"S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114",
}
def read_csv(p):
 with open(p,newline="",encoding="utf-8-sig") as f:return list(csv.DictReader(f))
def pref(d,bps,suffix):
 xs=list(d.glob(f"*_{bps}BPS_{suffix}"))
 assert len(xs)==1,(d,bps,suffix,xs)
 return xs[0]
def equity_audit(p):
 rows=read_csv(p)
 vals=[(r["utc"],float(r["compounded_mtm_equity_jpy"])) for r in rows]
 peak=vals[0][1];peak_t=vals[0][0];maxdd=0;dd_peak=peak_t;dd_trough=peak_t;troughv=peak
 months={}
 month_first={}
 for t,v in vals:
  m=t[:7]
  if m not in month_first:month_first[m]=v
  months[m]=v
  if v>peak:peak=v;peak_t=t
  dd=v/peak-1
  if dd<maxdd:maxdd=dd;dd_peak=peak_t;dd_trough=t;troughv=v
 mr={}
 prev=vals[0][1]
 for m in sorted(months):
  mr[m]=months[m]/prev-1
  prev=months[m]
 return {"final":vals[-1][1],"maxdd":maxdd,"ddPeak":dd_peak,"ddTrough":dd_trough,
         "monthlyReturns":mr,"positiveMonths":sum(x>0 for x in mr.values()),"negativeMonths":sum(x<0 for x in mr.values()),
         "worstMonth":min(mr.items(),key=lambda kv:kv[1]),"bestMonth":max(mr.items(),key=lambda kv:kv[1])}
out={"status":"RESEARCH_ONLY_HYPE_FORMAL_FREE_ENTRY_AUDIT","productionMutation":False,"cases":{}}
for name,d in cases.items():
 man=json.load(open(d/"RUN_MANIFEST.json",encoding="utf-8-sig"))
 cc={"manifest":man["results"],"bps":{}}
 for bps in (10,30):
  eq=equity_audit(pref(d,bps,"EQUITY_30MIN.csv"))
  fills=read_csv(pref(d,bps,"FILLS.csv"))
  dec=read_csv(pref(d,bps,"DECISIONS.csv"))
  risks=read_csv(pref(d,bps,"SHARED_RISK_EVENTS.csv"))
  hf=[x for x in fills if x["strategy"]=="HYPE"]
  hp=[float(x["net_pnl_jpy"]) for x in hf]
  hgp=sum(x for x in hp if x>0);hgl=-sum(x for x in hp if x<0)
  reasons=Counter(x["reason"] for x in dec if x["strategy"]=="HYPE")
  cc["bps"][str(bps)]={"equity":eq,
    "hype":{"fills":len(hf),"wins":sum(x>0 for x in hp),"losses":sum(x<=0 for x in hp),
             "winRate":sum(x>0 for x in hp)/len(hp) if hp else None,"netPnlJpy":sum(hp),
             "profitFactorJpy":hgp/hgl if hgl else (999 if hgp else None),
             "routes":dict(Counter(x["route"] for x in hf)),
             "exitReasons":dict(Counter(x["exit_model_reason"] for x in hf)),
             "trades":[{k:x[k] for k in ("trade_id","entry_utc","exit_utc","exit_model_reason","net_pnl_jpy","gross_x")} for x in hf]},
    "hypeDecisionReasons":dict(reasons),
    "sharedRisk":{"trip":sum(x["event"]=="TRIP" for x in risks),"flatten":sum(x["event"]=="FLATTEN" for x in risks)}}
 out["cases"][name]=cc
# deltas
for bps in ("10","30"):
 a=out["cases"]["WAIT"]["bps"][bps]["equity"];b=out["cases"]["FORMALFREE"]["bps"][bps]["equity"]
 out.setdefault("delta",{})[bps]={"finalJpy":b["final"]-a["final"],"finalRatio":b["final"]/a["final"],
                                  "maxDdPctPoint":100*(b["maxdd"]-a["maxdd"]),
                                  "positiveMonthsDelta":b["positiveMonths"]-a["positiveMonths"]}
p=R/"DIRECTION_RESEARCH_20261109"/"hype_formalfreeentry_exact_audit_20261114.json"
p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("SAVED",p,"SHA256",hashlib.sha256(p.read_bytes()).hexdigest())
for bps in ("10","30"):
 print("\nBPS",bps,"DELTA",out["delta"][bps])
 for name in ("WAIT","FORMALFREE"):
  z=out["cases"][name]["bps"][bps]
  print(name,"EQ",z["equity"])
  print(name,"HYPE",json.dumps(z["hype"],ensure_ascii=False))
  print(name,"HYPE_REASONS",z["hypeDecisionReasons"],"RISK",z["sharedRisk"])