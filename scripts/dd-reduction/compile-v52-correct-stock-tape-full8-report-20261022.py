#!/usr/bin/env python3
"""Compile ONLY the V52-native 99-stock-tape updated full8 economic research.

Never accept the accidentally inert crypto-only V52 candidate-hook output.
Strictly match HYPE/Idle/FET8/4 previously adopted research and baseline
10bps/30bps before attaching any improvement or recommendation.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]
DATA=REPO/"docs/research/results/v52-after-fet-20261022"
FET=REPO/"docs/research/results/fet-after-hype-render-tao-20261022/FET_EXIT_FULL8_RESULTS_20261022.json"
BASE="V52_AFTER_FET84_NO_CHANGE"
OTHERS=("V52_SHORT_PARTIAL_CONV30_PNL0P2","V52_SHORT_BASIS125_LOSS0P1","V52_LONG_PARTIAL_CONV30_PNL0P2")

def j(p):return json.loads(Path(p).read_text("utf-8"))
def yen(x):return f"{x:,.0f}円"
def dd(x):return f"{x:.4f}%"
def wr(x):return f'{x["v52Wins"]}/{x["v52Trades"]}'

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--baseline",type=Path,required=True)
 parser.add_argument("--candidate",type=Path,required=True)
 args=parser.parse_args()
 main=j(args.baseline)
 alt=j(args.candidate)
 assert main["status"]=="RESEARCH_ONLY_V52_NATIVE_STOCK_TAPE_FIXED_SUPPRESSED_11"
 assert alt["status"]==main["status"]
 assert list(main["cases"])==[BASE]
 assert set(alt["cases"])==set(OTHERS)
 assert main["fixedPriorLogic"]==alt["fixedPriorLogic"]
 comps={**main["cases"],**alt["cases"]}
 formally=j(FET)["results"]["FET_TRAIL_8P_GIVEBACK_4P"]["costs"]
 for cost in ("10","30"):
  baseline=comps[BASE]["costs"][cost]
  expected=formally[cost]
  assert baseline["accounting"]=="PASS" and baseline["v52Trades"]==87
  assert abs(baseline["equityJpy"]-expected["portfolioFinalEquityJpy"])<.2
  assert abs(baseline["maxMtmDdPct"]-expected["maxMtmDdPct"])<1e-7
  assert baseline["modifiedV52Exits"]==0
 parity=j(DATA/"V52_HOURLY_PARITY_20261022.json")
 assert parity["cost"]["10"]["modelTrades"]==87
 assert parity["cost"]["10"]["paired"]==87
 assert parity["cost"]["10"]["reasonMatches"]==86
 qualified=[]
 for case,combo in comps.items():
  assert set(combo["costs"])=={"10","30"}
  assert combo["tapeManifest"]["originalRows"]==99
  assert combo["tapeManifest"]["originalClosed"]==88
  assert combo["tapeManifest"]["suppressedPreentryUnmodified"]==11
  for cost,run in combo["costs"].items():
   assert run["accounting"]=="PASS"
   assert run["v52Wins"]+run["v52Losses"]==run["v52Trades"]
   assert run["v52Trades"]>=80
   assert run["fixedStockOriginallySuppressed11"]
   assert run["reselectionHistory"]
   assert run["modifiedV52Exits"]<=combo["tapeManifest"]["modifiedClosedRows"]
   assert run["ledgerSha256"] and run["stockSourceRootSha256"]==combo["tapeManifest"]["normalizedScenarioSha256"]
   if case!=BASE:assert run["modifiedV52Exits"]>=1,(case,cost)
  if case!=BASE:
   a=combo["costs"]["10"];b=combo["costs"]["30"]
   if a["deltaVsFet84BaselineJpy"]>0 and b["deltaVsFet84BaselineJpy"]>0 \
     and a["maxMtmDdPct"]>=comps[BASE]["costs"]["10"]["maxMtmDdPct"]-1e-7 \
     and b["maxMtmDdPct"]>=comps[BASE]["costs"]["30"]["maxMtmDdPct"]-1e-7:
    qualified.append(case)

 record={
  "schema":"v52-native-stock-tape-h1-full8-after-fet84-research-v1",
  "status":"RESEARCH_ONLY_NOT_LIVE_NOT_FULL_CAUSAL_ADMISSION_REGEN",
  "economicBase":"HYPE_LONG_USER_ADOPTED_TAO_RENDER_3IDLE_RULES_PLUS_FET_TRAIL_8P_4PP",
  "period":"2025-08-10..2026-08-10",
  "initialCapitalJpy":10000,
  "depositsJpy":0,
  "compounding":True,
  "normalFrictionBps":10,
  "stressFrictionBps":30,
  "stockNativeLedgerRows":99,
  "stockNativeClosedRows":88,
  "fixedSuppressedStockCandidates":11,
  "completeNewExitPathAppliedToV52NativeLedger":True,
  "newExitNativeRouteIsNotCryptoOnlyPreallocation":True,
  "userSelectedCases":["V52_AFTER_FET84_NO_CHANGE"] if not qualified else [],
  "twoCostNonWorseningDdQualified":qualified,
  "results":comps,
  "provenance": {
    "sourceAudit":"V52_BASIS_AUDIT_20261022.json",
    "referenceAndAsterH1Parity":"V52_HOURLY_PARITY_20261022.json",
    "yahooHourlyPricesAcquiredOutsideGit":"v52_hourly_reference_recovery/yahoo-h1-provenance-manifest.json",
    "asterOfficialHourlySource":"Previous_Projects/bt-analysis-formal/market-Aster-H1-funding-and-manifests/normalized/aster_stock/klines"
  },
  "hardLimitations":[
   "Fixed original 99-row V52 tape; the 11 originally suppressed same-session V52 candidates are not regenerated on earlier exit.",
   "No complete V52 eligibility re-run, so not full dynamically reselected 8-strategy research in the V52 sleeve (other seven reallocate).",
   "Yahoo public 60m and Aster official H1 last completed closes are price-model proxies, not simultaneous executable live price or L2 order book.",
   "One V52 historical exit reason and two entry basis quotes disagree with reconstructed H1; those rows fail closed for new changes.",
   "In sample exploratory testing 2025-08..2026-08; no untouched OOS, independent production TypeScript parity or actual venue STOP certification.",
   "Nothing in this research executes orders, authorizes Kill Switch bypass, updates Production/Runner/HP or certifies LIVE."
  ]
 }
 DATA.mkdir(parents=True,exist_ok=True)
 (DATA/"V52_NATIVE_STOCK_FULL8_COMPARISON_20261022.json").write_text(json.dumps(record,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")

 lines=[
  "# V52 LONG/SHORT 出口：FET8/4累積後・本来の株式連動台帳で8ロジック統合BT",
  "",
  "**研究のみ。LIVE切替・注文・Production変更なし。今回のV52新出口はまだ正式採用しない。**",
  "",
  "## 徹底検証した一次条件",
  "",
  "- 最新研究アンカー：HYPE LONG新入口＋2出口、TAO SHORT入口、RENDER SHORT入口・利益保護、FET LONG +8% arm／4pp giveback、DOT/V12/Q102/PENGU/残り据置。",
  "- 2025-08-10〜2026-08-10、1万円・積立なし・複利、10bpsと30bps、総8ロジック。",
  "- Aster公式H1各銘柄8784本、Yahoo公開60m各銘柄1742本のハッシュ照合を通過。",
  "- 保有中のチェックポイントでは完了済み1h足しか参照せず、同時刻の未完成足や未来参照を禁止。",
  "- 旧V52テープの99件（88件決済、11件当初見送り）から各研究ケースの専用複製台帳だけ出口を修正。元の正式資料は変更なし。",
  "- 仮想通貨候補だけを変更した旧実験はV52決済が変わらず無効だったので破棄。本研究はV52本来のstock nativeモデル入力を置換し、統合ウォレットで再生。",
  "- 追加出口モデルでは一致率87入口中86出口理由一致。Basis entry異常2件・exit reason異常1件は変更を禁止。",
  "",
  "## 8ロジック統合結果",
  "",
  "| ケース | 10bps最終資産 | 基準差 | DD | V52勝数 | 30bps最終資産 | 基準差 | DD | V52勝数 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
 ]
 for case,row in comps.items():
  a=row["costs"]["10"];b=row["costs"]["30"]
  lines.append(
   f'| {case} | {yen(a["equityJpy"])} | {a["deltaVsFet84BaselineJpy"]:+,.0f}円 | {dd(a["maxMtmDdPct"])} | {wr(a)} | {yen(b["equityJpy"])} | {b["deltaVsFet84BaselineJpy"]:+,.0f}円 | {dd(b["maxMtmDdPct"])} | {wr(b)} |'
  )
 lines+=["","## 実際に変更されたV52出口件数",""]
 for case,row in comps.items():
  a=row["costs"]["10"];b=row["costs"]["30"]
  lines.append(f'- **{case}**: 元のV52テープ上の変更{row["tapeManifest"]["modifiedClosedRows"]}件、10bps portfolio採用後変更{a["modifiedV52Exits"]}件、30bps採用後変更{b["modifiedV52Exits"]}件。')
 lines+=["","## 研究としての判断","",
  f'10bps・30bps両方で統合資産が増え、MTM DDが悪化しないもの: **{", ".join(qualified) if qualified else "該当なし"}**。',
  "",
  "V52のBasis Stop 1.75倍は以前の研究で守るべき条件。新しい固定価格STOPを追加したり、既存収束/時間出口の成功取引を不必要に削ったりしない。",
  "",
  "### 正式採用を保留する理由",
  "",
  "- **最大の欠落は当初見送り11件のV52ネイティブ候補再生成**。新出口に伴って同一セッションV52の次候補が繰り上がる可能性は、この99行固定台帳では計算していない。したがって本結果はV52専用の完全因果再選択ではなく固定テープ感度分析。",
  "- 基準V52の87採用取引は原本87/87の入口時刻・符号と一致し、86/87の既存出口理由をH1参照で再現。例外を除外したうえで仮想出口を実装。",
  "- モデル上H1 価格・Basisを再現できても、ライブの瞬間BID/ASKと同時刻参照、資金拘束・pending、Resident STOP・IOC、スリッページは未認証。",
  "- 調整した同一年データの探索なのでOOSの独立検証とTypeScript Task9 LIVE差分Parityも必要。",
  "- 旧LIVE Runnerは変更しない。ユーザーの正式採用判断前のLIVE投入はしない。",
  "",
  "### 次の検証",
  "",
  "保有中のYahoo/Aster同期チェックポイントと、見送り11候補の値段・既存建玉占有が変化する時点の全候補を保存したV52 native signal generatorを入手／復元する。これにより再選択を含む再現可能な年次BTを確立し、新改善が利益/DDで有利な場合だけ採用可否を判断する。",
  "",
 ]
 (DATA/"V52_NATIVE_STOCK_FULL8_COMPARISON_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("COMPILED_NATIVE_STOCK_FULL8_10_30BPS","CASE_N",len(comps),"BOTH_COST_QUALIFIED",qualified,flush=True)
 for case,row in comps.items():
  a=row["costs"]["10"];b=row["costs"]["30"]
  print("COMPARE",case,"10",round(a["equityJpy"]),round(a["deltaVsFet84BaselineJpy"]),"DD",round(a["maxMtmDdPct"],4),
    "CHANGED",a["modifiedV52Exits"],"30",round(b["equityJpy"]),round(b["deltaVsFet84BaselineJpy"]),"DD",round(b["maxMtmDdPct"],4),
    "CHANGED",b["modifiedV52Exits"],flush=True)

if __name__=="__main__":main()
