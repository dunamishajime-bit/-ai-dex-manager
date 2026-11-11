#!/usr/bin/env python3
from pathlib import Path
import urllib.request, urllib.error, zipfile, io, csv, json, gzip, hashlib, time, datetime

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=ROOT/"PREPERIOD_TRAIN_20240101_20251001"/"Q102_HIGHVOL_BINANCE_PROXY"
OUT.mkdir(parents=True,exist_ok=True)
SYMS=["SUIUSDT","SEIUSDT","APTUSDT","ARBUSDT","OPUSDT","ENAUSDT","ONDOUSDT","FILUSDT","TRXUSDT"]
months=[]
d=datetime.date(2024,1,1)
while d<datetime.date(2025,10,1):
    months.append(f"{d.year:04d}-{d.month:02d}")
    d=(d.replace(day=28)+datetime.timedelta(days=4)).replace(day=1)

manifest=[]
summary={}
for sym in SYMS:
    rows=[]
    seen=False
    missing_after_seen=[]
    for mon in months:
        url=f"https://data.binance.vision/data/futures/um/monthly/klines/{sym}/1h/{sym}-1h-{mon}.zip"
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
            with urllib.request.urlopen(req,timeout=30) as resp:
                blob=resp.read()
        except urllib.error.HTTPError as e:
            if e.code==404:
                if seen: missing_after_seen.append(mon)
                continue
            raise
        seen=True
        h=hashlib.sha256(blob).hexdigest()
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names=[n for n in zf.namelist() if n.lower().endswith(".csv")]
            if len(names)!=1: raise RuntimeError(f"ZIP_CONTENT:{sym}:{mon}:{names}")
            text=zf.read(names[0]).decode("utf-8")
        n=0
        for rec in csv.reader(io.StringIO(text)):
            if not rec: continue
            try: int(rec[0])
            except: continue
            if len(rec)<12: raise RuntimeError(f"COLS:{sym}:{mon}:{len(rec)}")
            rows.append(rec[:12]);n+=1
        manifest.append({"symbol":sym,"month":mon,"url":url,"bytes":len(blob),"sha256":h,"rows":n})
        print("DOWN",sym,mon,n,len(blob),flush=True)
    if not rows:
        raise RuntimeError("NO_DATA_"+sym)
    # Monthly gaps after listing are not expected; allow only trailing gaps after the last actual month if delisted (none expected here).
    ts=[int(r[0]) for r in rows]
    order=sorted(range(len(rows)),key=lambda i:ts[i])
    rows=[rows[i] for i in order]
    ded=[]
    for rec in rows:
        t=int(rec[0])
        if ded and int(ded[-1][0])==t:
            if ded[-1]!=rec: raise RuntimeError(f"DUP_DIFF:{sym}:{t}")
            continue
        ded.append(rec)
    # continuity only between first and last available bar
    gaps=[]
    for a,b in zip(ded,ded[1:]):
        if int(b[0])-int(a[0])!=3600000:
            gaps.append((int(a[0]),int(b[0])))
    if gaps:
        raise RuntimeError(f"H1_GAPS:{sym}:{gaps[:5]}:N={len(gaps)}")
    op=OUT/f"{sym}-1h-20240101-20251001.jsonl.gz"
    with gzip.open(op,"wt",encoding="utf-8",newline="\n") as f:
        for rec in ded:
            # preserve canonical Binance kline array form; numeric conversion happens in replay.
            f.write(json.dumps(rec,separators=(",",":"))+"\n")
    summary[sym]={"rows":len(ded),"firstTs":int(ded[0][0]),"lastTs":int(ded[-1][0]),
                  "sha256":hashlib.sha256(op.read_bytes()).hexdigest(),"missingMonthsAfterFirstSeen":missing_after_seen}
    print("SYMBOL",sym,summary[sym],flush=True)

(OUT/"download-manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
(OUT/"normalized-summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COMPLETE",OUT,flush=True)
