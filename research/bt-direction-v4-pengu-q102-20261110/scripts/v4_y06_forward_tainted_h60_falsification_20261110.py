#!/usr/bin/env python3
"""Research-only falsification check of fixed Y06 60h on saved Oct-Nov 2026 forward shadow.
IMPORTANT: DO NOT call this untainted OOS: the source manifest says BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06.
"""
import gzip,json,os,hashlib,collections,datetime as dt
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
p=R/"FORWARD_HOLDOUT_20261001_20261108"
sr=p/"V4_DUALSIDE_LIFECYCLE"/"v4-forward-dualside-modeled-exits.jsonl"
sm=p/"native-V4-forward-entry-summary.json"
source=json.loads(sm.read_text(encoding="utf8"))
assert source["strategyStatus"]=="BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06"
data=[json.loads(z) for z in sr.open(encoding="utf8") if z.strip()]
ev=sorted((x for x in data if x["mode"]=="NATIVE" and x["route"]=="REC_Y06_REV_D0_T72"),key=lambda x:(x["entryTs"],x["candidateId"]))
assert len(ev)==20
H=3600000
prices={}
for sym in sorted({x["symbol"] for x in ev}):
 f=p/"aster-h1"/(sym+"-1h-20261001-20261108T20.jsonl.gz")
 with gzip.open(f,"rt",encoding="utf8") as z:
  prices[sym]={int(a[0]):float(a[1]) for a in (json.loads(l) for l in z if l.strip())}
samples=[]
for x in ev:
 t=x["entryTs"]+60*H
 if t<x["exitTs"]:
  op=prices[x["symbol"]].get(t)
  assert op is not None,(x["symbol"],t)
  later=(x["entryPrice"]-op)/x["entryPrice"]
  impact=later-x["rawReturn"]
  changed=True
 else:
  op=None;impact=0.;changed=False
 samples.append(dict(symbol=x["symbol"],entryTs=x["entryTs"],exitTs=x["exitTs"],
  native_return=x["rawReturn"],native_exit_reason=x["exitReason"],
  h60_changed=changed,h60_open_price=op,delta_vs_native=impact,
  native_won=x["rawReturn"]>0,
  entry_utc=dt.datetime.fromtimestamp(x["entryTs"]/1000,dt.timezone.utc).isoformat()))
episodes=[]
for i,x in enumerate(ev):
 if not episodes or x["entryTs"]>=episodes[-1]["end"]:
  episodes.append({"begin":x["entryTs"],"end":x["exitTs"],"indices":[i]})
 else:
  episodes[-1]["end"]=max(episodes[-1]["end"],x["exitTs"])
  episodes[-1]["indices"].append(i)
def aggregate(items):
 return dict(n=len(items),native_gross_sum=sum(v["native_return"] for v in items),
  native_wins=sum(v["native_return"]>0 for v in items),
  candidate_changed=sum(v["h60_changed"] for v in items),
  candidate_gross_delta=sum(v["delta_vs_native"] for v in items),
  improved=sum(v["delta_vs_native"]>1e-9 for v in items),
  damaged=sum(v["delta_vs_native"]< -1e-9 for v in items),
  damaged_native_winners=sum(v["native_won"] and v["delta_vs_native"]< -1e-9 for v in items))
for c in episodes:
 c["n"]=len(c["indices"])
 c["delta_sum"]=sum(samples[i]["delta_vs_native"] for i in c["indices"])
out={"status":"FALSIFICATION_ONLY_NOT_INDEPENDENT_OOS",
 "source_manifest_strategy_status":source["strategyStatus"],
 "source_period":source["period"],
 "native_entry_sha":source["outputSHA256"],
 "forward_exit_lifecycle_sha256":hashlib.sha256(sr.read_bytes()).hexdigest(),
 "overall":aggregate(samples),"episodes_count":len(episodes),"episodes":episodes,"cases":samples,
 "constraints":["Pinned V4 forward intention source is SHADOW_ONLY/BLOCKED_HINDSIGHT_LOOKAHEAD",
 "Source flagged external Y06; cannot be accepted as independent causal OOS",
 "V4 source plus modeled native STOP/guard exits; not actual signed venue fills",
 "Gross fees/funding/portfolio admission not replayed in this standalone falsification",
 "H60 was previously selected after seeing other historical splits; must not optimize thresholds against this sample"]}
file=R/"DIRECTION_RESEARCH_20261109"/"v4_y06_forward_tainted_60h_falsification_20261110.json"
file.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",file,"sha256",hashlib.sha256(file.read_bytes()).hexdigest())
print("OVERALL",json.dumps(out["overall"]))
print("EPISODES",len(episodes),[(c["n"],round(c["delta_sum"],6)) for c in episodes])
print("CASE_SUMMARY",[(x["symbol"],x["entry_utc"],round(x["native_return"],4),round(x["delta_vs_native"],4)) for x in samples])
