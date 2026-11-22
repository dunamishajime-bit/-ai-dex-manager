#!/usr/bin/env python3
"""P37 audit of PRISM VII P36; research only, no live writes.
No model training or data-snooping-based parameter promotion.
"""
from __future__ import annotations
import json, gzip, hashlib, math, statistics
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
R = ROOT / "results"
P36 = R / "PRISM7_P36_FIXED075_NATIVE_MFE_PROFIT_LOCK_53_SCENARIOS_20261122.json"
TRADES = R / "PRISM7_P36_FIXED075_SELECTED_NATIVE_POSITION_53_SCENARIOS_20261122.jsonl"
ALL120 = R / "PRISM7_P36_FIXED075_ALL120_INTENTS_53_SCENARIOS_20261122.jsonl.gz"
FEATURE = R / "PRISM7_P34_SELLER_ALL120_CAUSAL_PREENTRY_FEATURES_20261122.json"
P35 = R / "PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
OUT = R / "PRISM7_P37_P36_INDEPENDENCE_AND_LOSS_ATTRIBUTION_20261122.json"
MD = R / "PRISM7_P37_P36_INDEPENDENCE_AND_LOSS_ATTRIBUTION_20261122.md"

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def pct(x): return round(float(x), 6)
def wilson(k, n, z=1.959963984540054):
    if not n: return [None, None]
    p=k/n; den=1+z*z/n
    cen=(p+z*z/(2*n))/den
    delta=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return [round(100*(cen-delta), 3), round(100*(cen+delta), 3)]

def main():
    d=json.loads(P36.read_text(encoding="utf-8"))
    a=d["allFiftyThreeScenarioEconomics"]
    assert len(a)==53 and len({(x["model"],x["executionCase"]) for x in a})==53
    assert d["sourceNativeShortPinnedSHA"]=="1657e173d250ad58f53e62f7bb0a3428fb405496"
    assert d["grossFixed"]==.75 and d["roundtripFeeBps"]==30
    assert d["originalS4SourceIntents"]==120
    rows=[json.loads(s) for s in TRADES.read_text(encoding="utf-8").splitlines() if s.strip()]
    by=defaultdict(list)
    for row in rows: by[(row["model"],row["case"])].append(row)
    assert len(by)==53 and sum(len(v) for v in by.values())==len(rows)
    base=by[("NATIVE_ONLY","NATIVE_ONLY")]
    assert len(base)==20 and len({v["id"] for v in base})==20
    closed=[x for x in base if x.get("realizedNetPctOnEntryEquityIfClosed") is not None]
    censored=[x for x in base if x.get("realizedNetPctOnEntryEquityIfClosed") is None]
    wins=[x for x in closed if x["realizedNetPctOnEntryEquityIfClosed"]>0]
    losses=[x for x in closed if x["realizedNetPctOnEntryEquityIfClosed"]<=0]
    assert len(closed)==19 and len(wins)==14 and len(losses)==5 and len(censored)==1
    original53=json.loads(P35.read_text(encoding="utf-8"))
    assert len(original53)==53 and sum(x["net30pct"]>0 for x in original53)==29
    feat=json.loads(FEATURE.read_text(encoding="utf-8"))
    baseid={x["id"]:x for x in base}

    byfamily={}
    for m in sorted({x["model"] for x in a}):
        group=[x for x in a if x["model"]==m]
        if m=="NATIVE_ONLY": continue
        normal=next((x for x in group if x["executionCase"]=="SECOND_PRINT"),None)
        extreme=next((x for x in group if x["executionCase"]=="SECOND_PRINT_1000BPS"),None)
        if normal and extreme:
            e=normal["priceProxyEconomicAndDDAt075"]; f=extreme["priceProxyEconomicAndDDAt075"]
            byfamily[m]={
               "normal":{"winrate":e["conditionalWinratePct"],"wins":normal["wins"],"nav":e["sourceReferenceFinalEquityInclCensoredMarkYen"],
                 "m5DD":e["sourceM5CloseMarkedDDPct"],"highStressDD":e["sourcePrevCompletedM5PeakHighStressDDPct"],
                 "exits":normal["earlyCapturesApplied"],"winnerFlips":normal["sourceNativeWinnersTurnedLosers"]},
               "extreme1000bps":{"winrate":f["conditionalWinratePct"],"wins":extreme["wins"],"nav":f["sourceReferenceFinalEquityInclCensoredMarkYen"],
                 "m5DD":f["sourceM5CloseMarkedDDPct"],"highStressDD":f["sourcePrevCompletedM5PeakHighStressDDPct"],
                 "exits":extreme["earlyCapturesApplied"],"winnerFlips":extreme["sourceNativeWinnersTurnedLosers"]},
               "sourceUnderlyingChanges":[x["id"] for x in normal["originNativeSurvivorsChangedExitPrice"]]
            }

    native=next(x for x in a if x["model"]=="NATIVE_ONLY")
    shock=next(x for x in a if x["model"]=="P25_SHOCK_ONLY" and x["executionCase"]=="SECOND_PRINT")
    shock1000=next(x for x in a if x["model"]=="P25_SHOCK_ONLY" and x["executionCase"]=="SECOND_PRINT_1000BPS")
    assert len(shock["originNativeSurvivorsChangedExitPrice"])==1
    assert shock["originNativeSurvivorsChangedExitPrice"][0]["id"]=="S3_01700"
    native_s3=baseid["S3_01700"]
    shock_s3=next(x for x in by[("P25_SHOCK_ONLY","SECOND_PRINT")] if x["id"]=="S3_01700")
    other_changes=[]
    for x in by[("P25_SHOCK_ONLY","SECOND_PRINT")]:
       old=baseid[x["id"]]
       if x["id"]=="S3_01700":continue
       if x.get("exitTs")!=old.get("exitTs") or x.get("exitPrice")!=old.get("exitPrice") or x.get("realizedNetPctOnEntryEquityIfClosed")!=old.get("realizedNetPctOnEntryEquityIfClosed"):
          other_changes.append(x["id"])
    assert not other_changes, other_changes
    assert native["wins"]==shock["wins"]==14
    assert shock["earlyCapturesApplied"]==1
    assert shock["priceProxyEconomicAndDDAt075"]["sourceM5CloseMarkedDDPct"]<20
    assert shock1000["priceProxyEconomicAndDDAt075"]["sourceM5CloseMarkedDDPct"]<20

    causal=Counter(); all_rows=0; applied=[]
    with gzip.open(ALL120,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip():continue
            row=json.loads(line); all_rows+=1
            k=(row["model"],row["case"])
            causal[k]+=1
            if row.get("p36AddedProfitProtectionEarlyExit"):
                assert row["p36CausalSignalCloseTs"]<=row["exitProxyTs"]
                assert row["exitProxyTs"]<row["p36OriginNativeSourceExitTs"]
                assert row["p36CoverM5PositiveVolumeNotionalUSDT"]>0
                assert row["p36SourceVenueSignedFillVerified"] is False
                applied.append({"id":row["id"],"model":row["model"],"case":row["case"]})
    assert all_rows==53*120
    assert all(x==120 for x in causal.values()) and len(causal)==53
    assert sum(1 for x in applied if x["model"]=="P25_SHOCK_ONLY")==4

    featstats={}
    for field in ("emaDown24Below72","relativeWeak6h","btcWeak6h"):
        c=Counter()
        for x in closed:
            val=feat[x["id"]]["flags"][field]
            c[("winner" if x in wins else "loss",str(val))]+=1
        featstats[field]={f"{kind}_{flag}":c[(kind,flag)] for kind in ("winner","loss") for flag in ("True","False")}
    loss_table=[]
    for x in losses:
        f=feat[x["id"]]
        loss_table.append({"id":x["id"],"cohort":x["cohort"],"route":x["route"],
            "dateUTC":datetime.fromtimestamp(x["entryTs"]/1000,timezone.utc).date().isoformat(),
            "returnOnEquityPct":pct(x["realizedNetPctOnEntryEquityIfClosed"]),
            "exitReason":x["sourceOriginalExitReason"],"BTC6ReturnPct":pct(100*f["BTCret6"]),
            "PENGUMinusBTC6Pct":pct(100*f["PENGUminusBTC6"]),
            "emaDown24Below72":f["flags"]["emaDown24Below72"]})
    cohorts={}
    for group in sorted({x["cohort"] for x in closed}):
        g=[x for x in closed if x["cohort"]==group]
        cohorts[group]={"completed":len(g),"winners":sum(x["realizedNetPctOnEntryEquityIfClosed"]>0 for x in g),
            "losers":sum(x["realizedNetPctOnEntryEquityIfClosed"]<=0 for x in g)}

    signatures=defaultdict(list)
    for k, pp in by.items():
        sig=tuple((x["id"],x["exitTs"],None if x["exitPrice"] is None else round(x["exitPrice"],10)) for x in sorted(pp,key=lambda z:z["id"]))
        signatures[sig].append(k)
    duplicates=sorted((v for v in signatures.values() if len(v)>1),key=len,reverse=True)

    data={
      "schema":"prism7-p37-independent-audit-p36-source120/v1",
      "status":"RESEARCH_ONLY__NO_PROMOTION",
      "sourceHashes":{p.name:sha(p) for p in (P36,TRADES,ALL120,FEATURE,P35)},
      "preference":"fixed gross 0.75, original source intact, no live changes",
      "parity":{"originalP35Native53":53,"originalP35Native53Wins":29,"p36StructuralSourceIntents":120,
         "p36UniqueCases":53,"p36SourceScenarioLedgerRows":all_rows,"p36SourcePositionLedgerRows":len(rows),
         "selectedP36Positions":len(base),"p36Closed":len(closed),"p36Wins":len(wins),"p36Losses":len(losses),"p36RightCensored":len(censored)},
      "winrate":{"sampleWinPct":pct(100*len(wins)/len(closed)),
        "wilson95Pct":wilson(len(wins),len(closed)),
        "forAtLeast80PctMinWinsAt19":math.ceil(.8*len(closed)),
        "additionalLosersToAvoidIfNoWinnersRemoved":2},
      "sourceBaseline":native["priceProxyEconomicAndDDAt075"],
      "p25SecondPrint":shock["priceProxyEconomicAndDDAt075"],
      "p25SecondPrint1000bps":shock1000["priceProxyEconomicAndDDAt075"],
      "p25OnlyChangedTradeId":"S3_01700",
      "p25OnlyChangedTradeNetReturnOnEquityPct":{"native":pct(native_s3["realizedNetPctOnEntryEquityIfClosed"]),
          "p25":pct(shock_s3["realizedNetPctOnEntryEquityIfClosed"]),
          "delta":pct(shock_s3["realizedNetPctOnEntryEquityIfClosed"]-native_s3["realizedNetPctOnEntryEquityIfClosed"])},
      "p25OtherPositionExitsIdentical":True,
      "p25NativeWinCountUnchanged":True,
      "p25EventCount":1,
      "scenarioFamilyStressTable":byfamily,
      "uniquePositionOutcomeSignatures":len(signatures),
      "duplicateScenarioGroups":[{"count":len(v),"models":[list(k) for k in v]} for v in duplicates],
      "preEntryFeatureConfusionAmongClosedP36":featstats,
      "cohortLossCounts":cohorts,
      "fiveLosingTrades":loss_table,
      "modelAudit":{"positiveM5OpenProxyNotExecutable":True,"trueProductionEntryParity":False,
         "portfolioDD20Certified":False,"freshIndependentHoldout":False,
         "conditionSelectionWasHistoricallyExamined":True,
         "sampleIsNot53IndependentTrades":True,
         "noEntryGateWasDesignedFromObservedLosers":True,
         "sourceNativeSTOPPriorityAuditedAtRowLevel":True,
         "venueSignedFillVerified":False},
      "nextTest":"New independent data with true native V20 signal/exit and venue ask, evaluate preregistered entry state machine per cohort, shared gross/daily loss portfolio DD"
    }
    OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    md=[
       "# PRISM VII P37：P36の独立性・敗因・再現性監査",
       "",
       "判定：**RESEARCH_ONLY / 本番採用不可**。固定Gross 0.75、30bps。研究用価格プロキシ。",
       "",
       f"- 元53 Native Short: 53件中29勝（P35）。P36 S4構造系列は120 intent→20 position（19決済・14勝・5敗・1未決済）で、同じ母集団ではない。",
       f"- P36勝率 {100*len(wins)/len(closed):.2f}%。Wilson 95%区間 {wilson(len(wins),len(closed))}。80%以上には19決済で16勝が必要。",
       f"- 53シナリオは53独立試行ではなく、position出口結果のユニーク署名は {len(signatures)} 種類。",
       f"- P25 2本目は {len(shock['originNativeSurvivorsChangedExitPrice'])}件（S3_01700）だけ出口変更、勝数 {native['wins']} → {shock['wins']}。",
       f"- その取引のネット損益（元本比）は {native_s3['realizedNetPctOnEntryEquityIfClosed']:.2f}% → {shock_s3['realizedNetPctOnEntryEquityIfClosed']:.2f}%。残りのposition出口は完全一致。",
       f"- P25 M5終値DD: {native['priceProxyEconomicAndDDAt075']['sourceM5CloseMarkedDDPct']:.2f}% → {shock['priceProxyEconomicAndDDAt075']['sourceM5CloseMarkedDDPct']:.2f}%。+1000bpsでも {shock1000['priceProxyEconomicAndDDAt075']['sourceM5CloseMarkedDDPct']:.2f}%。ただし1イベントに依存。",
       "",
       "## 5敗（Native S4系列、0.75x）",
       "",
       "| ID | 日付 UTC | 系統 | 元本比損益 | BTC6h | PENGU−BTC6h |",
       "|---|---|---|---:|---:|---:|",
    ]
    for x in loss_table:
        md.append(f"| {x['id']} | {x['dateUTC']} | {x['route']} | {x['returnOnEquityPct']:.2f}% | {x['BTC6ReturnPct']:.2f}% | {x['PENGUMinusBTC6Pct']:.2f}% |")
    md += ["","## 監査上の結論",
       "- 既存のBTC6h弱含み・相対弱含み・EMA下降フラグは勝者にも敗者にも出現する。敗者だけに合わせた新閾値は過学習のため採用しない。",
       "- P25およびMFE-TPの同じ取引上の改善は独立した多重証拠ではない。早期決済1件を一般則と認定しない。",
       "- +1000bpsの出口スリップ試験と実際のvenue ask・板厚・約定/SL優先順位の検証は別物。",
       "- P36のS4構造入口とProduction Native V20入口は完全同一ではない。PnL、DD、勝率をProduction正式BT値と扱わない。",
       "- 本番Runner・建玉・STOP・Kill Switchは変更していない。研究用の監査台帳のみ作成。",""]
    MD.write_text("\n".join(md),encoding="utf-8")
    print("P37_AUDIT_PASS",json.dumps({"scenarios":53,"sourceIntents":all_rows,"distinctOutcomeSignatures":len(signatures),
         "trades":len(closed),"win":len(wins),"loss":len(losses),"censored":len(censored),
         "p25TradeDeltaPctOnEquity":data["p25OnlyChangedTradeNetReturnOnEquityPct"]["delta"],
         "wilson95":data["winrate"]["wilson95Pct"],
         "featureCounts":featstats,"cohorts":cohorts,
         "report":str(OUT)},ensure_ascii=False))
if __name__=="__main__":main()
