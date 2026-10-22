#!/usr/bin/env python3
"""Compile verified DOT SHORT 5m profit-guard tests + integrated 8-logic economic BT."""
from __future__ import annotations
import json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
RAW=ROOT/"dot_profit_guard_full8_20261022"
OUT=REPO/"docs"/"research"/"results"/"dot-short-profit-guard-20261022"
NAMES=("HYPE_ADOPTED_BASELINE","DOT_PROFIT_1P5_FLOOR0P25","DOT_PROFIT_2P0_FLOOR0P5","DOT_PROFIT_3P0_FLOOR1P0")
LABELS=("HYPE採用後基準（DOT現行）","DOT +1.5%到達後+0.25%保護","DOT +2.0%到達後+0.5%保護","DOT +3.0%到達後+1.0%保護")
def load(p):return json.loads(p.read_text(encoding="utf-8"))
def yen(v):return f"{v:,.0f}円"
def pct(v):return f"{v:.3f}%"
def main():
 res=load(RAW/"IDLE5_FULL8_AFTER_HYPE_20261022.json")
 screen=load(RAW/"DOT_PROFIT_M5_ACCEPTED_PRE_SCREEN_20261022.json")
 cfg=load(REPO/"config"/"research"/"hype-entry-adopted-20261022.json")
 assert cfg["adoptedCombinedCaseId"]=="COMBO_I1H1_P3F1P5"
 assert set(res["results"])==set(NAMES)
 for n in NAMES:
  for cost in ("10","30"):
   x=res["results"][n]["costs"][cost]
   assert x["accounting"]=="PASS"
   assert len(x["replay"])>=2 and bool(x["sha256Ledgers"])
 for cost in ("10","30"):
  cur=res["results"]["HYPE_ADOPTED_BASELINE"]["costs"][cost]
  ref=cfg["adoptedDualExitIntegratedAnchor"][cost]
  assert abs(cur["finalEquityJpy"]-ref["finalEquityJpy"])<0.1
  assert abs(cur["maxMtmDdPct"]-ref["maxMtmDdPct"])<1e-7
  assert screen["costs"][cost]["baselineWins"]==cur["byIdleShortSymbol"]["DOTUSDT"]["wins"]
 raw={"status":"RESEARCH_ONLY_NOT_LIVE", "period":"2025-08-10..2026-08-10",
      "initialCapitalJpy":10000,"contributionsJpy":0,"costsBps":[10,30],
      "fullyDynamicEightLogicReselection":True,
      "HypeAlreadyUserAdoptedAndFixed":True,
      "previousV12V4FourQ102ThreeAndPENGUUnchanged":True,
      "dotExistingProductionSource":"lib/disdex-exit-overlay-contract.ts",
      "dotExistingTrailingProfit":"confirmed_M5_close_3pct_arm_then_highest_confirmed_gain_minus_1p5_percentage_point_retrace",
      "productionCodeConfiguredStopPct":10,"productionCodeConfiguredTakeProfitPct":25,
      "productionCodeDotHoldHours":24,
      "productionVpsHpOrdersChanged":False,"venueFillAndTask9TypeScriptEconomicParityCertified":False,
      "m5FixedFillScreen":screen,
      "cases":{n:res["results"][n]["costs"] for n in NAMES}}
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"DOT_SHORT_PROFIT_GUARD_FULL8_20261022.json").write_text(
  json.dumps(raw,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 lines=["# DOT SHORT 利益保護：確定5分足＋8ロジック統合BT（2026-10-22）",
        "",
        "HYPE LONGのユーザー正式採用済み入口・出口を固定し、V12 V4/Q102の採用済み出口とPENGUは変更しない。DOT SHORTのみ研究出口を上乗せ。研究専用・未実装・LIVE不変更。",
        "",
        "## 現行の利益保護",
        "",
        "現行Runtimeコードでは、DOT/RENDERは確定5分足で含み益+3%に到達した後、最高確定含み益から1.5ポイント逆行する追従STOP。+3%なら+1.5%、+5%なら+3.5%を保護し、一度上げたSTOPは緩めない。根拠：lib/disdex-exit-overlay-contract.ts と lib/idle-priority-short-runner.ts。",
        "",
        "緊急STOP10%、緊急利確25%、DOT最大保有24時間、DOT gross0.25はconfig/idlePriorityShortPolicy.tsの設定値。VPS現在稼働Releaseとの完全一致は本研究では未認証。",
        "",
        "## 完全8ロジック統合BT",
        "",
        "期間2025-08-10〜2026-08-10、1万円開始、積立なし、複利、10bpsおよび30bps。時系列で候補を動的に再選択。",
        "",
        "| 研究条件 | 10bps最終資産 | 基準差 | DOT勝敗 | 10bps DD | 30bps最終資産 | 基準差 | DOT勝敗 | 30bps DD |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for n,label in zip(NAMES,LABELS):
  a=res["results"][n]["costs"]["10"]
  b=res["results"][n]["costs"]["30"]
  da=a["byIdleShortSymbol"]["DOTUSDT"];db=b["byIdleShortSymbol"]["DOTUSDT"]
  lines.append(f'| {label} | {yen(a["finalEquityJpy"])} | {a["equityDeltaVsAdoptedJpy"]:+,.0f}円 | {da["wins"]}勝{da["losses"]}敗 | {pct(a["maxMtmDdPct"])} | {yen(b["finalEquityJpy"])} | {b["equityDeltaVsAdoptedJpy"]:+,.0f}円 | {db["wins"]}勝{db["losses"]}敗 | {pct(b["maxMtmDdPct"])} |')
 lines+=["","## DOT単体の損益・勝率","",
         "| 研究条件 | 10bps勝率 | DOT単体損益10bps | 30bps勝率 | DOT単体損益30bps |",
         "|---|---:|---:|---:|---:|"]
 for n,label in zip(NAMES,LABELS):
  a=res["results"][n]["costs"]["10"]["byIdleShortSymbol"]["DOTUSDT"]
  b=res["results"][n]["costs"]["30"]["byIdleShortSymbol"]["DOTUSDT"]
  lines.append(f'| {label} | {pct(a["winRatePct"])} | {yen(a["modeledPnlJpy"])} | {pct(b["winRatePct"])} | {yen(b["modeledPnlJpy"])} |')
 lines+=["","## 既存の採用約定に対する5m事前スクリーニング（BTではない）","",
         "| 案 | 10bps作用した既存負け/既存勝ち | 30bps作用した既存負け/既存勝ち |",
         "|---|---:|---:|"]
 for n,label in zip(NAMES[1:],LABELS[1:]):
  a=screen["costs"]["10"]["cases"][n];b=screen["costs"]["30"]["cases"][n]
  lines.append(f'| {label} | {a["oldLosers"]}敗/{a["oldWinners"]}勝 | {b["oldLosers"]}敗/{b["oldWinners"]}勝 |')
 base=res["results"]["HYPE_ADOPTED_BASELINE"]["costs"]["10"]["byIdleShortSymbol"]["DOTUSDT"]
 win=base["modeledPnlJpy"]-base["loserPnlJpy"]
 lines+=["","## 判断と注意点",
  "",
  f'- 既存DOTは10bpsで{base["wins"]}勝{base["losses"]}敗、勝ち利益合計{yen(win)}、負け合計{yen(base["loserPnlJpy"])}。損失の絶対額が元々少ない。',
  "- +1.5%→+0.25%、+2%→+0.5%案は過去負けを救済する反面、過去勝ち7件にも作用。勝率だけで採用しない。",
  "- +3%→+1%案の事前検証では対象約定0件。既存の+3%/1.5ポイント追従STOPより追加の利益確保が本当にあるかを統合比較する。",
  "- 価格モデルであり実取引所の約定・保護注文Read-back認証ではない。独立Task9 TypeScriptエンジンとの正式一致、未使用期間OOS、コスト実測も未完了。",
  "- 今回のDOT追加条件はユーザー未採用。VPS/LIVE/Production/注文/HPへの変更は無し。",
  ""]
 (OUT/"DOT_SHORT_PROFIT_GUARD_FULL8_REPORT_20261022.md").write_text(
  "\n".join(lines),encoding="utf-8",newline="\n")
 print("REPORT_COMPLETE",OUT,flush=True)
 for n in NAMES:
  a=res["results"][n]["costs"]["10"];b=res["results"][n]["costs"]["30"]
  print("ECONOMY",n,"10bps",round(a["finalEquityJpy"]),round(a["equityDeltaVsAdoptedJpy"]),
        "30bps",round(b["finalEquityJpy"]),round(b["equityDeltaVsAdoptedJpy"]),flush=True)
if __name__=="__main__":main()
