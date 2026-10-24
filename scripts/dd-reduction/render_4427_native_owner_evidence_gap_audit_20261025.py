#!/usr/bin/env python3
"""RESEARCH ONLY: verify native owner evidence actually present for #4427."""
from __future__ import annotations
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib, json, sys

ROOT = Path(r"C:\tmp\render4427-fresh-process-audit-20261025\A")
ROOT_B = Path(r"C:\tmp\render4427-fresh-process-audit-20261025\B")
REPO = Path(__file__).resolve().parents[2]
RESULT = REPO / "docs/research/results/render-three-regime-20261024"
ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"
OWNER = "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH"
TARGETS = {"2026-05-27T21:00", "2026-06-23T01:00", "2026-06-25T07:00"}
NATIVE_PROOFS = (
    "registration", "source_asof", "shared_risk", "gross", "margin",
    "kill_switch", "account_lock", "dedup", "pending", "cooldown",
    "same_symbol_exclusivity", "native_slots", "owner_priority"
)
def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()

def load(path):
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def stamp(ms):
    return datetime.fromtimestamp(int(ms)/1000, timezone.utc).strftime("%Y-%m-%dT%H:%M")

def main():
    audit = {"status":"RESEARCH_ONLY_FAIL_CLOSED_NATIVE_OWNER_EVIDENCE_AUDIT",
             "reference":"Native8 modeled counterfactual, NOT live venue attestation",
             "route":ROUTE, "researchOwner":OWNER, "costs":{},
             "limitations":["Native candidate/decision/trade/event files are modeled research artifacts.",
               "Absence of a field in these four artifacts does not prove it is absent from all external systems.",
               "No Aster M5 signed fill, Funding, Margin Guard, Shared Risk, Kill Switch or account lock certification.",
               "2025 Aster RENDER H1 mark missing; historical windows previously explored, not pristine OOS.",
               "No production, VPS, HP, LIVE or real order change."]}
    for cost in (10,30):
        files = sorted(p for p in ROOT.rglob("candidate-decisions.jsonl") if p.parent.name==f"PRICE_MODEL_{cost}BPS")
        assert len(files)==3, (cost,len(files))
        bysha={}
        for p in files:bysha.setdefault(sha(p),[]).append(p)
        converged = [v for v in bysha.values() if len(v)==2]
        assert len(converged)==1, ("FINAL_ITERATION_RAW_SHA_NOT_UNIQUE",cost,{k:len(v) for k,v in bysha.items()})
        p=converged[0][0]
        bfiles=sorted(q for q in ROOT_B.rglob("candidate-decisions.jsonl") if q.parent.name==f"PRICE_MODEL_{cost}BPS")
        assert len(bfiles)==3 and sum(sha(q)==sha(p) for q in bfiles)==2, (cost,"INDEPENDENT_PROCESS_RAW_MISMATCH")
        rows=load(p)
        target=[x for x in rows if x.get("route")==ROUTE]
        assert len(target)==3,(cost,len(target))
        got={stamp(x["entry_ts_ms"]):x for x in target}
        assert set(got)==TARGETS,(cost,set(got))
        sibling = p.parent
        tradefile=sibling/"portfolio-trades.jsonl"
        eventfile=sibling/"portfolio-events.jsonl"
        candidatefile=next(p.parent.parent.parent.glob("candidates/crypto-price-model-candidates.jsonl"),None)
        assert tradefile.is_file() and eventfile.is_file()
        observed_fields=set()
        for path in (p,tradefile,eventfile):
            for x in load(path):observed_fields.update(x.keys())
        # Owner ID and source attestation are not automatically inferred from strategy_id=IDLE.
        missing_fields = [k for k in ("owner_id","capital_owner","native_owner_registration_sha256",
                                     "owner_priority_asof_sha256","shared_risk_asof_sha256",
                                     "margin_guard_asof_sha256","kill_switch_asof_sha256",
                                     "account_lock_asof_sha256","pending_inventory_asof_sha256",
                                     "dedup_asof_sha256") if k not in observed_fields]
        decisions=[]
        for t in sorted(TARGETS):
            x=got[t]
            assert x.get("strategy_id")=="IDLE" and x.get("symbol")=="RENDERUSDT" and x.get("side")=="SHORT"
            assert x.get("source_venue_signed") is False
            if t.endswith("05-27T21:00"):
                assert x["decision"]=="REJECTED_PORTFOLIO"
            else:
                assert x["decision"]=="ACCEPTED_MODELED_ENTRY"
                assert x.get("historical_fill_verified") is False
                assert x.get("quantity_actual_fill") is True
                assert x.get("quantity_provenance")=="MODEL_ACCEPTED_DECISION_AT_T"
            decisions.append({"utc":t,"decision":x["decision"],"reason":x["reason"],
                "source_venue_signed":x["source_venue_signed"],
                "historical_fill_verified":x.get("historical_fill_verified"),
                "quantity_actual_fill":x.get("quantity_actual_fill"),
                "quantity_provenance":x.get("quantity_provenance"),
                "owner_id":x.get("owner_id"),"capital_owner":x.get("capital_owner"),
                "requested_gross":x["requested_gross"],
                "accepted_gross":x.get("accepted_gross")})
        audit["costs"][str(cost)]={"convergedDecisionSha256":sha(p),
          "convergedDecisionFile":str(p),"independentProcessSameRawDecisionSha":True,
          "tradeSha256":sha(tradefile),"eventSha256":sha(eventfile),
          "missingFieldsInDecisionTradeEventArtifacts":missing_fields,
          "proofsAuthenticated":0,"proofsRequired":len(NATIVE_PROOFS),
          "targetDecisions":decisions,
          "verdict":"BLOCKED_NATIVE_OWNER_ROUTE_ASOF_PROOFS_MISSING"}
    assert audit["costs"]["10"]["missingFieldsInDecisionTradeEventArtifacts"]==audit["costs"]["30"]["missingFieldsInDecisionTradeEventArtifacts"]
    RESULT.mkdir(parents=True,exist_ok=True)
    out=RESULT/"RENDER_4427_NATIVE_OWNER_EVIDENCE_GAP_AUDIT_20261025.json"
    out.write_text(json.dumps(audit,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf-8")
    print("AUDIT_PASS_RESEARCH_ONLY",out)
    for cost,v in audit["costs"].items():
        print(cost,"missingFields",len(v["missingFieldsInDecisionTradeEventArtifacts"]),
              "proofsAuthenticated",v["proofsAuthenticated"],"targetDecisions",[(x["utc"],x["decision"]) for x in v["targetDecisions"]])
    print("SHA256",sha(out))
if __name__=="__main__":main()
