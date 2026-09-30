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
EXPECTED_KEYS=Path("research/idle_priority_393_generic_candidate_keys.txt")

def jsonl(path):
    out=[]
    try:
        for line in path.read_text().splitlines():
            if line.strip(): out.append(json.loads(line))
    except Exception:
        return []
    return out

def load_market(root,sym):
    p=root/"normalized"/"aster"/"klines"/f"{sym}.jsonl"
    out={}
    for r in jsonl(p):
        t=int(r["event_time_ms"])
        out[t]={"h":float(r["high"]),"l":float(r["low"]),"c":float(r["close"]),
                "q":float(r.get("quote_volume",r.get("quoteVolume",r.get("quote_asset_volume",r.get("quoteAssetVolume",0)))))}
    return out

def feat(m,btc,t):
    def g(ts):
        if ts not in m: raise KeyError(ts)
        return m[ts]
    def gb(ts):
        if ts not in btc: raise KeyError(ts)
        return btc[ts]
    s1=g(t-HOUR); s13=g(t-13*HOUR); s25=g(t-25*HOUR); b1=gb(t-HOUR); b25=gb(t-25*HOUR)
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
    med=statistics.median(x["q"] for x in prior72)
    rel=ret24-btc24
    return {
      ("BREAKOUT","LONG"): s1["c"]>max(x["c"] for x in prior24) and s1["q"]/med>=1.30 and sum(tr)/14/s1["c"]>=.007,
      ("BREAKOUT","SHORT"): s1["c"]<min(x["c"] for x in prior24) and s1["q"]/med>=1.30 and sum(tr)/14/s1["c"]>=.007,
      ("MOMENTUM","LONG"): ret12>=.03 and s1["q"]/med>=1.00 and sum(tr)/14/s1["c"]>=.007,
      ("MOMENTUM","SHORT"): ret12<=-.03 and s1["q"]/med>=1.00 and sum(tr)/14/s1["c"]>=.007,
      ("RELATIVE","LONG"): rel>=.03 and s1["q"]/med>=.80 and sum(tr)/14/s1["c"]>=.007,
      ("RELATIVE","SHORT"): rel<=-.03 and s1["q"]/med>=.80 and sum(tr)/14/s1["c"]>=.007,
    }

def idle_mask(trades,exit_before=True,same_entry_blocks=True):
    entries={}; exits={}
    for r in trades:
        try: en=int(r["entry_ts_ms"]); ex=int(r["exit_ts_ms"])
        except Exception: continue
        entries[en]=entries.get(en,0)+1; exits[ex]=exits.get(ex,0)+1
    active=0; idle=set()
    for t in range(START,END+1,HOUR):
        if exit_before: active=max(0,active-exits.get(t,0))
        e=entries.get(t,0)
        if active==0 and (not same_entry_blocks or e==0): idle.add(t)
        active+=e
        if not exit_before: active=max(0,active-exits.get(t,0))
    return idle

def mask_sha(idle):
    return hashlib.sha256((",".join(map(str,sorted(idle)))).encode()).hexdigest()

def digest(rows):
    body="".join(f"{s}|{t}|{a}|{side}\n" for s,t,a,side in sorted(rows,key=lambda x:(x[1],x[0])))
    return hashlib.sha256(body.encode()).hexdigest()

def run(states,idle,mode,priority,side_order,mask_mode):
    out=[]; last={}; prev={}
    for t in range(START,END+1,HOUR):
        is_idle=t in idle
        for sym in SYMBOLS:
            st=states.get((sym,t))
            if st is None: continue
            elig=[]
            for a in priority:
                for side in side_order:
                    k=(a,side); active=bool(st[k]); pk=(sym,a,side); was=prev.get(pk,False)
                    if mask_mode!="IDLE_ONLY_EDGE_STATE" or is_idle: prev[pk]=active
                    if active and (mode=="LEVEL" or not was): elig.append(k)
            if not elig: continue
            if mask_mode in ("IDLE_BEFORE","IDLE_ONLY_EDGE_STATE") and not is_idle: continue
            lt=last.get(sym,0)
            if lt and t-lt<12*HOUR: continue
            last[sym]=t
            if mask_mode=="EMIT_IDLE_ONLY" and not is_idle: continue
            a,side=elig[0]; out.append((sym,t,a,side))
    return out

ap=argparse.ArgumentParser()
ap.add_argument("--release-root",required=True)
ap.add_argument("--data-root",required=True)
a=ap.parse_args()
release=Path(a.release_root); data=Path(a.data_root)

expected=set(line.strip() for line in EXPECTED_KEYS.read_text().splitlines() if line.strip() and not line.startswith("#"))
if len(expected)!=EXPECTED_COUNT: raise SystemExit(f"EXPECTED_COUNT_BAD:{len(expected)}")

btc=load_market(data,"BTCUSDT"); market={s:load_market(data,s) for s in SYMBOLS}
states={}
for t in range(START,END+1,HOUR):
    for s in SYMBOLS:
        try: states[(s,t)]=feat(market[s],btc,t)
        except KeyError: pass

ledger_paths=list(release.rglob("portfolio-trades.jsonl"))
print(json.dumps({"event":"LEDGER_SCAN_START","files":len(ledger_paths)}))

mask_sources={}
for p in ledger_paths:
    trades=jsonl(p)
    if not trades or not all(isinstance(x,dict) for x in trades): continue
    # keep broad enough to include the 1033-era and all later formal variants
    if len(trades)<700 or len(trades)>1800: continue
    for exit_before in (True,False):
      for same_entry_blocks in (True,False):
        idle=idle_mask(trades,exit_before,same_entry_blocks)
        ms=mask_sha(idle)
        mask_sources.setdefault(ms,{"idle":idle,"sources":[]})
        if len(mask_sources[ms]["sources"])<8:
            mask_sources[ms]["sources"].append({"path":str(p.relative_to(release)),"rows":len(trades),
              "exit_before":exit_before,"same_entry_blocks":same_entry_blocks})

print(json.dumps({"event":"UNIQUE_IDLE_MASKS","count":len(mask_sources)}))
best=None; exact=[]
priorities=list(itertools.permutations(("BREAKOUT","MOMENTUM","RELATIVE")))
for mi,(ms,payload) in enumerate(mask_sources.items()):
    idle=payload["idle"]
    for mode in ("LEVEL","EDGE"):
      for priority in priorities:
       for side_order in (("LONG","SHORT"),("SHORT","LONG")):
        for mask_mode in ("IDLE_BEFORE","EMIT_IDLE_ONLY","IDLE_ONLY_EDGE_STATE"):
          rows=run(states,idle,mode,priority,side_order,mask_mode)
          keys=set(f"{s}|{t}|{ar}|{side}" for s,t,ar,side in rows)
          diff=len(keys^expected); sha=digest(rows)
          row={"maskSha":ms,"idleHours":len(idle),"sources":payload["sources"],"mode":mode,
               "priority":">".join(priority),"sideOrder":">".join(side_order),"maskMode":mask_mode,
               "count":len(rows),"sha256":sha,"symmetricDiff":diff}
          if best is None or (diff,abs(len(rows)-EXPECTED_COUNT))<(best["symmetricDiff"],abs(best["count"]-EXPECTED_COUNT)):
              best=row
          if len(rows)==EXPECTED_COUNT and sha==EXPECTED_SHA: exact.append(row)
    if (mi+1)%100==0:
        print(json.dumps({"event":"LEDGER_MASK_PROGRESS","done":mi+1,"total":len(mask_sources),"best":best}))
print(json.dumps({"event":"LEDGER_EXHAUSTIVE_RESULT","exact":exact,"best":best},sort_keys=True))
if len(exact)!=1:
    raise SystemExit(f"EXACT_LEDGER_MODEL_COUNT:{len(exact)}")
