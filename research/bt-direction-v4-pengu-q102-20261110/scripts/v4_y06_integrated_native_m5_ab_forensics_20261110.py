#!/usr/bin/env python3
"""DisDex Y06 native-vs-60h integrated A/B forensic audit. Read-only."""
import collections, csv, datetime as dt, hashlib, json, os
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
a=R/"VPS_DD_Y06_NATIVE_M5_AB_20261110"
b=R/"VPS_DD_Y06_H60_M5_AB_20261110"
prefix="Y06_NATIVE_LIFECYCLE_M5_AB_"
def table(folder,bps,type):
 with (folder/(prefix+str(bps)+"BPS_"+type+".csv")).open(encoding="utf-8-sig",newline="") as f:
  return list(csv.DictReader(f))
def ts(v):return dt.datetime.fromisoformat(v.replace("Z","+00:00"))
def series_dd(rows):
 peak=-1e100;draw=[]
 for r in rows:
  e=float(r["compounded_mtm_equity_jpy"])
  peak=max(peak,e)
  draw.append(e/peak-1)
 return draw
out={"status":"RESEARCH_ONLY_NOT_FULL_PARITY","costs":{},"base_folder":str(a),
     "candidate_folder":str(b),
     "warnings":["V52 lacks executable book history","stock max gross in this inherited engine is not current production-certified 1.5x",
                 "10/30bps results are in this inherited research engine, not production","portfolio A/B controls all other native tapes"]}
for bps in (10,30):
 ra=json.loads((a/(prefix+str(bps)+"BPS_SUMMARY.json")).read_text(encoding="utf8"))
 rb=json.loads((b/(prefix+str(bps)+"BPS_SUMMARY.json")).read_text(encoding="utf8"))
 ea=table(a,bps,"EQUITY_30MIN");eb=table(b,bps,"EQUITY_30MIN")
 fa=table(a,bps,"FILLS");fb=table(b,bps,"FILLS")
 da=table(a,bps,"DECISIONS");db=table(b,bps,"DECISIONS")
 assert len(ea)==len(eb) and all(x["utc"]==y["utc"] for x,y in zip(ea,eb))
 aa=series_dd(ea);bb=series_dd(eb)
 ai=min(range(len(aa)),key=lambda i:aa[i]);bi=min(range(len(bb)),key=lambda i:bb[i])
 def snapshot(i):
  x,y=ea[i],eb[i]
  return dict(utc=x["utc"],baseline_equity=float(x["compounded_mtm_equity_jpy"]),
    candidate_equity=float(y["compounded_mtm_equity_jpy"]),
    cash_baseline=float(x["wallet_cash_jpy"]),cash_candidate=float(y["wallet_cash_jpy"]),
    baseline_dd=aa[i],candidate_dd=bb[i],
    open_counts=(int(x["open_count"]),int(y["open_count"])),
    total_gross=(float(x["total_gross_x"]),float(y["total_gross_x"])))
 def fill_key(t):return t["source_signal_id"]
 ka={fill_key(x):x for x in fa};kb={fill_key(x):x for x in fb}
 common=set(ka)&set(kb);added=sorted(set(kb)-set(ka));lost=sorted(set(ka)-set(kb))
 modified_y06=[k for k in common if ka[k]["strategy"]=="V4" and
    ka[k]["route"]=="REC_Y06_REV_D0_T72" and
    ka[k]["exit_utc"]!=kb[k]["exit_utc"]]
 byname={}
 for strat in sorted({f["strategy"] for f in fa+fb}):
  o=[x for x in fa if x["strategy"]==strat]
  n=[x for x in fb if x["strategy"]==strat]
  byname[strat]=dict(count_native=len(o),count_h60=len(n),
    net_pnl_jpy_sum_native=sum(float(x["net_pnl_jpy"]) for x in o),
    net_pnl_jpy_sum_h60=sum(float(x["net_pnl_jpy"]) for x in n))
 dmapa={x["signal_id"]:x for x in da};dmapb={x["signal_id"]:x for x in db}
 admission_changed=[{"id":k,"native":dmapa[k]["decision"],"h60":dmapb[k]["decision"],
    "native_reason":dmapa[k]["reason"],"h60_reason":dmapb[k]["reason"],
    "strategy":k.split("_")[0]} for k in dmapa if dmapa[k]["decision"]!=dmapb[k]["decision"]]
 assert len(fa)==ra["modeled_fills"] and len(fb)==rb["modeled_fills"]
 def dist(x,at):
  return int((ts(x["exit_utc"])-at).total_seconds()/3600)
 def nearby(rows,utc,days=4):
  anchor=ts(utc)
  trades=[t for t in rows if abs((ts(t["exit_utc"])-anchor).total_seconds())<=days*24*3600]
  trades.sort(key=lambda t:abs((ts(t["exit_utc"])-anchor).total_seconds()))
  return [{"strategy":t["strategy"],"route":t["route"],"symbol":t["symbol"],
    "net_pnl_jpy":round(float(t["net_pnl_jpy"]),2),"exit_utc":t["exit_utc"]} for t in trades[:10]]
 out["costs"][str(bps)]=dict(
  equity_native=ra["final_compounded_jpy"],equity_h60=rb["final_compounded_jpy"],
  drawdown_native=ra["max_hourly_dd_pct"],drawdown_h60=rb["max_hourly_dd_pct"],
  delta_dd_points=rb["max_hourly_dd_pct"]-ra["max_hourly_dd_pct"],
  delta_equity=rb["final_compounded_jpy"]-ra["final_compounded_jpy"],
  native_trough=snapshot(ai),h60_trough=snapshot(bi),
  common_fills=len(common),new_fills=len(added),removed_fills=len(lost),
  changed_y06_native_fills=len(modified_y06),
  added_samples=[{"id":k,"strategy":kb[k]["strategy"],"symbol":kb[k]["symbol"],"route":kb[k]["route"],"entry":kb[k]["entry_utc"]} for k in added[:15]],
  removed_samples=[{"id":k,"strategy":ka[k]["strategy"],"symbol":ka[k]["symbol"],"route":ka[k]["route"],"entry":ka[k]["entry_utc"]} for k in lost[:15]],
  admission_changed=admission_changed[:30],admission_changes_total=len(admission_changed),
  net_pnl_by_strategy=byname,
  nearest_native_trough_closes=nearby(fa,ea[ai]["utc"]),
  nearest_h60_trough_closes=nearby(fb,eb[bi]["utc"]))
 p=R/"DIRECTION_RESEARCH_20261109"/"v4_y06_integrated_native_m5_ab_forensics_20261110.json"
 p.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
 print("BPS",bps,"EQUITY",round(ra["final_compounded_jpy"],2),round(rb["final_compounded_jpy"],2),
       "DD",ra["max_hourly_dd_pct"],rb["max_hourly_dd_pct"],
       "TROUGHS",ea[ai]["utc"],eb[bi]["utc"],
       "NEW_FILLS",len(added),"LOST_FILLS",len(lost),"Y06_CHANGED",len(modified_y06),
       "ADMISSION_CHANGES",len(admission_changed),flush=True)
 print("ADDED",[(k,kb[k]["strategy"],kb[k]["route"]) for k in added[:12]],flush=True)
 print("PROFIT_DELTA_BY_STRAT",[(s,round(z["net_pnl_jpy_sum_h60"]-z["net_pnl_jpy_sum_native"],2)) for s,z in byname.items()],flush=True)
print("SAVED",p)
