#!/usr/bin/env python3
"""Fail-closed historical HYPE route-vs-current-production source audit.

Reads ONLY offline research entries, immutable source-file copies, and a
sanitized nonsecret runtime-mode snapshot. Never executes TS or trades.
A route-name mismatch proves nonidentical source attribution, not the
absence of an economically equivalent signal in another algorithm.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,re
from pathlib import Path

REQUIRED={
 "scripts/disdex-hype-zec-long-live-runner.ts",
 "lib/hype-zec-long-runner.ts",
 "lib/hype-zec-long-market-data.ts",
 "lib/hype-trend-long-signal.ts",
 "config/hypeZecLongRuntime.ts",
 "config/hypeTrendLongPolicy.ts",
}
LEGACY_ROUTE="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"
MODEL_TAG="HYPE_REDESIGN_TIME48_NEXTOPEN"
MODEL_THRESHOLDS=(
 "0.004297852251518686",
 "0.02047426596091347",
 "0.026202553353817715",
)
LIVE_RULE_FIELDS=(
 "fastEmaPeriod","slowEmaPeriod","regimeEmaPeriod",
 "breakoutLookbackHours","minimumBreakoutBps","minimumRegimeSlopeBps",
 "atrPeriod","stopAtrMultiple","trailingAtrMultiple",
 "maximumHoldHours","maximumGross",
)
ENTRY_COLUMNS={"trade_id","utc","logic","symbol","side","route","entry_gross_x","source_runtime_sha"}

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def entries(path:Path)->dict:
    out={}
    with path.open(encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or not ENTRY_COLUMNS.issubset(set(reader.fieldnames)):
            raise ValueError("INCOMPLETE_RESEARCH_MODEL_ENTRY_SOURCE")
        for row in reader:
            if row["logic"]!="HYPE":continue
            if row["symbol"]!="HYPEUSDT" or row["side"]!="LONG":
                raise ValueError("HYPE_SOURCE_ENTRY_IDENTITY_DRIFT")
            key=(row["utc"],row["route"],row["source_runtime_sha"])
            if key in out:raise ValueError("DUPLICATE_HYPE_RESEARCH_ENTRY")
            g=float(row["entry_gross_x"])
            if not 0<g<10:raise ValueError("INVALID_MODEL_ENTRY_GROSS")
            out[key]={"entryTimeUtc":row["utc"],"route":row["route"],
                      "modelEntryGrossX":g,"sourceRuntimeSha":row["source_runtime_sha"]}
    if not out:raise ValueError("NO_RESEARCH_HYPE_ENTRIES")
    return out

def load_sources(root:Path)->tuple[dict,dict]:
    files={}
    content={}
    for name in sorted(REQUIRED):
        path=root/name
        if not path.is_file():raise ValueError("MISSING_LIVE_SOURCE_FILE:"+name)
        blob=path.read_bytes()
        files[name]={"sha256":hashlib.sha256(blob).hexdigest(),"bytes":len(blob)}
        content[name]=blob.decode("utf8").replace("\r\n","\n")
    return files,content

def policy_numbers(contents:dict)->dict:
    policy=contents["config/hypeTrendLongPolicy.ts"]
    if 'strategy: "HYPE_LONG"' not in policy or 'timeframe: "1h"' not in policy:
        raise ValueError("LIVE_HYPE_TREND_POLICY_SIGNATURE_MISSING")
    result={}
    for name in LIVE_RULE_FIELDS:
        match=re.search(r"\b"+re.escape(name)+r"\s*:\s*(\d+(?:\.\d+)?)\b",policy)
        if match is None:raise ValueError("LIVE_POLICY_FIELD_MISSING:"+name)
        result[name]=float(match.group(1))
    return result

def audit(entries10:dict,entries30:dict,wrapper:str,contents:dict,
          source_files:dict,release_sha:str,mode_evidence:dict)->dict:
    if not re.fullmatch("[0-9a-f]{40}",release_sha):raise ValueError("INVALID_LIVE_RELEASE_SHA")
    if set(entries10)!=set(entries30):raise ValueError("RESEARCH_HYPE_COST_CASE_SIGNAL_DRIFT")
    if LEGACY_ROUTE not in wrapper or MODEL_TAG not in wrapper:
        raise ValueError("RESEARCH_MODEL_ROUTE_OR_EXIT_SOURCE_UNVERIFIED")
    # This particular research model's rule differs from the live EMA/ATR policy.
    if not all(marker in wrapper for marker in MODEL_THRESHOLDS):
        raise ValueError("RESEARCH_MODEL_RULE_DEFINITION_CHANGED")
    routes=sorted({x["route"] for x in entries10.values()})
    if routes!=[LEGACY_ROUTE]:raise ValueError("UNEXPECTED_RESEARCH_MODEL_HYPE_ROUTE")
    if 'import { HypeZecLongRunner }' not in contents["scripts/disdex-hype-zec-long-live-runner.ts"]:
        raise ValueError("LIVE_RUNNER_WIRING_NOT_RECOGNIZED")
    if '"TREND"' not in contents["lib/hype-zec-long-market-data.ts"]:
        raise ValueError("LIVE_MARKET_DATA_MODE_WIRING_NOT_RECOGNIZED")
    if "buildHypeTrendSignal" not in contents["lib/hype-trend-long-signal.ts"]:
        raise ValueError("LIVE_TREND_SIGNAL_SOURCE_UNRECOGNIZED")
    if "signalMode" not in contents["config/hypeZecLongRuntime.ts"]:
        raise ValueError("LIVE_RUNTIME_MODE_WIRING_UNRECOGNIZED")
    policy=policy_numbers(contents)
    if mode_evidence.get("releaseSha")!=release_sha or mode_evidence.get("signalMode")!="TREND":
        raise ValueError("LIVE_RUNTIME_MODE_EVIDENCE_MISMATCH")
    if abs(float(mode_evidence.get("maximumGross"))-policy["maximumGross"])>1e-9:
        raise ValueError("LIVE_GROSS_CONFIG_POLICY_MISMATCH")
    for text in contents.values():
        if "PRIVATE KEY" in text:raise ValueError("UNEXPECTED_SENSITIVE_SOURCE")
    exact_matches=sorted(name for name,text in contents.items() if LEGACY_ROUTE in text)
    source_sha_set=sorted({x["sourceRuntimeSha"] for x in entries10.values()})
    if len(source_sha_set)!=1 or not re.fullmatch("[a-f0-9]{40}",source_sha_set[0]):
        raise ValueError("AMBIGUOUS_RESEARCH_MODEL_PIN")
    result={
        "schema":"disdex-hype-research-vs-live-policy-source-audit/v1",
        "status":"RESEARCH_HYPE_ROUTE_ABSENT_FROM_REVIEWED_LIVE_EXECUTION_PATH"
                 if not exact_matches else "RESEARCH_ROUTE_PRESENT_BUT_ECONOMICS_STILL_UNVERIFIED",
        "historicalEntryCount":len(entries10),
        "researchRoute":LEGACY_ROUTE,
        "researchModelExit":MODEL_TAG,
        "researchModelGrossRequestedX":1.0,
        "researchModelSourceSha":source_sha_set[0],
        "pinnedLiveReleaseSha":release_sha,
        "observedLiveSignalMode":mode_evidence["signalMode"],
        "liveTrendPolicy":policy,
        "routeMatchesInReviewedSources":exact_matches,
        "immutableSourceFiles":source_files,
        "liveRiskCeilingEqualsModelGross":abs(policy["maximumGross"]-1.0)<1e-9,
        "sourceDefinitionEquivalent":False,
        "economicParityCertified":False,
        "hypeHistoricalAsOfGateProofCertified":False,
        "productionMutations":0,
        "note":"Source-level attribution mismatch. A different route label alone cannot prove different market outcomes. Full canonical current-runner HYPE backtest requires native policy, historical as-of gates, trades/exits, and portfolio resimulation.",
    }
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--research-wrapper",required=True,type=Path)
    p.add_argument("--entries10",required=True,type=Path)
    p.add_argument("--entries30",required=True,type=Path)
    p.add_argument("--live-source-root",required=True,type=Path)
    p.add_argument("--live-mode-evidence",required=True,type=Path)
    p.add_argument("--live-release-sha",required=True)
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    files,contents=load_sources(args.live_source_root)
    e=json.loads(args.live_mode_evidence.read_text("utf-8-sig"))
    result=audit(entries(args.entries10),entries(args.entries30),
        args.research_wrapper.read_text("utf8"),contents,files,
        args.live_release_sha,e)
    result["inputSha256"]={
        "researchWrapper":sha(args.research_wrapper),"modelEntries10bps":sha(args.entries10),
        "modelEntries30bps":sha(args.entries30),"sanitizedModeEvidence":sha(args.live_mode_evidence)}
    output=json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+"\n"
    if args.output:args.output.write_text(output,"utf8")
    print(output)

if __name__=="__main__":main()
