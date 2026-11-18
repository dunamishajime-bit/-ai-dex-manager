"""BT-481-H2: source-only 7-family causal observation ledger.

Combines 6 families of synthetic-v4 closed-H1/H2 source signals with
the *original* V52 V50 candidate method exercised on separate fictional
Aster/reference book quotes by its existing offline source selftest.

No LIVE I/O, no positions, orders, fills, gross or performance.
"""
from __future__ import annotations
import collections
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import pathlib
import runpy
import sys
from datetime import datetime,timezone
sys.dont_write_bytecode=True

ROOT=pathlib.Path(__file__).resolve().parent.parent
SOURCE=ROOT/"scripts"/"bt-hp-unified-candidate-observation-ledger.py"
NATIVE_V52_TEST=ROOT/"scripts"/"bt-hp-v52-dual-source-temporal-selftest.py"
V52_MANIFEST=ROOT/"lib"/"bt-verification"/"pinned-native-v52"/"v50-source-manifest.json"
REPORTS=ROOT/"reports"/"bt-verification"
OUTPUT_STEM="BT_PR481_H2_7_FAMILY_CAUSAL_OBSERVATIONS_20261116_V1"

def import_validator():
    spec=importlib.util.spec_from_file_location("bt481_causal_ledger",SOURCE)
    if not spec or not spec.loader:raise RuntimeError("MISSING_CAUSAL_VALIDATOR")
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def join_v52_source_without_live_io():
    previous_argv=sys.argv
    capture=io.StringIO()
    try:
        # The existing deterministic test runs its native V52 method in an
        # isolated no-HTTP fixture shell; the caller never provides credentials.
        sys.argv=[str(NATIVE_V52_TEST)]
        with contextlib.redirect_stdout(capture):
            result=runpy.run_path(str(NATIVE_V52_TEST),run_name="bt481_h2_v52_source_only")
    finally:
        sys.argv=previous_argv
    if "PASS V52 source-exact" not in capture.getvalue():
        raise RuntimeError("V52_ORIGINAL_SOURCE_TEST_MISSING_PASS")
    m=json.loads(V52_MANIFEST.read_text(encoding="utf-8"))
    assert m["realOrderEntryEnabled"] is False
    assert m["fullV52Parity"] is False
    trace=result["trace"]
    assert trace["schema"]=="disdex-bt-v52-dual-source-input-v1"
    assert trace["seed"]==20261115 and trace["scenario"]=="rotation"
    assert trace["fills"]==0 and trace["venueTruth"] is False
    assert trace["stockReferenceTruth"] is False
    candidates=result["candidates"]
    assert len(candidates)==result["counts"]["selected_native_candidates"]==31
    rows=[]
    for c in candidates:
        ms=round(datetime.fromisoformat(c["at"]).timestamp()*1000)
        assert c["window"] in {"11:30","12:30","13:30"}
        assert c["side"] in {"BUY","SELL"}
        rows.append({
           "id":"V52|V50_NATIVE|" + c["at"]+"|"+c["symbol"],
           "family":"V52","runner":"V52_V50_NATIVE_DUAL_SOURCE_FIXTURE",
           "symbol":c["symbol"],
           "sourceSha256":m["upstreamSha256"],
           "sourcePath":m["upstreamPath"],
           "stage":"SOURCE_CANDIDATE",
           "decision":"LONG" if c["side"]=="BUY" else "SHORT",
           "eventTs":ms-10000,
           "availableAtTs":ms,
           "sourceObservedUntilTs":ms,
           "route":"V50_POST_"+c["window"].replace(":","")+"_SOURCE_ONLY"
        })
    # Verify every source timestamp corresponds to a real synthetic window.
    valid={(r["decisionAtMs"],p["symbol"]) for r in trace["inputs"] for p in r["pairs"]}
    assert all((r["availableAtTs"],r["symbol"]) in valid for r in rows)
    return rows,trace,m

def build_report(six_source_file:pathlib.Path):
    six=json.loads(six_source_file.read_text(encoding="utf-8-sig"))
    if six.get("schema")!="bt-pr481-raw-native-source-events-v1":
        raise RuntimeError("H2_NOT_SOURCE_NATIVE_INPUT")
    gen=six["generator"]
    if gen["seed"]!=20261115 or gen["scenario"]!="rotation" or gen["feedVersion"]!="v4":
        raise RuntimeError("H2_ARTIFICIAL_SOURCE_SCENARIO_MISMATCH")
    rows_v52,trace,manifest_v52=join_v52_source_without_live_io()
    merged=[*six["observations"],*rows_v52]
    manifest=six["sourceManifest"]
    if manifest["V52"]!=manifest_v52["upstreamSha256"]:
        raise RuntimeError("H2_V52_ORIGINAL_SOURCE_PIN_MISMATCH")
    ledger=import_validator().build(merged,six["cutoffTs"],manifest)
    if any(family not in ledger["familyCounts"] or ledger["familyCounts"][family]==0
           for family in ("V4","Q102","PENGU","FET","IDLE","V52","HYPE")):
        raise RuntimeError("H2_FAMILY_SOURCE_COVERAGE_INCOMPLETE")
    if ledger["execution"]!={"orders":0,"fills":0,"positions":0,"gross":None,"pnl":None}:
        raise RuntimeError("H2_EXECUTION_MUST_REMAIN_ZERO")
    if ledger["familyCounts"]["V52"]!=31:
        raise RuntimeError("H2_V52_NATIVE_CANDIDATE_COUNT_CHANGED")
    if ledger["stageCounts"]["ENTRY_VERIFIED"]!=0:
        raise RuntimeError("H2_FALSE_ENTRY_VERIFICATION")
    return ledger,{
        "schema":"disdex-bt-pr481-h2-source-evidence-manifest-v1",
        "taskId":"BT-481-H2",
        "cutoffUtc":datetime.fromtimestamp(six["cutoffTs"]/1000,timezone.utc).isoformat(),
        "artificialMarket":{
            "seed":gen["seed"],"scenario":gen["scenario"],"version":gen["feedVersion"],
            "start":gen["start"],"endExclusive":gen["endExclusive"],
            "realExchangeData":False,
            "v52IndependentModeledQuotes":True,
            "calendarHolidaysImplemented":False
        },
        "sourceObservationCounts":ledger["familyCounts"],
        "stageCounts":ledger["stageCounts"],
        "nativeProbeCounters":gen["counters"],
        "v52NativeCandidateWindows":len(rows_v52),
        "v52UnderlyingSyntheticWindows":len(trace["inputs"]),
        "liveParityVerified":False,
        "sourceEntryAdmitted":False,
        "actualOrders":0,"actualFills":0,
        "observedPortfolioGross":None,"observedPnL":None,
        "sourceLedgerSha256":ledger["sha256"],
        "limitations":[
          "V4 only native FAILED_BREAK core; other V4 routes not connected",
          "Q102 S1/S2 features have no proven 180d monthly selection; S3/S4 candidates require full admission",
          "HYPE H48 is a research-only entry gate, not certified current production strategy",
          "V52 source V50 timing is invented dual-quote synthetic data, not observed venues",
          "No native exits/STOP/positions/Shared Risk/Gross, no seven-runner performance calculation"
        ]
    }

def main():
    if len(sys.argv)!=2:raise SystemExit("usage: bt-hp-seven-source-observation-merge.py six_source_json")
    source=pathlib.Path(sys.argv[1])
    if not source.is_file():raise RuntimeError("SIX_FAMILY_SOURCE_FILE_MISSING")
    ledger,report=build_report(source)
    REPORTS.mkdir(parents=True,exist_ok=True)
    ledger_path=REPORTS/(OUTPUT_STEM+".json.gz")
    summary_path=REPORTS/(OUTPUT_STEM+".manifest.json")
    canonical=json.dumps(ledger,sort_keys=True,ensure_ascii=False,separators=(",",":"))+"\n"
    packed=gzip.compress(canonical.encode("utf-8"),compresslevel=9,mtime=0)
    ledger_path.write_bytes(packed)
    report["archiveSha256"]=hashlib.sha256(packed).hexdigest()
    report["archiveRelativePath"]=str(ledger_path.relative_to(ROOT)).replace("\\","/")
    summary_path.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print("PASS 7 source-observation families, 0 fills:",json.dumps({
        "n":len(ledger["observations"]),
        "families":ledger["familyCounts"],
        "stages":ledger["stageCounts"],
        "sha256":ledger["sha256"],
        "archive":str(ledger_path.relative_to(ROOT)),
        "bytesCompressed":len(packed)},ensure_ascii=False,sort_keys=True))
if __name__=="__main__":main()
