#!/usr/bin/env python3
"""Export source-labeled Aster historical H1 data for STABLE4 study symbols only.

The output is kept on the owner's machine. No LIVE data mutation or fabricated bars.
The pack manifest exposes all missing/late/duplicate hourly source bars.
"""
import argparse,csv,gzip,hashlib,json,pathlib
from datetime import datetime,timezone
CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
START_MS=int(datetime(2025,10,1,tzinfo=timezone.utc).timestamp()*1000)
END_MS=int(datetime(2026,10,1,tzinfo=timezone.utc).timestamp()*1000)
def iso(ms):
 return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for part in iter(lambda:f.read(1048576),b""):h.update(part)
 return h.hexdigest()
def read_bars(path):
 out=[];previous=None;gap_hours=0
 with gzip.open(path,"rt",encoding="utf8") as f:
  for line in f:
   raw=json.loads(line)
   t=int(raw[0])
   if t<START_MS or t>=END_MS:continue
   if previous is not None:
    if t<=previous or (t-previous)%3600000:raise ValueError("BAD_H1_CHRONOLOGY: "+path.name)
    gap_hours+=(t-previous)//3600000-1
   previous=t
   o,h,l,c=map(float,raw[1:5])
   if not(min(o,h,l,c)>0 and h>=max(o,c) and l<=min(o,c)):
    raise ValueError("BAD_H1_OHLC: "+path.name)
   out.append({"time":iso(t),"closedAt":iso(t+3600000),"open":o,"high":h,"low":l,"close":c})
 if not out:raise ValueError("NO_USABLE_H1: "+path.name)
 front_hours=(int(datetime.fromisoformat(out[0]["time"].replace("Z","+00:00")).timestamp()*1000)-START_MS)//3600000
 end_hours=(END_MS-int(datetime.fromisoformat(out[-1]["closedAt"].replace("Z","+00:00")).timestamp()*1000))//3600000
 missing_hours=gap_hours+front_hours+end_hours
 if min(front_hours,end_hours,gap_hours)<0:raise ValueError("BAR_OUTSIDE_PERIOD")
 return out,{"start_utc":out[0]["time"],"end_close_utc":out[-1]["closedAt"],
     "bars":len(out),"missing_hour_count":missing_hours,"gap_hour_count":gap_hours,
     "front_missing_hours":front_hours,"end_missing_hours":end_hours,
     "complete_h1_period":missing_hours==0,"source_gzip_sha256":sha(path)}
def main():
 a=argparse.ArgumentParser()
 a.add_argument("--source-h1",type=pathlib.Path,required=True)
 a.add_argument("--research-fills-dir",type=pathlib.Path,required=True)
 a.add_argument("--out-dir",type=pathlib.Path,required=True)
 args=a.parse_args()
 symbols={"BTCUSDT"}
 for bps in (10,30):
  path=args.research_fills_dir/(f"{CASE}_{bps}BPS_FILLS.csv")
  with path.open(encoding="utf-8-sig",newline="") as f:
   for row in csv.DictReader(f):symbols.add(row["symbol"])
 symbols=sorted(symbols)
 evidence={};packs=[];missing={}
 for symbol in symbols:
  matches=list(args.source_h1.glob(symbol+"-1h-20250924-20261001.jsonl.gz"))
  if len(matches)!=1:
   missing[symbol]="SOURCE_FILE_MISSING_OR_AMBIGUOUS"
   continue
  bars,coverage=read_bars(matches[0])
  evidence[symbol]=coverage
  packs.append((symbol,bars))
 args.out_dir.mkdir(parents=True,exist_ok=True)
 files=[]
 for index in range(0,len(packs),8):
  batch=packs[index:index+8]
  pack={"schema":"disdex-historical-symbol-candle-pack/v1",
    "period_start_inclusive":"2025-10-01T00:00:00Z",
    "period_end_exclusive":"2026-10-01T00:00:00Z",
    "venue":"Aster Public Futures H1",
    "mode":"READ_ONLY_RESEARCH_DATA_NOT_TRADE_CERTIFIED",
    "symbolCandles":{symbol:bars for symbol,bars in batch},
    "coverage":{symbol:evidence[symbol] for symbol,_ in batch}}
  path=args.out_dir/f"aster-h1-source-pack-{index//8+1:02d}.json"
  path.write_text(json.dumps(pack,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf8")
  files.append({"file":path.name,"sha256":sha(path),"symbols":[v[0] for v in batch],"bytes":path.stat().st_size})
 manifest={"schema":"disdex-historical-symbol-pack-manifest/v1",
  "period_start_inclusive":"2025-10-01T00:00:00Z",
  "period_end_exclusive":"2026-10-01T00:00:00Z",
  "source_venue":"Aster Public Futures H1",
  "production_parity_verified":False,
  "actual_venue_execution_verified":False,
  "requested_symbols":symbols,
  "found_symbols":sorted(evidence),
  "missing_symbols":missing,
  "source_coverage":evidence,
  "packs":files}
 manifest_path=args.out_dir/"ASTER_H1_MANIFEST_UNCERTIFIED.json"
 manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps({"status":"PASS_SOURCE_EXPORT_NOT_CERTIFIED",
   "requested":len(symbols),"available":len(evidence),
   "packs":len(files),"missing":missing,
   "size_mb":round(sum(f["bytes"] for f in files)/1048576,2),
   "complete_h1_symbols":sum(v["complete_h1_period"] for v in evidence.values())},
   ensure_ascii=False,indent=2))
if __name__=="__main__":main()