"""Read-only source/price-model binding for 29 selected S34 signals, not fills."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
import json
import sys
ROOT = Path(__file__).resolve().parents[2]
INPUTS = {
 "selected": ("STABLE4_Q102_FULL_UNIVERSE_S34_CLOCK_SELECTION_20261128.json","f4338565bd408b97f48359d83f80fe4503ef76d7f2518fe23b322d372b947e01"),
 "raw": ("STABLE4_Q102_S34_ANNUAL_SOURCE_INVENTORY_20261128.json","04209f9c8e49d8fcb781f6aa2afa7a16952dd9a3f2e876866ee1fa40bf73eeac"),
 "m5": ("STABLE4_Q102_S34_M5_EXIT_OBSERVATIONS_20261128.json","b1c2d6f336d7441eeb367ec1660167c04706266a744136cb805508c62d218373"),
}
def load():
    docs={}
    for k,(name,pin) in INPUTS.items():
        b=(ROOT/"docs/research"/name).read_bytes()
        if sha256(b).hexdigest()!=pin: raise ValueError("EVIDENCE_PIN_MISMATCH:"+name)
        docs[k]=json.loads(b)
        if docs[k]["orderAuthority"] is not False or docs[k]["fullQ102AnnualReplay"] is not False: raise ValueError("EVIDENCE_SCOPE")
        for p,h in docs[k]["sourcePins"].items():
            if sha256((ROOT/p).read_bytes()).hexdigest()!=h: raise ValueError("SOURCE_PIN_MISMATCH:"+p)
    return docs
def evaluate(d):
    raw=d["raw"]["events"]
    by_id={r["id"]:r for r in d["m5"]["rows"]}
    if len(raw)!=520 or len(by_id)!=520 or len(d["selected"]["observations"])!=52: raise ValueError("LEDGER_SHAPE")
    if d["m5"]["inputLedgerSha256"]!=INPUTS["raw"][1]: raise ValueError("M5_INPUT_PIN")
    rows=[]
    for r in d["selected"]["observations"]:
        s=r["signal"]
        if s["side"]==0: continue
        if s["dataCutoffTs"]!=r["decisionTs"]-3600000 or s["referenceTs"]!=r["decisionTs"]: raise ValueError("CAUSAL_SELECTION")
        matches=[c for c in raw if (c["entryTs"],c["symbol"],c["variant"],c["side"])==(r["decisionTs"],s["symbol"],s["variant"],s["side"])]
        if len(matches)!=1: raise ValueError("RAW_CANDIDATE_BINDING")
        c=matches[0]
        for field in ("family","hardStop","maxHoldHours","exitPolicy","layer","dataCutoffTs"):
            if s[field]!=c[field]: raise ValueError("EXIT_POLICY_MISMATCH:"+field)
        m=by_id[c["id"]]
        if (m["entryTs"],m["symbol"],m["side"],m["key"])!=(c["entryTs"],c["symbol"],c["side"],c["key"]): raise ValueError("M5_CANDIDATE_BINDING")
        rows.append({"id":c["id"],"signal":s,"entryTs":c["entryTs"],"base":m["base"],"profitFloor":m["profitFloor"]})
    if len(rows)!=29: raise ValueError("SELECTION_COUNT")
    summary={}
    for arm in ("base","profitFloor"):
        summary[arm]={"status":dict(Counter(r[arm]["status"] for r in rows)),"reason":dict(Counter(r[arm]["reason"] for r in rows if "reason" in r[arm]))}
    return {"schema":"stable4-q102-selected-s34-m5-binding/v1","status":"PARTIAL_SELECTED_SIGNALS_PRICE_MODEL_BINDING_ONLY","inputPins":{k:v[1] for k,v in INPUTS.items()},"selected":len(rows),"summary":summary,"rows":rows,"orderAuthority":False,"fullQ102AnnualReplay":False,"limitations":["All sleeves assumed idle in selected source ledger. No one-slot replay or other HIGH_VOL clocks.","Base and floor exit arms omit adopted PB adverse policy. Prices are M5 proxies, not actual fills. Missing exit is unresolved; do not free slot from missing evidence.","No PnL, DD, funding, shared risk, or LIVE authority."]}
if __name__=="__main__":
    result=evaluate(load())
    with open(sys.argv[1],"x",encoding="utf8",newline="\n") as f: json.dump(result,f,indent=2,sort_keys=True);f.write("\n")
    print(json.dumps(result["summary"],sort_keys=True))
