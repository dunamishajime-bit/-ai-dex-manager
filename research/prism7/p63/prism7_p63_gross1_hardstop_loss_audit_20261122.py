#!/usr/bin/env python3
"""PRISM VII P63: original pinned Native V20 hard-STOP loss concentration,
Gross .75 vs 1.00 one-slot unchanged Native entry/exits, source M5 DD and cost stress.
Research only, NO actual order, risk configuration, STOP or LIVE change.
"""
from __future__ import annotations
import hashlib,json
from pathlib import Path
from collections import Counter,defaultdict
from prism7_p38_causal_multihorizon_entry_20261122 import SOURCES
from prism7_native53_event_attribution_20261122 import load_m5
from prism7_p44_native53_pre_drop_context_source_exit_20261122 import source_slot,economy
import prism7_p44_native53_pre_drop_context_source_exit_20261122 as mod44
R=Path(__file__).resolve().parent.parent/"results"
SOURCE=R/"PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json"
P40=R/"PRISM7_P40_ORIGINAL_NATIVE53_LOSS_ANATOMY_20261122.json"
P44=R/"PRISM7_P44_NATIVE53_PRE_DROP_CONTEXT_0P75_SINGLE_SLOT_20261122.json"
OUT=R/"PRISM7_P63_GROSS1_NATIVE53_HARD_STOP_LOSS_AND_DD_AUDIT_20261122.json"
MD=R/"PRISM7_P63_GROSS1_NATIVE53_HARD_STOP_LOSS_AND_DD_AUDIT_20261122.md"
SHA="1657e173d250ad58f53e62f7bb0a3428fb405496"
def hash_file(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rnd(n):return round(float(n),6)
def main():
 native=json.loads(SOURCE.read_text(encoding="utf8"))
 diag=json.loads(P40.read_text(encoding="utf8"))
 p44=json.loads(P44.read_text(encoding="utf8"))
 assert len(native)==53 and sum(x["net30pct"]>0 for x in native)==29
 assert diag["sourceNative53Losses"]==24 and diag["sourceNative53Wins"]==29
 for x in native:
  assert x["parity"]=="EXACT" and x["native_short_signal"]
  assert abs(100*(1-x["exitPrice"]/x["entryPrice"])-.3-x["net30pct"])<1e-7
 all_loss=[x for x in native if x["net30pct"]<0]
 hard=[x for x in all_loss if x["exitReason"]=="SHORT_HARD_STOP"]
 assert len(all_loss)==24 and len(hard)==14
 assert all(abs(x["net30pct"]+8.3)<1e-8 for x in hard)
 all_loss_abs=-sum(z["net30pct"] for z in all_loss)
 hard_loss_abs=-sum(z["net30pct"] for z in hard)
 assert abs(hard_loss_abs-116.2)<1e-6
 row={
  "naturalSource53":53,"winners":29,"losers":24,
  "losingHardStops":len(hard),"losingMaxHold":len(all_loss)-len(hard),
  "hardStopNet30PercentPerOriginalNotional":-8.3,
  "allLossNet30NotionalPctPoints":rnd(-all_loss_abs),
  "hardStopNet30NotionalPctPoints":rnd(-hard_loss_abs),
  "hardStopShareOfLossMagnitudePct":rnd(100*hard_loss_abs/all_loss_abs),
  "hardStopNaturalSourceKeys":[x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]) for x in hard],
  "mustNotLoosenHardStop":True,
 }
 source=[{"key":x["period"]+"|"+x["id"]+"|"+str(x["entryTs"]),
   "id":x["id"],"period":x["period"],"entryTs":x["entryTs"],
   "entryPrice":x["entryPrice"],"exitTs":x["exitTs"],
   "exitPrice":x["exitPrice"],"sourceExitReason":x["exitReason"],
   "sourceNativeNet30Pct":x["net30pct"]} for x in native]
 slot,skipped=source_slot(source)
 assert len(slot)==33 and len(skipped)==20
 loss_slot=[x for x in slot if x["sourceNativeNet30Pct"]<0]
 hard_slot=[x for x in loss_slot if x["sourceExitReason"]=="SHORT_HARD_STOP"]
 assert len(loss_slot)==15 and len(hard_slot)==8
 slot_loss_abs=-sum(z["sourceNativeNet30Pct"] for z in loss_slot)
 slot_hard_abs=-sum(z["sourceNativeNet30Pct"] for z in hard_slot)
 row_slot={
  "oneSlotPositionCount":33,"wins":18,"losers":15,
  "hardStops":8,"allSingleSlotLossNet30PctPoints":rnd(-slot_loss_abs),
  "hardStopLossNet30PctPoints":rnd(-slot_hard_abs),
  "hardStopShareOfLossMagnitudePct":rnd(100*slot_hard_abs/slot_loss_abs),
  "sourceHardStopLossIds":[x["key"] for x in hard_slot],
  "replayOriginalNativeSource53Retained":True,
  "sourceGross0p75ClaimDoesNotAutomaticallyExtendTo1p0":True
 }
 prices,hashes=load_m5(SOURCES)
 grid=[]
 for gross in (.5,.75,1.0,1.25):
  mod44.GROSS=gross
  for fee,slip in ((10,0),(30,0),(30,100)):
   econom=economy(slot,prices,fee,slip)
   grid.append({"gross":gross,"feeBps":fee,"extraBuyCoverSlipBps":slip,
      "originalSource53NaturalSignals":53,"sourceSingleSlotClosed":33,
      "originalSourceStop8PctNeverChanged":True,
      "nativeSourceExitPricesAndTimesUnchanged":True,
      "econ":econom})
 selected=[x for x in grid if x["feeBps"]==30 and x["extraBuyCoverSlipBps"]==0]
 g075=next(z for z in selected if z["gross"]==.75)
 g10=next(z for z in selected if z["gross"]==1.0)
 stress=next(z for z in grid if z["gross"]==1.0 and z["feeBps"]==30 and z["extraBuyCoverSlipBps"]==100)
 assert (g075["econ"]["wins"],g10["econ"]["wins"])==(18,18)
 assert abs(g075["econ"]["finalNAVYen"]-14193.07)<.001
 assert abs(g075["econ"]["M5HighStressMarkedDDPct"]-25.10029)<1e-5
 assert abs(g10["econ"]["M5HighStressMarkedDDPct"]-32.11305)<1e-5
 assert abs(g10["econ"]["finalNAVYen"]-15557.46)<.001
 assert abs(stress["econ"]["M5HighStressMarkedDDPct"]-37.11247)<1e-5
 report={
  "schema":"prism7-p63-pinned-native53-original-stop-loss-concentration-vs-1gross/v1",
  "status":"RESEARCH_ONLY_NO_PRODUCTION_GROSS_CHANGE",
  "sourceNativePinnedSHA":SHA,
  "fixedSource53OriginalNativeEntriesAndExitsExactNet30Parity53of53":True,
  "sourceNativeLossConcentration":row,
  "chronologicalOriginalOneSlot33LossConcentration":row_slot,
  "grossAndFeeStressGrid":grid,
  "baselineGross075":g075,
  "scenarioGross1":g10,
  "scenarioGross1AdditionalCover100bps":stress,
  "stopBeforeMaxLossMechanismRequiredNotStopRelaxation":True,
  "newGross1LiveAllowed":False,
  "riskGateDD20FailedAtGross1":True,
  "allSourceNativeOriginalProfitExitsRetained":True,
  "dataSHA256":{"Native53":hash_file(SOURCE),"P40":hash_file(P40),
     "P44":hash_file(P44),"M5":hashes},
  "limitations":[
   "Source original 53 cases overlap and do not represent 53 actual independent fills; original one-slot admits 33 proxy positions.",
   "Native53 hard-stop -8.3% represents source configured 8% protective hard exit plus 30bps fee. Cannot treat stops as defect without verifying their trigger and preventing worse tail losses.",
   "Gross change may alter shared gross, other runners, account margin, liquidation risk, daily loss thresholds: ALL ABSENT FROM RESEARCH MODEL.",
   "Research M5 prior high/close DD marks and source native H1 exits are not actual signed fills, exchange STOP sequencing or true portfolio DD.",
   "Slippage +100bps is applied to hypothetical cover price for every source exit as severe stress, not measured actual market impact.",
   "A model that avoids hindsight-labeled hard-stop losses will leak the future outcome; design a prospective, as-of state machine then independently validate.",
   "Earlier P59 6h/12h no-progress thresholds had low winner retention; automatic early exit cannot be promoted from the historical source.",
   "No new unseen original Aster venue data available and no future non-overfit verification.",
   "Original production Runner, positions, orders, STOP, Kill Switch, GitHub master, gross policy were not accessed or changed."
  ]
 }
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 md=["# P63 — Native V20: Gross 1.0 proposal vs hard-stop loss concentration",
 "",
 "Original source SHA "+SHA+", original source53 29 wins/24 losses; per original 53 source 14 HARD_STOP losses, each -8.3% at 30bps. HARD_STOP contributed "+str(rnd(row["hardStopShareOfLossMagnitudePct"]))+"% of all losing notional return magnitude; time exits contribute the remainder.",
 "",
 "One-slot independent overlapping price model selects 33 source trade intents (18 wins 15 losses) and 8 hard stops; hard stop loss share "+str(rnd(row_slot["hardStopShareOfLossMagnitudePct"]))+"% of original33 losers' notional-loss magnitude.",
 "",
 "| Gross | Fee | Cover extra | Wins / closed | M5 high DD | Final NAV JPY |",
 "|---|---:|---:|---:|---:|---:|"]
 for z in grid:
  e=z["econ"]
  md.append("| "+str(z["gross"])+" | "+str(z["feeBps"])+"bps | "+str(z["extraBuyCoverSlipBps"])+"bps | "+str(e["wins"])+"/"+str(e["singleSlotPositions"])+" | "+str(e["M5HighStressMarkedDDPct"])+"% | "+str(e["finalNAVYen"])+" |")
 md+=["","**Decision:** Gross 1.0 in unchanged original native model increases 30bps DD 25.10% to 32.11%, and +100bps buy-cover stress to 37.11%. Gross1 should be a RESEARCH TARGET, not deployed.",
 "","Refocus on loss-tail and STOP trigger fidelity while preserving rare large native wins. Do NOT widen/remove 8% emergency hard stop. Model ex-ante failed rebound / trend regime change and test damage containment BEFORE native protective hard stop, with venue M5/STOP fill priority. Evaluate DD <=20%, compound NAV >= original and robust fees, not win-rate alone.",
 "","This is no LIVE action, no real account DD, signed fills or shared multi-runner gross. Research artifacts only.",""]
 MD.write_text("\n".join(md),encoding="utf8")
 print("P63_GROSS1_HARDSTOP_LOSS_CONCENTRATION_SOURCE33_PARITY_PASS",
  json.dumps({"naturalSource53":row,"fixedSlot33":row_slot,
   "gross075":{k:g075["econ"][k] for k in ("wins","conditionalWinPct","M5HighStressMarkedDDPct","finalNAVYen")},
   "gross1":{k:g10["econ"][k] for k in ("wins","conditionalWinPct","M5HighStressMarkedDDPct","finalNAVYen")},
   "gross1Cover100DD":stress["econ"]["M5HighStressMarkedDDPct"]},ensure_ascii=False),flush=True)
 print("FILES",OUT,MD)
if __name__=="__main__":main()
