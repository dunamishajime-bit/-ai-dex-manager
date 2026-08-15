"""Full frozen-firewall versus no-firewall ablation for Generic Candidate V1.

Diagnostic only. It does not change, rank, remove, or retune individual blockers.
The ONLY comparison is the entire frozen firewall ON versus the entire firewall OFF,
with the same predeclared generic trigger, fixed hold, gross, costs, and delays.
No new candidate is selected from this result.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import research_loss_firewall_generic_candidate_v1 as c


def run_all(candles,idx):
    out={}
    for label,(a,z) in c.PERIODS.items():
        n,_=c.simulate(candles,idx,a,z,c.NORMAL_BPS_PER_SIDE,0)
        s,_=c.simulate(candles,idx,a,z,c.STRESS_BPS_PER_SIDE,c.STRESS_DELAY_HOURS)
        out[label]={"normal":n,"stress":s}
    return out


def main():
    candles,idx,_=c.b.base.load()
    on=run_all(candles,idx)
    original=c.fw.matched_blockers
    try:
        c.fw.matched_blockers=lambda features: []
        off=run_all(candles,idx)
    finally:
        c.fw.matched_blockers=original
    comparison={}
    for label in c.PERIODS:
        comparison[label]={
            "firewallOnNormalReturnPct":on[label]["normal"]["returnPct"],
            "firewallOffNormalReturnPct":off[label]["normal"]["returnPct"],
            "normalReturnDeltaPct":on[label]["normal"]["returnPct"]-off[label]["normal"]["returnPct"],
            "firewallOnNormalPf":on[label]["normal"]["pf"],
            "firewallOffNormalPf":off[label]["normal"]["pf"],
            "firewallOnStressReturnPct":on[label]["stress"]["returnPct"],
            "firewallOffStressReturnPct":off[label]["stress"]["returnPct"],
            "stressReturnDeltaPct":on[label]["stress"]["returnPct"]-off[label]["stress"]["returnPct"],
            "firewallOnTrades":on[label]["normal"]["trades"],
            "firewallOffTrades":off[label]["normal"]["trades"],
        }
    out={
        "researchLine":"LOSS_FIREWALL_V1_FULL_ABLATION","researchOnly":True,"diagnosticOnly":True,
        "individualBlockerAblation":False,"blockerRetune":False,"newCandidateSelected":False,
        "sameGenericTrigger":True,"sameHold":True,"sameGross":True,"sameCostsAndDelay":True,
        "productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,
        "comparison":comparison,"nextAction":"CLOSE_CURRENT_EVIDENCE_SET_AND_REPORT",
    }
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    (root/"loss-firewall-v1-full-ablation.json").write_text(json.dumps(out,indent=2,sort_keys=True),encoding="utf-8")
    print(json.dumps(out,indent=2,sort_keys=True))

if __name__=="__main__":main()
