#!/usr/bin/env python3
"""Fail closed verification of 2026-10-21 non-production V4 LONG study."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]/"docs/research/results/v12-v4-long-route-risk-20261021"
raw=json.loads((ROOT/"V12_V4_LONG_ROUTE_DD_SUMMARY_20261021.json").read_text("utf8"))
repeat=json.loads((ROOT/"V12_V4_LONG_INDEPENDENT_REPLAY_SHA_PROOF_20261021.json").read_text("utf8"))
require=lambda c,label: None if c else (_ for _ in ()).throw(AssertionError("RESEARCH_EVIDENCE_FAIL_CLOSED:"+label))
require(raw["status"]=="RESEARCH_ONLY_NO_DD_IMPROVING_CANDIDATE","wrong status")
require(raw["liveChanged"] is False,"LIVE flag")
require(raw["signedVenueStopParity"] is False,"venue false claim")
require(raw["independentTypeScriptAllocatorParity"] is False,"independent TS false claim")
require(len(raw["cases"])==8,"8 cases")
for cost,anchor in [("10",(222818966.87803495,-15.62063681288941,1310)),
                     ("30",(124289206.81827945,-16.78776877493442,1307))]:
 b=raw["baseline"][cost]
 require(abs(b["finalEquityJpy"]-anchor[0])<.001 and abs(b["maxMtmDdPct"]-anchor[1])<1e-6
         and b["closedTrades"]==anchor[2],"baseline drift "+cost)
 for name,record in raw["cases"].items():
  x=record["costs"][cost]
  require(x["accounting"]=="PASS","accounting:"+name+cost)
  require(abs(x["ddImprovementPp"]-(x["maxMtmDdPct"]-anchor[1]))<1e-6,"dd diff:"+name+cost)
  require(abs(x["equityRetention"]-x["finalEquityJpy"]/anchor[0])<1e-12,"equity diff:"+name+cost)
for name,record in raw["cases"].items():
 require(record["gate"]["passesExploratoryGate"] is False,"unapproved adoption:"+name)
require(repeat["compared"]==20 and repeat["exactMatches"]==20,"SHA count")
require(len(repeat["files"])==20 and all(len(v["sha256"])==64 for v in repeat["files"]),"SHA validity")
actual=hashlib.sha256((Path(__file__).with_name("run-task9-v4-long-route-risk-20261021.py")).read_bytes()).hexdigest()
require(raw["scriptSha256"]==actual,"runner source hash drift")
print("PASS V4 LONG research compact, 8 rejected candidates, accounting, 20/20 independent ledger SHA receipts")
