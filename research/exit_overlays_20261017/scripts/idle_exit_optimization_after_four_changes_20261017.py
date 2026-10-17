"""Integrated research: test Idle 5m exit improvement *after* four selected changes,
Q102 profit protect, HYPE 2% wallet loss, Idle DOT+RENDER gross 0.25.
Use frozen 8-strategy engine, same accepted gross and source; NO LIVE or venue changes.
"""
from __future__ import annotations
from pathlib import Path
import json,time,math,traceback
import bt120_idle_gross_q102hype_20261017 as p

ROOT=p.ROOT
OUT=ROOT/"idle_exit_optimization_after_four_changes_20261017"
assert not OUT.exists(), "New study must not overwrite old folder"
OUT.mkdir(parents=True,exist_ok=False)
p.OUT=OUT;p.base.OUTROOT=OUT

# All profiles inherit just the DOT/RENDER 0.25x change, while other IDLE
# symbols, other strategies, existing Q102/HYPE and approved 3 research
# floors stay untouched.
sizes={"DOTUSDT":.25,"RENDERUSDT":.25}
BOTH={"DOTUSDT","RENDERUSDT"}
ALL=set(p.IDLE_SYMBOLS)
configs=[
("ALL_FLOOR_2", "IDLE_06_FLOOR_2_TO_0p5",ALL),
("ALL_TRAIL_2","IDLE_12_TRAIL_2_GIVEBACK_1",ALL),
("ALL_RISK_1p5","CUSTOM_IDLE_RISK_1p5",ALL),
("ALL_VOLUME_2p5","IDLE_22_VOLUME_SHOCK_2p5",ALL),
("RENDER_FLOOR_2","IDLE_06_FLOOR_2_TO_0p5",{"RENDERUSDT"}),
("RENDER_TRAIL_2","IDLE_12_TRAIL_2_GIVEBACK_1",{"RENDERUSDT"}),
("RENDER_VOLUME_2p5","IDLE_22_VOLUME_SHOCK_2p5",{"RENDERUSDT"}),
("RENDER_REV_3","IDLE_15_REVERSAL_3BAR_0p8",{"RENDERUSDT"}),
("DOT_RISK_1p5","CUSTOM_IDLE_RISK_1p5",{"DOTUSDT"}),
("DOT_TRAIL_2","IDLE_12_TRAIL_2_GIVEBACK_1",{"DOTUSDT"}),
("DOT_VOLUME_2p5","IDLE_22_VOLUME_SHOCK_2p5",{"DOTUSDT"}),
("DOT_REV_3","IDLE_15_REVERSAL_3BAR_0p8",{"DOTUSDT"}),
("BOTH_FLOOR_2","IDLE_06_FLOOR_2_TO_0p5",BOTH),
("BOTH_TRAIL_2","IDLE_12_TRAIL_2_GIVEBACK_1",BOTH),
("BOTH_VOLUME_2p5","IDLE_22_VOLUME_SHOCK_2p5",BOTH),
("BOTH_RISK_1p5","CUSTOM_IDLE_RISK_1p5",BOTH),
]
assert len(configs)==16
custom="CUSTOM_IDLE_RISK_1p5"
assert custom not in p.r.BY_ID
p.r.BY_ID[custom]={**p.r.BY_ID["IDLE_01_HARD_WALLET_2"],"id":custom,"name":"WALLET_HARD_1p5","risk":.015}
for name,exitname,syms in configs:
 assert name not in p.POLICIES
 assert syms.issubset(ALL)
 p.POLICIES[name]={"sizes":sizes.copy(),"exit":exitname,"symbols":syms}
controls={
 c:json.loads((ROOT/"fresh_rerun_q102_hype_idle_dot_render025_20261017"/"DOT_RENDER_QUARTER"/f"{c}bps"/"idle_gross_result.json").read_text(encoding="utf8"))
 for c in (10,30)}
print("EXIT_EXPERIMENT_CONFIGS",json.dumps([{"name":n,"exit":e,"scope":sorted(s)} for n,e,s in configs],ensure_ascii=False),flush=True)
print("EXIT_EXPERIMENT_START",len(configs)*2,flush=True)
rows=[]
for name,exitname,scope in configs:
 for cost in (10,30):
  print("START_CASE",name,cost,flush=True)
  try:
   result=p.run(name,cost)
  except Exception:
   traceback.print_exc();print("STOP_ON_FAILED_CASE",name,cost,flush=True);raise
  baseline=controls[cost]
  assert result["accounting"]=="PASS"
  assert result["sizing_candidate_N"]>0
  assert result["idle_by_symbol"]["DOTUSDT"]["max_gross"]<=.250001
  assert result["idle_by_symbol"]["RENDERUSDT"]["max_gross"]<=.250001
  row={"name":name,"exit":exitname,"scope":sorted(scope),
       "cost_bps":cost,"final_jpy":result["final_jpy"],
       "max_dd_pct":result["max_dd_pct"],
       "delta_dd_point":round(result["max_dd_pct"]-baseline["max_dd_pct"],4),
       "delta_jpy":round(result["final_jpy"]-baseline["final_jpy"],2),
       "pf":result["pf"],"win_pct":result["win_pct"],
       "annual_trades":result["annual_trades"],
       "trade_delta":result["annual_trades"]-baseline["annual_trades"],
       "idle_counts":result["all_trades_by_strategy"]["IDLE"],
       "max_idle_loss_pct":min(v["worst_pct"] for v in result["idle_by_symbol"].values()),
       "idle_by_symbol":result["idle_by_symbol"],
       "m5_changes":result["five_minute_exit_changes"]}
  rows.append(row)
  print("COMPACT",json.dumps({k:v for k,v in row.items() if k not in ("idle_by_symbol","m5_changes")},ensure_ascii=False),flush=True)
summary={
 "status":"RESEARCH_COMPLETE",
 "research_only":True,
 "source_baseline":"Q102 floor2->0.5 + HYPE wallet stop2 + IDLE DOT/RENDER gross0.25",
 "dates":"2025-08-10 to 2026-08-10",
 "provenance":"Binance Vision M5 normalized to frozen source entry; original 8-strategy integrated replay H1, no Aster L2",
 "baseline":controls,
 "cases":rows
}
f=OUT/"IDLE_EXIT_FOUR_CHANGE_COMPARISON.json"
f.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf8")
best=[]
byname={n:{c:next(x for x in rows if x["name"]==n and x["cost_bps"]==c) for c in (10,30)} for n,_,_ in configs}
for name,ds in byname.items():
 a,b=ds[10],ds[30]
 if a["delta_dd_point"]>=0 and b["delta_dd_point"]>=0 and a["trade_delta"]>=0 and b["trade_delta"]>=0:
  best.append(name)
ranking=sorted(byname, key=lambda n:(min(byname[n][c]["delta_dd_point"] for c in (10,30)),sum(byname[n][c]["delta_dd_point"] for c in (10,30))),reverse=True)
md=["# 4変更案に追加するIdle出口改善研究BT","",
"既存8ロジック統合エンジン。Q102利益保護、HYPE2%損失制限、Idle DOT・RENDER Gross各0.25xを固定。予測ではなく過去のモデルBT。LIVE未変更。",
"","| 追加するIdle出口 | 10bps最大DD | 10bps最終資産 | 件数 | 30bps最大DD | 30bps最終資産 | 件数 |",
"|---|---:|---:|---:|---:|---:|---:|"]
for name in ranking:
 a,b=byname[name][10],byname[name][30]
 md.append(f"| {name} | {a['max_dd_pct']:.4f}% | {a['final_jpy']:,.0f}円 | {a['annual_trades']} | {b['max_dd_pct']:.4f}% | {b['final_jpy']:,.0f}円 | {b['annual_trades']} |")
md+=["","## 10/30bps両方でDD改善、年間取引件数非減少した条件",""]
md+=["- "+str(n) for n in best] or ["- 該当なし"]
md+=["","## 制限","",
"5分足価格はBinance Vision USD-Mの値をエントリー価格で正規化。リアルタイムAster約定、Mark Price・板・資金調達やresident stopの復旧証明ではない。過去データのDD選択は過学習の可能性あり。独立期間検証が必要。","",
f"全結果: {f}",""]
(OUT/"IDLE_EXIT_FOUR_CHANGE_COMPARISON.md").write_text("\n".join(md),encoding="utf8")
print("RESEARCH_ALL_COMPLETED",len(rows),len(best),"bothcost_candidates",best,flush=True)
