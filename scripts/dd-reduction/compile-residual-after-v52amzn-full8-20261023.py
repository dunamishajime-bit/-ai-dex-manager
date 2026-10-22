#!/usr/bin/env python3
"""Compile RESIDUAL 8-logic exit research after AMZN+1.0 adopted study anchor."""
import json,hashlib
from pathlib import Path
R=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
REPO=Path(__file__).resolve().parents[2]
OUT=REPO/"docs/research/results/residual-after-v52amzn-20261023"
CASES=("DOGE_LOSS_1H_2P_MFE1","DOGE_LOSS_2H_1P5_MFE1",
       "DOGE_PROFIT_3P_FLOOR1","DOGE_LOSS1H_PLUS_PROFIT3P")
def read(p):return json.loads(Path(p).read_text("utf-8"))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def money(x):return f"{x:,.0f}円"
def perc(x):return f"{x:.3f}%"
def main():
 am=read(R/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json")["cases"]["AMZN_SHORT_PRIOR_CLOSE_PLUS1P0"]["costs"]
 found={}
 for p in (R/"f8residual/RESIDUAL_M5_EXIT_FULL8_AFTER_AMZN_20261023.json",
           R/"f8residual_more/RESIDUAL_M5_EXIT_FULL8_AFTER_AMZN_20261023.json"):
  z=read(p)
  assert z["status"]=="RESEARCH_ONLY_RESIDUAL_M5_EXIT_FULL8_AFTER_USER_ADOPTED_V52_AMZN_GATE"
  for name,o in z["cases"].items():
   assert name not in found
   found[name]=o
 assert set(found)==set(CASES)
 base={}
 for cost in ("10","30"):
  c=am[cost]
  matches=[p for p in (R/"f8v52amzn_more/engine").rglob("portfolio-trades.jsonl") if sha(p)==c["ledgerSha256"]]
  assert matches
  rr=[json.loads(x) for x in matches[0].read_text("utf-8").splitlines() if x]
  rr=sorted((x for x in rr if x["strategy_id"]=="RESIDUAL"),key=lambda x:x["exit_ts_ms"])
  e=10000.;peak=e;dd=0.
  for x in rr:
   e*=1+x["total_pnl_jpy"]/x["entry_equity"];peak=max(peak,e);dd=min(dd,(e/peak-1)*100)
  loss=sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in rr if x["total_pnl_jpy"]<0)
  win=sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in rr if x["total_pnl_jpy"]>0)
  base[cost]={**c,"residualTrades":len(rr),"residualW":sum(x["total_pnl_jpy"]>0 for x in rr),
    "residualL":sum(x["total_pnl_jpy"]<0 for x in rr),
    "residualNetJpy":win+loss,"residualGrossWinJpy":win,"residualGrossLossJpy":loss,
    "residualIsolatedStartJpy":10000,"residualIsolatedEndJpy":e,
    "residualIsolatedRealizedDDPct":dd}
 qualified=[]
 for name in CASES:
  q=found[name]["costs"]
  assert set(q)=={"10","30"}
  for c in ("10","30"):
   z=q[c]
   assert z["accounting"]=="PASS" and z["changedResidualDogeExits"]>0
   assert z["full8ReselectionPasses"]>=2
  a=q["10"];b=q["30"]
  if (a["deltaVsCarryOverAmznBaselineJpy"]>=0 and b["deltaVsCarryOverAmznBaselineJpy"]>=0
   and a["maxMtmDrawdownPct"]>=base["10"]["maxMtmDdPct"]-1e-8
   and b["maxMtmDrawdownPct"]>=base["30"]["maxMtmDdPct"]-1e-8
   and a["deltaTotalTrades"]>=0 and b["deltaTotalTrades"]>=0):qualified.append(name)
 screening=read(OUT/"RESIDUAL_M5_EARLY_EXIT_SCREEN_20261023.json")
 obj={"status":"RESEARCH_ONLY_NO_LIVE",
  "sourcePeriod":"2025-08-10..2026-08-10",
  "benchmark":"HYPE+TAO_RENDER+FET8_4+AMZN_SHORT_REFERENCE_PREV_CLOSE_OVER1P0(research)",
  "costsBps":[10,30],"baseline":base,"cases":found,
  "candidateCostDDTradeQualifiers":qualified,
  "screen":screening,
  "caveats":["Original model 11 V52 suppressed stock candidate not regenerated",
    "M5 signal from completed candle and modeled next M5 open, no venue fill evidence",
    "Stop results in sample and cannot establish live parity",
    "PENGU untouched; no VPS or Production modifications"]}
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"RESIDUAL_EXIT_FULL8_COMPARISON_20261023.json").write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 lines=[
  "# RESIDUAL DOGE/AVAXの損益・DDと初期逆行/利益保護研究",
  "",
  "研究のみ。AMZN SHORTの前日比+1.0%超ブロックを研究ベースに引き継ぎ、LIVE/Productionは変更していません。",
  "",
  "2025年8月10日〜2026年8月10日。初期1万円、積立なし、10bpsと30bps。",
  "DOGEとAVAXはRESIDUALのLONGだけ。PENGUその他のロジックは変更しません。",
  "",
  "## RESIDUALだけの元の統合口座への損益寄与",
  "",
  "|指標|10bps|30bps|","|---|---:|---:|",
  f'|取引数|{base["10"]["residualTrades"]}|{base["30"]["residualTrades"]}|',
  f'|勝/負|{base["10"]["residualW"]}/{base["10"]["residualL"]}|{base["30"]["residualW"]}/{base["30"]["residualL"]}|',
  f'|勝ち利益寄与|{money(base["10"]["residualGrossWinJpy"])}|{money(base["30"]["residualGrossWinJpy"])}|',
  f'|負け損失寄与|{money(base["10"]["residualGrossLossJpy"])}|{money(base["30"]["residualGrossLossJpy"])}|',
  f'|純寄与|{money(base["10"]["residualNetJpy"])}|{money(base["30"]["residualNetJpy"])}|',
  f'|単体1万円仮想複利最終資産|{money(base["10"]["residualIsolatedEndJpy"])}|{money(base["30"]["residualIsolatedEndJpy"])}|',
  f'|単体決済ベース最大DD|{perc(base["10"]["residualIsolatedRealizedDDPct"])}|{perc(base["30"]["residualIsolatedRealizedDDPct"])}|',
  "",
  "共有口座への円損益と、RESIDUALだけの元サイズ比率を仮想複利した口座残高を混同しないこと。単体DDは保有中含み損を含みません。",
  "",
  "## 新DOGE出口4案：8ロジック統合BT",
  "",
  "|案|10bps資産|基準差|MTM DD|全取引|30bps資産|基準差|MTM DD|全取引|",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  f'|AMZN変更後の基準|{money(base["10"]["equityJpy"])}|0|{perc(base["10"]["maxMtmDdPct"])}|{base["10"]["closedTrades"]}|{money(base["30"]["equityJpy"])}|0|{perc(base["30"]["maxMtmDdPct"])}|{base["30"]["closedTrades"]}|']
 for name in CASES:
  a=found[name]["costs"]["10"];b=found[name]["costs"]["30"]
  lines.append(f'|{name}|{money(a["finalEquityJpy"])}|{money(a["deltaVsCarryOverAmznBaselineJpy"])}|{perc(a["maxMtmDrawdownPct"])}|{a["closedTrades"]}|{money(b["finalEquityJpy"])}|{money(b["deltaVsCarryOverAmznBaselineJpy"])}|{perc(b["maxMtmDrawdownPct"])}|{b["closedTrades"]}|')
 lines+=["",f'**両コストで利益・DD・件数を維持できた候補：{", ".join(qualified) if qualified else "なし"}。**',
  "",
  "## 手法と制限",
  "",
  "- 1h/2h早期損失判定と利益保護は、5分足終値確定後の次の5分足始値で約定モデル化。価格急変・板損失・部分約定は認証していない。",
  "- 直前のDOGE LONG損失−2%でもMFE>+1%となったトレードは初期STOP対象外。既存ロジックのEXIT優先と競合Grossは全8ロジック再計算。",
  "- 株式V52元11件の抑制候補の再発火を完全再生成できない。H1/M5データの研究モデルであり、TypeScript LIVE完全一致と誤認しない。",
  "- 閾値は同一年の30トレード程度から選択したため過学習の可能性。OOS/Forward Shadow必須。",
  "",
  "## 再現可能ファイル",
  "",
  "- RESIDUAL_M5_EARLY_EXIT_SCREEN_20261023.json",
  "- RESIDUAL_EXIT_FULL8_COMPARISON_20261023.json",
  "- screen-residual-next-m5-after-v52amzn-20261023.py",
  "- run-residual-doge-m5-full8-after-amzn-20261023.py",
  "",
  "**STATUS: RESEARCH_ONLY**",""]
 (OUT/"RESIDUAL_EXIT_RESEARCH_REPORT_20261023.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("RESIDUAL_REPORT_COMPLETE",len(found),"SCENARIOS","QUALIFIED",qualified,flush=True)
 for name in CASES:
  a=found[name]["costs"]["10"];b=found[name]["costs"]["30"]
  print("CASE",name,"C10",round(a["finalEquityJpy"]),round(a["deltaVsCarryOverAmznBaselineJpy"]),round(a["maxMtmDrawdownPct"],5),a["closedTrades"],
     "C30",round(b["finalEquityJpy"]),round(b["deltaVsCarryOverAmznBaselineJpy"]),round(b["maxMtmDrawdownPct"],5),b["closedTrades"],flush=True)
if __name__=="__main__":main()
