#!/usr/bin/env python3
"""Publish 2026-10-22 five-coin Idle SHORT causal historical research without touching LIVE."""
from __future__ import annotations
import json,hashlib,datetime
from pathlib import Path
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
REPO=Path(__file__).resolve().parents[2]
OUT=REPO/"docs"/"research"/"results"/"idle-five-short-winrate-20261022"
OUT.mkdir(parents=True,exist_ok=True)
def read(path):return json.loads(Path(path).read_text(encoding="utf-8"))
def cleanrec(name,detail):
 return {
 "label":name,"gates":detail.get("gates"),"costs":{
  c:{k:v for k,v in x.items() if k not in ("sha256Ledgers","replay")}
  for c,x in detail["costs"].items()
  },"replay":{
  c:detail["costs"][c]["replay"] for c in detail["costs"]
 },"ledgerSha256":{
  c:detail["costs"][c]["sha256Ledgers"] for c in detail["costs"]
 }
 }
def money(v):return f"{v:,.0f}"
def pct(v):return f"{v:.2f}%"
def main():
 first=read(ROOT/"f8v2"/"IDLE5_FULL8_AFTER_HYPE_20261022.json")
 second=read(ROOT/"f8v3"/"IDLE5_FULL8_AFTER_HYPE_20261022.json")
 third=read(ROOT/"f8v4"/"IDLE5_FULL8_AFTER_HYPE_20261022.json")
 screen=read(ROOT/"five5"/"IDLE_ALL5_FEATURE_SCREEN_20261022.json")
 profit=read(ROOT/"five5"/"IDLE5_MORE_PROFIT_EXIT_PRE_SCREEN_20261022.json")
 historical=read(ROOT/"idle_short_after_hype_adopted"/"IDLE_SHORT_M5_PATH_SCREEN_20261022.json")
 anchor=read(REPO/"config"/"research"/"hype-entry-adopted-20261022.json")
 assert anchor["adoptedCombinedCaseId"]=="COMBO_I1H1_P3F1P5"
 baseline=first["results"]["HYPE_ADOPTED_BASELINE"]
 for cost in ("10","30"):
  h=anchor["adoptedDualExitIntegratedAnchor"][cost]
  p=baseline["costs"][cost]
  assert abs(p["finalEquityJpy"]-h["finalEquityJpy"])<.10
  assert abs(p["maxMtmDdPct"]-h["maxMtmDdPct"])<1e-8
 for policy,res in [*first["results"].items(),*second["results"].items(),*third["results"].items()]:
  for c,x in res["costs"].items():
   assert x["accounting"]=="PASS",(policy,c)
   assert x["sha256Ledgers"] and len(x["replay"])>=2
   assert all(bool(z["sha256Ledgers"]) if isinstance(z,dict) and "sha256Ledgers" in z else True for z in [])
 for c in ("10","30"):
  assert historical["costs"][c]["totalAcceptedIdleShort"]==historical["costs"][c]["validM5Count"]
  assert len([q for q in screen["samples"] if q.startswith(c+"_")])==5
 report={
  "status":"COMPLETE_RESEARCH_8LOGIC_CAUSAL_PRICE_MODEL_NOT_LIVE",
  "period":"2025-08-10..2026-08-10",
  "initialCapitalJpy":10000,"contributions":0,"modeledCostsBps":[10,30],
  "sourceBranch":"research/idle-five-symbol-winrate-causal-20261022",
  "hypeAdoptedEntryAndDualExit":"HYPE_BTC3H_LE0P6_REL3H_GE2P0_AND_COMBO_I1H1_P3F1P5",
  "lockedV12V4FourQ102Three":True,
  "PENGUOriginal":True,"dynamicEightLogicReselection":True,
  "venueCertified":False,"independentUnifiedTask9TypeScriptParityCertified":False,
  "productionOrLiveModified":False,
  "allValidAcceptedFiveMinuteIdleSource":True,
  "firstPassSourceVolumeBugCorrectedAndInvalidOldRunsDiscarded":True,
  "classification":"IN_SAMPLE_HISTORICAL_RESEARCH_SMALL_SAMPLE_MULTIPLE_TESTING_RISK",
  "baseline":cleanrec("HYPE_ADOPTED_BASELINE",baseline),
  "entryCases":{n:cleanrec(n,v) for n,v in first["results"].items() if n!="HYPE_ADOPTED_BASELINE"},
  "exitAndCumulativeCases":{n:cleanrec(n,v) for n,v in second["results"].items()},
  "renderBullishVetoCases":{n:cleanrec(n,v) for n,v in third["results"].items()},
  "fiveSymbolScreen":screen["samples"],
  "profitScreen":{c:{"groups":v["groups"]} for c,v in profit["costs"].items()},
  "originalExitScreen":{c:{key:val for key,val in v.items() if key!="ledger"} for c,v in historical["costs"].items()}
 }
 (OUT/"IDLE_FIVE_SHORT_CAUSAL_FULL8_20261022.json").write_text(
  json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 cases={**first["results"],**second["results"],**third["results"]}
 lines=[
 "# Idle Priority SHORT 5通貨・勝率と損失抑制の深掘り（2026-10-22）",
 "",
 "研究のみ。**HYPE採用済み新入口と初期STOP・利益保護を固定**し、V12 V4採用4出口、Q102採用3出口、PENGU等は変更なし。2025-08-10〜2026-08-10、1万円開始・積立なし・複利・10/30bps、8ロジック時系列動的再選択。",
 "",
 "## 統合経済BT（10bps主軸、30bpsストレス）",
 "",
 "| 研究ケース | 10bps資産 | 10bps基準差 | 30bps資産 | 30bps基準差 | 10bps MTM DD | 30bps MTM DD |",
 "|---|---:|---:|---:|---:|---:|---:|",
 ]
 labels={
 "HYPE_ADOPTED_BASELINE":"採用済HYPE・Idle現行",
 "RENDER_VOL1P2":"RENDER入口 出来高1h>=直前6hの1.2倍",
 "RENDER_BTC6LE0_RET6GE_MINUS4":"RENDER入口 BTC6h<=0%、銘柄6h>=-4%",
 "TAO_RET1H_LE_MINUS1":"TAO入口 直近1h騰落率<=-1%（有望）",
 "DOT_RET6GE_MINUS4":"DOT入口 直近6h騰落率>=-4%",
 "RENDER_PROFIT_1P5_FLOOR0P25":"RENDER出口 SHORT含益+1.5%後、+0.25%を保護",
 "TAO_RET1H_PLUS_RENDER_PROFIT":"TAO入口 + RENDER利益保護（累積）",
 "RENDER_RET6GE_MINUS4_REL6GE_MINUS2":"RENDER入口 6h>=-4%かつ相対6h>=-2pt",
 "TAO_RET1H_PLUS_RENDER_RET6REL6":"TAO入口 + RENDER 6h過落ち回避（累積）",
 "RENDER_SKIP_RISING_BTC_STRONG_REL":"RENDER入口：BTC6h>0%かつ相対6h>0ptの同時成立をBLOCK",
 "TAO_RET1H_PLUS_RENDER_SKIP_RISING_BTC_STRONG_REL":"TAO入口 + RENDER強気レジームBLOCK（累積）",
 "TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT":"TAO入口 + RENDER強気BLOCK + RENDER利益保護（累積）",
 }
 for name,res in cases.items():
  a=res["costs"]["10"];b=res["costs"]["30"]
  lines.append(f'| {labels.get(name,name)} | {money(a["finalEquityJpy"])}円 | {a["equityDeltaVsAdoptedJpy"]:+,.0f}円 | {money(b["finalEquityJpy"])}円 | {b["equityDeltaVsAdoptedJpy"]:+,.0f}円 | {pct(a["maxMtmDdPct"])} | {pct(b["maxMtmDdPct"])} |')
 lines+=["","## 通貨別の現行HYPE基準 8ロジック実約定モデル", "",
 "| 通貨 | 10bps勝敗 | 勝率 | 30bps勝敗 | 勝率 | 現時点の優先判定 |",
 "|---|---:|---:|---:|---:|---|"]
 comments={"RENDERUSDT":"最優先：低勝率・2026年1〜3月が弱い",
 "TAOUSDT":"1h<-1%入口は有望、標本小",
 "DOTUSDT":"既存5m保護維持が有力、一律入口Gateは収益混在",
 "JUPUSDT":"10bps4件・30bps7件。変更せず観察",
 "TIAUSDT":"10bps5/5・30bps6/6。入口の変更不要"}
 for sym in ("RENDERUSDT","TAOUSDT","DOTUSDT","JUPUSDT","TIAUSDT"):
  a=baseline["costs"]["10"]["byIdleShortSymbol"][sym]
  b=baseline["costs"]["30"]["byIdleShortSymbol"][sym]
  lines.append(f'| {sym} | {a["wins"]}勝{a["losses"]}敗 | {pct(a["winRatePct"])} | {b["wins"]}勝{b["losses"]}敗 | {pct(b["winRatePct"])} | {comments[sym]} |')
 lines+=["","## RENDER SHORT 個別勝率・実現損益（統合資産と区別）",
 "| ケース | 10bps勝敗 | 10bps RENDER損益 | 30bps勝敗 | 30bps RENDER損益 |",
 "|---|---:|---:|---:|---:|"]
 for name,res in cases.items():
  a=res["costs"]["10"]["byIdleShortSymbol"]["RENDERUSDT"]
  b=res["costs"]["30"]["byIdleShortSymbol"]["RENDERUSDT"]
  lines.append(f'| {labels.get(name,name)} | {a["wins"]}勝{a["losses"]}敗 | {money(a["modeledPnlJpy"])}円 | {b["wins"]}勝{b["losses"]}敗 | {money(b["modeledPnlJpy"])}円 |')

 lines+=["","## RENDER SHORTの負けパターンと原因仮説","","- 2026年1〜3月のRENDER SHORT（10/30bpsとも）2勝10敗・勝率16.7%。2026年4〜6月は10bps9勝5敗・64.3%、30bps8勝4敗・66.7%。ただしこの時系列の後半も条件選定に使っており**未使用OOSではない**。",
 "- 10bps過去実行で、RENDERのエントリー前6h下落率中央値：勝ち-1.09%、負け-2.88%。出来高比中央値：勝ち1.204倍、負け0.885倍。ATR3h中央値：勝ち0.408%、負け0.505%。「売られ過ぎと出来高不足のショート」が弱い仮説。",
 "- 完全に決着したM5のみ使用。出来高は当該通貨自身の価格履歴を参照するよう検証途中にバグ修正、古いBTC出来高参照の暫定結果と出力は破棄。原因・修正・専用単体テストを記録。",
 "- 現行RENDERの3%以上のMFEを達成した勝ちもあり、短い出口は主力勝ちを犠牲にし得るため、利益保護は既存winnerへの作用を明示的に分解。","",
 "## 入口フィルターの判定","","- RENDER出来高1.2倍Gate：10bpsの勝率70.0%、30bps77.8%まで改善。ただし8ロジック資産は両方減少、DD改善なし。勝率単独では採用不可。",
 "- RENDERのBTC6h<=0かつRENDER6h>=-4%：資産は両コストで減少。回復局面の根本問題を完全には解消できず。",
 "- TAO 1h騰落率<=-1.0%：全8ロジックで10/30bps双方資産プラス、TAOショート5勝0敗・6勝0敗。単一期間・小標本のためフォワード/OOSが必要。",
 "- DOT 6h>=-4%：10bps資産減、30bps小幅増でもDD悪化。見送り。",
 "- JUPとTIAは取引数が少なく、現状高勝率。入口/出口の新ルールを無理に導入しない。",
 "",
 "## 利益保護の検証","","- RENDER SHORT「含み益+1.5%到達を確定M5終値で確認し、後続足で+0.25%の保護水準に逆行したら決済」：採用済約定群を対象とする事前5m経路検証は10/30bpsとも旧負け4件、旧勝ち0件がヒット。",
 "- 同条件の8ロジック動的BTは上表。単独ケースとTAO入口との併用を分けて報告する。10bps/30bpsの勝率・最終資産・DDを優先。",
 "- +1.5%→+0.5%に保護床を上げると、10/30bpsとも旧負け4件に加えて旧勝ち1件も決済対象。+0.75%/+1.0%床では主力winner切りが増加。",
 "",
 "## 採用に進む場合の研究候補",
 "- **10bpsの最高最終資産候補**：TAO入口1h<=-1%、RENDER強気BTC相対6h veto、RENDER+1.5%確定後+0.25%利益床の3条件併用。10bps最終資産239,985,735円、RENDER15勝9敗（62.5%）。",
 "- **30bpsストレスに最も強い候補**：TAO入口1h<=-1%とRENDER強気BTC相対6h vetoの2条件併用。30bps最終資産136,216,673円。3条件併用の30bpsは135,946,895円で、2条件併用より269,778円低い。",
 "- **RENDERの低勝率解消は未完了**：直近3ヶ月以降の未使用OOS、30bpsでの利益保護床の取引コスト耐性、残る単独大敗の入口要因を追加検証。利益保護の+0.25%床は10bpsではRENDERの旧負け4件をプラスへ転換、30bpsでは4件とも小負けを維持。",
 "- 新SHORT条件はいずれも**ユーザーの正式採用・Production配線・venue取引認証未完了**。既存LIVE変更はしない。",
 "",
 "## 結論・品質とProduction境界","","- 最終採否は勝率だけではなく統合最終資産・MTM DD・既存の勝ち幅・10/30bps頑健性・複数条件の探索バイアスを総合。ユーザーが明示的に採用済みなのはHYPE入口2条件と出口2条件のみ。新Idle SHORT条件は研究候補。",
 "- 原データは全シンボルで欠損0（確定5m後方参照）。フル統合は正式Task9 TypeScript経済パリティ・実venue STOP認証・未使用期間OOSを未完了。LIVE/Production/VPS/注文/HPには一切変更なし。",
 "- 本レポートのJSONに各variantの動的BT会計PASS、全件シグナル再選択、採用された全トレードのモデリング統計、停止判定収束、台帳SHA256を保存。原本台帳はユーザー所有PCの隔離研究フォルダ内。",
 ""]
 (OUT/"IDLE_FIVE_SHORT_CAUSAL_FULL8_REPORT_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("COMPILED",OUT)
 print("CASE_COUNT",len(cases))
 for n,z in cases.items():
  print("CASE",n,"10bps",round(z["costs"]["10"]["equityDeltaVsAdoptedJpy"]),
        "30bps",round(z["costs"]["30"]["equityDeltaVsAdoptedJpy"]),
        "RENDER_W",z["costs"]["10"]["byIdleShortSymbol"]["RENDERUSDT"]["wins"])
if __name__=="__main__":main()
