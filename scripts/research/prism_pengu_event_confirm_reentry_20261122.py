#!/usr/bin/env python3
"""PRISM II: Event-driven 5m follow-through confirmation and price-reanchored entry.

PENGU route remains SHORT for SHORT_V20. These are RESEARCH ONLY, separate
fixed-horizon simulated price outcomes, NOT native exit/live order parity.
"""
from __future__ import annotations
import csv,datetime as dt,json,math,sys,contextlib,io,statistics
from collections import defaultdict,Counter
from pathlib import Path
# Imports shared, independently validated M5 reader and stop-first simulator.
with contextlib.redirect_stdout(io.StringIO()):
 import prism_pengu_m5_entry_confirmation_20261122 as m
OUT=m.OUT
WINDOW_HOURS=(6,12,24)
THRESHOLD_PCT=(1,2,3,4)
SUSTAIN_BARS=(2,6)
HORIZONS=(24,48,72)
ROUTES=("RECOVERY_V8","SHORT_V20","LONG_V64")
END=m.END
DATA=m.coins["PENGUUSDT"]
a=DATA["b"];tslist=DATA["t"];at=DATA["i"]

def phase(ts):return "development" if ts<m.CUT1 else ("validation" if ts<m.CUT2 else "post_validation")
def signal_trigger(si,window_h,threshold,n_sustain,volume_confirm=False):
 start=si["entryTs"];i=at.get(start)
 if i is None:return None
 if start+(window_h*3600000)>=END:return None
 end=at.get(start+window_h*3600000)
 if end is None:return None
 if tslist[end]-tslist[i]!=(end-i)*m.BAR:return None
 side=1 if si["side"]=="LONG" else -1
 ref=float(si["model"]["entryPrice"])
 if ref<=0:raise ValueError("BAD_REFERENCE")
 thr=ref*(1+side*threshold/100)
 for j in range(i+n_sustain-1,end):
  # Use only *closed* candles; buy at the next candle's open.
  def meets(bar):
   return (bar[3]>=thr) if side==1 else (bar[3]<=thr)
  if not all(meets(a[k]) for k in range(j-n_sustain+1,j+1)):continue
  if volume_confirm:
   look=a[max(i,j-5):j+1]
   v=sum(k[4] for k in look)
   ratio=sum((k[5] if side==1 else k[4]-k[5]) for k in look)/v if v>0 else 0
   if ratio<.54:continue
  fill_idx=j+1
  if fill_idx>=len(a):return None
  ts=tslist[fill_idx]
  if ts!=tslist[j]+m.BAR:return None
  return {"confirm_utc":dt.datetime.fromtimestamp(ts/1000,dt.timezone.utc).isoformat(),
    "entryTs":ts,"entry_price":a[fill_idx][0],
    "signal_price":ref,"side":si["side"],"entry_relative_move_pct":100*side*(a[fill_idx][0]/ref-1),
    "wait_hours":(ts-start)/3600000}
 return None

def stats(x):
 n=len(x);wins=sum(v>0 for v in x)
 return {"n":n,"wins":wins,"wr_pct":round(100*wins/n,2) if n else None,
         "mean_pct":round(statistics.mean(x),3) if n else None,
         "sum_pct":round(sum(x),3) if n else None,
         "losses":n-wins}

def gross(x):
 return x["return"]
signals=[s for s in m.signals if s["route"] in ROUTES]
assert len(signals)==116
candidates={}
for si in signals:
 ts=si["entryTs"];i=at.get(ts)
 if i is None:continue
 if i+1>=len(a):continue
 srcparity_pct=abs(a[i][0]/si["model"]["entryPrice"]-1)*100
 candidates[si["id"]]={"si":si,"ts":ts,"parity_gt5bps":srcparity_pct>.05,
                        "parity_pct":srcparity_pct}
res=[]
traces=[]
skipped=Counter()
for route in ROUTES:
 for ph in ("development","validation","post_validation"):
  candidates_this=[z for z in candidates.values() if z["si"]["route"]==route and phase(z["ts"])==ph]
  for horizon in HORIZONS:
   base_by={}
   for item in candidates_this:
    si=item["si"];src=si["entryTs"]
    out=m.stop_horizon("PENGUUSDT",src,horizon,
        a[at[src]][0],1 if si["side"]=="LONG" else -1,.06 if route=="RECOVERY_V8" else .08)
    if out is None:
     skipped["baseline_stop_data_unavailable"]+=1;continue
    base_by[si["id"]]=out
   for window in WINDOW_HOURS:
    for threshold in THRESHOLD_PCT:
     for sustain in SUSTAIN_BARS:
      for volume in (False,True):
       key=f"FOLLOW_{threshold}PCT_SUSTAIN_{sustain}X5M_WINDOW_{window}H"+("_TAKER54" if volume else "")
       paired=[]
       triggered=[]
       for item in candidates_this:
        si=item["si"]
        if si["id"] not in base_by:continue
        conf=signal_trigger(si,window,threshold,sustain,volume_confirm=volume)
        if conf is None:continue
        shifted=m.stop_horizon("PENGUUSDT",conf["entryTs"],horizon,conf["entry_price"],
           1 if si["side"]=="LONG" else -1,.06 if route=="RECOVERY_V8" else .08)
        if shifted is None:
         skipped["shifted_stop_data_unavailable"]+=1;continue
        paired.append((item,base_by[si["id"]],shifted,conf))
        triggered.append(si["id"])
       for fee in (10,30):
        native=[100*(out["return"]-fee/10000) for out in base_by.values()]
        matched_base=[100*(ba["return"]-fee/10000) for item,ba,sh,conf in paired]
        shifted_ret=[100*(sh["return"]-fee/10000) for item,ba,sh,conf in paired]
        selected=stats(shifted_ret);bas=stats(native);pairbase=stats(matched_base)
        strict=[(item,ba,sh,conf) for item,ba,sh,conf in paired if not item["parity_gt5bps"]]
        strict_rets=[100*(sh["return"]-fee/10000) for item,ba,sh,conf in strict]
        strict_stats=stats(strict_rets)
        row={"route":route,"phase":ph,"horizon_hours":horizon,
         "window_hours":window,"threshold_pct":threshold,"sustain_bars":sustain,
         "volume_confirm":volume,"rule":key,"fee_bps":fee,
         "baseline_n":bas["n"],"baseline_wr_pct":bas["wr_pct"],"baseline_mean_pct":bas["mean_pct"],
         "triggered_n":selected["n"],"selected_wr_pct":selected["wr_pct"],
         "selected_mean_pct":selected["mean_pct"],"selected_sum_pct":selected["sum_pct"],
         "paired_baseline_wr_pct":pairbase["wr_pct"],"paired_baseline_mean_pct":pairbase["mean_pct"],
         "retained_pct":round(100*selected["n"]/max(1,bas["n"]),2),
         "strict_price_matched_n":strict_stats["n"],
         "strict_price_matched_wr_pct":strict_stats["wr_pct"],
         "winner_to_loser":sum(ba["return"]>fee/10000 and sh["return"]<=fee/10000 for item,ba,sh,conf in paired),
         "loser_to_winner":sum(ba["return"]<=fee/10000 and sh["return"]>fee/10000 for item,ba,sh,conf in paired),
         "baseline_winners_excluded":bas["wins"]-pairbase["wins"],
         "baseline_losers_excluded":bas["losses"]-pairbase["losses"],
         "no_portfolio_replay":True}
        res.append(row)
        if fee==30 and horizon==48:
         for item,ba,sh,conf in paired:
          traces.append({"signal_id":item["si"]["id"],"route":route,"phase":ph,
           "rule":key,"baseline_model_48h_return_pct":round(100*(ba["return"]-.003),4),
           "delayed_48h_return_pct":round(100*(sh["return"]-.003),4),
           "entry_reference_parity_pct":round(item["parity_pct"],4),
           "stop_hit_after_delayed_entry":sh["stop"],"confirmation":conf})
res.sort(key=lambda x:(x["route"],x["phase"],x["horizon_hours"],x["fee_bps"],x["rule"]))
with (OUT/"pengu_event_confirmation_grid.csv").open("w",encoding="utf-8-sig",newline="") as file:
 writer=csv.DictWriter(file,list(res[0]));writer.writeheader();writer.writerows(res)
(OUT/"pengu_event_confirmation_trace.json").write_text(
 json.dumps({"schema":"prism-pengu-event-confirmation/v1","trace":traces,
  "requirements":{"signal_reference":"original H1 open, known when the signal fires",
   "confirmation":"2 or 6 consecutive completed M5 closes beyond 1/2/3/4% from signal H1 open",
   "optional":"buyer/taker dominance >=54% in last up to 6 completed 5m bars",
   "entry":"next 5m open after final confirming bar",
   "STOP":"route V8 6%, others 8% anchored to re-entered price",
   "exit":"independent fixed 24/48/72h with STOP first; not native trailing", 
   "data":"5m historical source as separate price feed, 34/116 entry mismatches >5bps versus H1",
   "selection":"no thresholds selected from heldout; grid is exploratory and multiple comparisons apply",
   "causal":"signal's original model future exit never enters decision",
   "no_live":True}},ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n",
 encoding="utf8")
print("EVENT_CONFIRMATION_COMPLETE",json.dumps({"rules_tested":len(res),"trace":len(traces),"missing":dict(skipped)}),flush=True)
for route in ROUTES:
 for ph in ("development","validation","post_validation"):
  for hold in (48,):
   z=[x for x in res if x["route"]==route and x["phase"]==ph and x["horizon_hours"]==hold and x["fee_bps"]==30]
   if not z:continue
   top=[x for x in z if x["triggered_n"]>=5 and x["retained_pct"]>=25]
   print("EVENT_BASE",route,ph,hold,"baseline_n",z[0]["baseline_n"],"base_wr",z[0]["baseline_wr_pct"])
   for x in sorted(top,key=lambda x:(-x["selected_wr_pct"],-x["selected_mean_pct"]))[:7]:
    print("  ",x["rule"],"n",x["triggered_n"],"WR",x["selected_wr_pct"],"MEAN",x["selected_mean_pct"],
      "PARITY_STRICT_WR",x["strict_price_matched_wr_pct"],"REJ_W",x["baseline_winners_excluded"],
      "REJ_LOSS",x["baseline_losers_excluded"],flush=True)
