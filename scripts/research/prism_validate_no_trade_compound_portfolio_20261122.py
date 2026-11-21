#!/usr/bin/env python3
"""Independent CSV readback of PRISM III no-volume gate full-compound replay.

All 5min MTM samples, realized fills and profit factors are recalculated
independently of the simulator summary/manifest. No new trading logic.
"""
from __future__ import annotations
import csv,datetime as dt,hashlib,json,math,statistics,sys
from collections import Counter
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
BASE=ROOT/"DD_MLX_COHERENT_CONTROL_20261121"
MOD=ROOT/"DD_PRISM3_PENGU_TRADEABLE_H1_ENTRY_20261122"
BAD={"PENGU_00016","PENGU_00071","PENGU_00083","PENGU_00093"}
EXPECTED_ACTIVE={"PENGU_00016","PENGU_00071","PENGU_00093"}
def checksum(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def ffile(folder,fee,suffix):
 a=list(folder.glob(f"*_{fee}BPS_{suffix}"))
 if len(a)!=1:raise ValueError("FILE_NOT_UNIQUE:"+str(folder)+":"+suffix)
 return a[0]
def calc(folder,fee):
 eqfile=ffile(folder,fee,"EQUITY_30MIN.csv")
 flfile=ffile(folder,fee,"FILLS.csv")
 smfile=ffile(folder,fee,"SUMMARY.json")
 summ=json.loads(smfile.read_text(encoding="utf8"))
 peak=-1.0;maxdd=0.0;peakwhen=None;troughwhen=None;origin=None;peak_at_trough=None
 n=0;final=None;trough_eq=None
 with eqfile.open(encoding="utf-8-sig",newline="") as f:
  for row in csv.DictReader(f):
   val=float(row["compounded_mtm_equity_jpy"])
   if not (val>0 and math.isfinite(val)):raise ValueError("BAD_EQUITY_VALUE")
   n+=1
   if n==1:origin=row["utc"];first=val
   if val>peak:peak=val;peakwhen=row["utc"]
   dd=100*(1-val/peak)
   if dd>maxdd:
    maxdd=dd;troughwhen=row["utc"];trough_eq=val;peak_at_trough=peak;peakdate=peakwhen
   final=val
 with flfile.open(encoding="utf-8-sig",newline="") as f:fills=list(csv.DictReader(f))
 wins=sum(float(x["net_pnl_jpy"])>0 for x in fills)
 profit=sum(max(float(x["net_pnl_jpy"]),0) for x in fills)
 losses=sum(min(float(x["net_pnl_jpy"]),0) for x in fills)
 pf=profit/-losses if losses<0 else None
 nos=[x for x in fills if x["source_signal_id"] in BAD]
 runner=Counter(x["strategy"] for x in fills)
 if n!=105121:raise ValueError("MTM_POINT_COUNT_DIFFERENCE:"+str(n))
 if abs(maxdd-abs(float(summ["max_hourly_dd_pct"])))>1e-6:
  raise ValueError("MAX_DD_NOT_RECALCULATED:"+str(maxdd)+" vs "+str(summ["max_hourly_dd_pct"]))
 if len(fills)!=int(summ["modeled_fills"]) or abs(100*wins/len(fills)-float(summ["win_rate_pct"]))>1e-6:
  raise ValueError("WR_FILL_COUNT_MISMATCH")
 if pf is not None and abs(pf-summ["profit_factor"])>1e-6:raise ValueError("PF_RECALC_MISMATCH")
 # Summary's final compounded amount is wallet cash at final time, while MTM
 # may include positions still open at the terminal boundary.
 return {"fee_bps":fee,"case":folder.name,
  "equity_first":first,"mtm_at_last":final,"summary_final_wallet_jpy":summ["final_compounded_jpy"],
  "mdd_pct":round(maxdd,6),"dd_peak_utc":peakdate,"dd_trough_utc":troughwhen,
  "dd_peak_jpy":round(peak_at_trough,4),"dd_trough_jpy":round(trough_eq,4),
  "filling_n":len(fills),"wins":wins,"winrate_pct":round(100*wins/len(fills),6),
  "pf":round(pf,6) if pf is not None else None,
  "runner_counts":dict(runner),"forbidden_trades":[
   {k:x[k] for k in ("source_signal_id","strategy","route","entry_utc","net_pnl_jpy")} for x in nos],
  "verified_mtm_samples":n,
  "sha256":{eqfile.name:checksum(eqfile),flfile.name:checksum(flfile),smfile.name:checksum(smfile)}}
results={}
for fee in (10,30):
 a=calc(BASE,fee);b=calc(MOD,fee)
 results[str(fee)]={"control":a,"volume_aware":b,
   "dd_improvement_points":round(a["mdd_pct"]-b["mdd_pct"],6),
   "net_wallet_change_jpy":round(b["summary_final_wallet_jpy"]-a["summary_final_wallet_jpy"],4),
   "wins_change":b["wins"]-a["wins"],"fills_change":b["filling_n"]-a["filling_n"],
   "winrate_improvement_points":round(b["winrate_pct"]-a["winrate_pct"],6)}
 if {t["source_signal_id"] for t in a["forbidden_trades"]}!=EXPECTED_ACTIVE:
  raise ValueError("CONTROL_FORBIDDEN_SOURCE_ADMISSIONS_CHANGED")
 if b["forbidden_trades"]:raise ValueError("ZERO_VOLUME_TRADES_STILL_IN_NEW_SIM")
 print("INDEPENDENT",fee,"DD",a["mdd_pct"],"->",b["mdd_pct"],
       "WR",a["winrate_pct"],"->",b["winrate_pct"],
       "profits",a["summary_final_wallet_jpy"],"->",b["summary_final_wallet_jpy"],flush=True)
assert results["10"]["dd_improvement_points"]>10
assert abs(results["30"]["dd_improvement_points"])<.01
assert results["10"]["volume_aware"]["mdd_pct"]>20
assert results["30"]["volume_aware"]["mdd_pct"]>20
audit={"schema":"disdex-prism3-compound-no-execution-gate-recomputed/v1",
  "basis":"unchanged previous STABLE3 GROSS425 source/fee model and V52 exit latch corrected",
  "caveats":["Research-only model retains target-year-selected research Gate, Gross4.25 and V52 price proxy; NOT current Production parity",
  "HYPE and other runners unchanged in code, but their admissions/gross can change after removing trades",
  "No zero-volume historical venue fills are signed; rejecting no-trade hour is a model quality correction",
  "This audit does not confirm live exchange availability, fees, funding actual, STOP resident orders, or owner approvals",
  "MTM is rechecked from full 105121 samples each scenario; WIN PnL and PF independently recomputed",
  "10bps and 30bps both must pass DD20. Neither does."],
  "results":results}
OUT.mkdir(exist_ok=True)
(OUT/"PRISM_VOLUME_GATE_FULL_COMPOUND_INDEPENDENT_RECALC.json").write_text(
 json.dumps(audit,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM_VOLUME_GATE_FULL_COMPOUND_VALIDATED_PASS",flush=True)
