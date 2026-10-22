#!/usr/bin/env python3
"""V52-only 87 selected trades: explain profit, loss, closed-trade DD, risk.

From pinned 8-logic FET8/4 + HYPE/Idle cumulative portfolio 10/30bps ledgers.
Two DISTINCT equity concepts:
(1) Contribution PnL JPY in the *real modeled shared portfolio*;
(2) Synthetic V52-only compounded return by replaying each original
    trade's total PnL / actual integrated pre-entry wallet equity,
    keeping original accepted gross. NOT a reoptimized standalone allocator.
Exit-only DD cannot capture true MTM DD; show H1 adverse interval touches
as a separate coarse upper-bound sensitivity, not valid STOP fills.
"""
from __future__ import annotations
import argparse,bisect,collections,csv,datetime,hashlib,itertools,json,math,statistics
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
STOCK=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/bt-analysis-formal/formal_extract/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster_stock/klines")
FIVE=("TSLA","NVDA","META","MSFT","AMZN")
HOUR=3600000
INITIAL=10000.0

def read(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def sha(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for c in iter(lambda:f.read(1<<20),b""):h.update(c)
 return h.hexdigest()
def dt(ms):return datetime.datetime.fromtimestamp(int(ms)/1000,datetime.timezone.utc).isoformat()

def comp(group):
 e=INITIAL;high=e;worst=0.;at=None;path=[]
 for x in sorted(group,key=lambda r:(r["exit_ts_ms"],r["entry_ts_ms"])):
  rn=float(x["total_pnl_jpy"])/float(x["entry_equity"])
  assert math.isfinite(rn) and -.5<rn<.5,rn
  e*=1+rn;high=max(high,e);dd=e/high-1
  if dd<worst:worst=dd;at={"exitUtc":dt(x["exit_ts_ms"]),
   "symbol":x["symbol"],"side":x["side"],"candidateId":x["candidate_id"]}
  path.append({"exitUtc":dt(x["exit_ts_ms"]),"equityJpy":e,"ddPct":100*dd})
 return {"syntheticIsolatedStartJpy":INITIAL,
  "syntheticIsolatedEndJpy":e,"syntheticIsolatedReturnPct":100*(e/INITIAL-1),
  "closedTradeOnlyMaxDDPct":100*worst,"closedTradeOnlyTrough":at,
  "closedEquityPath":path}

def summary(group):
 n=len(group)
 pnl=[float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in group]
 winners=[x for x in group if float(x["total_pnl_jpy"])>0]
 losers=[x for x in group if float(x["total_pnl_jpy"])<0]
 pos=sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in winners)
 neg=sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in losers)
 rr=[float(x["total_pnl_jpy"])/float(x["entry_equity"]) for x in group]
 rrplus=sum(r for r in rr if r>0)
 rrneg=sum(r for r in rr if r<0)
 eq=comp(group)
 return {"trades":n,"wins":len(winners),"losses":len(losers),
  "winRatePct":100*len(winners)/n if n else None,
  "positiveContributionJpy":pos,"negativeContributionJpy":neg,
  "netContributionJpy":pos+neg,
  "modelContributionProfitFactor":pos/(-neg) if neg<0 else None,
  "sumPositiveNetWalletReturnPct":100*rrplus,
  "sumNegativeNetWalletReturnPct":100*rrneg,
  "tradeNormalizedProfitFactor":rrplus/(-rrneg) if rrneg<0 else None,
  "averageNetWalletReturnPerTradePct":100*statistics.mean(rr) if rr else None,
  "medianNetWalletReturnPerTradePct":100*statistics.median(rr) if rr else None,
  "worstNetWalletReturnPct":100*min(rr) if rr else None,
  "bestNetWalletReturnPct":100*max(rr) if rr else None,
  "maxConsecutiveLosses":max((len(list(g)) for key,g in itertools.groupby(
    sorted(group,key=lambda r:r["exit_ts_ms"]),lambda x:x["total_pnl_jpy"]<0) if key),default=0),
  **{k:v for k,v in eq.items() if k!="closedEquityPath"},
 }

def find_ledger(root,expected):
 candidates=[x for x in root.rglob("portfolio-trades.jsonl") if sha(x)==expected]
 assert candidates,("LEDGER_SHA_NOT_FOUND",expected)
 return sorted(candidates,key=str)[0]

def adverse_aster(series,trade):
 sym=trade["symbol"].replace("USDT","")
 bars,ts=series[sym]
 start=int(trade["entry_ts_ms"]);end=int(trade["exit_ts_ms"])
 i=max(0,bisect.bisect_right(ts,start)-1)
 j=bisect.bisect_left(ts,end)
 overlap=[b for b in bars[i:j] if b["event_time_ms"]+HOUR>start and b["event_time_ms"]<end]
 assert overlap
 entry=float(trade["entry_price"])
 side=str(trade["side"])
 max_price=max(float(b["high"]) for b in overlap)
 min_price=min(float(b["low"]) for b in overlap)
 adverse=100*((max_price/entry-1) if side=="SHORT" else (1-min_price/entry))
 favorable=100*((1-min_price/entry) if side=="SHORT" else (max_price/entry-1))
 return {"adverseOverlappingH1Pct":max(0,adverse),
         "favorableOverlappingH1Pct":max(0,favorable),
         "overlappingH1Bars":len(overlap),
         "h1BarOverlapCanIncludePreEntryOrPostExitMinutes":True}

def h1_mark_proxy_dd(trades,market):
 """Research-only H1 completed CLOSE MTM: price-only and reserved exit fees.

 Uses original integrated accepted sizing; no venue FX intratrade,
 bid/ask, current-bar quote, or overnight spread. Never call canonical DD.
 """
 hh={sym:([b["event_time_ms"]+HOUR for b in market[sym][0]],
           [float(b["close"]) for b in market[sym][0]]) for sym in FIVE}
 eq=INITIAL;peak=eq;worst=0.;trough=None;npoints=0
 for x in sorted(trades,key=lambda x:x["entry_ts_ms"]):
  cap=eq
  unit=float(x["entry_equity"])
  fees=float(x["entry_fee"])+float(x["exit_fee"])
  entryratio=-fees/unit
  atentry=cap*(1+entryratio)
  dd=atentry/peak-1
  if dd<worst:worst=dd;trough={"candidateId":x["candidate_id"],"point":"two-fee-reserve"}
  sign=1 if x["side"]=="LONG" else -1
  timestamps,prices=hh[x["symbol"].replace("USDT","")]
  begin=bisect.bisect_right(timestamps,int(x["entry_ts_ms"]))
  end=bisect.bisect_left(timestamps,int(x["exit_ts_ms"]))
  for idx in range(begin,end):
   price=prices[idx]
   estexit=float(x["exit_fee"])*price/float(x["exit_price"])
   unitpnl=sign*float(x["quantity"])*(price-float(x["entry_price"]))-float(x["entry_fee"])-estexit
   pos=cap*(1+unitpnl/unit)
   if pos<=0:raise RuntimeError("V52_POSITIVE_H1_MARK_EQUITY_VIOLATION")
   peak=max(peak,pos)
   dd=pos/peak-1
   if dd<worst:worst=dd;trough={"candidateId":x["candidate_id"],"point":"completed-h1-close","utc":dt(timestamps[idx])}
   npoints+=1
  eq=cap*(1+float(x["total_pnl_jpy"])/unit)
  peak=max(peak,eq)
  dd=eq/peak-1
  if dd<worst:worst=dd;trough={"candidateId":x["candidate_id"],"point":"modeled-exit","utc":dt(x["exit_ts_ms"])}
 return {"approxPriceOnlyH1MTMDDPct":100*worst,
         "approxPriceOnlyH1MTMTrough":trough,"h1CompletedMarks":npoints,
         "note":"Price-only H1 close plus conservative estimated exit-fee reserve. Not signed venue MTM or market microstructure-certified."}

def global_dd_provenance(ledger,fullrows):
 mtm_path=Path(ledger).with_name("task9-mtm.jsonl")
 assert mtm_path.is_file()
 lines=[json.loads(x) for x in mtm_path.read_text(encoding="utf-8").splitlines() if x]
 worst=min(lines,key=lambda row:float(row["drawdown_pct"]))
 ts=int(worst["timestamp_ms"])
 live=[row for row in fullrows if int(row["entry_ts_ms"])<=ts<int(row["exit_ts_ms"])]
 return {"timestampUtc":dt(ts),"ddPct":float(worst["drawdown_pct"]),
    "equityJpy":worst["equity_jpy"],"peakEquityJpy":worst["peak_equity_jpy"],
    "v52Positions":sum(x["strategy_id"]=="V52" for x in live),
    "otherOpenStrategySides":dict(collections.Counter(x["strategy_id"]+" "+x["side"] for x in live)),
    "mtmPricedHours":len(lines)}

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--output",type=Path,required=True)
 args=parser.parse_args()
 args.output.mkdir(parents=True,exist_ok=True)
 manifest=read(ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json")
 assert manifest["status"]=="RESEARCH_ONLY_V52_NATIVE_STOCK_TAPE_FIXED_SUPPRESSED_11"
 prev=read(REPO/"docs/research/results/v52-after-fet-20261022/V52_HOURLY_PARITY_20261022.json")
 assert prev["cost"]["10"]["paired"]==87 and prev["cost"]["10"]["reasonMatches"]==86
 provenance=read(REPO/"docs/research/results/v52-after-fet-20261022/V52_YAHOO_ASTER_H1_SOURCE_PROVENANCE_20261022.json")
 market={}
 for sym in FIVE:
  p=STOCK/f"{sym}USDT.jsonl"
  assert sha(p)==provenance["asterOfficialNormalizedSha256"][sym]
  bars=[json.loads(x) for x in p.read_text("utf-8").splitlines() if x]
  assert len(bars)==8784
  market[sym]=(bars,[int(x["event_time_ms"]) for x in bars])
 data={"schema":"v52-only-selected-full8-trades-profit-loss-closed-dd-v1",
  "status":"MODEL_BACKTEST_RESEARCH_ONLY",
  "period":"2025-08-10..2026-08-10",
  "baseline":"HYPE_LONG+IDLE_TAO_RENDER+FET_LONG_8P_4PP_USER_ADOPTED_RESEARCH_COMPOUND",
  "costsBps":[10,30],"startingCapitalJpy":INITIAL,
  "ddDefinition":"Synthetic isolated replays original trade ROI PnL/actual integrated wallet pre-entry equity, compounded and ordered by exit; realized closed-only, no MTM, not independent full-gross portfolio.",
  "pnlDefinition":"JPY gains/losses use actual modeled capital allocation from source integrated wallet, not V52-only capital.",
  "asterH1Risk":"OHLC bars overlap entry/exit at hh:30 and include pre-entry/post-exit half-hours. Possible STOP-touch counts are upper bounds, NOT exchange fills.",
  "previousStockResearchV52NativeFixedSuppressedCandidates":11,
  "noProductionChanges":True,"cost":{}}
 allcsv=[];selected_market=[]
 for cost in ("10","30"):
  run=manifest["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"][cost]
  path=find_ledger(ROOT/"f8v52native/engine",run["ledgerSha256"])
  rows=[json.loads(x) for x in path.read_text("utf-8").splitlines() if x]
  group=sorted((x for x in rows if x["strategy_id"]=="V52"),
        key=lambda a:(a["exit_ts_ms"],a["entry_ts_ms"],a["candidate_id"]))
  assert len(group)==87 and all(x["symbol"].replace("USDT","") in FIVE for x in group)
  assert sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in group)-run["v52ModeledPnlJpy"]<1e-5
  scalars={name:{**summary([x for x in group if f(x)]),
      **h1_mark_proxy_dd([x for x in group if f(x)],market)} for name,f in {
   "ALL":lambda x:True,"LONG":lambda x:x["side"]=="LONG",
   "SHORT":lambda x:x["side"]=="SHORT"}.items()}
  bysymbol={sym:summary([x for x in group if x["symbol"]==sym+"USDT"]) for sym in FIVE}
  bysymbolside={sym+"|"+side:summary([x for x in group if x["symbol"]==sym+"USDT" and x["side"]==side])
                for sym in FIVE for side in ("LONG","SHORT") if any(x["symbol"]==sym+"USDT" and x["side"]==side for x in group)}
  byexit={side+"|"+reason:summary([x for x in group if x["side"]==side and x["exit_reason_actual"]==reason])
          for side in ("LONG","SHORT") for reason in ("BASIS_CONVERGED","BASIS_STOP","TIME_OR_SESSION_FLAT")
          if any(x["side"]==side and x["exit_reason_actual"]==reason for x in group)}
  monthly=collections.defaultdict(list)
  for x in group:monthly[dt(x["exit_ts_ms"])[:7]].append(x)
  bymonth={month:summary(items) for month,items in sorted(monthly.items())}
  losses=sorted((x for x in group if x["total_pnl_jpy"]<0),key=lambda x:x["modeled_realized_pnl_jpy_at_exit_fx"])
  biggest=[{"symbol":x["symbol"],"side":x["side"],"candidateId":x["candidate_id"],
            "utc":dt(x["exit_ts_ms"]),"exit":x["exit_reason_actual"],
            "modeledLossJpy":float(x["modeled_realized_pnl_jpy_at_exit_fx"]),
            "netWalletPct":100*float(x["total_pnl_jpy"])/float(x["entry_equity"]),
            "priceReturnPct":(1 if x["side"]=="LONG" else -1)*100*(float(x["exit_price"])/float(x["entry_price"])-1),
            "acceptedGross":float(x["accepted_gross"])}
           for x in losses[:12]]
  adverse_counts={str(c):0 for c in (0.5,1,1.5,2,3,5)}
  risk_by_side=collections.defaultdict(list)
  for x in group:
   adv=adverse_aster(market,x)
   risk_by_side[x["side"]].append(adv["adverseOverlappingH1Pct"])
   if x["side"]=="SHORT":
    for c in (0.5,1,1.5,2,3,5):
     if adv["adverseOverlappingH1Pct"]>=c:adverse_counts[str(c)]+=1
   if cost=="10":selected_market.append(adv)
   allcsv.append({
    "cost_bps":cost,"candidate_id":x["candidate_id"],"symbol":x["symbol"],"side":x["side"],
    "entry_utc":dt(x["entry_ts_ms"]),"exit_utc":dt(x["exit_ts_ms"]),
    "exit_reason":x["exit_reason_actual"],
    "holding_hours":(int(x["exit_ts_ms"])-int(x["entry_ts_ms"]))/HOUR,
    "accepted_gross":x["accepted_gross"],"entry_price":x["entry_price"],"exit_price":x["exit_price"],
    "price_return_pct":(1 if x["side"]=="LONG" else -1)*100*(float(x["exit_price"])/float(x["entry_price"])-1),
    "wallet_return_pct":100*float(x["total_pnl_jpy"])/float(x["entry_equity"]),
    "shared_portfolio_realized_pnl_jpy":x["modeled_realized_pnl_jpy_at_exit_fx"],
    "possible_h1_adverse_pct":adv["adverseOverlappingH1Pct"],
    "h1_adverse_interval_touch_not_verified_fill":True,
   })
  data["cost"][cost]={
    "sourceLedgerSha256":run["ledgerSha256"],
    "sourcePortfolioEquityJpy":run["equityJpy"],
    "sourcePortfolioMTMDdPct":run["maxMtmDdPct"],
    "sourcePortfolioTrades":run["closedTrades"],
    "sourcePortfolioWorstDDContext":global_dd_provenance(path,rows),
    "overall":scalars["ALL"],"side":{k:v for k,v in scalars.items() if k!="ALL"},
    "bySymbol":bysymbol,"bySymbolSide":bysymbolside,"byExitSide":byexit,
    "byExitMonth":bymonth,"worstTradesByPortfolioContribution":biggest,
    "potentialShortOHLCStopTouchesAtOrAbovePct":adverse_counts,
    "maxShortAdverseOverlappingH1Pct":max(risk_by_side["SHORT"]),
    "maxLongAdverseOverlappingH1Pct":max(risk_by_side["LONG"]),
    "isolatedClosedEquityPath":comp(group)["closedEquityPath"],
    "sourceIsLiveFillCertified":False,
   }
  print("V52_EXTRACTED",cost,"n",scalars["ALL"]["trades"],"wallet_end",round(scalars["ALL"]["syntheticIsolatedEndJpy"]),
     "realized_DD_pct",round(scalars["ALL"]["closedTradeOnlyMaxDDPct"],4),
     "gross_win_jpy",round(scalars["ALL"]["positiveContributionJpy"]),
     "gross_loss_jpy",round(scalars["ALL"]["negativeContributionJpy"]),
     "h1_short_max_ghost_adverse",round(max(risk_by_side["SHORT"]),4),flush=True)
 assert len(allcsv)==174
 (args.output/"V52_ONLY_TRADE_DETAIL_20261022.csv").write_text("",encoding="utf-8")
 with (args.output/"V52_ONLY_TRADE_DETAIL_20261022.csv").open("w",encoding="utf-8",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=list(allcsv[0]),lineterminator="\n")
  writer.writeheader();writer.writerows(allcsv)
 (args.output/"V52_ONLY_PNL_DD_ANALYSIS_20261022.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 normal=data["cost"]["10"];stress=data["cost"]["30"]
 s=lambda x:f"{x:,.0f}"
 v=lambda x:f"{x:.2f}%"
 lines=[
  "# V52だけのトレード抽出：損益・DD・原始損失パターン",
  "",
  "## 分析条件と厳密な区別",
  "",
  "- 期間: 2025-08-10〜2026-08-10。最新版HYPE・Idle RENDER/TAO・FET8/4までを研究上引き継いだ8ロジック統合BTからV52だけを抽出。",
  "- モデル約定: 10bps/30bps（実LIVE建玉・約定ではない）。株式連動銘柄5つ。全取引リストCSVも同フォルダに添付。",
  "- 共有口座への損益寄与（円）と、「元の採用Gross・資金競合を維持した約定収益率だけをV52単独1万円に複利再生した仮想口座」は全く異なる。",
  "- V52専用最大DDは**決済ベース**。含み損を含む正規MTM DDに必要な完全な同時venue-reference-L2注文証跡なし。",
  "- 参考としてAsterの**確定H1終値**と元建玉サイズ、入口fee+出口fee予備費から近似MTM DDを別算出。ギャップ・約定気配・参照価格同期を含む正式MTM DDではない。",
  "- H1の高値/安値での損切り到達可能性を比較したが、NY11:30等の入口/出口とAster時間足hh:00開始がずれ、各H1に建玉前後30分が混じる。実STOP約定数ではない。",
  "",
  "## V52のみ（年間87件）の損益分解",
  "",
  "| 指標 | 10bps | 30bps |",
  "|---|---:|---:|",
  f'| 勝敗 | {normal["overall"]["wins"]}勝{normal["overall"]["losses"]}敗 | {stress["overall"]["wins"]}勝{stress["overall"]["losses"]}敗 |',
  f'| 勝率 | {v(normal["overall"]["winRatePct"])} | {v(stress["overall"]["winRatePct"])} |',
  f'| 共有口座へのプラス寄与 | {s(normal["overall"]["positiveContributionJpy"])}円 | {s(stress["overall"]["positiveContributionJpy"])}円 |',
  f'| 共有口座へのマイナス寄与 | {s(normal["overall"]["negativeContributionJpy"])}円 | {s(stress["overall"]["negativeContributionJpy"])}円 |',
  f'| 共有口座への正味寄与 | {s(normal["overall"]["netContributionJpy"])}円 | {s(stress["overall"]["netContributionJpy"])}円 |',
  f'| V52-only仮想複利 最終資産 | {s(normal["overall"]["syntheticIsolatedEndJpy"])}円 | {s(stress["overall"]["syntheticIsolatedEndJpy"])}円 |',
  f'| V52-only仮想複利 決済DD | {v(normal["overall"]["closedTradeOnlyMaxDDPct"])} | {v(stress["overall"]["closedTradeOnlyMaxDDPct"])} |',
  f'| V52-only仮想複利 H1終値ベースの近似MTM DD | {v(normal["overall"]["approxPriceOnlyH1MTMDDPct"])} | {v(stress["overall"]["approxPriceOnlyH1MTMDDPct"])} |',
  f'| 8ロジック統合MTM DD（比較用） | {v(normal["sourcePortfolioMTMDdPct"])} | {v(stress["sourcePortfolioMTMDdPct"])} |',
  "",
  "## 統合最大DDが出た時点のV52寄与",
  "",
  f'- 10bps: {normal["sourcePortfolioWorstDDContext"]["timestampUtc"]}、V52建玉 {normal["sourcePortfolioWorstDDContext"]["v52Positions"]}件、他保有 {normal["sourcePortfolioWorstDDContext"]["otherOpenStrategySides"]}。',
  f'- 30bps: {stress["sourcePortfolioWorstDDContext"]["timestampUtc"]}、V52建玉 {stress["sourcePortfolioWorstDDContext"]["v52Positions"]}件、他保有 {stress["sourcePortfolioWorstDDContext"]["otherOpenStrategySides"]}。',
  "- 最大DD時点にV52の建玉がない場合、V52直接の損切り強化ではその時点の含み損を改善できない。10bpsではV52初回エントリーよりも前の最大DD。",
  "",
  "## LONG と SHORT",
  "",
  "| | LONG 10bps | SHORT 10bps | LONG 30bps | SHORT 30bps |",
  "|---|---:|---:|---:|---:|",
 ]
 for k,fmt in (("trades",s),("wins",s),("losses",s),("winRatePct",v),("positiveContributionJpy",s),("negativeContributionJpy",s),("netContributionJpy",s),("syntheticIsolatedEndJpy",s),("closedTradeOnlyMaxDDPct",v),("approxPriceOnlyH1MTMDDPct",v),("worstNetWalletReturnPct",v)):
  vals=[normal["side"]["LONG"][k],normal["side"]["SHORT"][k],
        stress["side"]["LONG"][k],stress["side"]["SHORT"][k]]
  lines.append("| "+k+" | "+" | ".join(fmt(x) for x in vals)+" |")
 lines+=["","## 銘柄別・損益（10bps）",
  "",
  "| 銘柄 | 取引 | 勝ち | 負け | プラス寄与 | マイナス寄与 | 純寄与 |",
  "|---|---:|---:|---:|---:|---:|---:|"]
 for sym in FIVE:
  v0=normal["bySymbol"][sym]
  lines.append(f'| {sym} | {v0["trades"]} | {v0["wins"]} | {v0["losses"]} | {s(v0["positiveContributionJpy"])} | {s(v0["negativeContributionJpy"])} | {s(v0["netContributionJpy"])} |')
 lines+=["","## LONG/SHORT × 出口理由（10bps）","","| 方向・既存出口 | 取引 | 勝ち | 負け | 損失寄与 | 純寄与 |","|---|---:|---:|---:|---:|---:|"]
 for name,r in normal["byExitSide"].items():
  lines.append(f'| {name} | {r["trades"]} | {r["wins"]} | {r["losses"]} | {s(r["negativeContributionJpy"])}円 | {s(r["netContributionJpy"])}円 |')
 lines+=["","## 重要な損失と危険な勘違い","",
  "- 最大のSHORT損失はTSLA SHORTのBasis収束決済。Basis STOPではなく、価格が逆行したままBasis収束した点が重要。",
  "- Basisは(Aster mid/Yahoo reference−1)の乖離であって、SHORT価格損益そのものではない。Basis収束してもSHORTの価格損失が発生し得る。",
  "- スロットgrossが2.0なら、SHORT価格−0.9%が元の統合口座におよそ−1.8%（取引コスト別）を与える。価格STOPの−5%は**価格ベース**であり総口座損失−5%とは異なる。",
  "",
  "## 最悪トレード（10bps、共有口座の円損失順）","",
  "|銘柄|方向|出口|決済損益|元口座ROI|モデル価格ROI|",
  "|---|---|---|---:|---:|---:|"]
 for z in normal["worstTradesByPortfolioContribution"][:10]:
  lines.append(f'| {z["symbol"]} | {z["side"]} | {z["exit"]} | {s(z["modeledLossJpy"])}円 | {v(z["netWalletPct"])} | {v(z["priceReturnPct"])} |')
 lines+=["","## −5% STOPと代替候補のステータス","",
  "- −5% SHORTハードSTOP: 52件の保存されたAster H1高値には到達痕跡なし。既存BTに追加しても約定変更はない可能性が高く、極端な価格急騰時の保険候補として維持。実注文保護の再起動復元・reduce-only・部分約定は未検証。",
  "- −2%: 保存H1高値で到達0件。−1.5%: 1件、−1%: 2件。最初・最後の30分についてH1高値の時刻順は不明なので、これだけで『早期STOPした場合の改善額』は算定できない。",
  "- 入口Basisが小さいSHORTだけのロット抑制（例75/80bps未満1.0xや1.5x）は、エントリー数を維持して大きな価格逆行による口座損失を減らす候補。別スクリプトで8ロジック動的資金再配分BT実施。",
  "- 基本のBasis Stop 1.75倍、Basis収束20bps、時間決済は改変せず。PENGUとLONGの確立済み出口も変更しない。",
  "",
  "## 実行注意点",
  "",
  "- 2025-08〜2026-08の同一期間で候補閾値を選ぶと過学習する可能性がある。別年OOS、ネイティブの抑制11候補再選択が残る。",
  "- 独立したTypeScriptのProduction経済Parity、現在のVPS release、実取引所リスク・保護STOP認証は未確認。すべて研究のみ。",
  "",
 ]
 (args.output/"V52_ONLY_PNL_DD_ANALYSIS_20261022.md").write_text("\n".join(lines),encoding="utf-8",newline="\n")
 print("V52_DATA_FILES",args.output,flush=True)
if __name__=="__main__":main()
