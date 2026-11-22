#!/usr/bin/env python3
"""P38 PRISM VII 0.75x prospective-causal M5 microstructure entry audit.
Research only. 120 S4 source intents preserved, native V20 exit ref pinned.
All models/thresholds declared before inspecting P38 M5 features.
No original Native 53 trade edits, no live modifications.
"""
from __future__ import annotations
import argparse,gzip,hashlib,json,math,statistics
from pathlib import Path
from collections import Counter,defaultdict
from datetime import datetime,timezone

from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p36_pengu_075_native_m5_profit_lock_53_scenarios_20261122 import select_native_overrides
from prism7_p34_pengu_seller_causal_three_gate_075_gross_ablation_20261122 import block
from prism7_p28_layer3_fixed_gross_capital_allocation_20261122 import scan
from prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122 import apply_single_slot

HOME=Path(__file__).resolve().parent.parent
RES=HOME/"results"
BT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
M5=300_000
GROSS=.75
PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
SOURCES=[
 HOME/"prebaseline_public_20250801_20250924"/"PENGUUSDT-5m-20250801-20250924.jsonl.gz",
 BT/"aster-public-v3-5m-prefix"/"PENGUUSDT-5m-20250924-20260803.jsonl.gz",
 BT/"aster-public-v3-5m-suffix"/"PENGUUSDT-5m-20260803-20261001.jsonl.gz",
 HOME/"forward_public_20261001_20261118"/"PENGUUSDT-5m-20261001-20261118.jsonl.gz"]
BTC=[
 HOME/"prebaseline_public_20250801_20250924"/"BTCUSDT-5m-20250801-20250924.jsonl.gz",
 BT/"aster-public-v3-5m-prefix"/"BTCUSDT-5m-20250924-20260803.jsonl.gz",
 BT/"aster-public-v3-5m-suffix"/"BTCUSDT-5m-20260803-20261001.jsonl.gz",
 HOME/"forward_public_20261001_20261118"/"BTCUSDT-5m-20261001-20261118.jsonl.gz"]
P32=RES/"PRISM7_P32_S4_NATIVE_V20_EXIT_REPLAY_SUMMARY_20261122_NATIVE_ALL120_EVENTS.json"
P33=RES/"PRISM7_P33_NATIVE_S4_ALL120_CAUSAL_SHOCK_EVENTS_20261122.json"
PROFILES=RES/"PRISM7_P34_SELLER_ALL120_CAUSAL_PREENTRY_FEATURES_20261122.json"
P36=RES/"PRISM7_P36_FIXED075_NATIVE_MFE_PROFIT_LOCK_53_SCENARIOS_20261122.json"
OUT=RES/"PRISM7_P38_M5_CAUSAL_MULTI_HORIZON_ENTRY_ABLATION_20261122.json"
LEDGER=RES/"PRISM7_P38_M5_CAUSAL_ALL120_SOURCE_FEATURES_20261122.jsonl.gz"
NOTE=RES/"PRISM7_P38_M5_CAUSAL_MULTI_HORIZON_ENTRY_ABLATION_20261122.md"
FEES=(10,30)
P25_STRESS=(0,1000)
EXIT_STRESS=(0,100)
GATES=("BASE_P34_ONLY",
       "SELLER_60_TAKER_45",
       "SELLER_30_TAKER_45",
       "M5_60_DOWN",
       "M5_60_BELOW_VWAP",
       "M5_2_OF_3",
       "M5_MULTISCALE_SELLER",
       "M5_RELATIVE_TAKER_VS_BTC")
# Explicitly fixed gates, NOT optimized thresholds on any P36 outcomes.
# These M5 60m/30m values are all prior to the proposed native entry OPEN.
# Thresholds are exploratory economic hypotheses, not winning selectors.

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def load_btc_quarantine(paths):
    """Keep source bytes immutable; quarantine invalid BTC OHLC with audit trail."""
    found={};hashes={};bad=[]
    for path in paths:
        hashes[path.name]=sha(path)
        with gzip.open(path,"rt",encoding="utf8") as f:
            for line in f:
                a=json.loads(line); t=int(a[0])
                if len(a)<11:raise ValueError("BTC_BAR_FIELDS_MISSING")
                o,h,l,c=[float(a[i]) for i in (1,2,3,4)]
                volume,buy=float(a[5]),float(a[9])
                valid=(0<l<=min(o,c)<=max(o,c)<=h and volume>=0 and 0<=buy<=volume)
                if not valid:
                    bad.append({"source":path.name,"ts":t,
                        "reason":"OHLC_OR_VOLUME_NOT_VALID",
                        "originalSourceOhlc":[o,h,l,c]})
                    continue
                if t in found and found[t]!=a:
                    raise ValueError("BTC_DUPLICATE_DISAGREE")
                found[t]=a
    return found,hashes,bad

def rounded(x,n=6):return None if x is None else round(float(x),n)
def win95(k,n):
    if not n:return [None,None]
    z=1.95996398454;p=k/n;d=1+z*z/n
    mid=(p+z*z/(2*n))/d
    delta=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [round(100*(mid-delta),3),round(100*(mid+delta),3)]

def asof_lookback(market,entry,n=12):
    assert entry%M5==0
    rows=[]
    for j in range(n,0,-1):
        ts=entry-j*M5
        b=market.get(ts)
        if b is None:
            return None
        if len(b)<11 or float(b[5])<0:
            raise ValueError("P38_BAD_ASOF_BAR")
        # Candle must be completed strictly before entry open.
        if ts+M5>entry: raise ValueError("P38_LEAK_LOOKBACK")
        rows.append(b)
    return rows

def fsource(cand,profiles,pengu,btc):
    t=cand.get("entryProxyTs")
    if t is None:return {"state":"NO_P32_SOURCE_ENTRY","asof":False}
    t=int(t)
    px=asof_lookback(pengu,t)
    bx=asof_lookback(btc,t)
    if px is None or bx is None:
        return {"state":"MISSING_12_PRE_ENTRY_M5_BARS","asof":False,"entryTs":t}
    vol=sum(float(b[5]) for b in px)
    bvol=sum(float(b[9]) for b in px)
    vol6=sum(float(b[5]) for b in px[6:])
    bvol6=sum(float(b[9]) for b in px[6:])
    bv=sum(float(b[5]) for b in bx)
    bbuy=sum(float(b[9]) for b in bx)
    if not vol or not vol6 or not bv:
        return {"state":"ZERO_SOURCE_POSITIVE_VOLUME_LOOKBACK","asof":False,"entryTs":t}
    positive=sum(float(b[5])>0 for b in px)
    positive6=sum(float(b[5])>0 for b in px[6:])
    vwap=sum(float(b[4])*float(b[5]) for b in px)/vol
    first=float(px[0][1]);last=float(px[-1][4])
    ret=last/first-1
    btcfirst=float(bx[0][1]);btclast=float(bx[-1][4])
    # Returns, volumes, and flags are all from strictly completed bars.
    flags={
        "seller60":bvol/vol<=.45,
        "seller30":bvol6/vol6<=.45,
        "microDown":ret<0,
        "belowVWAP":last<vwap,
        "relativeSeller":bvol/vol<=bbuy/bv-.03,
    }
    return {
       "state":"CAUSAL_PRE_ENTRY_M5_COMPLETE",
       "asof":True,"entryTs":t,
       "lastObservedM5CloseTs":t,
       "firstObservedM5OpenTs":t-12*M5,
       "preEntryM5Bars":12,"positiveM5Bars60m":positive,
       "positiveM5Bars30m":positive6,
       "penguTakerBuyRatio60":rounded(bvol/vol),
       "penguTakerBuyRatio30":rounded(bvol6/vol6),
       "btcTakerBuyRatio60":rounded(bbuy/bv),
       "penguLast60mCloseReturnPct":rounded(100*ret),
       "btcLast60mCloseReturnPct":rounded(100*(btclast/btcfirst-1)),
       "penguM5LastCloseVsVWAPPct":rounded(100*(last/vwap-1)),
       "buyVolumeUnits60m":rounded(bvol),
       "totalVolumeUnits60m":rounded(vol),
       "sourceCandidateRoute":cand["route"],
       "flags":flags,
       "venueSignedExecutionProven":False
    }

def passes(name,feature):
    if name=="BASE_P34_ONLY":return True
    if not feature.get("asof"):return False
    f=feature["flags"]
    if name=="SELLER_60_TAKER_45":return f["seller60"]
    if name=="SELLER_30_TAKER_45":return f["seller30"]
    if name=="M5_60_DOWN":return f["microDown"]
    if name=="M5_60_BELOW_VWAP":return f["belowVWAP"]
    if name=="M5_2_OF_3":return sum(f[k] for k in ("seller60","microDown","belowVWAP"))>=2
    if name=="M5_MULTISCALE_SELLER":return f["seller60"] and f["seller30"] and f["microDown"]
    if name=="M5_RELATIVE_TAKER_VS_BTC":return f["relativeSeller"]
    raise ValueError(name)

def gate(row,feature,name):
    y=dict(row)
    y.update(p38Model=name,p38AsOfM5State=feature["state"],p38BlockedByM5=False)
    if name=="BASE_P34_ONLY" or row.get("entryProxyTs") is None:return y
    if passes(name,feature):return y
    y.update(status="P38_RESEARCH_CAUSAL_GATE_BLOCKED",
       p38BlockedByM5=True,
       p38NativePreservedEntryTs=row["entryProxyTs"],
       p38NativePreservedExitTs=row.get("exitProxyTs"),
       p38NativePreservedExitPrice=row.get("exitProxyPrice"),
       entryProxyTs=None,entryProxyPrice=None,exitProxyTs=None,exitProxyPrice=None,
       exitReason=None)
    return y

def all_exit_stress(rows,bps):
    if not bps:return rows
    out=[]
    for row in rows:
        if row["status"]!="PRICE_PROXY_CLOSED":
            out.append(row);continue
        # Short buy-to-cover is more expensive, including source native stops.
        y=dict(row)
        y["exitProxyPrice"]=float(row["exitProxyPrice"])*(1+bps/10000)
        y["p38AllCoversExtraSlipBps"]=bps
        out.append(y)
    return out

def grouped(record):
    ret=defaultdict(list)
    for x in record:
        if x["realizedNetPctOnEntryEquityIfClosed"] is None:continue
        ret[x["cohort"]].append(x["realizedNetPctOnEntryEquityIfClosed"])
    return {
        k:{"closed":len(v),"wins":sum(x>0 for x in v),
           "winPct":rounded(100*sum(x>0 for x in v)/len(v)),
           "meanEquityReturnPct":rounded(sum(v)/len(v)),
           "win95":win95(sum(x>0 for x in v),len(v))}
        for k,v in sorted(ret.items())}

def diff(base,mod):
    b={x["id"]:x for x in base if x["realizedNetPctOnEntryEquityIfClosed"] is not None}
    m={x["id"]:x for x in mod if x["realizedNetPctOnEntryEquityIfClosed"] is not None}
    return {
       "originalWinnersExcluded":[k for k,x in b.items() if x["realizedNetPctOnEntryEquityIfClosed"]>0 and k not in m],
       "originalLosersExcluded":[k for k,x in b.items() if x["realizedNetPctOnEntryEquityIfClosed"]<=0 and k not in m],
       "newCompletedFromFreedSlot":[k for k in m if k not in b],
       "originalWinnersChangedSign":[k for k,x in b.items() if x["realizedNetPctOnEntryEquityIfClosed"]>0 and k in m and m[k]["realizedNetPctOnEntryEquityIfClosed"]<=0],
    }

def main():
    p36=json.loads(P36.read_text(encoding="utf8"))
    native=json.loads(P32.read_text(encoding="utf8"))
    shock=json.loads(P33.read_text(encoding="utf8"))
    profiles=json.loads(PROFILES.read_text(encoding="utf8"))
    assert len(native)==len(shock)==len(profiles)==120
    assert len({x["id"] for x in native})==120
    assert p36["sourceNativeShortPinnedSHA"]==PIN and p36["grossFixed"]==GROSS
    for key,path in (("P32NativeAll120",P32),("P33CrossAssetSourceDetector120",P33),("P34EntryCausal120",PROFILES)):
        assert sha(path)==p36["sourcePriceHashes"][key],(key,"PINNED_INPUT_MISMATCH")
    pengu,ph=load_m5(SOURCES)
    btc,bh,bad_btc=load_btc_quarantine(BTC)
    assert ph==p36["sourcePriceHashes"]["PENGUM5"],"P38_PENGU_M5_SOURCE_HASH_DRIFT"
    features={x["id"]:fsource(x,profiles[x["id"]],pengu,btc) for x in native}
    ledger=[]
    for x in native:
        assert profiles[x["id"]]["intentTs"]==x["intentTs"]
        if x.get("entryProxyTs") is not None:
            ft=features[x["id"]]
            assert ft["asof"],(x["id"],ft)
            assert ft["lastObservedM5CloseTs"]<=int(x["entryProxyTs"])
        ledger.append({"sourceIntentId":x["id"],"sourceRoute":x["route"],
                       "sourceCohort":x["cohort"],"nativeSourceStatus":x["status"],
                       "nativeSourceEntryTs":x.get("entryProxyTs"),
                       "h1CausalProfile":profiles[x["id"]],
                       "p38CausalM5Feature":features[x["id"]]})
    reference={(q["model"],q["executionCase"]):q for q in p36["allFiftyThreeScenarioEconomics"]}
    report=[]
    base_records={}
    snapshot=[]
    for extraShock in P25_STRESS:
      for name in GATES:
        stage=[]
        for n in native:
            override=select_native_overrides(
                 n,"P25_SHOCK_ONLY",2,extraShock,{"state":"NOT_MFE_ROUTE"},shock[n["id"]])
            old=block(override,profiles[n["id"]],"SELLER_BTC_TREND_ONLY")
            stage.append(gate(old,features[n["id"]],name))
        # Preserve original 120 opportunities; single slot is applied AFTER gate,
        # not to the already OCCUPIED_SLOT P36 ledger.
        selected=apply_single_slot(stage)
        assert len(selected)==120 and len({x["id"] for x in selected})==120
        for fee in FEES:
          for extraAllCovers in EXIT_STRESS:
            stressed=all_exit_stress(selected,extraAllCovers)
            econ,records=scan(stressed,pengu,GROSS,fee)
            if name=="BASE_P34_ONLY" and fee==30 and extraAllCovers==0:
                exe="SECOND_PRINT" if extraShock==0 else "SECOND_PRINT_1000BPS"
                check=reference[("P25_SHOCK_ONLY",exe)]
                target=check["priceProxyEconomicAndDDAt075"]
                for key in ("conditionalWinCount","originalSourceCompletedTradeCount",
                    "conditionalMeanNetReturnPctOnEquity","conditionalWinratePct",
                    "sourceM5CloseMarkedDDPct","sourcePrevCompletedM5PeakHighStressDDPct",
                    "sourceReferenceFinalEquityInclCensoredMarkYen"):
                    assert abs(float(econ[key])-float(target[key]))<=1e-7,(key,econ[key],target[key])
                assert len(records)==20
            slotkey=(extraShock,fee,extraAllCovers)
            if name=="BASE_P34_ONLY":
                base_records[slotkey]=records
            assert slotkey in base_records,"BASELINE_NOT_FIRST"
            delta=diff(base_records[slotkey],records)
            completed=econ["originalSourceCompletedTradeCount"]
            wins=econ["conditionalWinCount"]
            res={
                "model":name,"P25CoverExtraSlipBps":extraShock,
                "roundTripFeeBps":fee,"additionalAllShortBuyCoverSlipBps":extraAllCovers,
                "source120Preserved":len(selected),"sourceP34Blocked":sum(z.get("p34BlockedByPreEntrySignals",False) for z in selected),
                "p38BlockedAdditional":sum(z.get("p38BlockedByM5",False) for z in selected),
                "completed":completed,"wins":wins,"losses":completed-wins,
                "rightCensored":econ["sourceCensoredOpenPositionCount"],
                "conditionalWinratePct":econ["conditionalWinratePct"],
                "winrateWilson95":win95(wins,completed),
                "conditionalMeanNetReturnPctOnEquity":econ["conditionalMeanNetReturnPctOnEquity"],
                "profitFactor":econ["conditionalProfitFactor"],
                "M5CloseMarkedDDPct":econ["sourceM5CloseMarkedDDPct"],
                "priorCompletedPeakHighStressDDPct":econ["sourcePrevCompletedM5PeakHighStressDDPct"],
                "finalNAVYen":econ["sourceReferenceFinalEquityInclCensoredMarkYen"],
                "sourceSingleSlotTotalReturnPointsOnEquity":econ["sourceSingleSlotTotalReturnPointsOnEquity"],
                "all120OpportunityYieldPctPoints":rounded(econ["sourceSingleSlotTotalReturnPointsOnEquity"]/120),
                "cohortResults":grouped(records),
                "originalTradeChange":delta,
                "liveApproved":False}
            report.append(res)
            if fee==30 and extraAllCovers==0:
                snapshot.append({"model":name,"shockSlip":extraShock,
                     "selected":[{"id":x["id"],"cohort":x["cohort"],"route":x["route"],
                         "exitTs":x["exitTs"],"exitPrice":x["exitPrice"],"ret":x["realizedNetPctOnEntryEquityIfClosed"]}
                         for x in records]})
    assert len(report)==len(GATES)*len(P25_STRESS)*len(FEES)*len(EXIT_STRESS)
    normals=[x for x in report if x["roundTripFeeBps"]==30 and
              x["additionalAllShortBuyCoverSlipBps"]==0 and x["P25CoverExtraSlipBps"]==0]
    assert len(normals)==len(GATES)
    original=next(x for x in normals if x["model"]=="BASE_P34_ONLY")
    viable=[x["model"] for x in normals if x["M5CloseMarkedDDPct"]<=20 and
      x["priorCompletedPeakHighStressDDPct"]<=20 and x["completed"]>=15 and
      x["conditionalWinratePct"]>=80 and x["finalNAVYen"]>=original["finalNAVYen"]]
    result={
       "schema":"prism7-p38-frozen-microstructure-m5-causal-entry-gates-source120-0p75/v1",
       "pinnedSha":PIN,"gross":GROSS,
       "originalNative53SourceUntouched":True,
       "allNativeSourceStructuralIntents":120,
       "source120FeaturesBuilt":len(features),
       "availableNativeEntryFeatures":sum(z.get("asof",False) for z in features.values()),
       "precommittedGates":list(GATES),
       "precommittedFeesBps":FEES,
       "precommittedP25ShockSlippageBps":P25_STRESS,
       "precommittedAllShortCoversAdditionalSlippageBps":EXIT_STRESS,
       "totalScenarios":len(report),
       "inputSHA":{
          "p32NativeAll120":sha(P32),"p33Shock120":sha(P33),
          "p34CausalH1":sha(PROFILES),"p36Reference":sha(P36),
          "PENGU_M5":ph,"BTC_M5":bh},
       "btcInvalidBarsQuarantined":bad_btc,
       "baseReferenceP36MatchedTo1eMinus7":True,
       "allScenarios":report,
       "base30bpsNoSlipNormalScenarios":normals,
       "featureRecords":len(ledger),
       "viableWithinExploredHistoryOnly":viable,
       "cohortClassification":{
          "PRE_2025_AUG_SEP":"already used in P8-P37; NOT blind",
          "BASE_2025_2026":"already used in P8-P37; NOT blind",
          "POST_2026_OCT_NOV":"already used in P8-P37; NOT untouched independent OOS"},
       "promotionDecision":"NO_PRODUCTION_ADOPTION_WITHOUT_UNSEEN_PERIOD_AND_NATIVE_ENTRY_PARITY",
       "limits":[
          "Entry source is novel S4 structural setup, not exact original pinned V20 live entrance.",
          "All PRE/BASE/POST periods already examined before the P38 hypothesis; not true blind holdout.",
          "Positive M5 open is non-executable price proxy and the public taker-buy volume ratio is not venue-level orderbook delta.",
          "H1 and M5 source coherence and intra-bar STOP/EXIT sequencing not fully certified.",
          "No funding, fill, liquidation, real fee tiers, other runners, correlated positions or portfolio-level drawdown.",
          "P25 flash-crash exit developed around known one-event historical outcome; do not interpret as independent multi-event proof.",
          "Price features are computed from 12 M5 candles completed before entry, but extra P38 gate can reallocate the freed slot to a different S4 candidate.",
          "Comparing model winrates while excluding losers can inflate estimates; require minimum trades and whole-120-opportunity yield."
       ]
    }
    OUT.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    with gzip.open(LEDGER,"wt",encoding="utf8") as f:
        for x in ledger:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n")
    lines=[
       "# P38 | PENGU SHORT V20 S4 0.75x pre-entry M5 causal feature ablation",
       "",
       "研究専用（Production未反映）。前提：源120候補、不変Native出口、P34 BTC6Hフィルタ、P25の出口価格モデル。",
       "過去3コホートはP37以前に結果を閲覧済みで、POSTも未見OOSではない。",
       "",
       "| Gate | 決済数 | 勝数 | 勝率 | 終値DD | High DD | NAV（円） | 追加ブロック |",
       "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for a in normals:
      lines.append(f"| {a['model']} | {a['completed']} | {a['wins']} | {a['conditionalWinratePct']:.2f}% | {a['M5CloseMarkedDDPct']:.2f}% | {a['priorCompletedPeakHighStressDDPct']:.2f}% | {a['finalNAVYen']:,.0f} | {a['p38BlockedAdditional']} |")
    lines.extend(["",f"検証シナリオ：{len(report)}、入力Native価格入場の直前5分足確認：{result['availableNativeEntryFeatures']}件。",
      "本番採用判定：NO。完全Native V20入口一致、未見の外部期間、実約定/STOP優先・統合DDが未検証。",
      ""])
    NOTE.write_text("\n".join(lines),encoding="utf8")
    print("PRISM7_P38_CAUSAL_MULTIHORIZON_0P75_NATIVE_SOURCE120_PASS")
    print("INPUT",json.dumps({"n":len(features),"causal":result["availableNativeEntryFeatures"],"scenarios":len(report)},ensure_ascii=False))
    for x in normals:
        print("CASE",json.dumps({k:x[k] for k in ("model","completed","wins","conditionalWinratePct","M5CloseMarkedDDPct","priorCompletedPeakHighStressDDPct","finalNAVYen","p38BlockedAdditional","cohortResults","originalTradeChange")},ensure_ascii=False))
    print("VIABLE_IN_SAMPLE_ONLY",viable)
    print("FILES",OUT,LEDGER,NOTE)
if __name__=="__main__":main()
