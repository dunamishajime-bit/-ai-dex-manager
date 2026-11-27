"""Counterfactual delayed price observation at due time; never actual exit confirmation."""
from pathlib import Path
from hashlib import sha256
from collections import Counter
import gzip,json,math,sys
from stable4_q102_selected_one_slot_replay import load,replay,ROOT,PINS,END
M=300000
def run(root):
    rows=load()
    model=json.loads((ROOT/"docs/research"/next(iter(PINS))).read_bytes())
    revised=[]
    gaps=[]
    for r in rows:
        if r["status"]!="TIME_EXIT_PRICE_UNAVAILABLE":
            revised.append(r);continue
        symbol=r["signal"]["symbol"]
        due=r["entryTs"]+r["signal"]["maxHoldHours"]*3600000
        meta=[x for x in model["files"] if x["symbol"]==symbol and x["folder"]=="aster-public-v3-5m-suffix"]
        if len(meta)!=1:raise ValueError("ARCHIVE_MISSING")
        a=meta[0];raw=(root/a["folder"]/a["file"]).read_bytes()
        if sha256(raw).hexdigest()!=a["sha256"]:raise ValueError("ARCHIVE_SHA")
        by={}
        for line in gzip.decompress(raw).splitlines():
            b=json.loads(line);ts=int(b[0])
            if due<=ts<min(due+12*M,END):
                if ts in by:raise ValueError("DUPLICATE")
                by[ts]=b
        found=None
        for t in range(due,min(due+12*M,END),M):
            b=by.get(t)
            if b is None:break
            op,hi,lo,cl,vol,q,trades=map(float,[b[1],b[2],b[3],b[4],b[5],b[7],b[8]])
            if not (int(b[6])==t+M-1 and all(map(math.isfinite,[op,hi,lo,cl,vol,q,trades])) and min(op,lo,cl)>0 and lo<=min(op,cl) and hi>=max(op,cl) and vol>=0 and q>=0 and trades.is_integer() and trades>=0 and (vol==0)==(trades==0)):break
            if vol>0:
                found={"entryTs":r["entryTs"],"symbol":symbol,"dueTs":due,"observedBarOpenTs":t,"priceObservationTs":t+M,"delayMinutes":(t+M-due)//60000,"observedClose":cl,"volume":vol,"trades":int(trades),"sourceSha256":a["sha256"],"status":"COUNTERFACTUAL_PRICE_ONLY"}
                break
        if found:
            gaps.append(found)
            revised.append({**r,"status":"MODELED_EXIT_NOT_FILL","exitTs":found["priceObservationTs"],"exitPrice":found["observedClose"],"reason":"DELAYED_TIME_PRICE_COUNTERFACTUAL"})
        else:
            gaps.append({"entryTs":r["entryTs"],"symbol":symbol,"dueTs":due,"status":"UNRESOLVED"});revised.append(r)
    strict=replay(rows);conditional=replay(revised)
    summarize=lambda x:dict(Counter(y["decision"] for y in x))
    return {"schema":"stable4-q102-time-exit-gap-sensitivity/v1","status":"COUNTERFACTUAL_PRICE_SENSITIVITY_NOT_EXECUTION","inputPins":PINS,"maxWaitMinutes":60,"gaps":gaps,"strict":summarize(strict),"conditional":summarize(conditional),"conditionalDecisions":conditional,"orderAuthority":False,"fullQ102AnnualReplay":False,"limitations":["Does not change the strict unresolved-slot result. Assumes pending time exit can be modeled at first later positive-volume M5 close, not proof of executable quote, actual order or fill.","Does not replay protection or slippage during delay; competing STOP/quote path unknown, so alternative is sensitivity only. Other sleeves assumed idle, no PnL/DD or annual certification."]}
if __name__=="__main__":
    result=run(Path(sys.argv[1]))
    with open(sys.argv[2],"x",encoding="utf8",newline="\n") as f:json.dump(result,f,indent=2,sort_keys=True);f.write("\n")
    print(json.dumps({k:result[k] for k in ("gaps","strict","conditional")},sort_keys=True))
