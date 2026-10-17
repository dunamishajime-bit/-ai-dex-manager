"""Clean-room *output* rerun of 4-change DisDex integrated 8-logic BT.
Inputs: unmodified 2026-10-08 frozen formal research model, original 2026-10-17 causal M5 archive.
Change set: Q102 +2% -> +0.5% floor; HYPE wallet loss 2% STOP;
Idle DOT 0.25x and RENDER 0.25x gross; all other Idle symbols 1.0x.
No venue orders, no LIVE/Production writes.
"""
from __future__ import annotations
import hashlib,json,math,os,time
from pathlib import Path
import bt120_idle_gross_q102hype_20261017 as p

root=p.ROOT
new=root/"fresh_rerun_q102_hype_idle_dot_render025_20261017"
prior=root/"idle_gross_on_q102_hype"
assert not new.exists(),f"FRESH_OUTPUT_ALREADY_EXISTS: {new}"
new.mkdir(parents=True,exist_ok=False)
p.POLICIES["DOT_RENDER_QUARTER"]={"sizes":{"DOTUSDT":.25,"RENDERUSDT":.25},"exit":None}
assert p.POLICIES["DOT_RENDER_QUARTER"]["sizes"]=={"DOTUSDT":.25,"RENDERUSDT":.25}
assert p.Q102_HYPE=={"Q102":"Q102_06_FLOOR_2_TO_0p5","HYPE_LONG":"HYPE_LONG_01_HARD_WALLET_2"}
p.OUT=new
p.base.OUTROOT=new
paths=["bt120_idle_gross_q102hype_20261017.py","bt120_combined_and_slippage_stress_20261017.py",
       "bt120_integrated_5minute_full8_20261017.py","idle_gross_fractional_isolated_full8_20261016.py",
       "idle_profit_trailing_full8_20261016.py"]
hashes={name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in paths}
runs=[]
print("REVALIDATION_BEGIN",str(new),flush=True)
for policy in ("BASE_QH","DOT_RENDER_QUARTER"):
 for cost in (10,30):
  print("REVALIDATE_RUN",policy,cost,flush=True)
  result=p.run(policy,cost)
  assert result["accounting"]=="PASS"
  old=json.loads((prior/policy/f"{cost}bps"/"idle_gross_result.json").read_text(encoding="utf8"))
  fields=["final_jpy","max_dd_pct","pf","annual_trades","all_trades_by_strategy","idle_by_symbol","sizing_candidate_N","five_minute_exit_changes"]
  for k in fields:
   a,b=result[k],old[k]
   if k in ("final_jpy","pf"):
    assert math.isclose(a,b,abs_tol=1e-7,rel_tol=1e-12),(policy,cost,k,a,b)
   else:
    assert a==b,(policy,cost,k,a,b)
  assert result["annual_trades"] >= (1226 if cost==10 else 1222)
  stats=result["idle_by_symbol"]
  if policy=="DOT_RENDER_QUARTER":
   assert stats["DOTUSDT"]["max_gross"]<=.250001
   assert stats["RENDERUSDT"]["max_gross"]<=.250001
   for s in ("TAOUSDT","TIAUSDT","JUPUSDT"):
    if s in stats:
     assert stats[s]["max_gross"]>.95,(s,stats[s])
   assert result["sizing_candidate_N"]>0
  stop=result["five_minute_exit_changes"]
  assert stop["byStrategy"]["Q102"]>0 and stop["byStrategy"]["HYPE_LONG"]>0,(policy,cost,stop)
  delta={
   "reproducibility":"EXACT_PASS","policy":policy,"cost_bps":cost,
   "final_jpy":result["final_jpy"],"max_dd_pct":result["max_dd_pct"],
   "pf":result["pf"],"win_pct":result["win_pct"],
   "annual_trades":result["annual_trades"],"trades_by_strategy":result["all_trades_by_strategy"],
   "idle_all_symbols":stats,"five_minute_changes":stop,
   "candidate_gross_modified":result["sizing_candidate_N"],
   "accepted_dot_gross_max":stats.get("DOTUSDT",{}).get("max_gross"),
   "accepted_render_gross_max":stats.get("RENDERUSDT",{}).get("max_gross")}
  runs.append(delta)
  print("REVALIDATE_PASS",json.dumps(delta,ensure_ascii=False),flush=True)

base={i["cost_bps"]:i for i in runs if i["policy"]=="BASE_QH"}
target={i["cost_bps"]:i for i in runs if i["policy"]=="DOT_RENDER_QUARTER"}
assert set(base)==set(target)=={10,30}
report={
 "status":"REVALIDATED_EXACT_ALL_4_CASES",
 "research_only":True,"production_unchanged":True,
 "original_period":"2025-08-10 through 2026-08-10",
 "original_initial_jpy":10000,
 "description":"Q102 +2%->+0.5% resident modeled floor, HYPE wallet -2% modeled STOP, Idle DOT and RENDER requested gross 0.25x (others unchanged), formal 8-logic shared-gross replay",
 "model_limitations":["No Aster L2/MarkPrice actual venue fill evidence","BinanceVision 5m source normalized at entry","Aster price gaps & partial fills not certified","V52 older M5 gaps not fixed","in-sample selection only, no independent holdout"],
 "input_script_sha256":hashes,
 "results":runs,
 "differences_vs_q102_hype":{
  str(cost):{
   "asset_jpy_delta":target[cost]["final_jpy"]-base[cost]["final_jpy"],
   "dd_pctpoints_improvement":target[cost]["max_dd_pct"]-base[cost]["max_dd_pct"],
   "annual_trade_count_delta":target[cost]["annual_trades"]-base[cost]["annual_trades"]}
  for cost in (10,30)}
}
file=new/"REVALIDATION_FINAL_REPORT.json"
file.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
out=[
 "# Q102利益保護＋HYPE損失制限＋Idle DOT/RENDER 0.25x 再実行レポート",
 "",
 "**STATUS: REVALIDATED_EXACT_ALL_4_CASES — LIVE未変更**",
 "",
 "検証期間：2025-08-10～2026-08-10。初期資金1万円、積立なし、複利。8戦略を共有Gross／同時建玉／再エントリー込みで再計算。",
 "",
 "| 構成 | コスト | 最終資産 | 最大MTM DD | PF | 勝率 | 取引件数 |",
 "|---|---:|---:|---:|---:|---:|---:|"
]
for row in runs:
 out.append(f"| {row['policy']} | {row['cost_bps']}bps | {row['final_jpy']:,.0f}円 | {row['max_dd_pct']:.4f}% | {row['pf']:.4f} | {row['win_pct']:.3f}% | {row['annual_trades']:,} |")
out+=["","Q102：価格有利+2%を確定5分足で観測後、+0.5%の保護。HYPE：口座想定損失2%STOP。Idle DOT/RENDERのみgross 0.25x、JUP/TIA/TAOは既存gross。",
 "",
 "## 監査",
 "- 各コストとも新規出力へ一から正式統合リプレイ実行、会計PASS。",
 "- 前回のJSONと最終資産／DD／PF／件数／戦略別件数／Idle通貨別gross・最悪損失／出口変更件数が完全一致。",
 "- DOT・RENDERの受理gross<=0.25x。Q102・HYPE双方の5分足退出変更が実際に発生したことを確認。",
 "- 実AsterのSTOP執行／手数料・約定遅延／板・Mark価格／部分約定は未認証。未来期間の外部検証は未実施。過去BT利益は未来利益の保証ではない。",
 "",
 f"詳細JSON: {file}",
 "LIVE／Productionロジックは変更していない。"
]
(new/"REVALIDATION_FINAL_REPORT.md").write_text("\n".join(out)+"\n",encoding="utf8")
print("REVALIDATION_ALL_DONE",str(file),str(new/"REVALIDATION_FINAL_REPORT.md"),flush=True)
