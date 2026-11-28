"""Conservative one-slot admission of pinned Q102 hypothetical M5 outcomes."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
import json
import sys
ROOT=Path(__file__).resolve().parents[2]
PINS={
 "STABLE4_Q102_SELECTED_NATIVE_EXIT_MODEL_20261128.json":"2d208ef1252884bdf60720802ce78ee65f84f45afe221edccfaeb411481bb5f0",
 "STABLE4_Q102_FULL_UNIVERSE_ALL_READY_CLOCK_SCREEN_20261128.json":"8bcaa800393b4cd920c3524f0ba242bc482c54fa05564ed4c8b53276a49864f0",
}
END=1790812800000
def load():
    docs=[]
    for name,pin in PINS.items():
        raw=(ROOT/"docs/research"/name).read_bytes()
        if sha256(raw).hexdigest()!=pin: raise ValueError("LEDGER_SHA:"+name)
        doc=json.loads(raw)
        if doc["orderAuthority"] is not False or doc["fullQ102AnnualReplay"] is not False: raise ValueError("SCOPE")
        for p,d in doc["sourcePins"].items():
            if sha256((ROOT/p).read_bytes()).hexdigest()!=d: raise ValueError("SOURCE_SHA:"+p)
        docs.append(doc)
    a,b=docs
    if a["inputLedgerSha256"]!=list(PINS.values())[1]: raise ValueError("INPUT_BINDING")
    expected={r["decisionTs"]:r["signal"] for r in b["observations"] if r["signal"]["side"]}
    if len(expected)!=38 or len(a["rows"])!=38: raise ValueError("COUNT")
    if {r["entryTs"]:r["signal"] for r in a["rows"]}!=expected: raise ValueError("SIGNAL_BINDING")
    return a["rows"]
def replay(rows):
    active=None
    decisions=[]
    for r in sorted(rows,key=lambda x:x["entryTs"]):
        ts=r["entryTs"]
        if active is not None and active.get("exitTs") is not None and active["exitTs"]<=ts: active=None
        rec={"entryTs":ts,"symbol":r["signal"]["symbol"],"family":r["signal"]["family"],"side":r["signal"]["side"],"sourceStatus":r["status"]}
        if active is not None:
            rec.update(decision="BLOCKED_UNRESOLVED_SLOT" if active.get("exitTs") is None else "BLOCKED_OCCUPIED_SLOT",occupyingEntryTs=active["entryTs"])
        elif r["status"] in ("ENTRY_M5_ZERO_VOLUME","ENTRY_M5_MISSING_OR_INVALID"):
            rec["decision"]="NO_MODELED_ENTRY_PRICE"
        else:
            if not r.get("entryPrice",0)>0: raise ValueError("ENTRY_PRICE")
            if r["status"]=="MODELED_EXIT_NOT_FILL":
                if not ts<r["exitTs"]<=END or not r.get("exitPrice",0)>0: raise ValueError("EXIT_PRICE_OR_CLOCK")
                active={"entryTs":ts,"exitTs":r["exitTs"]}
                rec.update(decision="MODELED_ADMIT_AND_EXIT",exitTs=r["exitTs"],reason=r["reason"])
            elif r["status"] in ("HOLD_M5_MISSING_OR_INVALID","ZERO_VOLUME_STOP_TOUCH_UNPROVEN","H1_ADOPTED_EXIT_HISTORY_UNAVAILABLE","TIME_EXIT_PRICE_UNAVAILABLE","STUDY_END_OPEN_POSITION"):
                active={"entryTs":ts}
                rec.update(decision="MODELED_ADMIT_UNRESOLVED_LATCH",observedThrough=r.get("observedThrough"))
            else: raise ValueError("UNKNOWN_STATUS")
        decisions.append(rec)
    return decisions
def selftest():
    def r(t,status="MODELED_EXIT_NOT_FILL",**extra):
        return dict(entryTs=t,signal=dict(symbol="X",family="PB",side=1),status=status,entryPrice=1,exitPrice=1,reason="TIME",**extra)
    seq=[r(1,exitTs=3),r(2,exitTs=4),r(3,exitTs=5),r(5,"TIME_EXIT_PRICE_UNAVAILABLE"),r(6,exitTs=7)]
    assert [x["decision"] for x in replay(seq)]==["MODELED_ADMIT_AND_EXIT","BLOCKED_OCCUPIED_SLOT","MODELED_ADMIT_AND_EXIT","MODELED_ADMIT_UNRESOLVED_LATCH","BLOCKED_UNRESOLVED_SLOT"]
    assert replay([r(1,"ENTRY_M5_ZERO_VOLUME"),r(2,exitTs=3)])[1]["decision"]=="MODELED_ADMIT_AND_EXIT"
if __name__=="__main__":
    selftest()
    rows=load()
    out=replay(rows)
    result={"schema":"stable4-q102-selected-one-slot-replay/v1","status":"PARTIAL_ONE_SLOT_MODEL_NO_EXECUTION_PROOF","inputPins":PINS,"summary":dict(Counter(x["decision"] for x in out)),"decisions":out,"orderAuthority":False,"fullQ102AnnualReplay":False,"limitations":["All other sleeves assumed empty; this is a conditional Q102-only model on 942 hours, not a full wallet replay.","Entry M5 zero volume is treated as no modeled entry, not proof that a live order failed. An admitted position with unknown exit latches slot indefinitely, not released by assumed deadline.","Exit at same timestamp frees modeled slot before next entry. No quote/fill/funding/fees or DD inference."]}
    with open(sys.argv[1],"x",encoding="utf8",newline="\n") as f:json.dump(result,f,indent=2,sort_keys=True);f.write("\n")
    print(json.dumps(result["summary"],sort_keys=True))
    print(json.dumps([x for x in out if x["decision"].startswith("MODELED_ADMIT")],sort_keys=True))
