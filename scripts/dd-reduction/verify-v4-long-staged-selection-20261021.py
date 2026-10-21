#!/usr/bin/env python3
"""Fail-closed validation of user-selected plus3 plus1 and rejected plus2 fallbacks."""
import json,hashlib,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
DOC=HERE.parents[1]/"docs/research/results/v12-v4-long-route-risk-20261021"
F=DOC/"V12_V4_LONG_SELECTED_PLUS3_PLUS1_AND_PLUS2_BACKUP_20261021.json"
result=json.loads(F.read_text("utf8"))
source=HERE/"run-task9-v4-long-staged-profit-20261021.py"
assert result["status"]=="USER_SELECTED_PLUS3_TO_PLUS1_RESEARCH_ONLY__PLUS2_BACKUPS_REJECTED"
assert hashlib.sha256(source.read_bytes()).hexdigest()==result["sourceScriptSha256"]
assert not result["emergencyStopVerifiedVenueNow"]
assert not result["selectedProfitFloorGuaranteedByH1Only"]
assert result["existingPinnedEmergencyStopPriceRatioLong"]==0.92
assert all(v == 0 for k,v in result["operation"].items() if k in ("orders","cancels","positions"))
assert not result["operation"]["productionChanged"]
assert not result["operation"]["vpsChanged"]
selected=result["selectedPolicy"]
rule=selected["rule"]
assert rule["id"]=="PROFIT_X_3P0_FLOOR1P0_BEAR2"
assert rule["mfe_gte"]==.03 and rule["close_floor"]==.01 and rule["bear_bars"]==2
assert rule["sides"]==["LONG"]
assert set(rule["routes"])==set(("REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H"))
assert len(result["stagedCases"])==3
for cost in ("10","30"):
 baseline=result["baseline"][cost]["finalEquityJpy"]
 sc=selected["costs"][cost]
 assert sc["accounting"]=="PASS"
 assert sc["ddImprovementPp"]==0
 assert sc["originalLosersImproved"]==0 and sc["originalWinnersExitedEarly"]==1
 assert sc["finalEquityJpy"]<baseline
 for name,item in result["stagedCases"].items():
  row=item["costs"][cost]
  assert row["accounting"]=="PASS",(name,cost)
  assert math.isclose(row["finalEquityJpy"]/baseline,row["equityRetention"],rel_tol=1e-12),(name,cost)
  assert math.isclose(row["maxMtmDdPct"]-result["baseline"][cost]["maxMtmDdPct"],row["ddImprovementPp"],abs_tol=1e-8),(name,cost)
  assert row["admittedLongStopExits"]>=row["originalLosersImproved"]+row["originalWinnersExitedEarly"]
for name,item in result["stagedCases"].items():
 assert item["economicDDGateBothCosts"] is False,name
 assert item["policy"]["mode"]=="staged_profit_h1"
 assert item["policy"]["mfe_gte"]==.03 and item["policy"]["close_floor"]==.01
 assert item["policy"]["early_mfe_gte"]==.02
print("PASS selected +3/+1 10bps/30bps economics, 3 staged rejected, fail closed/no live mutation")
