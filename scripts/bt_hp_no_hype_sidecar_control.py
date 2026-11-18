#!/usr/bin/env python3
"""Matched no-HYPE sidecar ablation for STABLE4 native HYPE sensitivity.

Research-only, no production economics certification, no trading.
"""
from __future__ import annotations
import argparse,hashlib,json,os
from pathlib import Path
from bt_hp_native_hype_integrated_sensitivity import (
 EXPECTED_WRAPPER_SHA,BASE_OUTPUT,OUTPUT_SUFFIX,NEW_HYPE_FILTER,
 sha_file,transform,replace_one,EXEC_ANCHOR,
)
NO_HYPE_SUFFIX="_NO_HYPE_SIDECAR_SOURCE_GROSS_20261115_V1"

def make_ablation(code:str)->str:
    transformed=transform(code,with_gross=True)
    transformed=replace_one(transformed,
        'out_name="'+BASE_OUTPUT+OUTPUT_SUFFIX+'"',
        'out_name="'+BASE_OUTPUT+NO_HYPE_SUFFIX+'"',
        "NO_HYPE_ISOLATED_OUTPUT")
    transformed=replace_one(transformed,NEW_HYPE_FILTER,
                            'if c["s"]=="HYPE":',
                            "ALL_HYPE_RESEARCH_CANDIDATES_EXCLUDED")
    compile(transformed,"<no-hype-sidecar-research-wrapper>","exec")
    return transformed

def run(wrapper:Path,*,verify_only:bool)->None:
    if sha_file(wrapper)!=EXPECTED_WRAPPER_SHA:
        raise ValueError("SOURCE_WRAPPER_SHA_MISMATCH")
    output=wrapper.parents[2]/(BASE_OUTPUT+NO_HYPE_SUFFIX)
    if not verify_only and output.exists():
        raise ValueError("NONOVERWRITE_ABLATION_OUTPUT_EXISTS")
    transformed=make_ablation(wrapper.read_text("utf8"))
    os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
    os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
    namespace={"__name__":"__main__","__file__":str(wrapper)}
    print("NO_HYPE_SOURCE_SHA256",hashlib.sha256(transformed.encode("utf8")).hexdigest(),flush=True)
    if verify_only:
        prefix=transformed.split(EXEC_ANCHOR,1)[0]
        exec(compile(prefix+'print("NO_HYPE_SOURCE_GENERATOR_CHECK_PASS",flush=True)\n',
          str(wrapper)+"::NO_HYPE_VERIFY","exec"),namespace)
        return
    exec(compile(transformed,str(wrapper)+"::NO_HYPE_CONTROL","exec"),namespace)
    if not output.exists():raise ValueError("NO_HYPE_OUTPUT_MISSING")
    meta={
        "schema":"disdex-bt-stable4-no-hype-control/v1",
        "status":"RESEARCH_ONLY_ZERO_HYPE_SIDECAR_ABLATION",
        "matchedModelFamilyExceptHypeCandidateAdmission":True,
        "sourceWrapperSha256":EXPECTED_WRAPPER_SHA,
        "transformedSourceSha256":hashlib.sha256(transformed.encode("utf8")).hexdigest(),
        "experimentalPriorGateScopeUnchanged":True,
        "hypeCandidatesAdmittedExpected":0,
        "portfolioEconomicsLiveParityCertified":False,
        "venueMutations":0
    }
    (output/"NO_HYPE_RESEARCH_CONTROL_ATTESTATION.json").write_text(
        json.dumps(meta,ensure_ascii=False,indent=2)+"\n","utf8")
    print("NO_HYPE_ABLATION_OUTPUT_DIR",str(output),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wrapper",type=Path,required=True)
    p.add_argument("--verify-only",action="store_true")
    a=p.parse_args()
    run(a.wrapper,verify_only=a.verify_only)
if __name__=="__main__":main()
