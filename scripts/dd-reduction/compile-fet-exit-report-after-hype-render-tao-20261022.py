#!/usr/bin/env python3
"""Generate and verify FET exit research evidence from full 8-logic recomputation."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from collections import Counter

REPO=Path(__file__).resolve().parents[2]
BASE="FET_AFTER_ALL_ADOPTED_BASELINE"
def read(path):return json.loads(Path(path).read_text(encoding="utf-8"))
def jpy(v):return f"{v:,.0f}円"
def pct(v):return f"{v:.4f}%"

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--input",required=True,type=Path)
 parser.add_argument("--combo-input",type=Path,action="append",default=[])
 args=parser.parse_args()
 original=read(args.input)
 for combo_file in args.combo_input:
  extra=read(combo_file)
  assert extra["status"]==original["status"]
  assert extra["adoptedSource"]==original["adoptedSource"]
  for case,row in extra["cases"].items():
   assert case.startswith("FET_COMBO_") and case not in original["cases"]
   original["cases"][case]=row
 anchor=read(REPO/"config/research/hype-render-tao-cumulative-adopted-20261022.json")
 assert original["status"]=="RESEARCH_ONLY_FET_EXIT_AFTER_USER_ADOPTED_ALL_RULES"
 assert BASE in original["cases"]
 expected={c:anchor["modeledEightStrategyIntegratedBaseline"]["cost10bps" if c=="10" else "cost30bps"] for c in ("10","30")}
 for cost in ("10","30"):
  x=original["cases"][BASE]["costs"][cost]
  assert abs(x["portfolioFinalEquityJpy"]-expected[cost]["finalEquityJPY"]) < 0.20
  assert abs(x["maxMtmDdPct"]-expected[cost]["maxMtmDrawdownPct"])<1e-7
  assert x["fet"]["trades"]==8
 for case,v in original["cases"].items():
  assert set(v["costs"])=={"10","30"}
  for cost,x in v["costs"].items():
   assert x["accounting"]=="PASS"
   assert x["sourceLedgerSha256"]
   assert x["fet"]["wins"]+x["fet"]["losses"]==x["fet"]["trades"]
   assert len(x["replayHistory"])>=2
 chosen=[]
 for case,v in original["cases"].items():
  if case==BASE:continue
  a=v["costs"]["10"];b=v["costs"]["30"]
  if a["deltaVsFormalAdoptedJpy"]>0 and b["deltaVsFormalAdoptedJpy"]>0 \
    and a["maxMtmDdPct"]>=expected["10"]["maxMtmDrawdownPct"]-1e-7 \
    and b["maxMtmDdPct"]>=expected["30"]["maxMtmDrawdownPct"]-1e-7:
   chosen.append(case)
 lines=["# FET BRK48 LONG 出口改善 — 累積正式採用後8ロジック統合BT",
        "",
        "## 前提",
        "",
        "- 比較対象: FET SHORTではなくFET LONGのみ。その他7ロジックの入口・出口を固定し、HYPE LONGの新条件とRENDER＋TAOのSHORT3条件をすべて先に累積適用。",
        "- 期間2025-08-10〜2026-08-10、初期1万円・積立なし・複利、10bps通常コスト／30bpsストレス。全8ロジックを出口変化後に時系列動的再選択。",
        "- 確定5分足を用い、当該足の終値でARM、次以降の足のLOWで追従STOP発火、ギャップは不利なOPEN価格にて執行。",
        "- 現行FETはすでに+5%到達後の+3%保護・24h終了・リスクSTOP等を持ち、元のFET決済より前にのみ追加案が変更を許される。",
        "- 価格モデル・歴史的な最適化研究。取引所STOP発注、独立OOS、Task9独立TypeScript経済Parityの認証ではない。",
        "",
        "## FET単体ベースライン",
        ""]
 for c in ("10","30"):
  x=original["cases"][BASE]["costs"][c];f=x["fet"]
  lines.append(f'- {c}bps: {f["trades"]}件・{f["wins"]}勝{f["losses"]}敗、損益 {jpy(f["modeledPnlJpy"])}。出口内訳: {json.dumps(f["byExit"],ensure_ascii=False)}。')
 lines+=["","## 実証した研究候補と経済結果","",
        "| 条件 | 10bps資産 | 差額 | FET 10bps勝敗 | 10bps DD | 30bps資産 | 差額 | FET 30bps勝敗 | 30bps DD |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
 for case,v in original["cases"].items():
  a=v["costs"]["10"];b=v["costs"]["30"]
  A=a["fet"];B=b["fet"]
  lines.append(f'| {case} | {jpy(a["portfolioFinalEquityJpy"])} | {a["deltaVsFormalAdoptedJpy"]:+,.0f}円 | {A["wins"]}勝{A["losses"]}敗 | {pct(a["maxMtmDdPct"])} | {jpy(b["portfolioFinalEquityJpy"])} | {b["deltaVsFormalAdoptedJpy"]:+,.0f}円 | {B["wins"]}勝{B["losses"]}敗 | {pct(b["maxMtmDdPct"])} |')
 lines+=["","## 採用判断（まだ自動採用しない）","",
  f'- 利益改善かつDD非悪化の候補を10bpsと30bpsの両方で満たすもの: {", ".join(chosen) if chosen else "なし"}。',
  "- サンプルは年間FETわずか8件。勝率変化は過信しない。採用には経済効果・過学習リスク・本番Venue STOP維持の確認が必要。",
  "- 初期逆行STOPは、FETの回復する損失取引に作用すると負けを大きくする可能性があるため、単体の負け件数だけでは推奨しない。",
  "- 今回は正式採用ではない。VPS/LIVE/Production/注文/HPへの変更なし。既採用HYPE、IdleおよびDOTを維持。",
  ""]
 dst=REPO/"docs/research/results/fet-after-hype-render-tao-20261022"
 dst.mkdir(parents=True,exist_ok=True)
 (dst/"FET_EXIT_FULL8_REPORT_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 compact={"schema":"fet-full8-exit-after-cumulative-adoption-v1",
          "date":"2026-10-22","status":"RESEARCH_ONLY_NOT_LIVE",
          "baselineAnchor":{"10":expected["10"],"30":expected["30"]},
          "selectedCases":list(original["cases"]),
          "qualifiedBothCostImprovementNonWorseningDd":chosen,
          "results":original["cases"],
          "limitations":original["caveats"]}
 (dst/"FET_EXIT_FULL8_RESULTS_20261022.json").write_text(
  json.dumps(compact,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("REPORT_PASS",dst,flush=True)
 print("STABLE_BOTH_COST",chosen,flush=True)
 for case,v in original["cases"].items():
  a=v["costs"]["10"];b=v["costs"]["30"]
  print("RESEARCH_FINAL",case,"10",round(a["portfolioFinalEquityJpy"]),round(a["deltaVsFormalAdoptedJpy"]),
        "30",round(b["portfolioFinalEquityJpy"]),round(b["deltaVsFormalAdoptedJpy"]),flush=True)

if __name__=="__main__":main()
