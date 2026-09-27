"""Immutable, reusable non-Aster venue H1/funding acquisition for 2025-08-10..2026-08-10.

Official Binance USD-M or OKX USDT-linear swaps only. Do not mix venues.
Save per-symbol original API pages, normalized compressed history, hashes and coverage;
never silently substitute Aster or splice missing hours.
"""
from __future__ import annotations
import argparse
from datetime import date,datetime,time,timezone
import gzip,hashlib,json,shutil
from pathlib import Path
from . import sources
from .acquire import extract_universes
from .manifest import load_manifest
from .acquire import MANIFEST_PATH
from .aster_h1_repair import valid_h1

START=date(2025,8,10); END=date(2026,8,11); WARMUP=date(2025,1,1)
MS=3600000

def ts(d): return int(datetime.combine(d,time.min,timezone.utc).timestamp()*1000)
def dump(path,items):
    path.parent.mkdir(parents=True,exist_ok=True)
    b=("".join(json.dumps(r,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n" for r in items)).encode()
    path.write_bytes(b);return hashlib.sha256(b).hexdigest()
def atomic_archive(src,dest):
    dest.parent.mkdir(parents=True,exist_ok=True)
    body=src.read_bytes()
    with gzip.open(dest,"wb",compresslevel=6,mtime=None) as f: f.write(body)
    return hashlib.sha256(body).hexdigest(),hashlib.sha256(dest.read_bytes()).hexdigest()
def extract_archive(src,dest,sha):
    body=gzip.decompress(src.read_bytes())
    if hashlib.sha256(body).hexdigest()!=sha: raise ValueError("ARCHIVE_SHA_MISMATCH:"+str(src))
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
def normalized_h1(venue,symbol,data):
    out=[]
    for raw in data:
        t=int(raw[0]);o,h,l,c=map(float,raw[1:5])
        if venue=="okx":
            base=float(raw[6]);quote=float(raw[7]);closed=t+MS-1
        else:
            base=float(raw[5]);quote=float(raw[7]);closed=int(raw[6])
        out.append(dict(source=venue,exchange=venue.upper(),instrument=symbol,
                        interval="1h",event_time_ms=t,close_time_ms=closed,
                        open=o,high=h,low=l,close=c,base_volume=base,quote_volume=quote))
    return sorted(out,key=lambda x:x["event_time_ms"])
def run(venue,root,reusable):
    if venue not in ("binance","okx"): raise ValueError("NON_ASTER_VENUE_REQUIRED")
    root=Path(root); reusable=Path(reusable);root.mkdir(parents=True,exist_ok=True)
    uni=extract_universes();symbols=uni["crypto_union"]
    start,end=ts(WARMUP),ts(END)-1
    manifest=dict(schema_version=1,venue=venue,period_start=START.isoformat(),
                  end_exclusive=END.isoformat(),warmup_start=WARMUP.isoformat(),
                  runtime_sha=load_manifest(MANIFEST_PATH)["runtime_sha"],
                  symbols={},missing_symbols=[],funding_incomplete=[],
                  reuse_archive=str(reusable),source="OFFICIAL_EXCHANGE_API")
    # The current instrument catalog is not a trustworthy historical delisting
    # registry. Record it without treating missing historical instruments as zero trades.
    try:
        cat=sources.fetch_instrument_catalog(venue)
        manifest["catalog_sha256"]=cat.page_hashes
        dump(root/"catalog.jsonl",cat.rows)
        lookup={str(x.get("instId" if venue=="okx" else "symbol")):x for x in cat.rows}
    except Exception as e:
        lookup={};manifest["catalog_error"]=type(e).__name__+":"+str(e)[:150]
    for symbol in symbols:
        native=symbol.replace("USDT","-USDT-SWAP") if venue=="okx" else symbol
        info=dict(symbol=symbol,native=native,source=venue)
        if native in lookup:
            try:
                verified=sources.verify_native_instrument(venue,native,lookup[native])
                info["listing_ms"]=verified.listed_from_ms
                info["contract_type"]=verified.contract_type
            except ValueError as e:
                info["metadata_warning"]=str(e)
        norm=root/"normalized"/venue/"klines"/(symbol+".jsonl")
        cached=reusable/"normalized"/"klines"/(symbol+".jsonl.gz")
        cached_meta=reusable/"metadata"/(symbol+".json")
        if cached.is_file() and cached_meta.is_file():
            cm=json.loads(cached_meta.read_text())
            if cm.get("venue")==venue and cm.get("period_start")==START.isoformat() and cm.get("end_exclusive")==END.isoformat():
                extract_archive(cached,norm,cm["h1_sha256"])
                h1=[json.loads(l) for l in norm.read_text().splitlines() if l]
                info["h1_reused"]=True
            else: h1=None
        else: h1=None
        if h1 is None:
            try:
                kl=sources.fetch_historical_klines(venue,native,start,end)
                h1=normalized_h1(venue,symbol,kl.rows)
                # Store compressed raw official exchange responses separately for audits.
                raw_path=root/"raw"/venue/(symbol+"-h1-pages.jsonl")
                dump(raw_path,[{"page":i,"payload_sha256":hashlib.sha256(b).hexdigest(),
                                "response":b.decode()} for i,b in enumerate(kl.raw_responses)])
                if h1: dump(norm,h1)
                else: info["h1_error"]="NO_HISTORY_RETURNED"
            except Exception as e:
                h1=[];info["h1_error"]=type(e).__name__+":"+str(e)[:170]
        if h1:
            times=[r["event_time_ms"] for r in h1]
            bad=[r["event_time_ms"] for r in h1 if not valid_h1(r)]
            gaps=sum(b-a!=MS for a,b in zip(times,times[1:]))
            requested=[r for r in h1 if ts(START)<=r["event_time_ms"]<ts(END)]
            info.update(h1_count=len(h1),in_period_h1=len(requested),
                        first_h1=times[0],last_h1=times[-1],gaps=gaps,
                        malformed_h1=bad[:20])
            if bad: info["h1_error"]="MALFORMED_SOURCE_H1"
            # Freeze reusable normalized candles, keeping the original source on every row.
            if not info.get("h1_error"):
                sha,gzsha=atomic_archive(norm,cached)
                info["h1_sha256"]=sha;info["h1_archive_sha256"]=gzsha
            elif not cached.exists() and norm.is_file():
                info["h1_sha256"]=hashlib.sha256(norm.read_bytes()).hexdigest()
        else:
            info["h1_count"]=0
        fp=root/"normalized"/venue/"funding"/(symbol+".jsonl")
        fc=reusable/"normalized"/"funding"/(symbol+".jsonl.gz")
        fm=reusable/"metadata"/(symbol+".json")
        f_loaded=False
        if fc.is_file() and fm.is_file():
            m=json.loads(fm.read_text())
            if m.get("funding_sha256"):
                extract_archive(fc,fp,m["funding_sha256"])
                fund=[json.loads(l) for l in fp.read_text().splitlines() if l]
                f_loaded=True
        if not f_loaded:
            try:
                f=sources.fetch_historical_funding(venue,native,start,end)
                fund=[{"source":venue,"exchange":venue.upper(),"instrument":symbol,
                       "event_time_ms":int(x["fundingTime"]),
                       "funding_rate":float(x["fundingRate"])} for x in f.rows]
                fund.sort(key=lambda x:x["event_time_ms"])
                dump(root/"raw"/venue/(symbol+"-funding-pages.jsonl"),
                     [{"page":i,"payload_sha256":hashlib.sha256(b).hexdigest(),
                       "response":b.decode()} for i,b in enumerate(f.raw_responses)])
                if fund: dump(fp,fund)
            except Exception as e:
                fund=[];info["funding_error"]=type(e).__name__+":"+str(e)[:170]
        info["funding_count"]=len(fund)
        if fund:
            sha,gzsha=atomic_archive(fp,fc)
            info["funding_sha256"]=sha;info["funding_archive_sha256"]=gzsha
        else: manifest["funding_incomplete"].append(symbol)
        cm={k:info[k] for k in ("venue","symbol","h1_sha256","funding_sha256") if k in info}
        cm.update(period_start=START.isoformat(),end_exclusive=END.isoformat())
        fm.parent.mkdir(parents=True,exist_ok=True);fm.write_text(json.dumps(cm,sort_keys=True,indent=2)+"\n")
        if not h1: manifest["missing_symbols"].append(symbol)
        manifest["symbols"][symbol]=info
        (root/"crossvenue-acquisition-progress.json").write_text(json.dumps(manifest,sort_keys=True,indent=2)+"\n")
        print("ACQUIRED",venue,symbol,"H1",len(h1),"FUNDING",len(fund),"GAPS",info.get("gaps"),flush=True)
    manifest["status"]="INCOMPLETE" if manifest["missing_symbols"] or manifest["funding_incomplete"] else "ACQUIRED"
    (root/"crossvenue-acquisition-manifest.json").write_text(json.dumps(manifest,sort_keys=True,indent=2)+"\n")
    # Existing scan requires an acquisition manifest with the source runtime SHA.
    (root/"acquisition-manifest.json").write_text(json.dumps({"runtime_sha":manifest["runtime_sha"],
        "requested":{"period_start":START.isoformat(),"end_exclusive":END.isoformat()},
        "source_venue":venue,"source_manifest":"crossvenue-acquisition-manifest.json"},sort_keys=True)+"\n")
    return manifest

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--venue",choices=["binance","okx"],required=True)
    p.add_argument("--root",type=Path,required=True);p.add_argument("--reusable",type=Path,required=True)
    a=p.parse_args();m=run(a.venue,a.root,a.reusable)
    print("ACQUISITION_STATUS",json.dumps({k:m[k] for k in ("venue","status","missing_symbols","funding_incomplete")},sort_keys=True))
