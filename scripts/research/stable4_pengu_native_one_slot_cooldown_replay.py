"""One PENGU slot + native exit cooldown for two isolated source-lineage arms.

Conditional MODEL only, not actual exchange fills, shared seven-runner occupancy,
venue STOP, fees/funding or Gross/DD certification. Zero-volume ASTER M5 causes
fail-closed entry-price omission; does not prove the venue would reject an order.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE="STABLE4_PENGU_ALL_ROUTES_NATIVE_H1_POSITION_HELPER_REPLAY_20261128.json"
PIN="93b4c4dd203da5394b77e58a7a23eaa359d3978ee27a6df5973aaddafde84e00"
H=3_600_000

def read_report():
    path=ROOT/"docs/research"/SOURCE
    raw=path.read_bytes()
    if sha256(raw).hexdigest()!=PIN:raise ValueError("PENGU_NATIVE_EXIT_LEDGER_PIN_MISMATCH")
    data=json.loads(raw)
    if (data.get("schema")!="stable4-pengu-all-routes-native-h1-position-helper-replay/v1"
        or data.get("orderAuthority") is not False
        or data.get("fullPenguAnnualTradeReplay") is not False
        or data.get("productionEligible") is not False
        or data.get("summary",{}).get("BASE",{}).get("rawCandidates")!=54
        or data.get("summary",{}).get("V8_V64",{}).get("rawCandidates")!=112):
        raise ValueError("NATIVE_PENGU_RESEARCH_SCOPE")
    for name,hash_value in data.get("sourcePins",{}).items():
        path=ROOT/name
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=hash_value:
            raise ValueError("SOURCE_PIN_MISMATCH:"+name)
    return data

def sequence(arm:list)->list:
    seen=set();active_until=0;cooldown_until=0;decision=[]
    for event in sorted(arm,key=lambda x:x["entryTs"]):
        ts=event["entryTs"]
        if ts in seen:raise ValueError("DUPLICATE_SOURCE_EVENT_CLOCK")
        seen.add(ts)
        row={"sourceSignalTs":ts,"route":event["route"],"side":event["side"],"sourcePriceModel":event["status"],"orderAuthority":False}
        if ts<active_until:
            row.update(decision="BLOCKED_OCCUPIED_MODEL_SLOT",blockingUntilTs=active_until)
        elif ts<cooldown_until:
            row.update(decision="BLOCKED_NATIVE_COOLDOWN",blockingUntilTs=cooldown_until)
        elif event["status"]=="FIRST_M5_CONFIRMATION_UNAVAILABLE":
            row["decision"]="NO_M5_ENTRY_CONFIRMATION"
        elif event["status"]=="NEXT_M5_OPEN_UNAVAILABLE":
            row["decision"]="NO_M5_ENTRY_PRICE_MODEL"
        elif event["status"]=="SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":
            x=event["exit"]
            if not isinstance(x,dict) or x["actualReduceOnlyFillVerified"] is not False:
                raise ValueError("FALSE_VENUE_EXECUTION_CLAIM")
            end=x["modelExitClock"]
            cd=x["cooldownHours"]
            if not isinstance(end,int) or end<=ts or not isinstance(cd,(int,float)) or cd not in (6,24):
                raise ValueError("NATIVE_EXIT_OR_COOLDOWN_TIME_INVALID")
            active_until=end
            cooldown_until=end+int(cd*H)
            row.update(decision="MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT",exitModelTs=end,sourceExitReason=x["reason"],cooldownUntilTs=cooldown_until)
        else:
            active_until=2**53-1
            row.update(decision="MODELED_ENTRY_UNRESOLVED_LATCH",sourceStatus=event["status"])
        decision.append(row)
    return decision

def selftest():
    def case(t,end=None,status="SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL",cd=6):
        e={"entryTs":t,"route":"SHORT_V20","side":"SHORT","status":status}
        if end:e["exit"]={"actualReduceOnlyFillVerified":False,"modelExitClock":end,"cooldownHours":cd,"reason":"SHORT_MAX_HOLD"}
        return e
    rows=[case(1,3),case(2,4),case(3,5),case(3+6*H,3+7*H)]
    # Distinct timestamps, the first following entry is blocked by occupancy,
    # next after exit is held in native cooldown, final is allowed.
    assert [r["decision"] for r in sequence(rows)]==[
        "MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT","BLOCKED_OCCUPIED_MODEL_SLOT","BLOCKED_NATIVE_COOLDOWN","MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT"]
    rows=[case(1,status="NO_SOURCE_EXIT"),case(2,4)]
    assert sequence(rows)[1]["decision"]=="BLOCKED_OCCUPIED_MODEL_SLOT"
    rows=[case(1,status="FIRST_M5_CONFIRMATION_UNAVAILABLE"),case(2,4)]
    assert sequence(rows)[1]["decision"]=="MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT"

if __name__=="__main__":
    selftest()
    doc=read_report()
    arms={k:sequence(doc["results"][k]) for k in ("BASE","V8_V64")}
    summary={k:{"rawCandidates":len(v),"decisionCounts":dict(sorted(Counter(r["decision"] for r in v).items())),
      "admittedRoute":dict(sorted(Counter(r["route"] for r in v if r["decision"]=="MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT").items()))} for k,v in arms.items()}
    out={"schema":"stable4-pengu-isolated-native-one-slot-cooldown/v1","status":"CONDITIONAL_SOURCE_HELPER_ONE_SLOT_NOT_VENUE_EXECUTION","sourceLedgerSha256":PIN,"summary":summary,"decisions":arms,"orderAuthority":False,"fullPenguAnnualTradeReplay":False,"sharedWalletCompleted":False,"productionEligible":False,"limitations":[
      "Only independent PENGU alternative mode arms, not simultaneous BASE + V8/V64. Native raw signals are routed into one conditional PENGU model slot with source helper exit times and source cooldown hours.",
      "Assumes fills at hypothetical ASTER next M5 opens and instant complete source exits at subsequent observed price; actual venue read-back, resident STOPs, partial orders and slippage are UNVERIFIED.",
      "Strict SAFE LIVE policy must NOT release a real slot on source model exit alone; requires signed venue position/order reconciliation. This table is only a conditional research comparator.",
      "Absent first M5 positive volume excludes an entry from this model; future next-bar M5 volume is recorded only ex-post, not used to admit an entry.",
      "No seven-Runner shared exposure, daily loss, cumulative DD, fees/funding, order authority, exact-source release certificate or Owner authorization."]}
    with open(sys.argv[1],"x",encoding="utf8",newline="\n") as f:json.dump(out,f,sort_keys=True,indent=2);f.write("\n")
    print(json.dumps(summary,sort_keys=True))
