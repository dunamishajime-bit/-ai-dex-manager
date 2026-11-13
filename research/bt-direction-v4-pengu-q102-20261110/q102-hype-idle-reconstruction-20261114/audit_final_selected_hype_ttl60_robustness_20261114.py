import csv,json,datetime as dt,hashlib
from pathlib import Path
from collections import defaultdict
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"S3_P3_HYPECONS10_ONHEALTH_TTL60_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
OUT=R/"DIRECTION_RESEARCH_20261109"/"final_selected_hype_ttl60_full_robustness_20261114.json"
def ts(s):return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
report={"status":"RESEARCH_ONLY_FINAL_SELECTED_HYPE_TTL60_ROBUSTNESS","selectionUsesTargetYearForAdoptedRules":False,"costs":{}}
for bps in (10,30):
 ep=next(D.glob(f"*_{bps}BPS_EQUITY_30MIN.csv"))
 fp=next(D.glob(f"*_{bps}BPS_FILLS.csv"))
 er=list(csv.DictReader(open(ep,encoding="utf-8-sig")))
 fills=list(csv.DictReader(open(fp,encoding="utf-8-sig")))
 bym={}
 peak=float(er[0]["compounded_mtm_equity_jpy"]);pt=ts(er[0]["utc"]);mdd=0;pk=None;tr=None
 for x in er:
  t=ts(x["utc"]);m=f"{t.year:04d}-{t.month:02d}";e=float(x["compounded_mtm_equity_jpy"])
  if m not in bym:bym[m]={"first":e,"last":e}
  bym[m]["last"]=e
  if e>peak:peak=e;pt=t
  dd=e/peak-1
  if dd<mdd:mdd=dd;pk=(pt,peak);tr=(t,e)
 mf=defaultdict(list);routes=defaultdict(lambda:{"n":0,"wins":0,"net":0.0,"gp":0.0,"gl":0.0})
 for x in fills:
  t=ts(x["exit_utc"]);m=f"{t.year:04d}-{t.month:02d}";p=float(x["net_pnl_jpy"]);mf[m].append(p)
  k=(x["strategy"],x["symbol"],x["side"],x["route"]);z=routes[k];z["n"]+=1;z["wins"]+=p>0;z["net"]+=p
  if p>0:z["gp"]+=p
  elif p<0:z["gl"]-=p
 months={}
 for m,z in bym.items():
  ps=mf.get(m,[]);gp=sum(v for v in ps if v>0);gl=-sum(v for v in ps if v<0)
  months[m]={"equity_return_pct":100*(z["last"]/z["first"]-1),"fills":len(ps),
             "wr_pct":100*sum(v>0 for v in ps)/len(ps) if ps else None,
             "pf":gp/gl if gl else (999.0 if gp else None),"net_pnl_jpy":sum(ps)}
 rts=[]
 for k,z in routes.items():
  rts.append({"strategy":k[0],"symbol":k[1],"side":k[2],"route":k[3],
              "n":z["n"],"wr":z["wins"]/z["n"],"net":z["net"],"pf":z["gp"]/z["gl"] if z["gl"] else 999.0})
 ov=[]
 for x in fills:
  et=ts(x["entry_utc"]);xt=ts(x["exit_utc"])
  if et<=tr[0] and xt>=pk[0]:
   ov.append({"strategy":x["strategy"],"symbol":x["symbol"],"side":x["side"],"route":x["route"],
              "entry":x["entry_utc"],"exit":x["exit_utc"],"gross":float(x["gross_x"]),
              "net":float(x["net_pnl_jpy"]),"reason":x["exit_model_reason"]})
 report["costs"][str(bps)]={"months":months,"routeContribution":sorted(rts,key=lambda z:(z["strategy"],z["net"])),
                           "maxDD":{"pct":mdd*100,"peakUtc":str(pk[0]),"troughUtc":str(tr[0]),
                                    "overlapWorst":sorted(ov,key=lambda z:z["net"])[:40]}}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
for bps in ("10","30"):
 c=report["costs"][bps]
 months=sorted(c["months"])
 print("\n=== BPS",bps,"===")
 print("MONTH_BREADTH",sum(c["months"][m]["equity_return_pct"]>0 for m in months),"/",len(months))
 for m in months:
  z=c["months"][m]
  print(m,"RET",round(z["equity_return_pct"],2),"fills",z["fills"],"WR",None if z["wr_pct"] is None else round(z["wr_pct"],1),"PF",None if z["pf"] is None else round(z["pf"],2))
 print("MAXDD",c["maxDD"]["pct"],c["maxDD"]["peakUtc"],c["maxDD"]["troughUtc"])
 print("Q102/IDLE ROUTES")
 for x in c["routeContribution"]:
  if x["strategy"] in ("Q102","IDLE","HYPE"):
   print(json.dumps({k:(round(v,4) if isinstance(v,float) else v) for k,v in x.items()},ensure_ascii=False))
 print("MDD_WORST")
 for x in c["maxDD"]["overlapWorst"][:20]:print(json.dumps(x,ensure_ascii=False))
