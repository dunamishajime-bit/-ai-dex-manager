#!/usr/bin/env python3
"""All8 integrated BT, risk-control proposal, and replay integrity checks."""
from pathlib import Path
import json,hashlib,math
here=Path(__file__).resolve().parent
d=here.parents[1]/"docs/research/results/v12-v4-long-route-risk-20261021"
report=json.loads((d/"V12_V4_LONG_AFTER_PLUS2_MINUS5_VERIFIED_BT_20261021.json").read_text("utf8"))
proof=json.loads((d/"V12_V4_LONG_PLUS2_TO_MINUS5_SHA_PROOF_20261021.json").read_text("utf8"))
assert report["status"]=="8LOGIC_BT_VERIFIED_RESEARCH_ONLY_X3_MINUS5_NO_EXTRA_EXIT"
assert report["scriptSha256"]==hashlib.sha256((here/"run-task9-v4-long-after2-stopminus5-20261021.py").read_bytes()).hexdigest()
assert proof["status"]=="PASS_10_OF_10" and len(proof["ledgers"])==10
assert not proof["realExchangeVenueCertified"] and not proof["independentNewTask9EngineParity"]
assert report["stopRule"]["mfeArmPct"]==2.0
assert report["stopRule"]["candidateStopPctFromEntry"]==-5.0
assert report["stopRule"]["currentTimeRouteEmergencyStopPctFromEntry"]==-8.0
assert not any(report["liveMutation"].values())
assert len(report["cases"])==4
for cost in ("10","30"):
 base=report["reference"]["baseline"][cost]
 selected=report["reference"]["selectedPlus3ToPlus1"][cost]
 x3=report["cases"]["X3_AFTER2_STOP_MINUS5"]["costs"][cost]
 assert x3["finalEquityJpy"]==selected["finalEquityJpy"]
 assert x3["maxMtmDdPct"]==selected["maxMtmDdPct"]
 for name,row in report["cases"].items():
  x=row["costs"][cost]
  assert x["accounting"]=="PASS"
  assert math.isclose(x["maxMtmDdPct"]-base["maxMtmDdPct"],x["ddImprovementPp"],abs_tol=1e-8)
 assert report["cases"]["TIME37_AFTER2_STOP_MINUS5"]["costs"][cost]["finalEquityJpy"]<selected["finalEquityJpy"]
 assert report["cases"]["TIME37_AFTER2_STOP_MINUS5"]["costs"][cost]["historicalLosersImproved"]==0
assert report["cases"]["X3_AFTER2_STOP_MINUS5"]["rule"]["routes"]==[
 "REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H"]
print("PASS 4 full8 cases x 10/30bps, -5% rule, selected profit baseline, SHA replay 10/10, no LIVE mutation")
