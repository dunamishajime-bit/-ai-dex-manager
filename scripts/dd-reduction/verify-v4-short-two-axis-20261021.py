#!/usr/bin/env python3
"""Fail closed on mismatched shortlist economics, archive, replay and acceptance claims."""
import json,hashlib,math
from pathlib import Path
here=Path(__file__).resolve().parent
d=here.parents[1]/"docs/research/results/v12-v4-short-risk-20261021"
summary=json.loads((d/"V12_V4_SHORT_TWO_AXIS_ECONOMIC_BT_20261021.json").read_text("utf8"))
proof=json.loads((d/"V12_V4_SHORT_TWO_AXIS_REPEAT_SHA_20261021.json").read_text("utf8"))
assert summary["status"]=="V4_SHORT_TWO_AXIS_FULL8_PRICE_MODEL_COMPLETE_RESEARCH_ONLY"
assert summary["sourceScriptSha256"]==hashlib.sha256((here/"run-task9-v4-short-two-axis-20261021.py").read_bytes()).hexdigest()
assert len(summary["profitCandidates"])==6
assert proof["sha256Matched"]==10 and len(proof["ledgerEntries"])==10
assert not proof["signedVenueCertified"] and not proof["productionModified"]
assert summary["leadingCandidateId"]=="SHORT_BOTH_2P5_AND_5P_TO_2P"
assert summary["independentTask9TsAllocatorParity"] is False
assert summary["signedLiveVenueCertification"] is False
assert summary["productionModified"] is False
assert summary["liveOrdersModified"] is False
for cost in ("10","30"):
 b=summary["baseline"][cost]
 i=summary["initial2p5Stop12hCooldown12hAnchor"][cost]
 selected=summary["profitCandidates"][summary["leadingCandidateId"]]["costs"][cost]
 assert selected["accounting"]=="PASS"
 assert selected["shortExitCount"]>50
 assert selected["ddImprovementPp"]>1
 assert selected["maxMtmDdPct"]>b["maxMtmDdPct"]
 assert math.isclose(selected["maxMtmDdPct"]-b["maxMtmDdPct"],selected["ddImprovementPp"],abs_tol=1e-8)
 assert selected["finalEquityJpy"]<i["finalEquityJpy"]
 for name,sc in summary["profitCandidates"].items():
  r=sc["costs"][cost]
  assert r["accounting"]=="PASS"
  assert math.isclose(r["maxMtmDdPct"]-b["maxMtmDdPct"],r["ddImprovementPp"],abs_tol=1e-8)
  assert r["shortExitCount"]>=r["baselineLosersImproved"]
assert summary["profitCandidates"]["SHORT_BOTH_2P5_AND_5P_TO_2P"]["costs"]["30"]["maxMtmDdPct"] < summary["initial2p5Stop12hCooldown12hAnchor"]["30"]["maxMtmDdPct"]
assert summary["profitCandidates"]["SHORT_BOTH_2P5_AND_5P_TO_2P"]["costs"]["30"]["finalEquityJpy"]/summary["baseline"]["30"]["finalEquityJpy"] < .75
print("PASS V4 SHORT two-axis 6x2 source-model economics, 10/10 independent ledger hashes, 30bps acceptance FAIL, LIVE untouched")
