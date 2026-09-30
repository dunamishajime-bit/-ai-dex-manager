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

def find_baselines(root: Path):
    specs=[
      ("selected1284","**/selected-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/portfolio-trades.jsonl",1284),
      ("historical1046","**/baseline-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/portfolio-trades.jsonl",1046),
      ("historical1050_cap","**/baseline-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_CAP_ONLY/PRICE_MODEL_10BPS/portfolio-trades.jsonl",1050),
      ("historical1037_unmodified","**/baseline-five-logic-all-cases-all-costs/CURRENT_BASELINE_UNMODIFIED/PRICE_MODEL_10BPS/portfolio-trades.jsonl",1037),
    ]
    out={}
    for name,pattern,count in specs:
        hits=list(root.glob(pattern))
        for p in hits:
            r=rows(p)
            if len(r)==count:
                out[name]=r
                print(json.dumps({"event":"BASELINE_FOUND","name":name,"path":str(p),"rows":len(r)}))
                break
    if not out: raise SystemExit("NO_BASELINES_FOUND")
    return out

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
        "break_close_close_short":s1["c"]<min(x["c"] for x in prior24),
        "break_close_close_long":s1["c"]>max(x["c"] for x in prior24),
        "break_close_hilo_short":s1["c"]<min(x["l"] for x in prior24),
        "break_close_hilo_long":s1["c"]>max(x["h"] for x in prior24),
        "break_wick_hilo_short":s1["l"]<min(x["l"] for x in prior24),
        "break_wick_hilo_long":s1["h"]>max(x["h"] for x in prior24),
        "pen_close_close_short":max(0.0,(min(x["c"] for x in prior24)-s1["c"])/s1["c"]),
        "pen_close_close_long":max(0.0,(s1["c"]-max(x["c"] for x in prior24))/s1["c"]),
        "pen_close_hilo_short":max(0.0,(min(x["l"] for x in prior24)-s1["c"])/s1["c"]),
        "pen_close_hilo_long":max(0.0,(s1["c"]-max(x["h"] for x in prior24))/s1["c"]),
        "pen_wick_hilo_short":max(0.0,(min(x["l"] for x in prior24)-s1["l"])/s1["c"]),
        "pen_wick_hilo_long":max(0.0,(s1["h"]-max(x["h"] for x in prior24))/s1["c"]),
    }

def gates(f, breakout_mode):
    return {
        ("BREAKOUT","LONG"): f[f"break_{breakout_mode}_long"] and f["vr"]>=1.30 and f["atr"]>=0.007,
        ("BREAKOUT","SHORT"):f[f"break_{breakout_mode}_short"] and f["vr"]>=1.30 and f["atr"]>=0.007,
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

def run_model(states, idle, mode, priority, side_order, mask_mode):
    out=[]; last={}; prev={}
    for t in range(START,END+1,HOUR):
        is_idle=t in idle
        for sym in SYMBOLS:
            st=states.get((sym,t))
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
baselines=find_baselines(root)
idle_variants_by_baseline={name:idle_masks(trades) for name,trades in baselines.items()}
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
    near_exact=0
    for s,t,src in feature_rows:
        try: calc=features(market[s],btc,t+offset_hours*HOUR)
        except KeyError: continue
        if (abs(calc["ret12"]-src["ret12"])<1e-10 and abs(calc["ret24"]-src["ret24"])<1e-10
            and abs(calc["rel24"]-src["rel24"])<1e-10 and abs(calc["vr"]-src["vr"])<1e-8 and abs(calc["atr"]-src["atr"])<1e-10):
            near_exact+=1
    feature_diag[str(offset_hours)]={
        "compared":compared,
        "mean_abs":{k:(sum(v)/len(v) if v else None) for k,v in errors.items()},
        "max_abs":{k:(max(v) if v else None) for k,v in errors.items()},
        "near_exact":near_exact
    }
print(json.dumps({"event":"SOURCE_FEATURE_PARITY","offset_hours":feature_diag},sort_keys=True))

breakout_modes=("close_close","close_hilo","wick_hilo")
all_states={mode:{} for mode in breakout_modes}
for t in range(START,END+1,HOUR):
    for s in SYMBOLS:
        try:
            ff=features(market[s],btc,t)
            for mode in breakout_modes: all_states[mode][(s,t)]=gates(ff,mode)
        except KeyError: pass

def strength_candidates(f, breakout_mode, score_mode):
    rows=[]
    specs=[
      ("BREAKOUT","LONG",f[f"break_{breakout_mode}_long"],f[f"pen_{breakout_mode}_long"],1.30),
      ("BREAKOUT","SHORT",f[f"break_{breakout_mode}_short"],f[f"pen_{breakout_mode}_short"],1.30),
      ("MOMENTUM","LONG",f["ret12"]>=0.03,max(0.0,f["ret12"]-0.03),1.00),
      ("MOMENTUM","SHORT",f["ret12"]<=-0.03,max(0.0,-f["ret12"]-0.03),1.00),
      ("RELATIVE","LONG",f["rel24"]>=0.03,max(0.0,f["rel24"]-0.03),0.80),
      ("RELATIVE","SHORT",f["rel24"]<=-0.03,max(0.0,-f["rel24"]-0.03),0.80),
    ]
    for a,side,directional,edge,vrmin in specs:
        if not directional or f["vr"]<vrmin or f["atr"]<0.007: continue
        # Price/return edge is measured against each gate's boundary.  Breakout
        # has a zero crossing boundary, so scale penetration by ATR to keep it
        # comparable to return/relative excess.
        primary=(edge/max(f["atr"],1e-12)) if a=="BREAKOUT" else edge/0.03
        vr=f["vr"]/vrmin
        atr=f["atr"]/0.007
        if score_mode=="PRIMARY": score=primary
        elif score_mode=="PRIMARY_PLUS_ONE": score=1.0+primary
        elif score_mode=="PRIMARY_X_VR": score=(1.0+primary)*vr
        elif score_mode=="PRIMARY_X_SQRT_VR": score=(1.0+primary)*(vr**0.5)
        elif score_mode=="PRIMARY_X_ATR": score=(1.0+primary)*atr
        elif score_mode=="PRODUCT": score=(1.0+primary)*vr*atr
        elif score_mode=="GEOMEAN": score=((1.0+primary)*vr*atr)**(1/3)
        elif score_mode=="SUM": score=(1.0+primary)+vr+atr
        elif score_mode=="MIN": score=min(1.0+primary,vr,atr)
        elif score_mode=="MAX": score=max(1.0+primary,vr,atr)
        else: raise ValueError(score_mode)
        rows.append((score,a,side))
    return sorted(rows,key=lambda x:(-x[0],x[1],x[2]))

def run_strength_model(feature_states,idle,breakout_mode,score_mode,mask_mode):
    out=[]; last={}
    for t in range(START,END+1,HOUR):
        is_idle=t in idle
        for sym in SYMBOLS:
            f=feature_states.get((sym,t))
            if f is None: continue
            candidates=strength_candidates(f,breakout_mode,score_mode)
            if not candidates: continue
            if mask_mode=="IDLE_BEFORE" and not is_idle: continue
            lt=last.get(sym,0)
            if lt and t-lt<12*HOUR: continue
            last[sym]=t
            if mask_mode=="EMIT_IDLE_ONLY" and not is_idle: continue
            _,a,side=candidates[0]
            out.append((sym,t,a,side))
    return out

expected_keys=set(
    line.strip() for line in EXPECTED_KEYS_PATH.read_text().splitlines()
    if line.strip() and not line.startswith("#")
)
if len(expected_keys)!=393: raise SystemExit(f"EXPECTED_KEYS_COUNT:{len(expected_keys)}")
results=[]
best_rows=None
best_row=None
best_symdiff=None
for baseline_name,idle_variants in idle_variants_by_baseline.items():
 for breakout_mode in breakout_modes:
  for (exit_before,same_entry_blocks),idle in idle_variants.items():
   for mode in ("LEVEL","EDGE"):
    for priority in itertools.permutations(("BREAKOUT","MOMENTUM","RELATIVE")):
     for side_order in (("LONG","SHORT"),("SHORT","LONG")):
      for mask_mode in ("IDLE_BEFORE","EMIT_IDLE_ONLY","IDLE_ONLY_EDGE_STATE"):
       out=run_model(all_states[breakout_mode],idle,mode,priority,side_order,mask_mode)
       sha=digest(out)
       row={
        "baseline":baseline_name,
        "breakout_mode":breakout_mode,
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
# Search strength-ranked causal winner selection after fixed-priority models.
feature_states={}
for t in range(START,END+1,HOUR):
    for s in SYMBOLS:
        try: feature_states[(s,t)]=features(market[s],btc,t)
        except KeyError: pass
strength_results=[]
strength_best=None
strength_best_rows=None
strength_best_diff=None
for baseline_name,idle_variants in idle_variants_by_baseline.items():
 for breakout_mode in breakout_modes:
  for (exit_before,same_entry_blocks),idle in idle_variants.items():
   for score_mode in ("PRIMARY","PRIMARY_PLUS_ONE","PRIMARY_X_VR","PRIMARY_X_SQRT_VR","PRIMARY_X_ATR","PRODUCT","GEOMEAN","SUM","MIN","MAX"):
    for mask_mode in ("IDLE_BEFORE","EMIT_IDLE_ONLY"):
      out=run_strength_model(feature_states,idle,breakout_mode,score_mode,mask_mode)
      out_keys=set(f"{s}|{t}|{a}|{side}" for s,t,a,side in out)
      symdiff=len(out_keys ^ expected_keys)
      row={"baseline":baseline_name,"breakout_mode":breakout_mode,"exit_before":exit_before,"same_entry_blocks":same_entry_blocks,
           "idle_hours":len(idle),"score_mode":score_mode,"mask_mode":mask_mode,"count":len(out),
           "sha256":digest(out),"symmetric_diff":symdiff}
      row["match"]=len(out)==EXPECTED_COUNT and row["sha256"]==EXPECTED_SHA
      if strength_best_diff is None or symdiff<strength_best_diff:
          strength_best_diff=symdiff; strength_best=row; strength_best_rows=list(out)
      if row["match"] or symdiff<=80 or abs(len(out)-EXPECTED_COUNT)<=10: strength_results.append(row)
strength_matches=[r for r in strength_results if r["match"]]
print(json.dumps({"event":"GENERIC_STRENGTH_SEARCH","matches":strength_matches,"best":strength_best,"near":sorted(strength_results,key=lambda r:(r["symmetric_diff"],abs(r["count"]-EXPECTED_COUNT)))[:80]},sort_keys=True))
if strength_best_rows is not None:
    strength_keys=set(f"{s}|{t}|{a}|{side}" for s,t,a,side in strength_best_rows)
    print(json.dumps({"event":"GENERIC_STRENGTH_BEST_DIFF","model":strength_best,
                      "missing":sorted(expected_keys-strength_keys),"extras":sorted(strength_keys-expected_keys)},sort_keys=True))
if len(strength_matches)==1:
    print("GENERIC_STRENGTH_MODEL_EXACT_MATCH")
    raise SystemExit(0)

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
