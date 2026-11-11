#!/usr/bin/env python3
from pathlib import Path
import json,datetime as dt,hashlib,collections

R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
PRE=R/"PREPERIOD_TRAIN_20250322_20251001"/"V4_DUALSIDE_LIFECYCLE"/"v4-pre-dualside-modeled-exits.jsonl"
FWD=R/"FORWARD_HOLDOUT_20261001_20261108"/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl"
OUT=R/"DIRECTION_RESEARCH_20261109"/"v4_symbol_direction_pretarget_freeze_forward_falsification_20261111.json"
COST=.003
T1=int(dt.datetime(2025,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
T2=int(dt.datetime(2025,9,1,tzinfo=dt.timezone.utc).timestamp()*1000)

pre=[json.loads(x) for x in PRE.read_text(encoding="utf-8").splitlines() if x.strip()]
fwd=[json.loads(x) for x in FWD.read_text(encoding="utf-8").splitlines() if x.strip()]

def met(rows):
    v=[float(z["rawReturn"])-COST for z in rows]
    gp=sum(x for x in v if x>0);gl=-sum(x for x in v if x<0)
    return {"n":len(v),"wr":sum(x>0 for x in v)/len(v) if v else None,
            "mean":sum(v)/len(v) if v else None,"sum":sum(v),
            "pf":gp/gl if gl else (999.0 if gp>0 else None)}
def bymode(rows,mode): return [z for z in rows if z.get("mode")==mode]
def split(rows):
    return {
      "train":[z for z in rows if z["entryTs"]<T1],
      "validation":[z for z in rows if T1<=z["entryTs"]<T2],
      "prehold":[z for z in rows if z["entryTs"]>=T2],
    }

symbols=sorted(set(z["symbol"] for z in pre))
audit={}
frozen=[]
for sym in symbols:
    ps=[z for z in pre if z["symbol"]==sym]
    sp=split(ps)
    native={k:met(bymode(v,"NATIVE")) for k,v in sp.items()}
    opposite={k:met(bymode(v,"OPPOSITE")) for k,v in sp.items()}
    # Strict pre-target freeze: enough data in all three temporal buckets,
    # native direction economically negative in every bucket, opposite direction
    # strictly better in every bucket, and the full pre-target native PF < 0.5.
    fulln=met(bymode(ps,"NATIVE"));fullo=met(bymode(ps,"OPPOSITE"))
    enough=native["train"]["n"]>=10 and native["validation"]["n"]>=5 and native["prehold"]["n"]>=3
    persist=all(native[k]["mean"] is not None and native[k]["mean"]<0 and (native[k]["pf"] or 0)<1 for k in native)
    oppbetter=all(opposite[k]["mean"] is not None and opposite[k]["mean"]>native[k]["mean"] for k in native)
    severe=(fulln["n"]>=20 and fulln["mean"]<0 and (fulln["pf"] or 0)<0.5)
    freeze=bool(enough and persist and oppbetter and severe)
    if freeze:frozen.append(sym)
    audit[sym]={"native":native,"opposite":opposite,"fullPretargetNative":fulln,"fullPretargetOpposite":fullo,
                "freezeBlockPretargetOnly":freeze,
                "criteria":{"enough":enough,"persistentNativeLoss":persist,"oppositeStrictlyBetterEverySplit":oppbetter,"fullPretargetSevere":severe}}

# Forward is read only after the pre-target symbol set is frozen.
forward={}
for sym in frozen:
    fs=[z for z in fwd if z["symbol"]==sym]
    forward[sym]={"native":met(bymode(fs,"NATIVE")),"opposite":met(bymode(fs,"OPPOSITE"))}
# A frozen BLOCK is accepted only if independent forward does not contradict the
# reason for blocking: native mean must remain <= 0 and native PF <= 1.
accepted=[s for s in frozen if forward[s]["native"]["n"]>=3 and
          forward[s]["native"]["mean"] is not None and forward[s]["native"]["mean"]<=0 and
          (forward[s]["native"]["pf"] or 0)<=1]
rejected=[s for s in frozen if s not in accepted]

out={
 "status":"V4_SYMBOL_DIRECTION_PRETARGET_FREEZE_TRUE_FORWARD_FALSIFICATION",
 "costBps":30,
 "pretargetSplit":{"train":"2025-03-22..2025-06-30","validation":"2025-07-01..2025-08-31","prehold":"2025-09-01..2025-09-30"},
 "freezeCriteria":{
   "trainMinN":10,"validationMinN":5,"preholdMinN":3,
   "nativeMeanNegativeEveryPretargetSplit":True,"nativePfBelow1EveryPretargetSplit":True,
   "oppositeMeanStrictlyBetterEveryPretargetSplit":True,
   "fullPretargetMinN":20,"fullPretargetPfBelow":0.5
 },
 "audit":audit,
 "frozenPretargetOnly":frozen,
 "forwardOneShot":forward,
 "acceptedAfterForwardFalsification":accepted,
 "rejectedByForwardFalsification":rejected,
 "decision":"BLOCK_ONLY_NOT_FLIP. Opposite-side outcomes are diagnostic; a flip is never promoted because forward opposite may still be negative.",
 "hashes":{"pre":hashlib.sha256(PRE.read_bytes()).hexdigest(),"forward":hashlib.sha256(FWD.read_bytes()).hexdigest()},
 "warnings":[
   "Current V4 route catalog is research-frozen and replayed backward; this is not historical as-deployed evidence.",
   "No 2025-10-01..2026-10-01 target outcome is read when freezing the symbol set.",
   "Forward 2026-10..11 is falsification only and cannot add a new symbol to the frozen set."
 ]
}
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("FROZEN_PRETARGET",frozen)
print("FORWARD",json.dumps(forward,separators=(",",":")))
print("ACCEPTED_BLOCK",accepted,"REJECTED_FORWARD",rejected)
for s in frozen:
 print("PRE",s,json.dumps(audit[s],separators=(",",":")))
print("OUT",OUT,"SHA256",hashlib.sha256(OUT.read_bytes()).hexdigest())
