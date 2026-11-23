#!/usr/bin/env python
"""Research only: strict capital-gap triggered D yield, no Live writes."""
import sys,json,time,hashlib
from pathlib import Path
sys.path.insert(0,"C:/tmp/v4-d-gross-20261026")
import v12_v4_d_tier_gross_sweep_20261026 as b
s=b.s
ROOT=Path("C:/tmp/v4-d-preempt-material-20261026");ROOT.mkdir(exist_ok=True)
GROSS={"REC_G3_LATE_BTC_REL":.25,"REC_X13_TP1.5_SL1_H24":.15,"CONT_SHORT_MID_AGE24_48":.15}
HOOK="                accepted_gross = min(requested, room)\n"
PAYLOAD="""                # PREEMPTIVE CAPACITY YIELD RESEARCH ONLY.
                # Only after upstream route gates, cooldown, slot and risk approval.
                # Do not liquidate just because a candidate appears.
                if (strategy in {"V12","Q102","PENGU","HYPE_LONG","V52"}
                        and str(candidate.get("route") or "") not in {"REC_G3_LATE_BTC_REL","REC_X13_TP1.5_SL1_H24","CONT_SHORT_MID_AGE24_48"}
                        and strategy_room > 1e-9
                        and min(sleeve_room,total_room) + 1e-12 < requested
                        # Ignore immaterial truncation of higher-priority size.
                        and (requested-min(sleeve_room,total_room)) >= 0.10):
                    victims = sorted(
                        [(vp, pos) for vp,pos in active.items()
                         if pos.get("strategy_id")=="V12"
                         and pos.get("route") in {"REC_G3_LATE_BTC_REL","REC_X13_TP1.5_SL1_H24","CONT_SHORT_MID_AGE24_48"}
                         and pos.get("entry_ts_ms",ts)<ts
                         and (strategy!="V12" or
                              (int(candidate.get("rank") or 0)>0
                               and int(candidate.get("rank") or 0)<int(pos.get("rank") or 0)))],
                        key=lambda item:(-int(item[1].get("rank") or 0),
                                         int(item[1].get("entry_ts_ms") or 0),int(item[0])))
                    for vp,pos in victims:
                        if min(sleeve_room,total_room) + 1e-12 >= requested:
                            break
                        mark = _mark(market,pos["symbol"],ts)
                        if mark is None:
                            continue
                        finalize_position(vp,ts,mark,
                                          f"D_CAPACITY_YIELD:{strategy}:{candidate.get('route')}")
                        equity = _equity(wallet,active,market,ts)
                        active_same_strategy = [z for z in active.values() if z["strategy_id"] == strategy]
                        strategy_gross = sum(_gross(z,market,ts,equity) for z in active_same_strategy)
                        total_gross = sum(_gross(z,market,ts,equity) for z in active.values())
                        crypto_gross = sum(_gross(z,market,ts,equity) for z in active.values() if z["strategy_id"]!="V52")
                        stock_gross = sum(_gross(z,market,ts,equity) for z in active.values() if z["strategy_id"]=="V52")
                        strategy_room = max(0.0,research_cap-strategy_gross)
                        sleeve_room = max(0.0,(STOCK_CAP-stock_gross) if strategy=="V52" else (CRYPTO_CAP-crypto_gross))
                        total_room = max(0.0,TOTAL_CAP-total_gross)
                        room = min(strategy_room,sleeve_room,total_room)
"""
def patched(source,strict):
 q=b.sweep.patch(source,strict)
 assert q.count(HOOK)==1,q.count(HOOK)
 return q.replace(HOOK,PAYLOAD+HOOK,1)
def main():
 s.w.OUT=ROOT;s.w.setup();b.v4.install_virtual_leg_study_adapter();b.final.install_final_routes()
 b.v3.stage3_transform=b.final.stage3_candidate_all
 b.v3.FAILED=b.ml.failed_candidates();b.v3.v2.FAILED=b.v3.FAILED
 s.w.base.source_batch=b.ind.custom_source_batch
 s.w.base.read_table=b.v3.v2.read_table
 orig=s.w.base.patch_admission
 for name,flag in [("D_MATERIAL_PREEMPT",True)]:
  b.v3.CASE[name]={"family_cap":b.CAP["family"],"gross":.10,"slots":16}
  b.ind.ACTIVE_RECOVERY_CAP=b.CAP["family"]
  b.mlift.MAX_LIFT_GROSS=.30;b.ind.ORIG_PATCH=orig
  s.w.base.patch_admission=patched if flag else b.sweep.patch
  b.COUNTS.clear();s.w.base._study_filter=b.make_filter(GROSS)
  print("START",name,flush=True);now=time.monotonic()
  result=s.w.base.run_study(name,"10,30")
  doc={"name":name,"preempt":flag,"requestedGross":GROSS,"seconds":time.monotonic()-now,"results":{}}
  for sc in result["scenarios"]:
   key="10bps" if sc["scenario_id"]=="PRICE_MODEL_10BPS" else "30bps"
   f=ROOT/"cases"/name/"runs"/sc["scenario_id"]/"portfolio-trades.jsonl"
   rows=[json.loads(x) for x in f.read_text("utf8").splitlines() if x.strip()]
   pre=[x for x in rows if str(x.get("exit_reason_actual") or "").startswith("D_CAPACITY_YIELD:")]
   doc["results"][key]={"finalEquityJpy":sc["final_equity_jpy"],"maxDdPct":100*sc["maximum_mtm_drawdown"],
    "PF":sc["profit_factor"],"WR":sc["win_rate"],"trades":sc["closed_trades"],
    "accounting":sc["accounting_reconciliation"]["status"],"preemptCount":len(pre),
    "preemptEvents":[{"route":x["route"],"ts":x["exit_ts_ms"],"gross":x["accepted_gross"],
                     "pnl":x["total_pnl_jpy"],"reason":x["exit_reason_actual"]} for x in pre],
    "ledgerSha256":hashlib.sha256(f.read_bytes()).hexdigest()}
   assert doc["results"][key]["accounting"]=="PASS"
  (ROOT/(name+".json")).write_text(json.dumps(doc,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
  print("FINISHED",name,[(k,round(v["finalEquityJpy"]),round(v["maxDdPct"],3),v["preemptCount"]) for k,v in doc["results"].items()],flush=True)
if __name__=="__main__":main()
