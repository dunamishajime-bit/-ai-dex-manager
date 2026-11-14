#!/usr/bin/env python3
"""STABLE4 controlled 10/30bps HYPE-native integration sensitivity.

This research-only wrapper preserves STABLE4's other experimental routes
unchanged and swaps its H48 research HYPE for the native-candidate HYPE TREND
population already present in the canonical engine. Sources are pinned.
No trading/exchange/runtime mutations. DO NOT label production economic parity.
"""
from __future__ import annotations
import argparse,hashlib,json,os,re
from pathlib import Path

EXPECTED_WRAPPER_SHA="08be27e5c6064e2ff9ada7674697e7c168bdb341e604251ce266fdc3e3ff74ea"
EXPECTED_HYPE_ROUTE="HYPE_TREND_LONG_PINNED"
BASE_OUTPUT="STABLE4_OPPORTUNITY_PROD_CAPS_20261114"
OUTPUT_SUFFIX="_NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1"
REMOVE_FROM='_HYPE_REDESIGN_PATH=R/"DIRECTION_RESEARCH_20261109"'
REMOVE_TO='# Q102 AVAX: local confidence hardening around QAON7.'
OLD_HYPE_FILTER='if c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H48R4_WSIG":'
NEW_HYPE_FILTER=f'if c["s"]=="HYPE" and c.get("route")!="{EXPECTED_HYPE_ROUTE}":'
EXEC_ANCHOR='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
CHECK_MARKER='assert "STEP=300000" in orig and "V52_STRATEGY_DAILY_LOSS_3P5_GATE" in orig'

def sha_file(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
def replace_one(s:str,old:str,new:str,label:str)->str:
    n=s.count(old)
    if n!=1:raise ValueError(f"ANCHOR_DRIFT_{label}:{n}")
    return s.replace(old,new,1)

def transform(wrapper:str,*,with_gross:bool)->str:
    start=wrapper.index(REMOVE_FROM)
    end=wrapper.index(REMOVE_TO,start)
    removed=wrapper[start:end]
    if "HYPE_REDESIGN_CAUSAL_H48R4_WSIG" not in removed or "raw.append(" not in removed:
        raise ValueError("H48_SOURCE_REMOVAL_NOT_PROVEN")
    result=wrapper[:start]+"""# Native HYPE TREND candidates are already loaded by the underlying canonical
# engine (78 pinned H1 signals, Aster public H1/M5 modeled exits, no venue).
# Deliberately do not inject the separate research H48 model here.

"""+wrapper[end:]
    result=replace_one(result,OLD_HYPE_FILTER,NEW_HYPE_FILTER,"HYPE_NATIVE_ROUTE_FILTER")
    result=replace_one(result,
        'out_name="'+BASE_OUTPUT+'"',
        'out_name="'+BASE_OUTPUT+OUTPUT_SUFFIX+'"',
        "OUTPUT_ISOLATION")
    # The STABLE4 wrapper already edits HYPE CAP checks to use candidate gross
    # rather than an unconditional constant. Keep its original code path and
    # replace its misleading H48-specific gate rejection label only.
    result=replace_one(result,
        'HYPE_REDESIGN_1P0_CRYPTO_CAP_GATE','HYPE_NATIVE_CANDIDATE_CRYPTO_CAP_GATE',
        "HYPE_NATIVE_GROSS_GATE_CRYPTO")
    result=replace_one(result,
        'HYPE_REDESIGN_1P0_TOTAL_CAP_GATE','HYPE_NATIVE_CANDIDATE_TOTAL_CAP_GATE',
        "HYPE_NATIVE_GROSS_GATE_TOTAL")
    if with_gross:
        result=replace_one(result,EXEC_ANCHOR,
            '''from bt_hp_instrument_research_engine import instrument_generated
orig=instrument_generated(orig)
print("NATIVE_HYPE_GROSS_OBSERVER_SHA256",
      hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)
'''+EXEC_ANCHOR,"SOURCE_GROSS_OBSERVER")
    if result.count(EXEC_ANCHOR)!=1 or result.count(CHECK_MARKER)!=1:
        raise ValueError("GENERATOR_RESULT_ANCHORS_UNEXPECTED")
    compile(result,"<native-hype-source-gross-wrapper>","exec")
    return result

def run(wrapper:Path,*,verify_only:bool,expected_pin:Path,case:str)->None:
    if sha_file(wrapper)!=EXPECTED_WRAPPER_SHA:raise ValueError("BASE_WRAPPER_SHA_MISMATCH")
    if case!="STABLE3":raise ValueError("RESEARCH_CASE_UNAPPROVED")
    if not expected_pin.is_file():raise ValueError("NATIVE_HYPE_CANDIDATE_FILE_MISSING")
    data=json.loads(expected_pin.read_text("utf8"))
    if len(data)!=78 or any(x.get("strategy_id")!="HYPE_LONG" or
      x.get("route")!=EXPECTED_HYPE_ROUTE for x in data):
        raise ValueError("NATIVE_HYPE_CANDIDATE_SET_DRIFT")
    if len({x["entry_ts_ms"] for x in data})!=78:
        raise ValueError("NATIVE_HYPE_DUPLICATE_CANDIDATES")
    original=wrapper.read_text("utf8")
    transformed=transform(original,with_gross=True)
    os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
    os.environ["DISDEX_PRETARGET_STABLE_CASE"]=case
    print("BASE_WRAPPER_SHA256",EXPECTED_WRAPPER_SHA,flush=True)
    print("ARCHIVED_HYPE_CANDIDATES_SHA256",sha_file(expected_pin),flush=True)
    print("TRANSFORM_SHA256",hashlib.sha256(transformed.encode("utf8")).hexdigest(),flush=True)
    namespace={"__name__":"__main__","__file__":str(wrapper)}
    if verify_only:
        # Build canonical + STABLE4 generated economic engine with gross observer,
        # then compile it without executing a trading simulation/writing output.
        prefix=transformed.split(EXEC_ANCHOR,1)[0]
        if "O=R/out_name" not in transformed:raise ValueError("OUTPUT_TRAILER_MISSING")
        exec(compile(prefix+'''print("SOURCE_GENERATOR_VERIFY_PASS",
            hashlib.sha256(orig.encode("utf8")).hexdigest(),flush=True)
''',str(wrapper)+"::NATIVE_HYPE_GENERATOR_CHECK","exec"),namespace)
        return
    out=wrapper.parents[2]/(BASE_OUTPUT+OUTPUT_SUFFIX)
    if out.exists():raise ValueError("NONOVERWRITE_OUTPUT_ALREADY_EXISTS")
    exec(compile(transformed,str(wrapper)+"::NATIVE_HYPE_INTEGRATED_RESEARCH","exec"),namespace)
    if not out.is_dir():raise ValueError("MODELED_OUTPUT_NOT_CREATED")
    audit={
       "schema":"disdex-bt-stable4-native-hype-integrated-sensitivity/v1",
       "status":"RESEARCH_ONLY_NATIVE_HYPE_CANDIDATE_PORTFOLIO_REPLAY",
       "sourceWrapperSha256":EXPECTED_WRAPPER_SHA,
       "transformedSourceSha256":hashlib.sha256(transformed.encode("utf8")).hexdigest(),
       "nativeHypeSourceCandidatesSha256":sha_file(expected_pin),
       "nativeCandidateCount":78,
       "sourceHypeResearchH48CandidatesExcluded":True,
       "preservesExistingStable4ExperimentalGates":True,
       "productionPinnedEconomicParityCertified":False,
       "venueFillsOrSharedKillSwitchAsOfCertified":False,
       "v4CodexCutoverTouched":False,"liveTradeActions":0}
    (out/"NATIVE_HYPE_RESEARCH_SENSITIVITY_ATTESTATION.json").write_text(
      json.dumps(audit,indent=2,ensure_ascii=False)+"\n","utf8")
    print("OUTPUT_DIR",str(out),flush=True)

def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wrapper",required=True,type=Path)
    p.add_argument("--hype-candidates",required=True,type=Path)
    p.add_argument("--verify-only",action="store_true")
    p.add_argument("--case",default="STABLE3")
    args=p.parse_args()
    run(args.wrapper,verify_only=args.verify_only,expected_pin=args.hype_candidates,case=args.case)

if __name__=="__main__":main()
