#!/usr/bin/env python3
"""Audit and compile AMZN-specific V52 reference-regime entry model results."""
from __future__ import annotations
import csv,datetime,hashlib,json
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=REPO/"docs/research/results/v52-amzn-entry-20261022"
BASE=ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json"
FOLDER=REPO/"docs/research/results/v52-short-risk-followup-20261022"
SCRIPTS=REPO/"scripts/dd-reduction"
INPUTS=(ROOT/"f8v52amzn/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json",
        ROOT/"f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json")
STATUS="RESEARCH_ONLY_IN_SAMPLE_AMZN_CAUSAL_ENTRY_VETO_NOT_LIVE"
LABELS={
 "AMZN_SHORT_PRIOR_CLOSE_PLUS0P5":"SHORT 前営業日比 +0.5%超は見送り",
 "AMZN_SHORT_PRIOR_CLOSE_PLUS1P0":"SHORT 前営業日比 +1.0%超は見送り",
 "AMZN_LONG_H1_MINUS1P0":"LONG Yahoo直前H1が-1.0%以下なら見送り",
 "AMZN_SHORT0P5_PLUS_LONG_H1_MINUS1P0":"SHORT +0.5% / LONG H1 -1.0% 複合",
}
MONTHS=("2025-08","2025-09","2025-10","2025-11","2025-12","2026-01",
        "2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08")

def load(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def money(v):return f"{v:,.0f}円"
def pc(v):return f"{v:.3f}%"

def main():
 original=load(BASE)["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"]
 baseline=load(FOLDER/"V52_ONLY_PNL_DD_ANALYSIS_20261022.json")["cost"]
 cases={}
 for path in INPUTS:
  src=load(path)
  assert src["status"]=="RESEARCH_ONLY_AMZN_ENTRY_YAHOO_REFERENCE_CLOSED_H1_V52_SOURCE_FIXED"
  for name,item in src["cases"].items():
   assert name not in cases
   cases[name]=item
 assert set(cases)==set(LABELS)
 orig={}
 with (FOLDER/"V52_ONLY_TRADE_DETAIL_20261022.csv").open(encoding="utf-8",newline="") as f:
  entries=list(csv.DictReader(f))
 for cost in (10,30):
  arr=[x for x in entries if int(x["cost_bps"])==cost and x["symbol"]=="AMZNUSDT"]
  assert len(arr)==17
  for row in arr:
   t=int(datetime.datetime.fromisoformat(row["entry_utc"]).timestamp()*1000)
   key=(int(cost),t,row["side"])
   assert key not in orig
   orig[key]=row
 source88=[json.loads(x) for x in (ROOT/"v52_stock_tape_studies_20261022/V52_AFTER_FET84_NO_CHANGE/v52-model-ledger.jsonl").read_text("utf-8").splitlines() if x]
 original_skips=[x for x in source88 if x["status"]!="MODELED_CLOSED_TRADE"]
 assert len(source88)==99 and len(original_skips)==11
 csvrows=[]
 analysis={}
 for name,item in cases.items():
  manifest=item["tape"]
  features=manifest["amznAllOriginalEntryFeatures"]
  assert len(features)==17 and manifest["originalSuppressedUnchanged"]==11
  block=manifest["rejectedAmznRecords"]
  assert manifest["amznVetoCount"]==len(block)
  observed={(x["originalEntryTsMs"],x["side"]) for x in block}
  assert len(observed)==len(block)
  blockedWins=0;blockedLosses=0
  for x in block:
   row=orig[(10,int(x["originalEntryTsMs"]),x["side"])]
   blockedWins+=float(row["wallet_return_pct"])>0
   blockedLosses+=float(row["wallet_return_pct"])<0
  not_regenerated=[]
  for s in original_skips:
   when=s["decision_ts_ms"]
   for r in source88:
    if r["status"]=="MODELED_CLOSED_TRADE" and (r["entry_ts_ms"],r["side"]) in observed \
     and r["entry_ts_ms"]<=when<r["exit_ts_ms"]:
     not_regenerated.append({"suppressedSymbol":s["symbol"],"decisionTs":when,"freedOriginalSymbol":r["symbol"]})
  for cost in ("10","30"):
   q=item["costs"][cost]
   assert q["accounting"]=="PASS"
   assert q["v52Trades"]==87-len(block)
   assert q["amzn"]["new"]==17-len(block)
   assert q["amzn"]["wins"]==baseline[cost]["bySymbol"]["AMZN"]["wins"]-blockedWins
   assert q["amzn"]["losses"]==baseline[cost]["bySymbol"]["AMZN"]["losses"]-blockedLosses
   assert q["reselectionPasses"]>=2
  analysis[name]={
    "label":LABELS[name],"blockedTrades":len(block),
    "blockedWinningTrades":blockedWins,"blockedLosingTrades":blockedLosses,
    "blockedShort":manifest["amznVetoShort"],"blockedLong":manifest["amznVetoLong"],
    "original11SuppressedEntriesFreedByThisVeto":not_regenerated,
    "10bps":item["costs"]["10"],"30bps":item["costs"]["30"],
    "sourceStockTapeSha256":manifest["caseTape99Sha256"],
    "sourceOriginalStockTapeSha256":manifest["sourceOriginal99Sha256"],
   }
  for f in features:
   key=(10,int(f["entryTsMs"]),f["side"])
   src=orig[key]
   row={"scenario":name,
        "entry_utc":datetime.datetime.fromtimestamp(int(f["entryTsMs"])/1000,datetime.timezone.utc).isoformat(),
        "side":f["side"],"price_entry_basis_bps":f["entryBasisBps"],
        "prior_ny_session_yahoo_return_pct":f["returnSincePreviousNySessionClosePct"],
        "last_completed_yahoo_h1_return_pct":f["lastCompletedYahooH1ReturnPct"],
        "original_trade_net_wallet_return_pct_10bps":src["wallet_return_pct"],
        "original_trade_realized_profit_jpy_10bps":src["shared_portfolio_realized_pnl_jpy"],
        "original_winner_10bps":float(src["wallet_return_pct"])>0,
        "gate_blocks":f["rejectedByCandidate"],
        "yahoo_last_completed_utc":f["yahooLastCompletedBarStartedUtc"],
        "prior_yahoo_session_last_close_utc":f["previousNySessionLastCloseBarStartedUtc"]}
   csvrows.append(row)
 assert len(csvrows)==17*len(cases)
 OUT.mkdir(parents=True,exist_ok=True)
 with (OUT/"V52_AMZN_CAUSAL_ENTRY_17TRADES_FEATURES_20261022.csv").open("w",encoding="utf-8",newline="") as fd:
  writer=csv.DictWriter(fd,fieldnames=list(csvrows[0]),lineterminator="\n")
  writer.writeheader();writer.writerows(csvrows)
 research={
  "schema":"v52-amzn-17-trade-specific-yahoo-entry-gate-native-stock-8strategy-v1",
  "status":STATUS,
  "period":"2025-08-10..2026-08-10",
  "baseLogic":"HYPE/TAO/RENDER/FET8_4 adopted, all non-AMZN V52 and other strategies unchanged",
  "startingCapitalJpy":10000,
  "previousBenchmark":original,
  "originalAMZNStats":{"10bps":baseline["10"]["bySymbol"]["AMZN"],"30bps":baseline["30"]["bySymbol"]["AMZN"]},
  "sourceAsterYahooProvenance":"docs/research/results/v52-after-fet-20261022/V52_YAHOO_ASTER_H1_SOURCE_PROVENANCE_20261022.json",
  "cases":analysis,
  "timingContract":"Yahoo H1 candle start+one hour <= decision time; previous NY session close not same-day future",
  "nonRegeneratedSuppressedStock11":True,
  "sourceIsActualLiveVenueStopFill":False,
  "oosNotAvailable":True}
 (OUT/"V52_AMZN_ENTRY_FULL8_COMPARISON_20261022.json").write_text(
  json.dumps(research,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 lines=[
  "# V52 AMZN専用の入口改善研究 2026-10-22",
  "",
  "**研究のみ。LIVE・VPS・HP・注文・建玉変更なし。既存V52の出口とBasis Stop 1.75倍はそのまま。**",
  "",
  "## 課題と母集団",
  "",
  "- 2025-08-10〜2026-08-10、10/30bps、1万円初期・積立なし・複利で8ロジック統合BT。",
  "- AMZNはV52全87件中17件。LONG6件（4勝2敗）、SHORT11件（6勝5敗）で全10勝7敗（勝率58.82%）。",
  "- SHORTの負けはBasis STOPだけでなく、期間中にAster建玉の価格が動かないままTIME_OR_SESSION_FLATで往復手数料を払う例が多い。",
  "- Aster価格とYahoo参照のズレが根拠のV52なので、入口でYahooの前日終値比トレンドを判定する仮説を検証。",
  "- Yahoo Referenceは当該AMZNの**確定済み**60分足のみ。エントリー時点で未来のYahoo当日引けやその後の1時間足を見ない。",
  "",
  "## 8ロジック統合BT（単位: 円）",
  "",
  "| AMZNのみ入口変更 | 見送り件数 (勝/負) | 10bps最終資産 | 基準差 | 最大DD | 30bps最終資産 | 基準差 | 最大DD |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  f'| 現状維持 | 0 | {money(original["10"]["equityJpy"])} | 0 | {pc(original["10"]["maxMtmDdPct"])} | {money(original["30"]["equityJpy"])} | 0 | {pc(original["30"]["maxMtmDdPct"])} |',
 ]
 for name in LABELS:
  v=analysis[name];t=v["10bps"];s=v["30bps"]
  lines.append(f'| {v["label"]} | {v["blockedTrades"]} (勝{v["blockedWinningTrades"]}/負{v["blockedLosingTrades"]}) | {money(t["equityJpy"])} | {money(t["deltaEquityJpy"])} | {pc(t["maxMtmDdPct"])} | {money(s["equityJpy"])} | {money(s["deltaEquityJpy"])} | {pc(s["maxMtmDdPct"])} |')
 lines+=["","## 入口フィルタの根拠と検出されたリスク",
  "",
  "- 入口Basisの最低60bpsは変更しない。SHORT側の候補はYahoo株価の前営業日の最後の確定参照値から、入口までに確定したYahoo株価までの騰落率。",
  "- +0.5%超のSHORT見送りは3敗を拾ったが、資金リバランス後の最終資産は10/30bpsとも減少。",
  "- +1.0%超のSHORT見送りは1敗のみ対象で、複利資産増加が観測されても単一トレードに依存するため過学習リスクが大きい。",
  "- 基準が+0.5%から+1.0%に少し変わるだけで10/30bpsの利益影響が逆転し、信号の頑健性が弱い。",
  "- LONG側の入口Yahoo直前H1が-1%以下は、急落追い掛けの除外という仮説。別に統合BTで計算。",
  "",
  "## 同じ条件が他のV52銘柄で通用するか（対照試験）",
  "",
  "- Yahoo前営業日終値比が+1%超だったSHORTは、AMZNでは1件中0勝1敗。",
  "- しかし**他の4銘柄では12件中11勝1敗**。この条件は全V52共通Gateにしてはならない。",
  "- 各銘柄の信号と参考価格・約定先価格は異なる。AMZNの閾値探索は個別・小標本の仮説に過ぎない。",
  "",
  "## 固定ストックテープと因果証拠の限界",
  "",
  "- 歴史的ネイティブV52正本99行（88決済・11既存抑制）から、AMZN指定エントリーだけをSKIPPED_CANDIDATEに置換。ほかの通貨・建値・出口・理由・Gross変更なし。",
  "- 8ロジックのウォレット・競合Gross・因果H1再選択は再実行し会計PASS。ただし元から抑制された11件のストック候補を完全再生成しておらず、新規発火可能な未保存候補も検証していない。",
  "- この比較結果は実際のAster/NYSEでの約定気配、スリッページ、部分約定を認証したものではない。",
  "- もとがAMZN17件という小標本で、同一年の取引結果を見てから閾値を決めた探索的BT。*独立したOut-of-sampleは未実施*。",
  "",
  "## 研究段階の運用方針",
  "",
  "- **暫定結論：新たなAMZNゲートはLIVE非採用**。+1.0% SHORT遮断は両コストで統合利益増でも、対象が1敗のためForward Shadow候補に限定。",
  "- V52全体のENTRY/EXITを変更しない。",
  "- AMZN専用の短期YahooトレンドGateだけを研究・Shadow監視候補として保持。利益・DDとも頑健であることを別期間と実時系列で確認後に採否。",
  "- 次の認証は元LIVEと同じ時間足確定境界・前日NYセッション判定・現場のYahoo参照取得失敗時のFail Closed・独立なForward Shadow記録。",
  "",
  "## 詳細データと再現実行",
  "",
  "- V52_AMZN_ENTRY_FULL8_COMPARISON_20261022.json：各候補の実際の8ロジック複利リバランス・会計・V52/AMZN件数。",
  "- V52_AMZN_CAUSAL_ENTRY_17TRADES_FEATURES_20261022.csv：17件×候補ごとの入口前Yahoo/元勝敗、エントリー確定時刻。",
  "- V52_SHORT_ENTRY_OTHER_STOCKS_NEGATIVE_CONTROL_20261022.json / V52_SHORT_52_YAHOO_ENTRY_NEGATIVE_CONTROL_20261022.csv：他銘柄対照。",
  "- scripts/dd-reduction/run-v52-amzn-entry-full8-after-fet-20261022.py：Python再現本体。",
  "- scripts/dd-reduction/test-v52-amzn-entry-causal-full8-after-fet-20261022.py：未来参照・元11件・AMZN単独変更・基準一致のテスト。",
  "",
  "**STATUS: RESEARCH_ONLY_NOT_APPROVED_FOR_LIVE**",
  ""]
 (OUT/"V52_AMZN_ENTRY_RESEARCH_REPORT_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("COMPILED",len(cases),"SCENARIOS","AMZN_TRACE",len(csvrows),"BASE10",round(original["10"]["equityJpy"]),"BASE30",round(original["30"]["equityJpy"]),flush=True)
 for name,c in analysis.items():
  a=c["10bps"];b=c["30bps"]
  print("RESULT",name,"BLOCK",c["blockedTrades"],"10",round(a["equityJpy"]),round(a["deltaEquityJpy"]),round(a["maxMtmDdPct"],4),a["closedTrades"],
   "30",round(b["equityJpy"]),round(b["deltaEquityJpy"]),round(b["maxMtmDdPct"],4),b["closedTrades"],
   "SKIPPED_ORIGINAL_OVERLAP",len(c["original11SuppressedEntriesFreedByThisVeto"]),flush=True)
if __name__=="__main__":main()
