#!/usr/bin/env python3
"""V52 LONG/SHORT: cumulative 8-logic BT source audit, no changed exit trades.

Do not use Aster/tokenized-stock 5m prices as historical Yahoo reference
series. An entry-only Yahoo quote cannot reconstruct hourly dynamic Basis.
"""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
PRIOR=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/idle-exit-deep-research-20261016/bt120_5m_20261017")
M5=300000
TICKERS=("TSLAUSDT","NVDAUSDT","METAUSDT","MSFTUSDT","AMZNUSDT")

def readjson(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def utc(ms):return datetime.datetime.fromtimestamp(int(ms)/1000,datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for chunk in iter(lambda:f.read(1<<20),b""):h.update(chunk)
 return h.hexdigest()
def jsonl(p):
 with Path(p).open(encoding="utf-8") as f:return [json.loads(line) for line in f if line.strip()]

def token_coverage(trade,bars,times):
 """Only test venue/token M5 coverage. This NEVER proves Yahoo Basis."""
 entry=int(trade["entry_ts_ms"]);exit_=int(trade["exit_ts_ms"])
 first=bisect.bisect_left(times,entry);last=bisect.bisect_left(times,exit_)
 if first>=len(times) or last<=first or times[first]>entry+M5:
  return {"hasEntry":False,"fullWindow":False,"entryErrorBps":None,"validBasis":False}
 ep=float(trade["entry_price"]);op=float(bars[first][1])
 err=10000*abs(op/ep-1) if ep>0 else None
 complete=(times[last-1]>=exit_-M5 and times[first]<=entry+M5
  and all(times[i]-times[i-1]==M5 for i in range(first+1,last)))
 return {"hasEntry":True,"fullWindow":bool(complete),"entryErrorBps":err,"validBasis":False}

def side_stats(trades):
 d=collections.defaultdict(list)
 for t in trades:
  s=str(t["side"]);reason=str(t.get("exit_reason_actual") or t.get("exit_reason"))
  d[(s,"ALL")].append(t);d[(s,reason)].append(t)
 return {f"{s}|{reason}":{
    "trades":len(items),
    "wins":sum(float(t["modeled_realized_pnl_jpy_at_exit_fx"])>0 for t in items),
    "losses":sum(float(t["modeled_realized_pnl_jpy_at_exit_fx"])<0 for t in items),
    "pnlJpy":sum(float(t["modeled_realized_pnl_jpy_at_exit_fx"]) for t in items),
    "negativePnlJpy":sum(min(0,float(t["modeled_realized_pnl_jpy_at_exit_fx"])) for t in items),
 } for (s,reason),items in sorted(d.items())}

def read_accepted_v52():
 path=REPO/"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/candidate-decisions.jsonl"
 data=[x for x in jsonl(path) if x.get("strategy_id")=="V52" and x.get("decision")=="ACCEPTED_MODELED_ENTRY"]
 both=[x for x in data if isinstance(x.get("v52_yahoo_entry_reference_usd"),(int,float))
       and isinstance(x.get("v52_entry_basis_bps"),(int,float))]
 assert both
 errors=[abs(10000*(float(t["candidate_entry_price_usd"])/float(t["v52_yahoo_entry_reference_usd"])-1)
                  -float(t["v52_entry_basis_bps"])) for t in both]
 return {"acceptedRows":len(data),"withYahooEntryAndBasis":len(both),
         "maxEntryBasisArithmeticDisagreementBps":max(errors),
         "hasContinuousReferenceSeries":False,
         "hasSynchronizedCheckpointBasisSeries":False}

def find_ledger(ref):
 root=ROOT/"f8fet"/"engine"
 paths=[p for p in root.rglob("portfolio-trades.jsonl") if digest(p)==ref]
 if not paths:raise RuntimeError("EXACT_FET84_LEDGER_NOT_FOUND")
 # Re-selection sometimes saves multiple byte-identical converged ledgers.
 # The pinned SHA256 is canonical; duplicate identical copies are harmless.
 return sorted(paths,key=lambda x:str(x))[0]

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",required=True,type=Path)
 args=parser.parse_args()
 manifest=readjson(ROOT/"f8fet/FET_NEXT_FULL8_RESEARCH_20261022.json")
 formal=readjson(REPO/"config/research/hype-render-tao-cumulative-adopted-20261022.json")
 native=readjson(REPO/"config/v52V50Runtime.json")
 assert formal["sourceResearch"]["selectedIntegratedCaseId"]=="TAO_RET1H_PLUS_RENDER_SKIP_AND_PROFIT"
 assert native["basisStopMultiple"]==1.75 and native["convergenceBps"]==20
 sourceinfo=readjson(PRIOR/"bt120_5m_price_quality.json")
 spec=importlib.util.spec_from_file_location("v52_legacy_source_scan",HERE/"run-idle-five-entry-full8-after-hype-20261022.py")
 assert spec and spec.loader
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 source,_=m.core.task8.legacy.bootstrap()
 prices={sym:source.getdata(sym) for sym in TICKERS}
 cases=manifest["cases"]["FET_TRAIL_8P_GIVEBACK_4P"]["costs"]
 result={
  "schema":"v52-source-basis-audit-after-fet84-v1",
  "status":"BLOCKED_YEARLY_V52_BASIS_REPLAY_NO_SYNCHRONIZED_REFERENCE_AND_VENUE_HISTORY",
  "basisEntryQuoteEvidence":read_accepted_v52(),
  "existingExitContract":native,
  "priorStudyHadIncompleteToken5m":True,
  "priceHistory":{sym:{
    "firstUtc":utc(times[0]) if times else None,
    "lastUtc":utc(times[-1]+M5) if times else None,
    "nBars":len(times),"20261017Study":sourceinfo.get(sym,{})
   } for sym,(bars,times) in prices.items()},
  "scenarios":{},
  "candidatesNotYetBacktested":[
   "V52_SHORT hourly Basis profit reversal after verified favorable convergence",
   "V52_LONG hourly Basis profit reversal after verified favorable convergence",
   "V52_SHORT and LONG time/session exit decomposition with a true checkpoint series"
  ],
  "prohibitedShortcut":"DO_NOT_USE_TOKENIZED_STOCK_M5_AS_YAHOO_REFERENCE_OR_INFER_BASIS_FROM_ENTRY_ONLY",
  "notChanged":["Production","VPS","LIVE","Runner","Orders","Positions","HP","BasisStop1.75"]
 }
 for cost in ("10","30"):
  scenario=cases[cost]
  assert scenario["accounting"]=="PASS"
  rows=[r for r in jsonl(find_ledger(scenario["sourceLedgerSha256"])) if r["strategy_id"]=="V52"]
  assert len(rows)==87 and all(r["symbol"] in TICKERS for r in rows)
  cover={str(r["position_id"]):token_coverage(r,*prices[r["symbol"]]) for r in rows}
  status={
   "total":len(rows),"withTokenEntryM5":sum(x["hasEntry"] for x in cover.values()),
   "withFullContiguousToken5m":sum(x["fullWindow"] for x in cover.values()),
   "entryErrorAbove25bps":sum(x["entryErrorBps"] is not None and x["entryErrorBps"]>25 for x in cover.values()),
   "entryErrorAbove100bps":sum(x["entryErrorBps"] is not None and x["entryErrorBps"]>100 for x in cover.values()),
   "withCompleteMatchedYahooAndVenueBasisTimeSeries":0,
   "causalDynamicBasisExitBTEligible":0,
  }
  worst=sorted(rows,key=lambda r:float(r["modeled_realized_pnl_jpy_at_exit_fx"]))[:15]
  result["scenarios"][cost]={
   "formalIntegratedEquityJpy":scenario["portfolioFinalEquityJpy"],
   "formalIntegratedMaxMtmDdPct":scenario["maxMtmDdPct"],
   "ledgerSha256":scenario["sourceLedgerSha256"],
   "totalTrades":len(rows),"sideReasons":side_stats(rows),"tokenCoverage":status,
   "entryByMonth":dict(collections.Counter(utc(r["entry_ts_ms"])[:7] for r in rows)),
   "worstLosses":[{
      "symbol":r["symbol"],"side":r["side"],"candidateId":r["candidate_id"],
      "entryUtc":utc(r["entry_ts_ms"]),"reason":r["exit_reason_actual"],
      "pnlJpy":r["modeled_realized_pnl_jpy_at_exit_fx"]
     } for r in worst],
  }
  print("V52_COST",cost,"EQUITY",round(scenario["portfolioFinalEquityJpy"]),
        "DD",round(scenario["maxMtmDdPct"],6),"COVERAGE",status,flush=True)
  print("V52_REASONS",cost,[(k,v["trades"],v["wins"],v["losses"],round(v["pnlJpy"])) for k,v in result["scenarios"][cost]["sideReasons"].items()],flush=True)
 output=args.output
 output.mkdir(parents=True,exist_ok=True)
 (output/"V52_BASIS_AUDIT_20261022.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 r=result["scenarios"]["10"]
 s=result["scenarios"]["30"]
 lines=[
  "# V52 LONG/SHORT 出口研究：FETまでの累積条件からのデータ・因果性監査",
  "",
  "状態: "+result["status"],
  "",
  "## 累積BT基準（HYPE LONG + Idle TAO/RENDER + FET LONG 8% arm/4pp giveback）",
  "",
  "| 指標 | 10bps | 30bps |","|---|---:|---:|",
  f'| 最終資産 | {r["formalIntegratedEquityJpy"]:,.0f}円 | {s["formalIntegratedEquityJpy"]:,.0f}円 |',
  f'| 最大MTM DD | {r["formalIntegratedMaxMtmDdPct"]:.4f}% | {s["formalIntegratedMaxMtmDdPct"]:.4f}% |',
  "| V52取引数 | 87 | 87 |","","## V52 LONG/SHORT別結果（10bps）","",
  "| 方向・出口 | 件数 | 勝ち | 負け | 損益 |","|---|---:|---:|---:|---:|"]
 for label,v in r["sideReasons"].items():
  lines.append(f'| {label} | {v["trades"]} | {v["wins"]} | {v["losses"]} | {v["pnlJpy"]:,.0f}円 |')
 cv=r["tokenCoverage"];e=result["basisEntryQuoteEvidence"]
 lines.extend(["","## 因果的バックテストが未成立の理由","",
  f'- 過去の原始候補台帳にYahoo入口参照価格とBasisが揃った候補 {e["withYahooEntryAndBasis"]}/{e["acceptedRows"]}件。ただし、保有中の参照価格履歴はない。',
  f'- V52建玉87件に対してトークン化銘柄の5分足入口を見つけられたのは {cv["withTokenEntryM5"]}件。期間全体を連続して覆うのは {cv["withFullContiguousToken5m"]}件。',
  f'- トークン入口価格とモデル価格の差が25bpsを超えた件数 {cv["entryErrorAbove25bps"]}件。旧研究も公開Binance Vision USD-M 5分足の未整合・欠損を認めている。',
  "- 何より、トークン化株価の5分足はYahoo株価のReference系列ではない。現在の動的Basis StopはAster mid / Reference priceから計算する必要がある。",
  "- 入口Yahoo値だけから利益確定・初期逆行時点のBasisや約定を再現することはできない。現存する署名済み実取引注文の証拠とも異なる。",
  "- LIVEのreferenceは外部provider必須。データの接続仕様をYahooと混同しない。",
  "",
  "## 最悪損失候補（10bps）","",
  "| 時刻(UTC) | 銘柄 | 方向 | 理由 | PnL |","|---|---|---|---|---:|"])
 for v in r["worstLosses"]:
  lines.append(f'| {v["entryUtc"][:16]} | {v["symbol"]} | {v["side"]} | {v["reason"]} | {v["pnlJpy"]:,.0f}円 |')
 lines.extend(["","## 次に試す候補（収益値は未認証）","",
  "- SHORT: 既存Basis収束と1.75×STOPを維持したまま、Basisが有利に動いた後、次の確定チェックポイントで逆転する場合の利益保護を評価。",
  "- LONG: LONGの時間決済負けとBasis収束後の再拡大を別台帳で分析。SHORT条件の一括流用禁止。",
  "- 時間出口: NY時間3h/15:30のまま、有利なBasis推移時の早期決済が資金配分に与える効果を確認。",
  "- 必須データ: 期間全体の同期したvenue midとYahooまたは正式reference価格・更新時刻、1hチェックポイント、fill価格、各系列の起源とSHA256。過去研究で確認された固定Entry-reference STOPのDD改善なし・利益減を繰り返さない。",
  "- データ取得後、5分足/チェックポイント因果再生、正規の8ロジック動的再選択、10/30bps、未使用期間OOS、実venue STOPを独立検証する。",
  "",
  "## 結論","",
  "**現時点でV52の新しい出口を正式採用しない。旧ロジック・LIVEに変更なし。** 正しい価格とBasis時系列がないため改善利益やDDの数値を捏造しない。",
 ])
 (output/"V52_BASIS_AUDIT_20261022.md").write_text("\n".join(lines)+"\n",encoding="utf-8",newline="\n")
 print("V52_AUDIT_FILES",output,flush=True)
if __name__=="__main__":main()
