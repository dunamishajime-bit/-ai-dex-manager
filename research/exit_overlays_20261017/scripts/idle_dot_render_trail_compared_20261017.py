"""Research-only rerun of Idle DOT/RENDER pursuit stop, against four approved candidate changes.
Frozen 8-strategy full backtest; never modify LIVE.
"""
from pathlib import Path
import json,traceback
import bt120_idle_gross_q102hype_20261017 as p
ROOT=p.ROOT
OUT=ROOT/"idle_dot_render_trail_compared_20261017"
OUT.mkdir(parents=True,exist_ok=True)
p.OUT=OUT
p.base.OUTROOT=OUT
sizes={"DOTUSDT":0.25,"RENDERUSDT":0.25}
configs={
 "DOT_TRAIL_2":{"sizes":sizes,"exit":"IDLE_12_TRAIL_2_GIVEBACK_1","symbols":{"DOTUSDT"}},
 "RENDER_TRAIL_2":{"sizes":sizes,"exit":"IDLE_12_TRAIL_2_GIVEBACK_1","symbols":{"RENDERUSDT"}},
 "DOT_RENDER_TRAIL_2":{"sizes":sizes,"exit":"IDLE_12_TRAIL_2_GIVEBACK_1","symbols":{"DOTUSDT","RENDERUSDT"}},
 "DOT_TRAIL_3":{"sizes":sizes,"exit":"IDLE_13_TRAIL_3_GIVEBACK_1p5","symbols":{"DOTUSDT"}},
 "RENDER_TRAIL_3":{"sizes":sizes,"exit":"IDLE_13_TRAIL_3_GIVEBACK_1p5","symbols":{"RENDERUSDT"}},
 "DOT_RENDER_TRAIL_3":{"sizes":sizes,"exit":"IDLE_13_TRAIL_3_GIVEBACK_1p5","symbols":{"DOTUSDT","RENDERUSDT"}},
}
baseline={c:json.loads((ROOT/"fresh_rerun_q102_hype_idle_dot_render025_20261017"/"DOT_RENDER_QUARTER"/f"{c}bps"/"idle_gross_result.json").read_text(encoding="utf8")) for c in (10,30)}
for name,config in configs.items():
 assert name not in p.POLICIES
 p.POLICIES[name]=config
print("START_PURSUIT",len(configs)*2,flush=True)
results=[]
for name in configs:
 for cost in (10,30):
  result_file=OUT/name/f"{cost}bps"/"idle_gross_result.json"
  print("CASE_BEGIN",name,cost,flush=True)
  if result_file.exists():
   result=json.loads(result_file.read_text(encoding="utf8"))
   print("RESUME_EXISTING_RESULT",name,cost,flush=True)
  else:
   try:
    result=p.run(name,cost)
   except Exception:
    traceback.print_exc();raise
  assert result["accounting"]=="PASS"
  assert result["idle_by_symbol"]["DOTUSDT"]["max_gross"]<=.250001
  assert result["idle_by_symbol"]["RENDERUSDT"]["max_gross"]<=.250001
  assert result["five_minute_exit_changes"]["byStrategy"].get("Q102",0)>0
  assert result["five_minute_exit_changes"]["byStrategy"].get("HYPE_LONG",0)>0
  b=baseline[cost]
  compact={
   "name":name,"cost_bps":cost,"final_jpy":result["final_jpy"],
   "dd_pct":result["max_dd_pct"],"win_pct":result["win_pct"],"PF":result["pf"],
   "trades":result["annual_trades"],"trade_delta":result["annual_trades"]-b["annual_trades"],
   "equity_delta":round(result["final_jpy"]-b["final_jpy"],2),
   "dd_delta":round(result["max_dd_pct"]-b["max_dd_pct"],5),
   "worst_idle_pct":min(x["worst_pct"] for x in result["idle_by_symbol"].values()),
   "idle_by_symbol":result["idle_by_symbol"],
   "m5_exit_change_bystrategy":result["five_minute_exit_changes"]["byStrategy"],
  }
  results.append(compact)
  print("TRAIL_COMPARISON_RESULT",json.dumps({k:v for k,v in compact.items() if k!="idle_by_symbol"},ensure_ascii=False),flush=True)
f=OUT/"IDLE_TRAILING_DOT_RENDER_FINAL_COMPARISON.json"
f.write_text(json.dumps({"baseline":baseline,"results":results,"live_unchanged":True,"in_sample":True,"frozen_model":True},ensure_ascii=False,indent=2),encoding="utf8")
lines=["# Idle DOT / RENDER 利益追走STOPの8ロジック統合研究BT",
       "研究条件: Q102利益保護 + HYPE2%損失制限 + DOT・RENDER gross0.25x固定、他戦略は変更なし。",
       "元のポートフォリオモデルで成行コスト10/30bps、2025-08-10〜2026-08-10、初期1万円複利。",
       "",
       "| trailing追加 | 10bps最終資産 | 10bps DD | 件数 | 30bps最終資産 | 30bps DD | 件数 |",
       "|---|---:|---:|---:|---:|---:|---:|"]
m={x["name"]:{} for x in results}
for x in results:m[x["name"]][x["cost_bps"]]=x
for n in configs:
 a,b=m[n][10],m[n][30]
 lines.append(f"| {n} | {a['final_jpy']:,.0f} | {a['dd_pct']:.4f}% | {a['trades']} | {b['final_jpy']:,.0f} | {b['dd_pct']:.4f}% | {b['trades']} |")
lines.extend(["",
    "## 注意","モデルの5m追走STOPでありAster実約定・板・スリッページ・MarkPrice・resident stop再起動復元は未認証。インサンプルのみ、LIVE変更なし。",
    "",f"詳細JSON: {f}"])
(OUT/"IDLE_TRAILING_DOT_RENDER_REPORT.md").write_text("\n".join(lines)+"\n",encoding="utf8")
print("TRAILING_RESEARCH_COMPLETED",len(results),flush=True)
