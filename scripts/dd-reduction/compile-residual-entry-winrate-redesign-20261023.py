#!/usr/bin/env python3
"""Compile audit-ready RESIDUAL entry research, 25 gates + 20 LONG + 22 SHORT + score."""
from pathlib import Path
import json,csv
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[1]
OUT=REPO/"docs/research/results/residual-entry-after-amzn-20261023"
def read(name):return json.loads((OUT/name).read_text("utf-8"))
def f(x):return f"{x:.1f}%" if x is not None else "—"
def pf(x):return f"{x:.3f}" if x is not None else "—"
def main():
 screen=read("RESIDUAL_CAUSAL_ENTRY_PRE_SCREEN_20261023.json")
 long=read("RESIDUAL_INDEPENDENT_NEW_ENTRY_MODEL_20261023.json")
 short=read("RESIDUAL_INDEPENDENT_BEAR_SHORT_DESIGN_20261023.json")
 score=read("RESIDUAL_ENTRY_PROBABILITY_TIME_SPLIT_20261023.json")
 assert len(screen["ruleDefinitions"])==25
 assert len(long["definitions"])==20
 assert len(short["rules"])==22
 assert len(score["features"])==18
 for s in ("DOGEUSDT","AVAXUSDT"):
  assert s in screen["costs"]["10"] and s in screen["costs"]["30"]
  assert all(set(long["cases"][name][s])=={"10","30"} for name in long["cases"])
  assert all(set(short["cases"][name][s])=={"10","30"} for name in short["cases"])
  assert set(score["results"][s]["validation"]["cases"])=={"q70","q80","q90","q95"}
  assert set(score["results"][s]["later"]["cases"])=={"q70","q80","q90","q95"}
 def qualify(r10,r30):
  return (r10["trades"]>=20 and r30["trades"]>=20
    and (r10["winRatePct"] or 0)>=70 and (r30["winRatePct"] or 0)>=70
    and (r10.get("tradeProfitFactor") or r10.get("pf") or 0)>=1.2
    and (r30.get("tradeProfitFactor") or r30.get("pf") or 0)>=1.2
    and abs(r10.get("closedTradeDDPct",r10.get("closedDDPct",0)))<=15
    and abs(r30.get("closedTradeDDPct",r30.get("closedDDPct",0)))<=15)
 qualifyLong=[]
 qualifyShort=[]
 qualifyModel=[]
 for name,item in long["cases"].items():
  for sym in ("DOGEUSDT","AVAXUSDT"):
   a,b=item[sym]["10"],item[sym]["30"]
   if qualify(a["all"],b["all"]) and a["late"]["trades"]>=10 and b["late"]["trades"]>=10 \
     and (a["late"]["winRatePct"] or 0)>=70 and (b["late"]["winRatePct"] or 0)>=70:
    qualifyLong.append([name,sym])
 for name,item in short["cases"].items():
  for sym in ("DOGEUSDT","AVAXUSDT"):
   a,b=item[sym]["10"],item[sym]["30"]
   if qualify(a["all"],b["all"]) and a["late"]["trades"]>=10 and b["late"]["trades"]>=10 \
     and (a["late"]["winRatePct"] or 0)>=70 and (b["late"]["winRatePct"] or 0)>=70:
    qualifyShort.append([name,sym])
 for sym in ("DOGEUSDT","AVAXUSDT"):
  for name in ("q70","q80","q90","q95"):
   val=score["results"][sym]["validation"]["cases"][name]
   test=score["results"][sym]["later"]["cases"][name]
   if all(val[c]["n"]>=20 and test[c]["n"]>=20
     and (val[c]["winRatePct"] or 0)>=70 and (test[c]["winRatePct"] or 0)>=70
     and (val[c]["pf"] or 0)>=1.2 and (test[c]["pf"] or 0)>=1.2
     and abs(test[c]["closedDDPct"])<=15 for c in ("10","30")):
    qualifyModel.append([name,sym])
 assert not qualifyLong and not qualifyShort and not qualifyModel,(
  "QUALIFIER_FOUND_MUST_REASSESS_RESEARCH_ADOPTION",qualifyLong,qualifyShort,qualifyModel)
 source={
  "schema":"RESIDUAL_entry_redesign_20261023_v1",
  "status":"NO_ROBUST_70PCT_WR_ENTRY_MODEL_FROM_AVAILABLE_SCREEN_RESEARCH_NOT_LIVE",
  "entryUniverse":"DOGEUSDT and AVAXUSDT, original LONG and new direction-aware SHORT",
  "costsBps":[10,30],
  "qualification":{"winRatePctBothCosts":70,"profitFactorBothCosts":1.2,
    "maxClosedDrawdownPct":15,"minTrades":20,"minLateTrades":10},
  "screenCount":len(screen["ruleDefinitions"]),"newLongCount":len(long["definitions"]),
  "newShortCount":len(short["rules"]),"predictiveTrainScoreQuantiles":[70,80,90,95],
  "passedNewLong":qualifyLong,"passedNewShort":qualifyShort,
  "passedProbScoreValidationAndLater":qualifyModel,
  "sourceRawArtifacts":[
    "RESIDUAL_CAUSAL_ENTRY_PRE_SCREEN_20261023.json",
    "RESIDUAL_CAUSAL_ENTRY_ALL_59_TRADES_20261023.csv",
    "RESIDUAL_INDEPENDENT_NEW_ENTRY_MODEL_20261023.json",
    "RESIDUAL_INDEPENDENT_NEW_ENTRY_ALL_EVENTS_10BPS_20261023.csv",
    "RESIDUAL_INDEPENDENT_BEAR_SHORT_DESIGN_20261023.json",
    "RESIDUAL_INDEPENDENT_BEAR_SHORT_EVENTS_10BPS_20261023.csv",
    "RESIDUAL_ENTRY_PROBABILITY_TIME_SPLIT_20261023.json",
    "RESIDUAL_ENTRY_PROBABILITY_SELECTED_10BPS_20261023.csv"],
  "riskLimits":["New signal generators are independent standalone research; no 8-logic ownership, admission, shared loss risk or venue matching",
   "Original accepted-trade gate screens condition on a small selected sample; not new candidate economic backtests",
   "Training and holdout were retrospectively examined in prior research, not independent untouched OOS",
   "No production V52 AMZN gate made live by this research; no Production or orders changed"]}
 (OUT/"RESIDUAL_ENTRY_REDIRECTION_DECISION_20261023.json").write_text(
  json.dumps(source,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 doge=screen["costs"]["10"]["DOGEUSDT"]["baseline"]
 avax=screen["costs"]["10"]["AVAXUSDT"]["baseline"]
 ddoge=screen["costs"]["30"]["DOGEUSDT"]["baseline"]
 davax=screen["costs"]["30"]["AVAXUSDT"]["baseline"]
 sh=short["cases"]["BTC6_DOWN_REL24_LE_MINUS3_VOL1P2"]["DOGEUSDT"]
 lines=[
 "# RESIDUAL 入口勝率の根本見直し — 2026-10-23",
 "",
 "**結論：従来DOGE/AVAX LONG入口は勝率・損益が弱い。既存取引の除外、LONG再生成、SHORT方向転換、確率スコアの全てを試したが、十分な取引数を維持して両コストで勝率70%を達成する候補は発見できていない。従来出口だけを変更して採用しない。**",
 "",
 "## 現行RESIDUALの勝率",
 "",
 "|対象|10bpsの勝率|30bpsの勝率|",
 "|---|---:|---:|",
 f'|DOGE LONG|{doge["wins"]}/{doge["n"]}（{f(doge["winRatePct"])}）|{ddoge["wins"]}/{ddoge["n"]}（{f(ddoge["winRatePct"])}）|',
 f'|AVAX LONG|{avax["wins"]}/{avax["n"]}（{f(avax["winRatePct"])}）|{davax["wins"]}/{davax["n"]}（{f(davax["winRatePct"])}）|',
 "",
 "Production設定 config/idleResidualLongPolicy.ts のDOGEはBTC相対24hリターン+3%以上、出来高倍率1.2以上、ATR最低0.7%以上、保有12h、緊急STOP価格-10%/利確+25%。直近のBTC上昇・DOGE上昇トレンドは必須条件ではない。AVAXは出来高最低0.8、他同様。これは入口の遅行・吹き上がり追いかけリスクがある。",
 "",
 "## 25の追加Gate：既存30/29約定を分解",
 "",
 "- DOGE 10bpsでは、直前6h DOGE騰落率>=0は6勝/12件（50.0%）、BTCに対する3h相対強度>=0は7勝/13件（53.8%）。",
 "- DOGE 30bpsでは同条件がそれぞれ4勝/11件（36.4%）、5勝/13件（38.5%）。",
 "- 前半と後半に分割しても安定70%勝率に至らない。Gateは新規シグナルを生成せず既存取引を間引くだけで、ユーザーの取引頻度維持の目標に不利。",
 "",
 "## 20種類の独立LONG入口候補を再生成",
 "",
 "- BTC上昇、DOGE相対強度、出来高、ATR、EMA傾き、1h高値更新、短期押し目からの回復などから、確定M5に基づく候補を1時間ごとに新規作成。",
 "- 12時間保有・価格-10%/+25%緊急STOP/利確の簡易リサーチモデル。DOGEに両コスト・後半期間で70%勝率かつPF>=1.2の候補はなし。",
 "- AVAXで少数の7件・勝率71.4%などの例はあるが、後半評価期間の約定が0件。前半だけ勝率がよくても採用しない。",
 "",
 "## 22種類の独立SHORT入口候補を新規作成",
 "",
 "- BTC6h下落、銘柄6h下落、BTC相対強度悪化、出来高、EMA下落、直近安値更新、戻り売りなどを組み合わせ、BTC弱気時の方向転換を検証。",
 f'- DOGE SHORTの相対24h-3%以下＋出来高1.2以上＋BTC6h下落：10bps {sh["10"]["all"]["trades"]}件 / 勝率{f(sh["10"]["all"]["winRatePct"])} / PF {pf(sh["10"]["all"]["pf"])} / 決済DD {f(sh["10"]["all"]["closedDDPct"])}。30bps勝率{f(sh["30"]["all"]["winRatePct"])} / PF {pf(sh["30"]["all"]["pf"])} / DD {f(sh["30"]["all"]["closedDDPct"])}。',
 "- SHORTを単純に追加すれば勝率70%になるという結論には至らなかった。上記の最良PF候補もDDが大きい。",
 "",
 "## 過去データで学習した18特徴の確率スコア",
 "",
 "- 確定M5のDOGE/AVAX/BTC 1/3/6/12/24h騰落率、相対強度、出来高比、ボラティリティ、レンジ位置を特徴に、固定の正則化ロジスティック回帰を用いた。",
 "- 学習：2025/8〜2025/12初旬、検証：2025/12〜2026/2初旬、後半：2026/2〜2026/8。時間窓境界は12hラベル期間を除外。",
 "- エントリー確率の上位70/80/90/95パーセンタイルを学習データだけから算出し、LONG/SHORT側の高スコア候補を12h固定保有として検証。実際の運用資金・他ロジックとの競合は含まない。",
 ]
 for sym in ("DOGEUSDT","AVAXUSDT"):
  for split in ("validation","later"):
   items=score["results"][sym][split]["cases"]
   best10=max(items.items(),key=lambda kv:(kv[1]["10"]["winRatePct"] or 0))
   best30=max(items.items(),key=lambda kv:(kv[1]["30"]["winRatePct"] or 0))
   lines.append(
    f'- {sym} {split}：10bps最高勝率 {f(best10[1]["10"]["winRatePct"])}（{best10[0]}・{best10[1]["10"]["n"]}件）、'
    f'30bps最高勝率 {f(best30[1]["30"]["winRatePct"])}（{best30[0]}・{best30[1]["30"]["n"]}件）。'
   )
 lines+=["",
 "これらの結果は、特徴量や学習法が変われば改善可能性を否定するものではない。ただし既存データだけから70%達成を主張することはできない。",
 "",
 "## 次に検証すべき入口設計",
 "",
 "1. DOGE_REL_VOLとAVAX_REL_LONGの信号品質を、LONG/SHORT別に真の発火候補（約定済み以外も含む）から再生成する。いまのデータは採択済み30/29件に偏る。",
 "2. ATRや出来高が急増した時の高値掴みを回避するため、直前M5の価格方向だけでなく、出来高クライマックス後の戻り・再上昇を別イベントとして認識。",
 "3. 実際のAster板/約定スプレッド、Open Interest、Funding、現先Basis、BTCレジームなど、OHLCV以外の学習可能特徴を実測で加える。",
 "4. 市場に方向性がない時はエントリーしない研究案と、資金が遊ぶ場合の別建てロジック追加を分離し、総取引数の減少を許容しない8戦略の再配分で検証。",
 "5. 未使用の別期間・Forward Shadowにおいて、勝率>=70%・PF>=1.2・最大DD<=15%・10/30bps・十分な約定件数を確認後だけ統合BTとCodex実装へ。",
 "",
 "## 根拠と制限",
 "",
 "- 研究初期1万円。新規信号の独立モデルは8ロジック統合BTではなく、他ロジック所有権、冷却、共有建玉、証拠金、取引所板、Fundingを再現していない。",
 "- 元V52の抑制11件も完全再生成していない。元LIVEと研究エンジンのSHA一致や約定証拠は未認証。",
 "- 後半評価期間を固定してはいるが、この同一年について過去に探索を行っており、真に未使用のOOSとは呼べない。",
 "- 直近12hの確定M5を使った時点で未確定データを参照しない設計。STOP/TAKEを同一5分足で両方触れた場合、研究は損切り先行で保守的に評価。",
 "",
 "**STATUS：RESEARCH_ONLY_NO_NEW_RESIDUAL_ENTRY_ADOPTED_AND_NO_LIVE_CHANGES**",
 ""]
 (OUT/"RESIDUAL_ENTRY_WINRATE_REDESIGN_REPORT_20261023.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("REPORT_BUILT_LONG",len(long["definitions"]),"SHORT",len(short["rules"]),"SCREEN",len(screen["ruleDefinitions"]),"SCORE_18_FEATURES")
 print("QUALIFIERS_NONE",qualifyLong,qualifyShort,qualifyModel)
if __name__=="__main__":main()
