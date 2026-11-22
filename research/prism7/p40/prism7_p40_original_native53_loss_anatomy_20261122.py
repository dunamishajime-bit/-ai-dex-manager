#!/usr/bin/env python3
"""PRISM VII P40: immutable Native V20 53 entry->exit loss anatomy.
Post-entry event categories are retrospective diagnostics, NOT admissible entry
gates. Uses fully completed positive-volume M5 bars; no signed fills.
"""
from __future__ import annotations
import json,hashlib,statistics,collections
from pathlib import Path
from datetime import datetime,timezone
from prism7_native53_event_attribution_20261122 import load_m5,analyze_one
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES,rounded
HOME=Path(__file__).resolve().parent.parent
R=HOME/"results"
SRC=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
P39=R/"PRISM7_P39_ORIGINAL_NATIVE53_M5_ASOF_FEATURES_20261122.jsonl"
P38=R/"PRISM7_P38_M5_CAUSAL_MULTI_HORIZON_ENTRY_ABLATION_20261122.json"
DEST=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_20261122.json"
DETAIL=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_LEDGER_20261122.jsonl"
MD=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_20261122.md"

def main():
    original=json.loads(SRC.read_text(encoding="utf8"))
    p39=[json.loads(x) for x in P39.read_text(encoding="utf8").splitlines() if x.strip()]
    p38=json.loads(P38.read_text(encoding="utf8"))
    m5,hashes=load_m5(SOURCES)
    assert len(original)==len(p39)==53 and hashes==p38["inputSHA"]["PENGU_M5"]
    lookup={x["key"]:x for x in p39}
    assert len(lookup)==53
    all_entries=[]
    for x in original:
        key=f"{x['period']}|{x['id']}|{x['entryTs']}"
        assert key in lookup and x["exitTs"]==lookup[key]["exitTs"]
        src={"entry_ts":int(x["entryTs"]),"exit_ts":int(x["exitTs"]),
             "entry_price":float(x["entryPrice"])}
        e=analyze_one(src,m5)
        native=float(x["net30pct"])
        assert x["originalNativeShortSignalUnchanged"] and x["parity"]=="EXACT"
        if native>0:category="WIN_ORIGINAL_NATIVE_EXIT"
        elif e["first_close_favorable_1pct"] is None:category="LOSS_NEVER_CONFIRMED_1PCT"
        elif e["first_close_favorable_3pct"] is None:category="LOSS_CONFIRMED_1_TO_LT3PCT"
        else:category="LOSS_CONFIRMED_3PCT_OR_MORE_GIVEN_BACK"
        firstA=e["first_close_adverse_1pct"]
        firstF=e["first_close_favorable_1pct"]
        order= ("NO_ADVERSE_1PCT_CLOSE" if firstA is None
                else "ADVERSE_FIRST_OR_NO_FAVORABLE" if firstF is None or firstA<=firstF
                else "FAVORABLE_FIRST")
        all_entries.append({
           "key":key,"id":x["id"],"cohort":x["period"],"nativeNet30Pct":native,
           "originalEntryTs":int(x["entryTs"]),"originalExitTs":int(x["exitTs"]),
           "holdHours":rounded((int(x["exitTs"])-int(x["entryTs"]))/3600000),
           "nativeExitReason":x["exitReason"],
           "entryAsOfAvailable":lookup[key]["causalM5"].get("asof",False),
           "entryAsOfState":lookup[key]["causalM5"]["state"],
           "postEntryLossCategory":category,
           "firstFavorableVsAdverse1Pct":order,
           "postEntryM5EventTrace":e,
           "leakageGuard":"ALL_CLASSIFICATION_OUTCOMES_USED_ONLY_FOR_DIAGNOSTICS_NOT_PREENTRY_GATE"
        })
    wins=[x for x in all_entries if x["nativeNet30Pct"]>0]
    losers=[x for x in all_entries if x["nativeNet30Pct"]<=0]
    assert len(wins)==29 and len(losers)==24
    category=collections.Counter(x["postEntryLossCategory"] for x in losers)
    assert sum(category.values())==24
    exit_reason=collections.Counter(x["nativeExitReason"] for x in losers)
    period=collections.defaultdict(list)
    for x in all_entries:period[x["cohort"]].append(x)
    for x in all_entries:
        for field in ("first_close_favorable_1pct","first_close_favorable_3pct","first_close_adverse_1pct"):
            t=x["postEntryM5EventTrace"][field]
            if t is not None:
                assert x["originalEntryTs"]<=t<=x["originalExitTs"],(x["key"],field)
    def bygroup(g):
        n=len(g);w=sum(x["nativeNet30Pct"]>0 for x in g)
        return {"n":n,"wins":w,"losses":n-w,"winratePct":rounded(w/n*100) if n else None,
            "sumNet30PctOnNotional":rounded(sum(x["nativeNet30Pct"] for x in g)),
            "medianHoldHours":rounded(statistics.median(x["holdHours"] for x in g)) if n else None}
    report={
       "schema":"prism7-p40-original-pinned53-postentry-source-loss-anatomy/v1",
       "status":"DIAGNOSTIC_ONLY__NO_THRESHOLD_PROMOTION",
       "sourceP35SHA256":hashlib.sha256(SRC.read_bytes()).hexdigest(),
       "sourceP39LedgerSHA256":hashlib.sha256(P39.read_bytes()).hexdigest(),
       "M5FilesSHA256":hashes,
       "sourceNative53Wins":29,
       "sourceNative53Losses":24,
       "sourceAll53SignalsStillPreserved":True,
       "lossGroups":dict(category),
       "lossExitReasonCounts":dict(exit_reason),
       "lossEarlyAdverse1PctBeforeFavorable1PctCount":sum(x["firstFavorableVsAdverse1Pct"]=="ADVERSE_FIRST_OR_NO_FAVORABLE" for x in losers),
       "lossFavorable1PctFirstCount":sum(x["firstFavorableVsAdverse1Pct"]=="FAVORABLE_FIRST" for x in losers),
       "lossNoAdverse1PctCloseCount":sum(x["firstFavorableVsAdverse1Pct"]=="NO_ADVERSE_1PCT_CLOSE" for x in losers),
       "sourceByCohort":{k:bygroup(v) for k,v in sorted(period.items())},
       "sourceByOutcome":{"winners":bygroup(wins),"losers":bygroup(losers)},
       "sourceLossDetail":[x for x in losers],
       "entryMicroUnscorableAll53":sum(not x["entryAsOfAvailable"] for x in all_entries),
       "entryMicroUnscorableWinning53":sum(not x["entryAsOfAvailable"] for x in wins),
       "outputAll53LedgerRows":len(all_entries),
       "classificationCannotBeUsedAsEntryGate":True,
       "productionPromotion":False,
       "limits":[
          "The event classification depends on observing future favorable/adverse price after entry; it is NOT an entry decision at the original timestamp.",
          "Original H1 Native V20 exit and M5 event clock may have unverified source divergence.",
          "M5 OHLC high/low intra-bar STOP sequencing, orderbook depth, signed fills and funding are not reconstructed.",
          "Native53 signals are not necessarily 53 nonoverlapping actual fills; these are native price-source cases.",
          "Observed PRE, BASE and POST periods are not a blind future validation.",
          "No real portfolio compounding, gross sharing or actual portfolio drawdown certified."
       ]}
    DEST.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    DETAIL.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in all_entries),encoding="utf8")
    lines=[
       "# P40 Original Native53 losses: causal-clock retrospective attribution","",
       "53件：29勝24敗。M5でエントリー後の3分類に分解し、将来情報を入口に混入しない。",
       "",
       "| 損失分類 | 件数 |",
       "|---|---:|"
    ]
    labels={"LOSS_NEVER_CONFIRMED_1PCT":"決済まで1%以上の有利M5終値が成立しない",
            "LOSS_CONFIRMED_1_TO_LT3PCT":"一時は有利1%以上、3%未満",
            "LOSS_CONFIRMED_3PCT_OR_MORE_GIVEN_BACK":"一時は有利3%以上、最終損失"}
    for k in labels: lines.append(f"| {labels[k]} | {category.get(k,0)} |")
    lines+=["",f"序盤から逆行（有利1%より先に逆行1%をM5終値で確認・または有利1%なし）：{report['lossEarlyAdverse1PctBeforeFavorable1PctCount']}件。",
       f"有利1%が先：{report['lossFavorable1PctFirstCount']}件。逆行1%終値なし：{report['lossNoAdverse1PctCloseCount']}件。",
       "",
       "設計判断：入口の方向判定と、保有後の進捗/利益喪失を別モデルとして研究する。将来の値動きに基づく事後分類を入口学習ラベル以外の既知情報として用いてはならない。",
       "Production不採用・未見期間再検証待ち。",""]
    MD.write_text("\n".join(lines),encoding="utf8")
    print("PRISM7_P40_ORIGINAL53_LOSS_TAXONOMY_PASS")
    print("SOURCE",{"n":53,"wins":29,"losses":24,"groupCounts":dict(category),
        "earlyAdverse":report["lossEarlyAdverse1PctBeforeFavorable1PctCount"],
        "favorableFirst":report["lossFavorable1PctFirstCount"],
        "noAdverse":report["lossNoAdverse1PctCloseCount"],
        "lossExitReasons":dict(exit_reason),
        "cohorts":report["sourceByCohort"]})
    print("FILES",DEST,DETAIL,MD)
if __name__=="__main__":main()
