#!/usr/bin/env python3
"""Deterministic research-only synthetic receipt audit."""
import hashlib, json, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DD=ROOT/"scripts/dd-reduction"
DEST=ROOT/"docs/research/results/render-three-regime-20261024"
TESTS=[
 "test_render_4427_atomic_receipt_research_20261025.py",
 "test_render_4427_independent_owner_route_contract_20261025.py",
 "test_render_4427_native_preallocation_asof_proof_20261025.py",
 "test_render_4427_native_proof_authenticity_20261025.py"]
MODULE=DD/"render_4427_atomic_receipt_research_20261025.py"
PRODUCER=DD/"run-render-4427-independent-profit-sell55-native8-20261024.py"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    s=PRODUCER.read_text(encoding="utf8")
    markers=["native.research_new_rows=inject","'generic_accepted':True",
             "'route_selected':True",
             "'source_runtime_sha':'RESEARCH_ONLY_RENDER_4427_INDEPENDENT_CAUSAL_SCORE_20261024'"]
    assert all(x in s for x in markers),"PRODUCER_SOURCE_CHANGED_FAIL_CLOSED"
    runs=[]
    for run in range(2):
        result=[]
        for f in TESTS:
            q=subprocess.run([sys.executable,str(DD/f)],cwd=ROOT,
                             capture_output=True,text=True,timeout=120)
            out=q.stdout+q.stderr
            n=re.search(r"Ran (\d+) tests? in ",out)
            assert q.returncode==0 and n and re.search(r"\nOK\s*$",out),(f,out[-3000:])
            result.append({"script":f,"tests":int(n.group(1)),"status":"PASS"})
        runs.append(result)
    assert runs[0]==runs[1]
    report={
     "status":"RESEARCH_ONLY_LOCAL_SQLITE_RECEIPT_ATOMICITY_TESTED_NOT_NATIVE_AUTHENTICATION",
     "date":"2026-10-25",
     "branch":"research/render4427-durable-receipt-audit-20261025",
     "parentSha":"ccb99fb6293b30406cf7ed9b6b63b60c698e6aa3",
     "moduleSha256":sha(MODULE),"newTestsSha256":sha(DD/TESTS[0]),
     "producerSha256":sha(PRODUCER),
     "producerResearchAssertionsVerified":True,
     "independentProcessRuns":runs,
     "testsPerProcess":sum(x["tests"] for x in runs[0]),
     "atomicity":{
       "sameReceiptEightSubprocesses":"one recorded; seven replay rejected",
       "restart":"persisted receipt rejected",
       "changedPayload":"REJECT_RECEIPT_CONFLICT",
       "sequence":"strict contiguous per source; out of order and gap rejected",
       "database":"SQLite WAL, BEGIN IMMEDIATE, synchronous FULL, unique constraints"},
     "native8PrimaryGateProofsVerified":0,
     "native8OwnerRegistered":False,"native8EconomicBacktestPerformed":False,
     "venueEvidenceCertified":False,"liveOrderAuthorized":False,
     "limitations":[
       "Synthetic local SQLite journal only; no Native8 pipeline integration",
       "No trusted receipt producer, independently pinned manifest root, or 13 authoritative GateProofs",
       "No production cross-host dedup, power-loss fault injection, or exchange execution proof",
       "June 23/25 cannot be certified from synthetic receipts; May 27 same-symbol conflict remains rejected",
       "2025 Aster RENDER H1 mark missing; Aster actual M5 fills/funding unverified",
       "Historical 2025H2 is explored, not untouched OOS",
       "No new Forward Shadow primary evidence verified",
       "VPS/LIVE/Production/HP/orders and existing 8 strategies unchanged"]}
    DEST.mkdir(parents=True,exist_ok=True)
    j=DEST/"RENDER_4427_ATOMIC_DURABLE_RECEIPT_RESEARCH_AUDIT_20261025.json"
    m=DEST/"RENDER_4427_ATOMIC_DURABLE_RECEIPT_RESEARCH_AUDIT_20261025.md"
    j.write_text(json.dumps(report,sort_keys=True,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
    m.write_text("""# RENDER #4427 — local atomic receipt research audit (2026-10-25)

**RESEARCH ONLY — no Native8 or LIVE authorization.**

## Newly audited
- 14 new synthetic tests and 42 existing contract/authenticity tests: 56/56 PASS in each of two fresh Python processes.
- Eight concurrent independent Python processes submitted the same synthetic receipt to one local SQLite DB: exactly one research-only claim; seven replays rejected.
- A fresh Python process rejected the same receipt after the original process ended; sequence gaps, backward sequence and conflicting payloads were rejected.
- The journal uses SQLite WAL, BEGIN IMMEDIATE, synchronous FULL, and unique constraints; success is RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED, never an order permit.

## Primary source boundary
The research producer uses native.research_new_rows=inject and self-asserted generic_accepted/route_selected=True, with a research label as source_runtime_sha. These are not independently authenticated Native8 Owner/Route proofs.

## Limits / Fail Closed
This local DB test does not establish power-loss resilience, cross-host atomicity, source identity, trusted root, 13 as-of safety proofs, venue order execution, or full Native8 integration. Do not treat synthetic receipts as historical proof for June 23/25; May 27 stays rejected due same-symbol position conflict. The Native8 pipeline, current eight strategies, VPS, LIVE, Production, HP, and real orders were not modified. No new economic BT.

The 2025 Aster RENDER H1 mark gap and actual Aster M5 fill/Funding verification gaps remain. Historical 2025H2 is explored, not untouched OOS. No new Forward Shadow primary evidence was established.

## Reproduce
Run scripts/dd-reduction/audit_render_4427_atomic_receipt_20261025.py from a fresh Python process. It executes all synthetic suites twice and emits deterministic JSON.
""",encoding="utf8")
    print(json.dumps({"testsPerProcess":report["testsPerProcess"],"runs":2,
                      "jsonSha256":sha(j),"moduleSha256":sha(MODULE)},sort_keys=True))
if __name__=="__main__":main()
