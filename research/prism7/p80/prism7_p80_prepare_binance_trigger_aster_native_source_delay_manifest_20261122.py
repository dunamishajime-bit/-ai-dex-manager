#!/usr/bin/env python3
"""P80 create frozen source entry decisions for latency 0/5/15m M5-native replays.

Contains 53 original ASTER source entrants and 57 independent Binance signal
entrants, each with ASTER venue source entry open and source modeled native exit.
Must not contaminate ASTER source return with Binance original exit.
"""
from __future__ import annotations
from pathlib import Path
import json,hashlib
from prism7_p42_pre_onset_first_downleg_hybrid_20261122 import R,SOURCE
from prism7_p73_no025_dualmarket_score_veto_half_full_20261122 import allocation
A=R/"PRISM7_P71_DUAL_MARKET_SIGNED_TF_POINTS_NATIVE53_20261122.json"
B=R/"PRISM7_P78_BINANCE_NATIVE_ENTRY_EXECUTE_ASTER_PINNED_NATIVE_EXIT_20261122.json"
F=R/"PRISM7_P75_BINANCE_NATIVE62_SAME_UTC_DUAL_POINTS_NO025_TRANSFER_20261122.json"
OUT=R/"PRISM7_P80_AST_BIN_TRIGGER_ASOF_NO025_M5_DELAY_ENTRY_MANIFEST_20261122.json"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 a=json.loads(A.read_text(encoding="utf8"))
 b=json.loads(B.read_text(encoding="utf8"))
 f=json.loads(F.read_text(encoding="utf8"))
 assert b["originalAsterNative53Parity"]=="PASS_53_OF_53"
 ia={z["entryTs"]:z for z in a["crossVenueSourceCaseAsOfScoreLedger53"]}
 ib={z["entryTs"]:z for z in f["independentSource62DualMarketAsOfFeatureLedger"]}
 inputs=[]
 for z in a["crossVenueSourceCaseAsOfScoreLedger53"]:
  inputs.append({"key":z["key"],"source":"ASTER_NATIVE_SOURCE",
    "period":z["cohort"],"entryTs":z["entryTs"],"sourceEntryPrice":z["entryPrice"],
    "sourceNativeExitTs":z["exitTs"],"sourceNativeExitPrice":z["exitPrice"],
    "sourceNativeNet30Pct":z["sourceNativeNet30Pct"],
    "sameHourBothOriginalSignals":z["entryTs"] in ib,
    "dualSigned":z["dualSigned"],
    "sizePolicies":{"GROSS_075":.75,
     "P73_CONDITIONAL_HALF_OR_SKIP":allocation("MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",z)}})
 for z in b["exactSourcePriceCounterfactualEvents"]:
  assert z["asterHypotheticalExitStatus"]=="NATIVE_EXIT_MODELED"
  scored=ib[z["binanceEntryTs"]]
  assert scored["entryTs"]==z["binanceEntryTs"]
  inputs.append({"key":"BINANCE_SIGNAL|"+z["binanceNativeSignalID"]+"|"+str(z["binanceEntryTs"]),
    "source":"BINANCE_NATIVE_SOURCE_EXECUTE_ASTER",
    "period":z["period"],"entryTs":z["binanceEntryTs"],
    "sourceEntryPrice":z["asterHypotheticalEntryPrice"],
    "sourceNativeExitTs":z["asterHypotheticalExitTs"],
    "sourceNativeExitPrice":z["asterHypotheticalExitPrice"],
    "sourceNativeNet30Pct":z["asterHypotheticalNet30Pct"],
    "sameHourBothOriginalSignals":z["asterOriginalNativeWouldSignal"],
    "dualSigned":scored["dualSigned"],
    "sizePolicies":{"GROSS_075":.75,
     "P73_CONDITIONAL_HALF_OR_SKIP":allocation("MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT",scored)}})
 assert len(inputs)==110
 assert sum(z["source"]=="ASTER_NATIVE_SOURCE" for z in inputs)==53
 assert sum(z["source"]=="BINANCE_NATIVE_SOURCE_EXECUTE_ASTER" for z in inputs)==57
 assert sum(z["sameHourBothOriginalSignals"] and z["source"].startswith("BINANCE") for z in inputs)==27
 assert all(g in (0,.5,.75,1.) for z in inputs for g in z["sizePolicies"].values())
 assert len({z["key"] for z in inputs})==110
 out={"schema":"prism7-p80-aster-native-exit-reprice-binance-triggers-M5-delay-manifest/v1",
  "pinnedOriginalNativeSourceSHA":"1657e173d250ad58f53e62f7bb0a3428fb405496",
  "researchOnly":True,"sourceAsterH1OpenEntryFromP78NativeParityPass":True,
  "sourceAster53AndBinanceTriggeredAster57":True,
  "gross025Excluded":True,"delayMinutesModels":[0,5,15],
  "allowedGross":[0,.5,.75,1.],
  "all110OriginalSourceMarketEntryDecisions":inputs,
  "referenceSourceSHA256":{"P71":sha(A),"P78":sha(B),"P75":sha(F)},
  "limitations":["Transport latency 5/15m is modeled as first positive M5 print at or later than given UTC offset. The first M5 print price is a proxy, not signed fill.",
    "ASTER source H1 native features pinned and original Aster 53 pure exits already exact parity in P78. Source stop is re-evaluated after altered entry time/price using P14 M5 positive-volume event-time proxy, so can legitimately differ from original source H1 exit.",
    "Only source as-of at Binance native signal time; no future PENGU/BTC outcome used for filtering.",
    "Native return gross sizing VOL_TARGET state may differ if grossFloor or cap reached; gross .5 and .75 are independent native state replays.",
    "No production changes or native venue signed fills, account Shared Risk, funding, orderbook or STOP lifecycle."]}
 OUT.write_text(json.dumps(out,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 print("P80_PREPARED_SOURCE110",json.dumps({"AST":53,"BIN":57,"shared":27,"macroHalfSourceAST":sum(z["sizePolicies"]["P73_CONDITIONAL_HALF_OR_SKIP"]==.5 for z in inputs if z["source"]=="ASTER_NATIVE_SOURCE"),"macroHalfSourceBIN":sum(z["sizePolicies"]["P73_CONDITIONAL_HALF_OR_SKIP"]==.5 for z in inputs if z["source"].startswith("BINANCE"))}),flush=True)
 print("FILE",OUT)
if __name__=="__main__":main()
