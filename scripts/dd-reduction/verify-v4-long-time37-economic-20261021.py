#!/usr/bin/env python3
"""Fail-closed economic and safety-evidence verifier for TIME37 LONG guard research."""
from pathlib import Path
import hashlib,json,math
HERE=Path(__file__).resolve().parent
d=HERE.parents[1]/"docs/research/results/v12-v4-long-route-risk-20261021"
r=json.loads((d/"V12_V4_LONG_TIME37_PLUS2_RESIDENT_LIKE_COMPARISON_20261021.json").read_text("utf8"))
cat=d/"V12_V4_LONG_FROZEN_TIME37_ROUTE_CATALOG_20261021.json"
src=HERE/"run-task9-v4-long-time37-profit-stop-20261021.py"
assert r["status"]=="RESEARCH_COMPLETED_NO_NEW_PLUS2_STOP_ACCEPTED"
assert r["scenarioCount"]==5 and r["costCases"]==10
assert hashlib.sha256(src.read_bytes()).hexdigest()==r["runnerSha256"]
assert hashlib.sha256(cat.read_bytes()).hexdigest()==r["catalogSha256"]
time=json.loads(cat.read_text("utf8"))["routes"]
assert len(time)==len(set(time))==37
assert r["allTimeRoutesCount"]==37
assert r["liveState"]=={'runnerUntouched': True,'ordersUntouched': True,'stopOrdersUntouched': True}
assert r["adoptionDecision"]["newLiveStop"]=="NOT_DEPLOYED"
assert not r["sourceResearch"]["venueFillCertified"]
assert not r["sourceResearch"]["newTask9EngineParity"]
assert r["existingApprovedResearchOnlyPrimary"]["venueProfitGuarantee"] is False
assert set(r["existingApprovedResearchOnlyPrimary"]["routes"])==set(("REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H"))
for cost in ("10","30"):
 b=r["baseline"][cost]
 for name,x in r["scenarios"].items():
  a=x["costs"][cost]
  assert a["accounting"]=="PASS",(name,cost)
  assert math.isclose(a["ddImprovementPp"],a["maxMtmDdPct"]-b["maxMtmDdPct"],abs_tol=1e-8),(name,cost)
  assert math.isclose(a["equityRetention"],a["finalEquityJpy"]/b["finalEquityJpy"],rel_tol=1e-12),(name,cost)
  assert a["admittedEarlyExits"]>=a["originalLosersImproved"]+a["originalWinnersExitedEarly"]
for name,x in r["scenarios"].items():
 assert not x["passesDoubleCostDD0p1pp"],name
 assert x["rule"]["strategy"]=="V12" and x["rule"]["sides"]==["LONG"]
 assert len(x["rule"]["routes"]) in (3,37)
print("PASS TIME37 full8 cost10+cost30 accounting, 5 candidates, catalog SHA, code SHA, no unapproved live promotion")
