#!/usr/bin/env python3
from pathlib import Path
import urllib.request,urllib.error,zipfile,io,csv,json,gzip,hashlib,datetime

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=ROOT/"PREPERIOD_TRAIN_20250301_20251001"/"Q102_FET_BINANCE_PROXY"
OUT.mkdir(parents=True,exist_ok=True)
SYM="FETUSDT"
months=[f"2025-{m:02d}" for m in range(3,10)]
manifest=[]
summary={}

for interval in ("1h","5m"):
    rows=[]
    for mon in months:
        url=f"https://data.binance.vision/data/futures/um/monthly/klines/{SYM}/{interval}/{SYM}-{interval}-{mon}.zip"
        req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req,timeout=60) as resp: blob=resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP_{e.code}:{url}") from e
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names=[n for n in zf.namelist() if n.lower().endswith(".csv")]
            if len(names)!=1: raise RuntimeError(f"ZIP_CONTENT:{interval}:{mon}:{names}")
            text=zf.read(names[0]).decode("utf-8")
        n=0
        for rec in csv.reader(io.StringIO(text)):
            if not rec: continue
            try: t=int(rec[0])
            except: continue
            if t>10**14: t//=1000
            rec=list(rec[:12]);rec[0]=str(t)
            rows.append(rec);n+=1
        manifest.append({"interval":interval,"month":mon,"url":url,"bytes":len(blob),"zipSha256":hashlib.sha256(blob).hexdigest(),"rows":n})
        print("DOWN",interval,mon,n,len(blob),flush=True)
    rows.sort(key=lambda r:int(r[0]))
    ded=[]
    for rec in rows:
        t=int(rec[0])
        if ded and int(ded[-1][0])==t:
            if ded[-1]!=rec: raise RuntimeError(f"DUP_DIFF:{interval}:{t}")
            continue
        ded.append(rec)
    step=3600000 if interval=="1h" else 300000
    gaps=[]
    for a,b in zip(ded,ded[1:]):
        if int(b[0])-int(a[0])!=step:gaps.append((int(a[0]),int(b[0])))
    if gaps: raise RuntimeError(f"GAPS:{interval}:{gaps[:10]} N={len(gaps)}")
    op=OUT/f"{SYM}-{interval}-20250301-20251001.jsonl.gz"
    with gzip.open(op,"wt",encoding="utf-8",newline="\n") as f:
        for rec in ded:f.write(json.dumps(rec,separators=(",",":"))+"\n")
    summary[interval]={"rows":len(ded),"firstTs":int(ded[0][0]),"lastTs":int(ded[-1][0]),"sha256":hashlib.sha256(op.read_bytes()).hexdigest()}
    print("SAVED",op,summary[interval],flush=True)

(OUT/"download-manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
(OUT/"normalized-summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COMPLETE",OUT,flush=True)
