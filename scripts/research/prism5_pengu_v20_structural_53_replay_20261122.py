#!/usr/bin/env python3
"""PRISM5 frozen causal PENGU SHORT structural design — three-cohort replay.

- Fixed source short events: PRE(6), BASE(40), POST(7) = 53.
- Both PENGU and BTC H1 series are as-of entry decisions, only completed H1.
- Records each of 7 continuation and 6 reversal evidence votes, by regime.
- Preserves original pinned model exits *only for immediate unchanged entries*.
- WAIT-confirmed entry is a NEW economic event; NEVER reuse original exit PnL.
  Such events are emitted to a separate replay queue for native TS lifecycle.
- Labels/economic outcomes do not participate in decisions or confirmation.
- No parameter search/fit and no Production writes.
"""
from __future__ import annotations
import csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from pathlib import Path
from collections import Counter,defaultdict
from dataclasses import asdict
sys.path.insert(0,str(Path(__file__).resolve().parent))
from prism5_pengu_v20_structural_direction_engine_20261122 import (
 SOURCE_PIN,SOURCE_BLOB,POLICY,H,source_h1,classify,confirm_pending)
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
W=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122")
OUT=W/"phase2_results";OUT.mkdir(exist_ok=True)
PERIODS=(
 ("PRE_2025_AUG_SEP",OUT/"PENGU_2025_AUG_SEP_PREBASELINE_PINNED_RAW_SIGNALS.json",
                      OUT/"native_lifecycle_prebaseline/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("BASE_2025_2026",OUT/"PENGU_ORIGINAL_116_NATIVE_ASOF_FEATURES.json",
                      R/"PENGU_NATIVE_LIFECYCLE_EXIT_20261109/pengu-native-lifecycle-modeled-exits.jsonl"),
 ("POST_2026_OCT_NOV",OUT/"PENGU_PINNED_FORWARD_SIGNALS.json",
                      OUT/"native_lifecycle_forward/pengu-native-lifecycle-modeled-exits.jsonl"))
pre=W/"prebaseline_public_20250801_20250924"
post=W/"forward_public_20261001_20261118"
files={}
for sym in ("PENGUUSDT","BTCUSDT"):
 files[sym]=[
  pre/(f"{sym}-1h-20250801-20250924"+("-RESEARCH_M5QA" if sym=="BTCUSDT" else "")+".jsonl.gz"),
  R/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz",
  post/f"{sym}-1h-20261001-20261118.jsonl.gz"]
def hashfile(p):return hashlib.sha256(p.read_bytes()).hexdigest()
data={}
for sym,parts in files.items():
 x={}
 for p in parts:
  if not p.is_file():raise ValueError("H1_SOURCE_FILE_MISSING:"+str(p))
  with gzip.open(p,"rt",encoding="utf8") as f:
   for line in f:
    bar=source_h1(json.loads(line))
    if bar.ts in x and bar!=x[bar.ts]:raise ValueError("H1_SOURCE_CONFLICT:"+str(bar.ts))
    x[bar.ts]=bar
 data[sym]=[x[t] for t in sorted(x)]
 print("SOURCE_H1_VALID",sym,"bars",len(x),"from",min(x),"to",max(x),flush=True)
if len(data["PENGUUSDT"])!=len(data["BTCUSDT"]):raise ValueError("H1_CROSS_SYMBOL_COVERAGE")
if [z.ts for z in data["PENGUUSDT"]]!=[z.ts for z in data["BTCUSDT"]]:
 raise ValueError("H1_SYMBOL_TIMESTAMPS_DISAGREE")
m={x.ts:x for x in data["PENGUUSDT"]}
def readexits(path):
 return [json.loads(s) for s in path.open(encoding="utf8") if s.strip()]
def native_ret(x):
 if x["side"]!="SHORT" or x["partialEvents"]:raise ValueError("SHORT_V20_PARTIAL_IN_EXIT")
 return 1-x["exitPrice"]/x["entryPrice"]
signals=[]
for period,signalpath,exitpath in PERIODS:
 obj=json.loads(signalpath.read_text(encoding="utf8"))
 if "source_runtime_sha" in obj and obj["source_runtime_sha"]!=SOURCE_PIN:
  raise ValueError("PIN_SIGNAL_SHA_MISMATCH")
 ss=[s for s in obj.get("signals",obj.get("candidates",[])) if s["route"]=="SHORT_V20"]
 xx=[e for e in readexits(exitpath) if e["route"]=="SHORT_V20"]
 if len(ss)!=len(xx):raise ValueError("NATIVE_EXIT_COUNT_MISMATCH")
 idx={(e["entryTs"],e["route"],e["side"]):e for e in xx}
 for s in ss:
  key=(s["entryTs"],s["route"],s["side"])
  e=idx.get(key)
  if not e:raise ValueError("NATIVE_EXIT_MISSING")
  if e["sourceRuntimeSha"]!=SOURCE_PIN:raise ValueError("EXIT_WRONG_PIN")
  signals.append((period,s,e))
assert Counter(period for period,_,_ in signals)=={
 "PRE_2025_AUG_SEP":6,"BASE_2025_2026":40,"POST_2026_OCT_NOV":7}
ledger=[];queued=[]
for period,s,e in sorted(signals,key=lambda p:p[1]["entryTs"]):
 entry=s["entryTs"]
 if entry!=s["signalTs"]+H:raise ValueError("NATIVE_SIGNAL_ENTRY_TS_NOT_NEXT_H1")
 if s["features"]["referenceTs"]!=s["signalTs"]:raise ValueError("REFERENCE_TS_NOT_NATIVE")
 ref=m.get(entry-H)
 if not ref or abs(ref.close-s["features"]["close"])>1e-12:
  raise ValueError("NATIVE_SIGNAL_PRICE_NOT_H1_CLOSE")
 if abs(s["features"]["atr24"]-s["features"]["atr24"])>1e-12:raise ValueError("BAD_ATR")
 d=classify(data["PENGUUSDT"],data["BTCUSDT"],entry,float(s["features"]["atr24"]))
 if d.decision_ts!=entry or d.source_pengu_ts!=s["signalTs"]:
  raise ValueError("LOOKAHEAD_REFERENCE_TS_MISMATCH")
 status=d.action;regime=d.regime;confirm_ts=None;confirm=None
 if status=="WAIT_UP_TO_2_COMPLETE_H1":
  for n in (1,2):
   cand=confirm_pending(data["PENGUUSDT"],data["BTCUSDT"],d,
       float(s["features"]["atr24"]),entry+n*H)
   if cand.action=="ENTER_SHORT_CANDIDATE":
    confirm_ts=cand.decision_ts;confirm=cand;status="DEFERRED_SHORT_NATIVE_EXIT_REQUIRED"
    break
   if cand.regime=="BOUNCE_OR_SHORT_SQUEEZE":
    status="ABORTED_WAIT_REVERSAL";confirm=cand;break
  if status=="WAIT_UP_TO_2_COMPLETE_H1":
   status="NO_ENTRY_AFTER_2H_WAIT"
 raw=native_ret(e)
 # A delayed entry changes price, holding and stop: source native outcome
 # is never credited to delayed entries. Only direct entries reuse native pnl.
 same_entry= status=="ENTER_SHORT_CANDIDATE"
 if confirm_ts is not None:
  if confirm_ts not in m:raise ValueError("DEFERRED_ENTRY_OPEN_MISSING")
  queued.append({"schema":"prism5-v20-deferred-native-replay/v1",
   "source_original_id":e["id"],"source_original_entryTs":entry,
   "entryTs":confirm_ts,"route":"SHORT_V20","side":"SHORT",
   "entryReferenceOpenPrice":m[confirm_ts].open,
   "entryAnchorReferenceTs":confirm_ts-H,
   "original_runtime_sha":SOURCE_PIN,"original_natural_entry":False,
   "source_entry_atr24_ratio":float(s["features"]["atr24"]),
   "original_source_features":s["features"],
   "confirmation_features":confirm.features if confirm else None,
   "period":period})
 row={
 "period":period,"original_signal_id":e["id"],"source_native_short_pin":SOURCE_PIN,
 "original_referenceTs":s["signalTs"],"original_entryTs":entry,
 "original_native_exitTs":e["exitTs"],
 "original_native_exit_reason":e["exitReason"],
 "original_native_entry_price":e["entryPrice"],
 "original_native_net10_pct":round(100*(raw-.001),6),
 "original_native_net30_pct":round(100*(raw-.003),6),
 "original_native_profitable30":raw>.003,
 "policy":POLICY,"v20_asof_action":d.action,"v20_regime":regime,
 "v20_final_action":status,
 "continuation_votes":d.continuation_votes,"reversal_votes":d.reversal_votes,
 "continuation_reasons":list(d.continuation_reasons),
 "reversal_reasons":list(d.reversal_reasons),
 "asof_confirmed_last_H1_start":d.source_pengu_ts,
 "source_quality":d.min_data_quality,
 "features":d.features,
 "deferred_entryTs":confirm_ts,
 "deferred_entry_price":m[confirm_ts].open if confirm_ts is not None else None,
 "source_exit_retained_for_direct":same_entry,
 "direct_net30_pct":round(100*(raw-.003),6) if same_entry else None,
 "direct_net10_pct":round(100*(raw-.001),6) if same_entry else None
 }
 ledger.append(row)
def evidence_stats(rows,field):
 rr=[x for x in rows if x["v20_final_action"]==field]
 wins=sum(x["original_native_profitable30"] for x in rr)
 return {"original_native_cohort_n":len(rr),"would_win_native30":wins,
         "would_lose_native30":len(rr)-wins}
aggregate=[]
for period in ("PRE_2025_AUG_SEP","BASE_2025_2026","POST_2026_OCT_NOV","ALL_ALREADY_SEEN"):
 group=[x for x in ledger if period=="ALL_ALREADY_SEEN" or x["period"]==period]
 direct=[x for x in group if x["source_exit_retained_for_direct"]]
 for fee in (10,30):
  key=f"direct_net{fee}_pct"
  base=f"original_native_net{fee}_pct"
  def metrics(grp,f):
   if not grp:return {"n":0,"wins":0,"wr_pct":None,"mean_net_pct":None,"price_pf":None}
   y=[x[f] for x in grp];wins=sum(v>0 for v in y)
   pos=sum(max(v,0) for v in y);neg=sum(max(-v,0) for v in y)
   return {"n":len(y),"wins":wins,"wr_pct":round(100*wins/len(y),2),
     "mean_net_pct":round(statistics.mean(y),5),
     "price_pf":round(pos/neg,4) if neg>0 else None}
  aggregate.append({
   "period":period,"fee_bps":fee,"original":metrics(group,base),
   "direct_only":metrics(direct,key),
   "stage_counts":dict(Counter(x["v20_final_action"] for x in group)),
   "regime_counts":dict(Counter(x["v20_regime"] for x in group)),
   "original_winners_rejected_or_deferred":sum(x[base]>0 for x in group if not x["source_exit_retained_for_direct"]),
   "original_losers_rejected_or_deferred":sum(x[base]<=0 for x in group if not x["source_exit_retained_for_direct"]),
   "deferred_n":sum(x["v20_final_action"]=="DEFERRED_SHORT_NATIVE_EXIT_REQUIRED" for x in group),
   "disclaimer":"Direct only reuses native exit because entry is unchanged. Deferred entries are excluded from both numerator and denominator until native exit rerun."})
def writecsv(path,records):
 cols=list(dict.fromkeys(k for r in records for k in r))
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,cols);writer.writeheader()
  for x in records:
   writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in x.items()})
writecsv(OUT/"PRISM5_PENGU_V20_STRUCTURE_53_CLASSIFICATION.csv",ledger)
(OUT/"PRISM5_PENGU_V20_STRUCTURE_DEFERRED_NATIVE_QUEUE.json").write_text(
 json.dumps({"schema":"prism5-v20-native-deferred-entries/v1","events":queued,
 "notice":"A deferred entry is not yet priced by the native exit source. Do not reuse source exit prices."},indent=2,ensure_ascii=False)+"\n",encoding="utf8")
result={"schema":"prism5-pengu-v20-structural-direction-v1",
 "native_pin":SOURCE_PIN,"native_blob":SOURCE_BLOB,"policy":POLICY,
 "population_counts":dict(Counter(x["period"] for x in ledger)),
 "all_native_source_exits_preserved":True,
 "policy_type":"structure-state entry engine, not trained outcome-selected threshold",
 "aggregate":aggregate,
 "source_H1_sha256":{sym:{p.name:hashfile(p) for p in parts} for sym,parts in files.items()},
 "limitations":["All three periods have already been observed by the researcher; not blind out-of-sample",
  "A direction-vote threshold is an economic heuristic, not a calibrated win probability",
  "New deferred entries require fresh pinned native stop/exit replay and cannot reuse old PnL",
  "No venue order book, signed fills, fee funding or portfolio shared Gross / DD parity",
  "No change to Recovery V8/LONG V64/HYPE or any LIVE runner; this is research only"]}
(OUT/"PRISM5_PENGU_V20_STRUCTURE_53_SUMMARY.json").write_text(
 json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("PRISM5_CLASSIFIED_53",len(ledger),"DEFERRED_NEED_NATIVE",len(queued),flush=True)
for z in aggregate:
 if z["fee_bps"]==30:
  print("PRISM5_COHORT",z["period"],"SOURCE",z["original"],"DIRECT",z["direct_only"],
        "COUNTS",z["stage_counts"],"DEFERRED",z["deferred_n"],
        "REJECT_WIN",z["original_winners_rejected_or_deferred"],flush=True)
