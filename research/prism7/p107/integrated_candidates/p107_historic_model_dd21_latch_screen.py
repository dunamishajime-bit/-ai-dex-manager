from pathlib import Path
import csv,json,datetime,hashlib,collections
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001")
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
names=[
"VPS_EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_ON_20261111",
"STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
"STABLE4_NORMALGROSS_3P5_V4_475_EXPLORATORY_20261116_V2",
"STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1",
"DD_STUDY_EXIT_INDEPENDENT_STOCK15_TOTAL35_V52_100_20261121"]
def utc(x):return datetime.datetime.fromisoformat(x.replace("Z","+00:00"))
result=[]
for name in names:
 d=BASE/name
 if not d.exists():continue
 for bps in (10,30):
  equity=list(d.glob("*"+str(bps)+"BPS_EQUITY_30MIN.csv"))
  fill=list(d.glob("*"+str(bps)+"BPS_FILLS.csv"))
  if len(equity)!=1 or len(fill)!=1:print("SKIP",name,bps);continue
  peak=0.;maxdd=0.;first_breach=None;last=None;points=0;monotone_violations=0
  with equity[0].open(encoding="utf-8-sig",newline="") as f:
   rd=csv.DictReader(f)
   for x in rd:
    t=x["utc"]
    n=float(x["compounded_mtm_equity_jpy"])
    if n<=0:raise RuntimeError("NONPOSITIVE_EQUITY:"+name)
    peak=max(peak,n)
    dd=1-n/peak
    maxdd=max(maxdd,dd)
    if first_breach is None and dd>0.21+1e-12:first_breach=t
    points+=1
    last=t
  v4=[],[]
  v4entries=[];total_fills=0
  with fill[0].open(encoding="utf-8-sig",newline="") as f:
   for x in csv.DictReader(f):
    total_fills+=1
    if x["strategy"]=="V4":v4entries.append(x)
  v4entries.sort(key=lambda x:x["entry_utc"])
  after=[x for x in v4entries if first_breach and utc(x["entry_utc"])>utc(first_breach)]
  earliest=after[0] if after else None
  rearm_strategies=collections.Counter(x["strategy"] for x in after)
  result.append({
    "scenario":name,"bps":bps,"equityObservations":points,"firstDdOver21Utc":first_breach,
    "max5minObservedDrawdownPct":round(maxdd*100,9),
    "modeledTotalFills":total_fills,"modeledV4Fills":len(v4entries),
    "modeledV4EntriesStrictlyAfterFirstDdOver21":len(after),
    "firstV4ModeledEntryAfterBreach":earliest["entry_utc"] if earliest else None,
    "lastV4ModeledEntryAfterBreach":after[-1]["entry_utc"] if after else None,
    "signedFillsInAfterBreachSubset":sum(x.get("signed_execution_verified","").lower()=="true" for x in after),
    "allAfterBreachV4AreModelled":all(x["model_class"] for x in after),
    "grossCapMatchToCurrentProductionNotProven":True,
    "inputProvenance":{"equityPath":str(equity[0].relative_to(BASE)),"equitySha256":hashlib.sha256(equity[0].read_bytes()).hexdigest(),
       "fillsPath":str(fill[0].relative_to(BASE)),"fillsSha256":hashlib.sha256(fill[0].read_bytes()).hexdigest()}
  })
output={
 "schema":"p107-legacy-model-5minute-account-peak-dd21-latched-v4-entry-violation-screen/v1",
 "sourceV4Sha":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
 "liveSourceRule":"maxDrawdown is cumulative over signed ACCOUNT_MARK and V4 SharedReservations.reserveUnderLease rejects when >0.21; the native latch persists after equity recovery",
 "conditionalInterpretation":"The archived research equity is a modeled 5-minute path, not authenticated production ACCOUNT_MARK. Any V4 model entries after modeled DD>21 are potential parity conflicts unless a separately proven owner-approved reset or different account mark timing exists.",
 "scenarios":result,
 "doNotCallTradesActualSignedVenueFills":True,
 "doesNotProveNoFormalResetOccurred":True,
 "fullCurrentSTABLE4ProductionParity":False,
 "productionOperations":0
}
p=ROOT/"P107_LEGACY_MODEL_POST_DD21_V4_ENTRY_SCREEN_20261123.json"
p.write_text(json.dumps(output,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
for x in result:print(x["scenario"],x["bps"],"DD_PCT",x["max5minObservedDrawdownPct"],"BREACH",x["firstDdOver21Utc"],"V4_POST_BREACH",x["modeledV4EntriesStrictlyAfterFirstDdOver21"],"V4_ALL",x["modeledV4Fills"])
