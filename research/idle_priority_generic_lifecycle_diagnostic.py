#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, itertools, json, statistics
from pathlib import Path

HOUR=3_600_000
START=1754938800000
END=1786280400000
SYMBOLS=["DOTUSDT","JUPUSDT","RENDERUSDT","TAOUSDT","TIAUSDT"]
EXPECTED_COUNT=393
EXPECTED_SHA="d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019a"
EXPECTED_KEYS_PATH=Path("research/idle_priority_393_generic_candidate_keys.txt")
EXPECTED_FEATURES_PATH=Path("research/idle_priority_393_generic_candidate_features.csv")

def rows(path):
    out=[]
    for line in Path(path).read_text().splitlines():
        if line.strip(): out.append(json.loads(line))
    return out

def find_baseline(root: Path):
    hits=list(root.glob("**/selected-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/portfolio-trades.jsonl"))
    for p in hits:
        r=rows(p)
        if len(r)==1284:
            print(json.dumps({"event":"BASELINE_FOUND","path":str(p),"rows":len(r)}))
            return r
    raise SystemExit(f"BASELINE_1284_NOT_FOUND:{[str(x) for x in hits]}")

def load_market(data_root: Path, sym: str):
    p=data_root/"normalized"/"aster"/"klines"/f"{sym}.jsonl"
    out={}
    for r in rows(p):
        t=int(r["event_time_ms"])
        out[t]={
            "o":float(r["open"]),"h":float(r["high"]),"l":float(r["low"]),"c":float(r["close"]),
            "q":float(r.get("quote_volume",r.get("quoteVolume",r.get("quote_asset_volume",r.get("quoteAssetVolume",0)))))
        }
    return out

def features(m, btc, t):
    def g(ts):
        x=m.get(ts)
        if not x: raise KeyError(ts)
        return x
    def gb(ts):
        x=btc.get(ts)
        if not x: raise KeyError(ts)
        return x
    s1=g(t-HOUR); s13=g(t-13*HOUR); s25=g(t-25*HOUR)
    b1=gb(t-HOUR); b25=gb(t-25*HOUR)
    prior24=[g(t-(i+2)*HOUR) for i in range(24)]
    prior72=[g(t-(i+2)*HOUR) for i in range(72)]
    atr14=[g(t-(i+1)*HOUR) for i in range(14)]
    tr=[]
    for i,row in enumerate(atr14):
        prev=g(t-(i+2)*HOUR)
        tr.append(max(row["h"]-row["l"],abs(row["h"]-prev["c"]),abs(row["l"]-prev["c"])))
    ret12=s1["c"]/s13["c"]-1
    ret24=s1["c"]/s25["c"]-1
    btc24=b1["c"]/b25["c"]-1
    med=statistics.median([x["q"] for x in prior72])
    return {
        "ret12":ret12,"ret24":ret24,"btc24":btc24,"rel24":ret24-btc24,
        "atr":sum(tr)/14/s1["c"],"vr":s1["q"]/med if med else float("inf"),
        "break_short":s1["c"]<min(x["c"] for x in prior24),
        "break_long":s1["c"]>max(x["c"] for x in prior24),
    }

def gates(f):
    return {
        ("BREAKOUT","LONG"): f["break_long"] and f["vr"]>=1.30 and f["atr"]>=0.007,
        ("BREAKOUT","SHORT"):f["break_short"] and f["vr"]>=1.30 and f["atr"]>=0.007,
        ("MOMENTUM","LONG"):f["ret12"]>=0.03 and f["vr"]>=1.00 and f["atr"]>=0.007,
        ("MOMENTUM","SHORT"):f["ret12"]<=-0.03 and f["vr"]>=1.00 and f["atr"]>=0.007,
        ("RELATIVE","LONG"):f["rel24"]>=0.03 and f["vr"]>=0.80 and f["atr"]>=0.007,
        ("RELATIVE","SHORT"):f["rel24"]<=-0.03 and f["vr"]>=0.80 and f["atr"]>=0.007,
    }

def digest(cands):
    body="".join(f"{s}|{t}|{a}|{side}\n" for s,t,a,side in sorted(cands,key=lambda x:(x[1],x[0])))
    return hashlib.sha256(body.encode()).hexdigest()

def idle_masks(trades):
    entries={}
    exits={}
    for r in trades:
        en=int(r["entry_ts_ms"]); ex=int(r["exit_ts_ms"])
        entries[en]=entries.get(en,0)+1
        exits[ex]=exits.get(ex,0)+1
    variants={}
    for exit_before in (True,False):
        for same_entry_blocks in (True,False):
            active=0; idle=set()
            for t in range(START,END+1,HOUR):
                if exit_before: active=max(0,active-exits.get(t,0))
                e=entries.get(t,0)
                if active==0 and (not same_entry_blocks or e==0): idle.add(t)
                active+=e
                if not exit_before: active=max(0,active-exits.get(t,0))
            variants[(exit_before,same_entry_blocks)]=idle
    return variants

def run_model(all_states, idle, mode, priority, side_order, mask_mode):
    out=[]; last={}; prev={}
    for t in range(START,END+1,HOUR):
        is_idle=t in idle
        for sym in SYMBOLS:
            st=all_states.get((sym,t))
            if st is None: continue
            eligible=[]
            for a in priority:
                for side in side_order:
                    k=(a,side); active=bool(st[k]); pk=(sym,a,side)
                    was=prev.get(pk,False)
                    # EDGE state evolution can be global or idle-only depending on mask_mode.
                    if mask_mode!="IDLE_ONLY_EDGE_STATE" or is_idle:
                        prev[pk]=active
                    edge_ok=active and (mode=="LEVEL" or not was)
                    if edge_ok: eligible.append((a,side))
            if not eligible: continue
            chosen=eligible[0]
            if mask_mode in ("IDLE_BEFORE","IDLE_ONLY_EDGE_STATE") and not is_idle:
                continue
            lt=last.get(sym,0)
            if lt and t-lt<12*HOUR:
                continue
            # In EMIT_IDLE_ONLY, non-idle generic candidates consume cooldown.
            last[sym]=t
            if mask_mode=="EMIT_IDLE_ONLY" and not is_idle:
                continue
            out.append((sym,t,chosen[0],chosen[1]))
    return out

ap=argparse.ArgumentParser()
ap.add_argument("--release-root",required=True)
ap.add_argument("--data-root",required=True)
a=ap.parse_args()
root=Path(a.release_root); data_root=Path(a.data_root)
base=find_baseline(root)
idle_variants=idle_masks(base)
btc=load_market(data_root,"BTCUSDT")
market={s:load_market(data_root,s) for s in SYMBOLS}
# Verify source feature timestamp/formula parity independently of lifecycle selection.
feature_rows=[]
for raw in EXPECTED_FEATURES_PATH.read_text().splitlines():
    raw=raw.strip()
    if not raw or raw.startswith("#") or raw.startswith("symbol,"): continue
    s,t,a0,side,r12,r24,rel,vr,atr=raw.split(",")
    feature_rows.append((s,int(t),{"ret12":float(r12),"ret24":float(r24),"rel24":float(rel),"vr":float(vr),"atr":float(atr)}))
feature_diag={}
for offset_hours in (-1,0,1):
    errors={k:[] for k in ("ret12","ret24","rel24","vr","atr")}
    compared=0
    for s,t,src in feature_rows:
        try: calc=features(market[s],btc,t+offset_hours*HOUR)
        except KeyError: continue
        compared+=1
        for k in errors: errors[k].append(abs(calc[k]-src[k]))
    feature_diag[str(offset_hours)]={
        "compared":compared,
        "mean_abs":{k:(sum(v)/len(v) if v else None) for k,v in errors.items()},
        "max_abs":{k:(max(v) if v else None) for k,v in errors.items()},
        "near_exact":sum(
            1 for s,t,src in feature_rows
            if (lambda calc: abs(calc["ret12"]-src["ret12"])<1e-10 and abs(calc["ret24"]-src["ret24"])<1e-10
                and abs(calc["rel24"]-src["rel24"])<1e-10 and abs(calc["vr"]-src["vr"])<1e-8 and abs(calc["atr"]-src["atr"])<1e-10)
               (features(market[s],btc,t+offset_hours*HOUR))
        )
    }
print(json.dumps({"event":"SOURCE_FEATURE_PARITY","offset_hours":feature_diag},sort_keys=True))

all_states={}
for t in range(START,END+1,HOUR):
    for s in SYMBOLS:
        try: all_states[(s,t)]=gates(features(market[s],btc,t))
        except KeyError: pass

expected_keys=set(
    line.strip() for line in EXPECTED_KEYS_PATH.read_text().splitlines()
    if line.strip() and not line.startswith("#")
)
if len(expected_keys)!=393: raise SystemExit(f"EXPECTED_KEYS_COUNT:{len(expected_keys)}")
results=[]
best_rows=None
best_row=None
best_symdiff=None
for (exit_before,same_entry_blocks),idle in idle_variants.items():
  for mode in ("LEVEL","EDGE"):
    for priority in itertools.permutations(("BREAKOUT","MOMENTUM","RELATIVE")):
      for side_order in (("LONG","SHORT"),("SHORT","LONG")):
        for mask_mode in ("IDLE_BEFORE","EMIT_IDLE_ONLY","IDLE_ONLY_EDGE_STATE"):
          out=run_model(all_states,idle,mode,priority,side_order,mask_mode)
          sha=digest(out)
          row={
            "exit_before":exit_before,"same_entry_blocks":same_entry_blocks,"idle_hours":len(idle),
            "mode":mode,"priority":">".join(priority),"side_order":">".join(side_order),"mask_mode":mask_mode,
            "count":len(out),"sha256":sha,"match":len(out)==EXPECTED_COUNT and sha==EXPECTED_SHA
          }
          distance=abs(len(out)-EXPECTED_COUNT)
          out_keys=set(f"{s}|{t}|{a}|{side}" for s,t,a,side in out)
          symdiff=len(out_keys ^ expected_keys)
          row["symmetric_diff"]=symdiff
          if best_symdiff is None or symdiff < best_symdiff:
              best_symdiff=symdiff
              best_row=dict(row)
              best_rows=list(out)
          if row["match"] or distance<=20 or symdiff<=20: results.append(row)
matches=[x for x in results if x["match"]]
print(json.dumps({"event":"GENERIC_LIFECYCLE_SEARCH","expected_count":EXPECTED_COUNT,"expected_sha":EXPECTED_SHA,"matches":matches,"near":results[:120]},sort_keys=True))
if len(matches)!=1:
    best_keys=set(f"{s}|{t}|{a}|{side}" for s,t,a,side in (best_rows or []))
    print(json.dumps({
        "event":"GENERIC_LIFECYCLE_BEST_NEAR",
        "model":best_row,
        "missing":sorted(expected_keys-best_keys),
        "extras":sorted(best_keys-expected_keys),
        "rows":best_rows,
    },sort_keys=True))
    raise SystemExit(f"GENERIC_MODEL_MATCH_COUNT:{len(matches)}")
