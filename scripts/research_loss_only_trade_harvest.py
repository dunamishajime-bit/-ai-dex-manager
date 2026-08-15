"""Harvest normalized trade-level records from the fixed V96+ research artifact population.

This stage may read outcomes only to label losing records, but does not inspect winner
features, select blockers, or calculate a new strategy. Artifact selection is fixed by
metadata/branch rules before ZIP contents are read. Research-only; no Fresh OOS,
production, VPS, LIVE, orders, or deployment.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

API="https://api.github.com"
REPO=os.environ["GITHUB_REPOSITORY"]
TOKEN=os.environ["GITHUB_TOKEN"]
SYMS=("BTC","ETH","BNB","SOL","LINK","AVAX")
VERSION_RE=re.compile(r"(?i)(?:^|[^a-z0-9])v[_-]?(\d{2,3})(?:[^0-9]|$)")
TRADE_HINT_RE=re.compile(r"(?i)(research|backtest|diagnos|trade|entry|pair|clean|forward|ownership|router|strategy|replay|v\d{2,3})")
EXCLUDE_NAME_RE=re.compile(r"(?i)(cache|node_modules|coverage|build|dist|premium-index-archive-probe|artifact-inventory|loss-only)")
EXCLUDE_BRANCH_TERMS=("aster-only","stock","market-hours-preflight","production","live-promotion","v52-market-hours","feature/v96")
INCLUDE_BRANCH_TERMS=(
    "research/win80-profit-optimization","research/v96","research/v71","chatgpt/3y-entry",
    "chatgpt/pairwise","chatgpt/router","codex/priority-router","codex/router-v",
    "research/equal-gross","research/pengu-dual",
)
RETURN_KEYS=("netReturnPct","net_return_pct","netPct","net_pct","tradeReturnPct","trade_return_pct","netPnlPct","net_pnl_pct","pnlPct","pnl_pct","returnPct","return_pct","profitPct","roiPct")
ENTRY_TS_KEYS=("entryTs","entry_ts","entryTime","entry_time","entryTimestamp","entry_timestamp","openTs","open_ts","timestamp","ts")
EXIT_TS_KEYS=("exitTs","exit_ts","exitTime","exit_time","exitTimestamp","exit_timestamp","closeTs","close_ts")
SIDE_KEYS=("side","direction","positionSide","position_side","signalSide","signal_side")
SYMBOL_KEYS=("symbol","pair","asset","instrument","ticker")
MFE_KEYS=("mfePct","mfe_pct","mfe","maxFavorablePct")
MAE_KEYS=("maePct","mae_pct","mae","maxAdversePct")
EXIT_REASON_KEYS=("exitReason","exit_reason","reason")
MAX_ARTIFACT_BYTES=20_000_000
MAX_MEMBER_BYTES=50_000_000


def req_json(url):
    req=urllib.request.Request(url,headers={"Authorization":f"Bearer {TOKEN}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"loss-only-trade-harvest"})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)

def req_bytes(url):
    last=None
    for k in range(4):
        try:
            req=urllib.request.Request(url,headers={"Authorization":f"Bearer {TOKEN}","Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"loss-only-trade-harvest"})
            with urllib.request.urlopen(req,timeout=90) as r:return r.read()
        except Exception as e:
            last=e;time.sleep(0.5*(2**k))
    raise last

def versions(name):return [int(x) for x in VERSION_RE.findall(name or "")]

def list_artifacts():
    out=[];page=1
    while True:
        b=req_json(f"{API}/repos/{REPO}/actions/artifacts?per_page=100&page={page}").get("artifacts",[]);out.extend(b)
        if len(b)<100:break
        page+=1
        if page>200:raise RuntimeError("ARTIFACT_PAGINATION_GUARD")
    return out

def selected_artifacts(arts):
    v96=[a for a in arts if 96 in versions(a.get("name",""))]
    if not v96:raise RuntimeError("NO_EXPLICIT_V96")
    cutoff=min(a["created_at"] for a in v96)
    chosen=[]
    for a in arts:
        if a.get("expired") or a.get("created_at","")<cutoff:continue
        nm=a.get("name","");br=((a.get("workflow_run") or {}).get("head_branch") or "").lower()
        if not TRADE_HINT_RE.search(nm) or EXCLUDE_NAME_RE.search(nm):continue
        explicit=any(v>=96 for v in versions(nm))
        include_branch=any(x in br for x in INCLUDE_BRANCH_TERMS)
        excluded=any(x in br for x in EXCLUDE_BRANCH_TERMS)
        if (explicit or include_branch) and not excluded and int(a.get("size_in_bytes") or 0)<=MAX_ARTIFACT_BYTES:
            chosen.append(a)
    # rerun duplicate artifacts with identical name+SHA are not independent evidence
    uniq={}
    for a in sorted(chosen,key=lambda x:x["created_at"]):
        key=(a.get("name"),((a.get("workflow_run") or {}).get("head_sha")))
        uniq[key]=a
    return cutoff,list(uniq.values())

def norm_symbol(x):
    s=str(x or "").upper().replace("/","").replace("-","").replace("_","")
    for sym in SYMS:
        if s==sym or s.startswith(sym+"USDT") or s.startswith(sym+"USD") or re.search(rf"(?:^|[^A-Z]){sym}(?:[^A-Z]|$)",str(x or "").upper()):return sym
    return None

def norm_side(x):
    if isinstance(x,(int,float)):
        return "LONG" if x>0 else "SHORT" if x<0 else None
    s=str(x or "").upper()
    if s in ("LONG","BUY","BULL","UP","1","+1"):return "LONG"
    if s in ("SHORT","SELL","BEAR","DOWN","-1"):return "SHORT"
    return None

def parse_ts(x):
    if x is None:return None
    if isinstance(x,(int,float)):
        v=int(x)
        if 1_000_000_000<=v<10_000_000_000:v*=1000
        return v if 1_000_000_000_000<=v<3_000_000_000_000 else None
    s=str(x).strip()
    if s.isdigit():return parse_ts(int(s))
    try:
        dt=datetime.fromisoformat(s.replace("Z","+00:00"))
        if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp()*1000)
    except Exception:return None

def first(obj,keys):
    for k in keys:
        if k in obj and obj[k] is not None:return obj[k],k
    return None,None

def num(x):
    try:
        v=float(x)
        return v if abs(v)<1e9 else None
    except Exception:return None

def family_name(artifact_name):
    s=re.sub(r"[-_]?\d{10,}$","",artifact_name or "")
    return s[:180]

def primary_version(name):
    vs=[v for v in versions(name) if v>=96]
    return max(vs) if vs else None

def default_partition(family,version):
    if version is not None:return "LOSS_DISCOVERY" if version%2==0 else "LOSS_VALIDATION"
    h=int(hashlib.sha256(family.encode()).hexdigest()[:8],16)
    return "LOSS_DISCOVERY" if h%2==0 else "LOSS_VALIDATION"

def contextual_mode(text):
    s=(text or "").lower()
    return "STRESS" if "stress" in s else "NORMAL" if "normal" in s else "UNSPECIFIED"

def attempt_record(obj,ctx,meta):
    sym=None
    for k in SYMBOL_KEYS:
        if k in obj:sym=norm_symbol(obj[k]);break
    sym=sym or ctx.get("symbol")
    if not sym:return None
    side=None
    for k in SIDE_KEYS:
        if k in obj:side=norm_side(obj[k]);break
    side=side or ctx.get("side")
    if not side:return None
    tv,tk=first(obj,ENTRY_TS_KEYS);ts=parse_ts(tv)
    if ts is None:return None
    rv,rk=first(obj,RETURN_KEYS);pnl=num(rv)
    if pnl is None:return None
    xv,xk=first(obj,EXIT_TS_KEYS);xt=parse_ts(xv)
    mfe,_=first(obj,MFE_KEYS);mae,_=first(obj,MAE_KEYS);reason,_=first(obj,EXIT_REASON_KEYS)
    fam=ctx.get("family") or family_name(meta["name"]);ver=ctx.get("version") or primary_version(meta["name"])
    mode=ctx.get("mode") or contextual_mode(meta["name"])
    feature_keys=[]
    for k in ("features","context","entryContext","entry_context","signalContext","signal_context"):
        if isinstance(obj.get(k),dict):feature_keys.extend(sorted(str(x) for x in obj[k].keys())[:100])
    return {
        "artifactId":meta["id"],"artifactName":meta["name"],"runId":meta["runId"],"headSha":meta["headSha"],"branch":meta["branch"],
        "sourceFile":ctx.get("file"),"sourceFamily":fam,"version":ver,"partition":default_partition(fam,ver),
        "symbol":sym,"side":side,"entryTs":ts,"exitTs":xt,"returnPct":pnl,"returnField":rk,
        "mfePct":num(mfe),"maePct":num(mae),"exitReason":str(reason)[:160] if reason is not None else None,
        "mode":mode,"sourceFeatureKeys":feature_keys,"loser":pnl<0,
    }

def walk(x,ctx,meta,out):
    if isinstance(x,dict):
        c=dict(ctx)
        for k in SYMBOL_KEYS:
            if k in x:
                q=norm_symbol(x[k]);c["symbol"]=q or c.get("symbol");break
        for k in SIDE_KEYS:
            if k in x:
                q=norm_side(x[k]);c["side"]=q or c.get("side");break
        for k in ("strategyId","strategy_id","researchLine","research_line","candidateId","candidate_id"):
            if isinstance(x.get(k),str):c["family"]=x[k][:180];v=primary_version(x[k]);c["version"]=v or c.get("version");break
        r=attempt_record(x,c,meta)
        if r:out.append(r)
        for k,v in x.items():
            cc=dict(c)
            ks=str(k).upper()
            if ks in SYMS:cc["symbol"]=ks
            low=str(k).lower()
            if "stress" in low:cc["mode"]="STRESS"
            elif low=="normal":cc["mode"]="NORMAL"
            walk(v,cc,meta,out)
    elif isinstance(x,list):
        for v in x:walk(v,ctx,meta,out)

def parse_member(name,b,meta):
    out=[];ctx={"file":name,"family":family_name(meta["name"]),"version":primary_version(meta["name"]),"mode":contextual_mode(meta["name"])}
    low=name.lower()
    try:
        if low.endswith(".json"):
            walk(json.loads(b.decode("utf-8")),ctx,meta,out)
        elif low.endswith(".jsonl") or low.endswith(".ndjson"):
            for line in b.decode("utf-8").splitlines():
                line=line.strip()
                if line:
                    try:walk(json.loads(line),ctx,meta,out)
                    except Exception:pass
        elif low.endswith(".csv"):
            for row in csv.DictReader(io.StringIO(b.decode("utf-8"))):walk(dict(row),ctx,meta,out)
    except Exception:pass
    return out

def process_artifact(a):
    meta={"id":a["id"],"name":a["name"],"runId":((a.get("workflow_run") or {}).get("id")),"headSha":((a.get("workflow_run") or {}).get("head_sha")),"branch":((a.get("workflow_run") or {}).get("head_branch"))}
    try:
        raw=req_bytes(f"{API}/repos/{REPO}/actions/artifacts/{a['id']}/zip")
        z=zipfile.ZipFile(io.BytesIO(raw));records=[];files=0
        for info in z.infolist():
            if info.is_dir() or info.file_size>MAX_MEMBER_BYTES:continue
            if not info.filename.lower().endswith((".json",".jsonl",".ndjson",".csv")):continue
            files+=1;records.extend(parse_member(info.filename,z.read(info),meta))
        return {"meta":meta,"files":files,"records":records,"error":None}
    except Exception as e:return {"meta":meta,"files":0,"records":[],"error":f"{type(e).__name__}:{e}"[:300]}

def main():
    arts=list_artifacts();cutoff,chosen=selected_artifacts(arts)
    results=[]
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs=[ex.submit(process_artifact,a) for a in chosen]
        for i,f in enumerate(as_completed(futs),1):
            results.append(f.result())
            if i%100==0:print(f"HARVEST_PROGRESS {i}/{len(futs)}",flush=True)
    records=[]
    for r in results:records.extend(r["records"])
    # exact duplicates from repeated files/artifacts are collapsed, but different source families remain independent evidence
    uniq={}
    for r in records:
        key=(r["sourceFamily"],r["symbol"],r["side"],r["entryTs"],r["exitTs"],round(r["returnPct"],8),r["mode"])
        uniq[key]=r
    records=list(uniq.values());records.sort(key=lambda r:(r["entryTs"],r["sourceFamily"],r["symbol"],r["side"]))
    losers=[r for r in records if r["loser"]]
    root=Path(os.environ.get("RESEARCH_STATE_DIR",".research-state"));root.mkdir(parents=True,exist_ok=True)
    with (root/"loss-only-normalized-trades.jsonl").open("w",encoding="utf-8") as f:
        for r in records:f.write(json.dumps(r,sort_keys=True)+"\n")
    with (root/"loss-only-losing-trades.jsonl").open("w",encoding="utf-8") as f:
        for r in losers:f.write(json.dumps(r,sort_keys=True)+"\n")
    fams=sorted({r["sourceFamily"] for r in records});syms={s:sum(r["symbol"]==s for r in records) for s in SYMS}
    summary={
        "researchLine":"LOSS_ONLY_TRADE_HARVEST","researchOnly":True,"winnerFeaturesInspected":False,"blockersSelected":False,
        "productionChanged":False,"vpsChanged":False,"liveChanged":False,"realTradingEnabled":False,"freshOosRead":False,
        "earliestExplicitV96CreatedAt":cutoff,"selectedArtifacts":len(chosen),"selectedArtifactBytes":sum(int(a.get("size_in_bytes") or 0) for a in chosen),
        "downloadErrors":sum(bool(r["error"]) for r in results),"machineReadableFilesScanned":sum(r["files"] for r in results),
        "rawCandidateRecords":len(records),"losingRecords":len(losers),"winningOrFlatRecords":len(records)-len(losers),
        "sourceFamilies":len(fams),"symbolCounts":syms,
        "partitionCounts":{p:sum(r["partition"]==p for r in records) for p in ("LOSS_DISCOVERY","LOSS_VALIDATION")},
        "errorExamples":[r["error"] for r in results if r["error"]][:20],
    }
    (root/"loss-only-trade-harvest-summary.json").write_text(json.dumps(summary,indent=2,sort_keys=True),encoding="utf-8")
    print(json.dumps(summary,indent=2,sort_keys=True))

if __name__=="__main__":main()
