#!/usr/bin/env python3
"""Verify V4 four rules are never removed and all Q102 cases have real full8 accounting."""
from __future__ import annotations
from pathlib import Path
import json,hashlib,math
repo=Path(__file__).resolve().parents[2]
docs=repo/"docs/research/results/v4-locked-cumulative-next-q102-20261021"
base=json.loads((docs/"V12_V4_USER_ADOPTED_FOUR_RULE_CUMULATIVE_BASELINE_20261021.json").read_text("utf8"))
q=json.loads((docs/"Q102_6_CANDIDATES_AFTER_V4_LOCKED_BT_20261021.json").read_text("utf8"))
assert base["status"]=="PINNED_CUMULATIVE_RESEARCH_BT_BASELINE_NOT_LIVE"
assert q["status"]=="V4_FOUR_ADOPTED_LOCKED_Q102_6_RESEARCH_CASES_COMPLETE_NO_Q102_ADOPTION"
assert base["lockedInSubsequentQ102Trials"] is True
assert q["V4AlreadyAdoptedAndNeverReverted"] is True
contract=json.loads((repo/"config/research/v12-v4-long-short-4rules-20261021.json").read_text("utf8"))
assert contract["status"]=="FORMALLY_ADOPTED_FOR_ALL_FUTURE_BT_NOT_LIVE"
assert contract["researchAdoption"]["isCanonicalCumulativeBaseline"] is True
assert contract["researchAdoption"]["futureBacktestsMustCarryAllFourV4Rules"] is True
assert contract["researchAdoption"]["q102ExtraRuleAdopted"] is False
assert contract["verification"]["full4RulesCombined8LogicEconomicBt"]=="COMPLETE_8LOGIC_NATIVE_PRICE_MODEL_10_AND_30_BPS"
assert contract["verification"]["productionDeployed"] is False
assert q["frozenHandoffSha"]=="4081eb37fe23f884a4d1fa93e2b608e388bf7071"
assert len(q["results"])==6 and q["Q102NewAdditionsAdopted"]==[]
sha=hashlib.sha256((repo/"scripts/dd-reduction/run-v4-locked-next-q102-20261021.py").read_bytes().replace(b"\r\n",b"\n")).hexdigest()
assert q["researchEngineSourceSha256"]==sha,"SRC_SHA_DRIFT"
for cost in ("10","30"):
 b=base["baseline"][cost]
 assert q["V4LockedBaseline"][cost]["finalEquityJpy"]==b["finalEquityJpy"]
 assert q["V4LockedBaseline"][cost]["maxMtmDdPct"]==b["maxMtmDdPct"]
 assert b["accounting"]=="PASS"
 assert b["cooldownModel"]=="ADMITTED_FILL_FIXED_POINT"
 assert len(b["cooldownPasses"])==3
 for name,case in q["results"].items():
  rec=case["costs"][cost]
  assert rec["accounting"]=="PASS"
  assert rec["cooldownModel"]=="ADMITTED_FILL_FIXED_POINT"
  assert len(rec["cooldownPasses"])==3
  assert rec["cooldownPasses"][-1]["observedAdmittedInitialShortStops"]==rec["cooldownPasses"][-1]["enforcedPriorCooldownEventCount"]
  assert math.isclose(rec["maxMtmDdPct"]-b["maxMtmDdPct"],rec["deltaDrawdownVsLockedPp"],abs_tol=1e-8)
  assert math.isclose(rec["finalEquityJpy"]/b["finalEquityJpy"],rec["equityRetentionVsLocked"],abs_tol=1e-12)
  assert rec["addedQ102Exits"]>=0
assert not any(case["passesBothCostDDGate0p1Pp"] for case in q["results"].values())
assert q["results"]["Q102_PROFIT_ARM2_FLOOR0P5"]["costs"]["10"]["addedQ102Exits"]==0
assert q["results"]["Q102_PROFIT_ARM2_FLOOR0P5"]["costs"]["30"]["addedQ102Exits"]==0
assert q["results"]["Q102_HV_LONG_INIT2P5_6H"]["costs"]["10"]["addedQ102Exits"]==0
assert all(q["results"]["Q102_INIT_2P5_6H_MFE0P5"]["costs"][c]["deltaDrawdownVsLockedPp"]<0 for c in ("10","30"))
assert all(q["results"]["Q102_INIT_2P5_12H_MFE1"]["costs"][c]["deltaDrawdownVsLockedPp"]<0 for c in ("10","30"))
print("PASS V4 4-rule frozen baseline and 6 Q102 changes × 10/30bps, confirmed M5 close profit, accepted-stop cooldown, no new Q102 adopted")
