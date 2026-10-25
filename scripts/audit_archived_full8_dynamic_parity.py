"""Compare re-allocated archived eight-family tape against its native order gates.

Exit 2 when parity is missing: a completed research model is not a formal BT.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

EIGHT = {"V12","PENGU","Q102","FET","HYPE_LONG","IDLE","RESIDUAL","V52"}

def read_jsonl(path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def evaluate(output_dir: Path,native_dir: Path,expected_v4_sha: str) -> dict:
    child=output_dir/"candidate-decisions.jsonl"
    native=native_dir/"candidate-decisions.jsonl"
    modeled=list(read_jsonl(child));official=list(read_jsonl(native))
    def stats(rows):
        eligible=Counter(r["strategy_id"] for r in rows if r.get("decision")=="ACCEPTED_MODELED_ENTRY")
        considered=Counter(r["strategy_id"] for r in rows)
        reasons=Counter((r["strategy_id"],r.get("reason")) for r in rows if r.get("decision")!="ACCEPTED_MODELED_ENTRY")
        return eligible,considered,reasons
    a,at,ar=stats(modeled)
    b,bt,br=stats(official)
    trades=list(read_jsonl(output_dir/"portfolio-trades.jsonl"))
    source=Counter(str(r.get("source_runtime_sha")) for r in trades)
    missing=sorted(EIGHT-set(at))
    gap={k:{"native":b[k],"dynamic":a[k],"difference":a[k]-b[k]} for k in sorted(EIGHT)}
    mismatched=sum(r.get("source_runtime_sha")!=expected_v4_sha for r in trades if r.get("strategy_id")=="V12")
    v4=[r for r in modeled if r.get("strategy_id")=="V12"]
    routes={str(r.get("route")) for r in v4 if r.get("route")}
    return {
      "status":"BLOCKED_FULL_LATEST_ORDER_GATE_PARITY",
      "familiesObserved":sorted(at),"missing":missing,
      "candidateDecisions":len(modeled),"tradeCount":len(trades),
      "latestV4ExpectedSha":expected_v4_sha,
      "v12TradesWrongSha":mismatched,
      "v12DistinctHistoricalRoutes":len(routes),
      "familyAcceptance":gap,
      "nativeIdleRiskGateRejections":{k[1]:n for k,n in br.items() if k[0]=="IDLE" and n},
      "nativeResidualRiskGateRejections":{k[1]:n for k,n in br.items() if k[0]=="RESIDUAL" and n},
      "modeledRuntimeSourceShas":dict(source),
      "candidateBasedReallocationWasReplayed":True,
      "nativeStrategyAdmissionParityVerified":False,
      "latestAdoptedSourceShaParityVerified":False,
      "modeledHypeFundingVerified":False,
      "liveVenueFillVerified":False,
      "automaticLiveActivationAuthorized":False,
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output-dir",type=Path,required=True)
    p.add_argument("--native-dir",type=Path,required=True)
    p.add_argument("--expected-v4-sha",required=True)
    p.add_argument("--report",required=True,type=Path)
    a=p.parse_args()
    d=evaluate(a.output_dir,a.native_dir,a.expected_v4_sha)
    a.report.parent.mkdir(parents=True,exist_ok=True)
    a.report.write_text(json.dumps(d,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
    print(json.dumps(d,ensure_ascii=False,sort_keys=True,indent=2))
    raise SystemExit(0 if d["status"].startswith("FULL_") else 2)

if __name__=="__main__":main()
