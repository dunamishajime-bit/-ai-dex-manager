from pathlib import Path
import json,hashlib
R=Path("C:/tmp/render-mtf-study-20261024")
E=Path("C:/tmp/r4427c3/RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024/engine")
S=json.loads((R/"RENDER_4427_SCOPED_PRIORITY_NATIVE8_DETERMINISTIC_AUDIT_20261024.json").read_text())
ids={10:["cmp_5bb26c207eb3","cmp_88139ccf92bb","cmp_d112f9aef1ff"],30:["cmp_2104321c587e","cmp_3a77ec7e46bd","cmp_433aa2452f5a"]}
def load(f):return [json.loads(s) for s in f.read_text().splitlines()]
def sha(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(",",":")).encode()).hexdigest()
report={"status":"RESEARCH_ONLY_ECONOMIC_REPLAY_CONFIRMED_FORMAL_OWNER_UNPROVEN","costs":{},"productionParity":False,"venueFillCertified":False}
for c,groups in ids.items():
 results=[];l=[];e=[];m=[];d=[]
 for g in groups:
  b=E/g/g/(str(c)+"bps");results.append(json.loads((b/"result.json").read_text()))
  f=b/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/("PRICE_MODEL_"+str(c)+"BPS")
  l.append(load(f/"portfolio-trades.jsonl"));e.append(load(f/"portfolio-events.jsonl"))
  m.append(load(f/"task9-mtm.jsonl"));d.append(load(f/"candidate-decisions.jsonl"))
 metrics=["final_equity_jpy","profit_factor","maximum_mtm_drawdown_pct","win_rate","closed_trades"]
 assert all(all(x[k]==results[0][k] for k in metrics) for x in results)
 norm_l=[sha([{k:v for k,v in x.items() if k!="candidate_id"} for x in a]) for a in l]
 norm_e=[sha([{k:v for k,v in x.items() if k!="candidate_id"} for x in a]) for a in e]
 mtm=[sha(a) for a in m]
 assert len(set(norm_l))==len(set(norm_e))==len(set(mtm))==1
 assert [len(x) for x in d]==[2543,2523,2523]
 assert [sum(x.get("reason")=="V12:TASK9_ADVERSE_SIDE_COOLDOWN" for x in a) for a in d]==[20,0,0]
 assert d[1]==d[2]
 a=S["costs"][str(c)];old=a["baseline"];new=a["scopedPriority"]
 assert abs(results[0]["final_equity_jpy"]-new["final_equity_jpy"])<1e-6
 assert abs(new["maximum_mtm_drawdown_pct"]-old["maximum_mtm_drawdown_pct"])<1e-10
 assert new["closed_trades"]-old["closed_trades"]==2
 report["costs"][str(c)]={"baseline_jpy":old["final_equity_jpy"],"scoped_jpy":new["final_equity_jpy"],"delta_jpy":round(new["final_equity_jpy"]-old["final_equity_jpy"],3),"baseline_pf":old["profit_factor"],"scoped_pf":new["profit_factor"],"scoped_win_rate_pct":round(results[0]["win_rate"]*100,6),"max_mtm_dd_pct":new["maximum_mtm_drawdown_pct"],"baseline_trades":old["closed_trades"],"scoped_trades":new["closed_trades"],"normalized_ledger_sha":norm_l[0],"normalized_events_sha":norm_e[0],"mtm_sha":mtm[0],"economic_three_run_match":True,"raw_decisions_three_run_match":False,"decisions_counts":[len(x) for x in d],"extra_first_run_rejected_v12_cooldown":20,"modeled_new_trades":a["new_trades"],"independent_decisions":a["independent_decisions"]}
report["limitations"]=["In-memory scoped _overlay_block clearing is NOT a formally registered Owner/Route.","Full Shared Risk/Margin Guard/Kill Switch/pending/account lock/dedup parity is unproven.","First run has 20 additional rejected V12 cooldown decisions and shifted candidate IDs, so exact decision/raw ledger SHA matching FAILS despite economic and MTM equality.","Aster 2025 RENDER H1 mark missing; signed Aster M5 fills and funding unverified.","Historical SELL55 was selected ex post; no untouched OOS.","No VPS/LIVE/Production/HP/orders changed."]
j=R/"RENDER_4427_SCOPED_PRIORITY_CANONICAL_REPLAY_AUDIT_20261025.json"
j.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
lines=["# RENDER #4427: scoped independent SHORT priority Native8 audit (2026-10-25)","","STATUS: RESEARCH ONLY; economic/MTM replay deterministic after canonicalization; formal Owner/Route unproven; DO NOT ADOPT LIVE.","","| Cost | Baseline JPY | Scoped JPY | Modeled delta JPY | Baseline trades | Scoped trades | MTM DD |","|---|---:|---:|---:|---:|---:|---:|"]
for c in (10,30):
 x=report["costs"][str(c)]
 lines.append(f"| {c}bps | {x['baseline_jpy']:,.3f} | {x['scoped_jpy']:,.3f} | +{x['delta_jpy']:,.3f} | {x['baseline_trades']} | {x['scoped_trades']} | {x['max_mtm_dd_pct']:.6f}% |")
lines+=["","## New verified findings","- 3 replays per cost have identical economic metrics, canonical modeled trade ledgers, portfolio events, and exact MTM time series.","- Raw decision reproducibility FAILS: first run contains 20 extra rejected V12 adverse-side cooldown decisions (2543 vs 2523), shifting candidate IDs and event sequence. Second and third decision files match.","- 2026-06-23 01:00 UTC and 2026-06-25 07:00 UTC modeled RENDER SHORTs enter under the scoped counterfactual. 2026-05-27 21:00 UTC remains rejected.","","## Critical limitations","- Scoped in-memory Core overlay change is a counterfactual, NOT formal independent Owner/Route registration; full safety parity remains unproven.","- Aster 2025 RENDER H1 mark missing, signed venue M5 fills and funding unverified. SELL55 was selected after reviewing past losses.","- All evaluated periods have already been explored; not untouched OOS. No LIVE, VPS, Production, HP, or orders changed.","","Reproduction script and JSON audit are in C:/tmp/render-mtf-study-20261024.",""]
md=R/"RENDER_4427_SCOPED_PRIORITY_CANONICAL_REPLAY_AUDIT_20261025.md"
md.write_text("\n".join(lines),encoding="utf8")
(R/"render_4427_scoped_priority_repro_audit_20261025.py").write_text(Path(__file__).read_text(encoding="utf8"),encoding="utf8")
print(json.dumps({"status":report["status"],"files":[str(j),str(md)],"deltas":{k:v["delta_jpy"] for k,v in report["costs"].items()}},ensure_ascii=False))
