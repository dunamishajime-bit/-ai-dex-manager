import json,gzip,hashlib
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=ROOT/"DIRECTION_RESEARCH_20261109"
j=json.load(open(D/"q102_avax_uni_fromscratch_event_v1_20261113.json",encoding="utf-8"))
H=3600000
specs={
 "AVAX_H12_R2":("AVAXUSDT",12,2),
 "AVAX_H12_R6":("AVAXUSDT",12,6),
 "AVAX_H24_R7":("AVAXUSDT",24,7),
 "AVAX_H48_R3":("AVAXUSDT",48,3),
 "UNI_H24_R15":("UNIUSDT",24,15),
 "UNI_H48_R18":("UNIUSDT",48,18),
}
series={}
for sym in ("AVAXUSDT","UNIUSDT"):
 p=ROOT/"aster-public-v3-h1"/f"{sym}-1h-20250924-20261001.jsonl.gz"
 d={}
 with gzip.open(p,"rt",encoding="utf-8") as f:
  for l in f:
   if l.strip():
    z=json.loads(l); d[int(z[0])]={"open":float(z[1]),"high":float(z[2]),"low":float(z[3]),"close":float(z[4])}
 series[sym]=d
out={"status":"RESEARCH_ONLY_Q102_SURVIVOR_EXACT_ROWS","selectionUsesTarget":False,"source":"TARGETTimes frozen by pretarget-selected generator","candidates":{}}
for name,(sym,h,rank) in specs.items():
 c=j["assets"][sym][str(h)]["topPretargetFrozen"][rank-1]
 rows=[]
 missing=[]
 for t in c["TARGETTimes"]:
  xt=int(t)+h*H
  if int(t) not in series[sym] or xt not in series[sym]:
   missing.append([int(t),xt]); continue
  ep=series[sym][int(t)]["open"]; xp=series[sym][xt]["open"]
  raw=(xp/ep-1) if c["side"]=="LONG" else (1-xp/ep)
  rows.append({"entryTs":int(t),"exitTs":xt,"symbol":sym,"side":c["side"],"entryPrice":ep,"exitPrice":xp,"rawReturn":raw})
 out["candidates"][name]={"symbol":sym,"horizon":h,"rank":rank,"side":c["side"],"rule":c["rule"],"score":c["score"],"pre":c["pre"],"target30":c["TARGET30"],"target10":c["TARGET10"],"forward30":c["FORWARD30"],"forward10":c["FORWARD10"],"rows":rows,"missing":missing}
p=D/"q102_avax_uni_survivor_exactrows_20261113.json"
data=json.dumps(out,ensure_ascii=False,indent=2).encode()
p.write_bytes(data)
print("SAVED",p,"SHA256",hashlib.sha256(data).hexdigest())
for k,v in out["candidates"].items():
 print(k,"rows",len(v["rows"]),"missing",len(v["missing"]),"side",v["side"],"h",v["horizon"],"score",v["score"])
 print(" target30",v["target30"],"forward30",v["forward30"])
 if v["rows"]: print(" first",v["rows"][0])
