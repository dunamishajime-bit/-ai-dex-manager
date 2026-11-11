#!/usr/bin/env python3
from pathlib import Path
import urllib.request, urllib.error, zipfile, io, csv, json, gzip, hashlib, datetime

ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=ROOT/"PREPERIOD_TRAIN_20250301_20251001"/"IDLE_ALL_BINANCE_PROXY"
OUT.mkdir(parents=True,exist_ok=True)
SYMS=["BTCUSDT","TAOUSDT","TIAUSDT","DOTUSDT","JUPUSDT","RENDERUSDT"]
INTERVALS=("1h","5m")
STEP={"1h":3600000,"5m":300000}
months=[f"2025-{m:02d}" for m in range(3,10)]
manifest=[];summary={}
for sym in SYMS:
  summary[sym]={}
  for iv in INTERVALS:
    rows=[];seen=False;missing_after_seen=[]
    for mon in months:
      url=f"https://data.binance.vision/data/futures/um/monthly/klines/{sym}/{iv}/{sym}-{iv}-{mon}.zip"
      try:
        req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
        with urllib.request.urlopen(req,timeout=45) as resp: blob=resp.read()
      except urllib.error.HTTPError as e:
        if e.code==404:
          if seen: missing_after_seen.append(mon)
          print("MISS",sym,iv,mon,flush=True);continue
        raise
      seen=True
      with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names=[n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names)!=1: raise RuntimeError(f"ZIP_CONTENT:{sym}:{iv}:{mon}:{names}")
        txt=zf.read(names[0]).decode("utf-8")
      n=0
      for rec in csv.reader(io.StringIO(txt)):
        if not rec:continue
        try:int(rec[0])
        except:continue
        if len(rec)<12:raise RuntimeError(f"COLS:{sym}:{iv}:{mon}:{len(rec)}")
        rows.append(rec[:12]);n+=1
      manifest.append({"symbol":sym,"interval":iv,"month":mon,"url":url,"bytes":len(blob),
                       "zipSha256":hashlib.sha256(blob).hexdigest(),"rows":n})
      print("DOWN",sym,iv,mon,n,len(blob),flush=True)
    if not rows: raise RuntimeError(f"NO_DATA:{sym}:{iv}")
    rows.sort(key=lambda r:int(r[0]));ded=[]
    for rec in rows:
      t=int(rec[0])
      if ded and int(ded[-1][0])==t:
        if ded[-1]!=rec:raise RuntimeError(f"DUP_DIFF:{sym}:{iv}:{t}")
        continue
      ded.append(rec)
    gaps=[(int(a[0]),int(b[0])) for a,b in zip(ded,ded[1:]) if int(b[0])-int(a[0])!=STEP[iv]]
    if gaps:raise RuntimeError(f"GAPS:{sym}:{iv}:{gaps[:5]}:N={len(gaps)}")
    op=OUT/f"{sym}-{iv}-20250301-20251001.jsonl.gz"
    with gzip.open(op,"wt",encoding="utf-8",newline="\n") as f:
      for rec in ded:f.write(json.dumps(rec,separators=(",",":"))+"\n")
    summary[sym][iv]={"rows":len(ded),"firstTs":int(ded[0][0]),"lastTs":int(ded[-1][0]),
                      "sha256":hashlib.sha256(op.read_bytes()).hexdigest(),
                      "missingMonthsAfterFirstSeen":missing_after_seen}
    print("SYMBOL",sym,iv,summary[sym][iv],flush=True)
(OUT/"download-manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
(OUT/"normalized-summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("COMPLETE",OUT,flush=True)
