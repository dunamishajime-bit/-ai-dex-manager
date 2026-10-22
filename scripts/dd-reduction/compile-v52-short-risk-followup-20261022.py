#!/usr/bin/env python3
"""V52-only 87-trade evidence and 8-logic four-candidate decision report."""
from __future__ import annotations
import argparse,json
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]
DATA=REPO/"docs/research/results/v52-short-risk-followup-20261022"
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
CASES=("V52_SHORT_BASIS_LT75_GROSS1P0","V52_SHORT_BASIS_LT75_GROSS1P5",
       "V52_SHORT_BASIS_LT80_GROSS1P0","V52_SHORT_BASIS_LT80_GROSS1P5")

def load(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def yen(v):return f"{v:,.0f}円"
def pc(v):return f"{v:.3f}%"

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--risk",required=True,type=Path)
 args=p.parse_args()
 attr=load(DATA/"V52_ONLY_PNL_DD_ANALYSIS_20261022.json")
 risk=load(args.risk)
 base=load(ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json")["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"]
 assert risk["status"]=="RESEARCH_ONLY_FIXED_NATIVE_STOCK_TAPE_V52_SIZE_SENSITIVITY"
 assert set(risk["cases"])==set(CASES)
 for c in ("10","30"):
  t=attr["cost"][c]
  assert t["sourceLedgerSha256"]==base[c]["ledgerSha256"]
  assert t["overall"]["trades"]==87
  assert t["sourcePortfolioWorstDDContext"]["v52Positions"]==0
  assert t["potentialShortOHLCStopTouchesAtOrAbovePct"]["5"]==0
 for case in CASES:
  q=risk["cases"][case]
  assert q["stockSource"]["suppressedPreentryUnmodified"]==11
  for c in ("10","30"):
   d=q["costs"][c]
   assert d["accounting"]=="PASS" and d["v52Trades"]==87
   assert d["v52LongTrades"]==35 and d["v52ShortTrades"]==52
 qualified=[]
 for case in CASES:
  c=risk["cases"][case]["costs"];a=c["10"];b=c["30"]
  if a["deltaVsCurrentJpy"]>=0 and b["deltaVsCurrentJpy"]>=0 \
    and a["maxMtmDDPct"]>=base["10"]["maxMtmDdPct"]-1e-8 \
    and b["maxMtmDDPct"]>=base["30"]["maxMtmDdPct"]-1e-8 \
    and a["deltaTotalTrades"]>=0 and b["deltaTotalTrades"]>=0:
   qualified.append(case)
 out={
   "schema":"v52-only-trade-attribution-and-short-size-risk-final-v1",
   "status":"RESEARCH_ONLY_NO_V52_ADOPTION_NO_LIVE",
   "costsBps":[10,30],
   "sourceFull8":"HYPE_LONG+TAO_RENDER_SHORT+FET_TRAIL8_4",
   "studyPeriod":"2025-08-10..2026-08-10",
   "v52OnlyBreakdown":attr["cost"],
   "baselineFull8":base,
   "riskSizeCases":risk["cases"],
   "allCostProfitDdTradeFrequencyQualifiers":qualified,
   "minusFiveShortPriceStop":{
      "thresholdPct":-5,"researchStatus":"KEEP_AS_SEPARATE_EMERGENCY_STOP_CANDIDATE_NOT_LIVE",
      "h1PriceTouchCount":0,"modeledHistoricalBenefit":"NO_OBSERVED_H1_TOUCH",
      "slippageAndNativeVenueOrderEvidence":"UNPROVEN",
      "otherPotentialTouches":{"lossMinusOnePct":2,"lossMinusOnePointFivePct":1,"lossMinusTwoPct":0},
      "barTimestampLimit":"H1 start hh:00, V52 trade times hh:30, overlaps include outside-position time, not precise stop fill."
    },
   "explicitLimitations":[
      "Closed-trade isolated DD not current ongoing venue MTM DD",
      "H1 close-only MTM proxy not signed venue mark-to-market",
      "Fixed native V52 model 88 closed and 11 suppressed pre-entry candidates; suppressed candidates not regenerated after exit or size changes",
      "In-sample threshold selection and original modeled fills cannot certify current LIVE parity",
      "No Production, orders, positions, VPS, or HP changed"
   ]}
 DATA.mkdir(parents=True,exist_ok=True)
 (DATA/"V52_SHORT_RISK_CANDIDATES_FULL8_20261022.json").write_text(
     json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 a=attr["cost"]["10"];b=attr["cost"]["30"]
 lines=[
  "# V52 87件の損益・DD分解とSHORT損失候補検証 2026-10-22",
  "",
  "**全て研究のみ。新規V52のLIVE実装・Production変更はなし。**",
  "",
  "## 研究条件",
  "",
  "- 2025-08-10〜2026-08-10、初期1万円、積立なし、複利、10bps/30bps。",
  "- HYPE LONG・Idle TAO/RENDER・FET LONG(+8%/4pp)の累積BTからV52の87件だけ抽出。",
  "- 共有ポートフォリオに対するV52の円損益と、87件を同じ建玉サイズ比率でV52だけに複利再生した仮想資産は別の指標。",
  "",
  "## V52 87取引の損益とDD",
  "",
  "| 指標 | 10bps | 30bps |","|---|---:|---:|",
  f'| 勝敗 | {a["overall"]["wins"]}勝 / {a["overall"]["losses"]}敗 | {b["overall"]["wins"]}勝 / {b["overall"]["losses"]}敗 |',
  f'| 勝率 | {pc(a["overall"]["winRatePct"])} | {pc(b["overall"]["winRatePct"])} |',
  f'| 共有口座への利益寄与 | {yen(a["overall"]["positiveContributionJpy"])} | {yen(b["overall"]["positiveContributionJpy"])} |',
  f'| 共有口座への損失寄与 | {yen(a["overall"]["negativeContributionJpy"])} | {yen(b["overall"]["negativeContributionJpy"])} |',
  f'| V52純損益寄与 | {yen(a["overall"]["netContributionJpy"])} | {yen(b["overall"]["netContributionJpy"])} |',
  f'| V52のみ1万円仮想複利最終資産 | {yen(a["overall"]["syntheticIsolatedEndJpy"])} | {yen(b["overall"]["syntheticIsolatedEndJpy"])} |',
  f'| V52決済ベース最大DD | {pc(a["overall"]["closedTradeOnlyMaxDDPct"])} | {pc(b["overall"]["closedTradeOnlyMaxDDPct"])} |',
  f'| V52確定H1終値近似MTM DD | {pc(a["overall"]["approxPriceOnlyH1MTMDDPct"])} | {pc(b["overall"]["approxPriceOnlyH1MTMDDPct"])} |',
  f'| 8ロジック統合最大MTM DD | {pc(a["sourcePortfolioMTMDdPct"])} | {pc(b["sourcePortfolioMTMDdPct"])} |',
  "",
  "注意: V52単体の近似H1 DDは、Aster確定H1終値・元取引比率・fee引当から計算したもので、正規の取引所Bid/Ask・Funding・ポジション瞬間MTMではない。",
  "",
  "## LONG / SHORT の詳細",
  "",
  "| 指標 | LONG 10bps | SHORT 10bps | LONG 30bps | SHORT 30bps |",
  "|---|---:|---:|---:|---:|"
 ]
 for k,f in (("trades",str),("wins",str),("losses",str),
             ("winRatePct",pc),("netContributionJpy",yen),
             ("negativeContributionJpy",yen),
             ("closedTradeOnlyMaxDDPct",pc),
             ("approxPriceOnlyH1MTMDDPct",pc)):
  values=[a["side"]["LONG"][k],a["side"]["SHORT"][k],b["side"]["LONG"][k],b["side"]["SHORT"][k]]
  lines.append("| "+k+" | "+" | ".join(f(x) for x in values)+" |")
 lines+=["","## SHORTの敗因（10bps）","","| 決済理由 | 勝ち | 負け | 損失寄与 |","|---|---:|---:|---:|"]
 for reason in ("BASIS_CONVERGED","BASIS_STOP","TIME_OR_SESSION_FLAT"):
  x=a["byExitSide"]["SHORT|"+reason]
  lines.append(f'| {reason} | {x["wins"]} | {x["losses"]} | {yen(x["negativeContributionJpy"])} |')
 lines+=["","最大負けはTSLA SHORTのBasis収束決済。10bpsの元口座損失率は-2.039%、価格損失は約-0.919%。Basis STOP 1.75倍では早期に防げなかったケース。","",
  "## SHORTのロット調整候補：8ロジック統合BTで再計算",
  "",
  "| 研究条件 | 10bps資産 | 基準差 | DD | 全取引 | 30bps資産 | 基準差 | DD | 全取引 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  f'| 現行 | {yen(base["10"]["equityJpy"])} | 0 | {pc(base["10"]["maxMtmDdPct"])} | {base["10"]["closedTrades"]} | {yen(base["30"]["equityJpy"])} | 0 | {pc(base["30"]["maxMtmDdPct"])} | {base["30"]["closedTrades"]} |',
 ]
 for name in CASES:
  c=risk["cases"][name]["costs"];x=c["10"];y=c["30"]
  lines.append(f'| {name} | {yen(x["finalEquityJpy"])} | {yen(x["deltaVsCurrentJpy"])} | {pc(x["maxMtmDDPct"])} | {x["closedTrades"]} | {yen(y["finalEquityJpy"])} | {yen(y["deltaVsCurrentJpy"])} | {pc(y["maxMtmDDPct"])} | {y["closedTrades"]} |')
 lines+=["",
  "## 判定",
  "",
  f'- 10bps/30bpsで利益、統合最大DD、総取引数がすべて悪化しない候補: **{", ".join(qualified) if qualified else "なし"}**。',
  "- V52単独DDの低下と全8ロジックDDの低下は別。弱いBasisのSHORT半ロット化は勝ち取引も削る。",
  "- 10bps最大DD発生は2025-08-14 04:00 UTCでV52の最初の取引より前。その時の建玉はV12 SHORT・Q102 SHORT。",
  "- 30bps最大DD発生は2025-12-10 23:00 UTCでV52建玉0。その時はV12 SHORT・Q102 LONG。",
  "",
  "## −5% SHORT価格ハードSTOP候補",
  "",
  "- 既存Basis Stop 1.75倍は維持。価格損失-5%を独立した緊急保護条件として研究候補に残す。採用・LIVE切替はしていない。",
  "- 過去H1の高値では-5%到達0件、-2%も0件。したがってこの期間の実績利益/最大DDを改善する効果は計測されない。",
  "- −1%は2件、−1.5%は1件のH1高値到達可能性あり。ただし各1時間足に建玉外30分の値動きが含まれ、時系列・約定の精度が不足。M5/tick+実板データで認証が必要。",
  "",
  "## その他の追加候補",
  "",
  "- SHORTにはBasis収束で価格損失を出すケースがある。共通的なAster-Yahoo短期トレンドや入口Basisとリスク量の関係を、独立した期間OOSで追跡。",
  "- 先に研究したSHORT Basis悪化1.25倍・価格損失−0.1%の早期出口は10bpsプラス・30bpsマイナス。SHORT/LONGの早期Basis利確も両コストで利益低下。",
  "- 前回のストック99行（88決済、11見送り）を固定しており、見送り11件の再選択と完全独立TypeScriptエンジン一致は未証明。形式上の会計PASSはLIVE認証を意味しない。",
  "",
  "## 再現用ファイル",
  "",
  "- V52_ONLY_TRADE_DETAIL_20261022.csv (87件×2コスト174行)。",
  "- V52_ONLY_PNL_DD_ANALYSIS_20261022.json (LONG/SHORT・銘柄・月別・出口別・決済DD・近似H1 DD)。",
  "- V52_SHORT_RISK_CANDIDATES_FULL8_20261022.json (4構成×2コスト統合結果)。",
  "",
  "**RESEARCH_ONLY_NO_ADOPTION_NO_LIVE_CHANGES**",
  ""
 ]
 (DATA/"V52_ONLY_SHORT_RISK_RESEARCH_REPORT_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("V52_REPORT_COMPILED","CASES",len(CASES),"QUALIFIED",qualified,flush=True)
 for name in CASES:
  a=risk["cases"][name]["costs"]["10"];b=risk["cases"][name]["costs"]["30"]
  print("COMPARE",name,10,round(a["finalEquityJpy"]),round(a["deltaVsCurrentJpy"]),round(a["maxMtmDDPct"],5),a["closedTrades"],
                     30,round(b["finalEquityJpy"]),round(b["deltaVsCurrentJpy"]),round(b["maxMtmDDPct"],5),b["closedTrades"],flush=True)

if __name__=="__main__":main()
