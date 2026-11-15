"""BT-481-H2: full seven-family observation archive causal and fidelity checks.
Always test the compressed provenance output after rebuilding it from sources.
"""
import copy
import gzip
import hashlib
import importlib.util
import json
import sys
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
REPORTS=ROOT/"reports"/"bt-verification"
PREFIX="BT_PR481_H2_7_FAMILY_CAUSAL_OBSERVATIONS_20261116_V1"
manifest=json.loads((REPORTS/(PREFIX+".manifest.json")).read_text(encoding="utf-8"))
archive=(REPORTS/(PREFIX+".json.gz")).read_bytes()
assert hashlib.sha256(archive).hexdigest()==manifest["archiveSha256"]
canonical=gzip.decompress(archive).decode("utf-8")
ledger=json.loads(canonical)
assert canonical==json.dumps(ledger,sort_keys=True,ensure_ascii=False,separators=(",",":"))+"\n"
sha=ledger["sha256"]
base={k:v for k,v in ledger.items() if k!="sha256"}
assert hashlib.sha256(json.dumps(base,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()==sha
assert sha==manifest["sourceLedgerSha256"]
assert manifest["cutoffUtc"]=="2025-10-23T00:00:00+00:00"
assert ledger["schema"]=="bt-pr481-causal-candidate-ledger-v1"
assert len(ledger["observations"])==8260
assert manifest["nativeProbeCounters"]=={
 "h1":528,"h2":204,"q102S34Raw":215,"q102S34Gated":0,
 "q102HVThresholds":84,"v4Events":3,"hypeCandidates":5,
 "penguCandidates":11,"idleCandidates":4,"fetCandidates":0}
assert ledger["familyCounts"]=={
 "FET":114,"HYPE":504,"IDLE":2280,"PENGU":349,
 "Q102":2327,"V4":2655,"V52":31}
assert ledger["stageCounts"]=={
 "ENTRY_VERIFIED":0,"FEATURE_ONLY":8206,
 "RESEARCH_RULE_SELECTED":0,"SOURCE_CANDIDATE":54}
assert ledger["execution"]=={
 "orders":0,"fills":0,"positions":0,"gross":None,"pnl":None}
assert manifest["sourceEntryAdmitted"] is False
assert manifest["liveParityVerified"] is False
assert manifest["observedPortfolioGross"] is None
assert manifest["observedPnL"] is None
assert set(ledger["sourceManifest"])=={
 "V4","Q102","PENGU","FET","IDLE","V52","HYPE"}
assert len(ledger["sourceManifest"]["Q102"])==2
assert hashlib.sha256((ROOT/"lib/bt-verification/h48-research-sandbox.ts").read_bytes()).hexdigest()==ledger["sourceManifest"]["HYPE"]
assert ledger["sourceManifest"]["V52"]=="5f7b5299b50ac2b85bfab6cef1dd746d7e114ce70c442f5f6fcadbe47dc78762"
stage_v52=[r for r in ledger["observations"] if r["family"]=="V52"]
assert len(stage_v52)==31
assert all(r["stage"]=="SOURCE_CANDIDATE" and r["runner"]=="V52_V50_NATIVE_DUAL_SOURCE_FIXTURE" for r in stage_v52)
assert all(r["availableAtTs"]-r["eventTs"]==10000 for r in stage_v52)
assert all(r["decision"] in {"LONG","SHORT"} for r in stage_v52)
assert all(r["family"]!="Q102" or
  r["sourceSha256"]!=ledger["sourceManifest"]["Q102"][0] or
  r["stage"] in ("FEATURE_ONLY","SOURCE_CANDIDATE")
  for r in ledger["observations"])
assert all(r["stage"]=="FEATURE_ONLY" for r in ledger["observations"]
  if r["family"]=="Q102" and r["runner"]=="Q102_S1S2_UNTRAINED_FEATURE_ONLY")
assert all(r["stage"]!="ENTRY_VERIFIED" for r in ledger["observations"])
assert all(r["eventTs"]<=r["sourceObservedUntilTs"]<=r["availableAtTs"]<=ledger["cutoffTs"]
           for r in ledger["observations"])
for r in ledger["observations"]:
    assert "orderId" not in r and "fillPrice" not in r and "pnl" not in r
    assert r["sourceSha256"] in ([ledger["sourceManifest"][r["family"]]]
         if isinstance(ledger["sourceManifest"][r["family"]],str)
         else ledger["sourceManifest"][r["family"]])

source=ROOT/"scripts/bt-hp-unified-candidate-observation-ledger.py"
spec=importlib.util.spec_from_file_location("bt481_h2_validator",source)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
assert mod.build(ledger["observations"],ledger["cutoffTs"],ledger["sourceManifest"])==ledger
def rejects(changer,expected):
    rows=[copy.deepcopy(ledger["observations"][0])]
    changer(rows[0])
    try:mod.build(rows,ledger["cutoffTs"],ledger["sourceManifest"])
    except mod.EvidenceError as e: assert str(e)==expected,(str(e),expected)
    else:raise AssertionError("UNEXPECTED_ACCEPT: "+expected)
rejects(lambda r:r.update(sourceObservedUntilTs=r["availableAtTs"]+1),"INPUT_CUTOFF_NOT_CAUSAL")
rejects(lambda r:r.update(sourceObservedUntilTs=r["eventTs"]-1),"INPUT_CUTOFF_NOT_CAUSAL")
rejects(lambda r:r.update(sourceSha256="0"*64),"SOURCE_PIN_MISMATCH")
rejects(lambda r:r.update(stage="ENTRY_VERIFIED",decision="LONG"),"ENTRY_NOT_PROVEN")
rejects(lambda r:r.update(fillQty=10),"EXECUTION_FIELDS_FORBIDDEN")
rejects(lambda r:r.update(route=""),"INVALID_ROUTE")
multi=copy.deepcopy(ledger["sourceManifest"])
multi["Q102"]=[multi["Q102"][0],multi["Q102"][0]]
try:mod.build([],ledger["cutoffTs"],multi)
except mod.EvidenceError as e:assert str(e)=="INVALID_MANIFEST"
else:raise AssertionError("UNEXPECTED_ACCEPT_DUPLICATE_PIN")
assert manifest["archiveRelativePath"].replace("\\","/")=="reports/bt-verification/"+PREFIX+".json.gz"
print("PASS PR481 H2 seven real source probes, 8,260 deterministic observations, 54 source candidates NOT trades, 0 executable orders and zero PnL")
