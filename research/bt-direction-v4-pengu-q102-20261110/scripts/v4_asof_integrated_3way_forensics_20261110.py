#!/usr/bin/env python3
"""Inspect ranked research A/B model decisions/fills/equity for 10/30bps, route & DD attribution."""
from pathlib import Path
import collections,csv,datetime as dt,hashlib,json
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
ROOT=R/"DIRECTION_RESEARCH_20261109"
BASE="Y06_NATIVE_LIFECYCLE_M5_AB_"
modes={name:R/("VPS_DD_V4_SORT_"+name+"_STOCK15_20261110") for name in ["SYMBOL","PINNED","ASOF"]}
def lines(mode,bps,suff):
 f=modes[mode]/(BASE+str(bps)+"BPS_"+suff+".csv")
 with f.open(encoding="utf-8-sig",newline="") as z:return list(csv.DictReader(z))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def iso(s):return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
out={"status":"RESEARCH_ONLY_ASOF_FILTER_HINDSIGHT_REMAINS",
 "run_explanation":"Changes only V4 same-timestamp intra-runner sort: symbol-vs-hindsight-pinned-vs-asof-matured. Other exit and price tapes fixed.",
 "source_pins":{"V4":"3ad65403013b701db5d9e53e8814e6ab827a28e8","PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496"},
 "original_engine_sha256":sha(R/"dd_strict_v2_plus_v4q102_pengu_recovery_reversal_20261109.py"),
 "asof_rank_map_sha256":sha(ROOT/"v4_asof_1394_candidate_rank_map_20261110.json"),
 "cost":{}}
for bps in [10,30]:
 artifacts={}
 for mode in modes:
  prefix=BASE+str(bps)+"BPS_"
  summ=json.loads((modes[mode]/(prefix+"SUMMARY.json")).read_text(encoding="utf8"))
  d=lines(mode,bps,"DECISIONS");f=lines(mode,bps,"FILLS");e=lines(mode,bps,"EQUITY_30MIN")
  assert int(summ["modeled_fills"])==len(f)
  dx={x["signal_id"]:x for x in d}
  fx={x["source_signal_id"]:x for x in f}
  assert len(dx)==len(d) and len(fx)==len(f)
  # Trough and rolling peak; no arbitrary same timestamp assumption.
  peak=-float('inf');idx=0;worst=0;trough=None;peak_time=None
  for z in e:
   equity=float(z["compounded_mtm_equity_jpy"])
   if equity>peak:peak=equity;peak_time=z["utc"]
   dd=100*(equity/peak-1)
   if dd<worst:worst=dd;trough=(z["utc"],peak_time,equity,peak)
  assert abs(worst-summ["max_hourly_dd_pct"])<.0001,(mode,worst,summ["max_hourly_dd_pct"])
  bystrat=collections.defaultdict(lambda:{"n":0,"pnl":0.})
  for z in f:
   bystrat[z["strategy"]]["n"]+=1
   bystrat[z["strategy"]]["pnl"]+=float(z["net_pnl_jpy"])
  artifacts[mode]={"summary":{
    "final_jpy":summ["final_compounded_jpy"],"dd_pct":summ["max_hourly_dd_pct"],
    "fills":len(f),"trough":trough,
    "total_decisions":len(d),"blocked":sum(z["decision"]=="BLOCK" for z in d)},
    "decisions":dx,"fills":fx,
    "by_strategy":dict(bystrat),
    "hashes":{s:sha(modes[mode]/(prefix+s+".csv")) for s in [
      "DECISIONS","FILLS","EQUITY_30MIN","FUNDING"]}}
 def diff(left,right):
  a=artifacts[left];b=artifacts[right]
  af=set(a["fills"]);bf=set(b["fills"])
  common=af&bf
  decision_different=[
    {"signal_id":k,"left":a["decisions"][k]["decision"],"right":b["decisions"][k]["decision"],
     "left_reason":a["decisions"][k]["reason"],"right_reason":b["decisions"][k]["reason"],
     "strategy":k.split("_")[0]}
    for k in a["decisions"] if
    (a["decisions"][k]["decision"],a["decisions"][k]["reason"]) !=
    (b["decisions"][k]["decision"],b["decisions"][k]["reason"])]
  return {"compare":left+"→"+right,"gained_fills":len(bf-af),"lost_fills":len(af-bf),
   "common_fills":len(common),
   "changed_decisions":len(decision_different),
   "changed_decisions_by_strategy":dict(collections.Counter(x["strategy"] for x in decision_different)),
   "decision_samples":decision_different[:35],
   "gained_samples":[{"id":k,"strategy":b["fills"][k]["strategy"],"route":b["fills"][k]["route"]} for k in sorted(bf-af)[:15]],
   "lost_samples":[{"id":k,"strategy":a["fills"][k]["strategy"],"route":a["fills"][k]["route"]} for k in sorted(af-bf)[:15]],
   "terminal_delta_jpy":b["summary"]["final_jpy"]-a["summary"]["final_jpy"],
   "dd_delta_points":b["summary"]["dd_pct"]-a["summary"]["dd_pct"],
   "strategy_pnl_deltas":{s:{"pnl_delta":b["by_strategy"][s]["pnl"]-a["by_strategy"][s]["pnl"],
                             "fill_count_delta":b["by_strategy"][s]["n"]-a["by_strategy"][s]["n"]}
      for s in sorted(set(a["by_strategy"])|set(b["by_strategy"]))},
   "hash_identical":{s:a["hashes"][s]==b["hashes"][s] for s in a["hashes"]}}
 out["cost"][str(bps)]={"modes":{mode:{"summary":a["summary"],"by_strategy":a["by_strategy"],"hashes":a["hashes"]} for mode,a in artifacts.items()},
 "differences":[diff("SYMBOL","PINNED"),diff("PINNED","ASOF"),diff("SYMBOL","ASOF")]}
t=ROOT/"v4_asof_integrated_3way_admission_and_dd_forensics_20261110.json"
t.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",t)
for bps,a in out["cost"].items():
 print("COST",bps)
 for mode,x in a["modes"].items():
  z=x["summary"];print("MODE",mode,"equity",round(z["final_jpy"],2),"DD",round(z["dd_pct"],4),
     "trough",z["trough"],"fills",z["fills"])
 for d in a["differences"]:
  print("COMPARE",d["compare"],"new",d["gained_fills"],"lost",d["lost_fills"],"decisions",d["changed_decisions"],
        "extra",round(d["terminal_delta_jpy"],2),"DD",round(d["dd_delta_points"],4),
        "pnl_by_strategy",{k:round(v["pnl_delta"],1) for k,v in d["strategy_pnl_deltas"].items() if abs(v["pnl_delta"])>1e-6})
