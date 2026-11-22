from pathlib import Path
import json,hashlib,collections,datetime,sys
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
P107=ROOT/"research-branch-checkout/research/prism7/p107"
OLD=Path(r"C:\tmp\disdex-bt-20251001-20261001/native-new-signal-20251001-20261001")
OUT=P107/"integrated_candidates"
OUT.mkdir(parents=True,exist_ok=True)
START=1759276800000
END=1790812800000
sources={
"V4":P107/"v4_exact/P107_V4_PIN_NATIVE_H1_1YEAR_DECISION_SCAN_20261123.json",
"PENGU":P107/"pengu_exact/P107_PENGU_PIN_ASOF_117_RAW_ENTRY_CANDIDATES_20261123.jsonl",
"Q102":P107/"q102_native/P107_Q102_PIN_21_SYMBOL_1Y_RAW_SIGNAL_AUDIT_20261123_V2.json",
"IDLE":P107/"fet_idle_exact/P107_IDLE_PIN_ASOF_184_RAW_ENTRY_CANDIDATES_20261123.jsonl",
"FET":P107/"fet_idle_exact/P107_FET_PIN_NATIVE_ONE_YEAR_11_ENTRY_PARITY_20261123.json",
"HYPE":P107/"hype_exact/P107_HYPE_CURRENT_PIN_NATIVE_ASOF_H1_H48_SHADOW_20261122.json",
"V4_GROSS":OLD/"native-V4-raw-intentions.jsonl",
}
def loadjson(p):return json.loads(p.read_text(encoding="utf8"))
def jsonl(p):return [json.loads(s) for s in p.read_text(encoding="utf8").splitlines() if s.strip()]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
pins={"V4":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
"PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496",
"Q102":"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7",
"IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5",
"FET":"7688ed7c93a1918d8b44837339b7da5584a868f5",
"HYPE":"e0e4f1d8f22b62e9410188ef6e590a20e31f760f"}
def utc(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat().replace("+00:00","Z")
def mk(runner,ts,decision,symbol,side,route,gross,payload,policy=None):
 ts=int(ts);decision=int(decision)
 assert runner in pins,(runner,payload)
 assert START<=ts<END,(runner,utc(ts))
 assert 0<gross<=3,(runner,gross)
 assert symbol.endswith("USDT"),(runner,symbol)
 assert side in ("LONG","SHORT"),(runner,side)
 assert isinstance(route,str) and len(route)>0
 assert decision<=ts,(runner,utc(decision),utc(ts))
 return {"entryTs":ts,"entryUtc":utc(ts),"sourceDecisionTs":decision,"runner":runner,"sourcePinnedSHA":pins[runner],
  "symbol":symbol,"side":side,"route":route,"requestedGross":float(gross),
  "rawCandidateOnly":True,"signedFill":False,"simulatedOrder":False,"sourceLineage":payload,
  "exitOrPolicyTag":policy}
events=[]
nativeV4=loadjson(sources["V4"])
oldV4=jsonl(sources["V4_GROSS"])
def vkey(x):
 return (int(x["decisionTs"]),x["symbol"],x["side"],x["route"],int(x["rank"]),int(x["entryTs"]))
idx={}
for e in oldV4:
 k=vkey(e)
 assert k not in idx,k
 idx[k]=e
assert nativeV4["pin"]==pins["V4"]
v4seen=set()
for snap in nativeV4["results"]:
 if snap["result"]!="PIN_SOURCE_NATIVE_DECISION":continue
 for c in snap["candidates"]:
  z={"decisionTs":snap["decisionTs"],"symbol":c["symbol"],"side":c["effectiveSide"],"route":c["route"],"rank":c["rank"],"entryTs":c["eligibleEntryTs"]}
  key=vkey(z)
  assert key in idx,("CURRENT_V4_NOT_LEGACY",key)
  assert key not in v4seen,key
  v4seen.add(key)
  old=idx[key]
  assert old["sourceFingerprint"]==snap["sourceFingerprint"]
  events.append(mk("V4",z["entryTs"],z["decisionTs"],z["symbol"],z["side"],z["route"],float(old["requestedGross"]),
      {"nativeDecisionFingerprint":snap["sourceFingerprint"],"rank":c["rank"],"verifiedOldEntryIdentity":True},"NATIVE_EXIT_MODEL_VERIFIED_AS_CONDITIONAL"))
assert len(v4seen)==len(idx)==1394
pengu=jsonl(sources["PENGU"])
assert len(pengu)==117
for x in pengu:
 assert x["source_runtime_sha"]==pins["PENGU"]
 events.append(mk("PENGU",x["entryTs"],x["signalTs"],x["symbol"],x["side"],x["route"],float(x["requestedGross"]),
      {"historicalEntryReferenceOpenPrice":x["entryReferenceOpenPrice"],"rawCandidateOnly":True},None))
q=loadjson(sources["Q102"])
assert q["sourceSha"]==pins["Q102"] and q["selectedUnconstrainedCandidateCount"]==49
for x in q["selectedUnconstrainedSignalCandidates"]:
 events.append(mk("Q102",x["decisionTs"],x["dataCutoffTs"],x["symbol"],x["side"],x["variant"],float(x["requestedGross"]),
      {"sourceDecisionTs":x["decisionTs"],"family":x["family"],"layer":x["layer"],
      "candidateSignalGrossMinRuntime":x["effectiveGross"],"preflightOnly500ish":True},x["exitPolicy"]))
idle=jsonl(sources["IDLE"])
assert len(idle)==184
for x in idle:
 assert x["source_runtime_sha"]==pins["IDLE"]
 events.append(mk("IDLE",x["entryTs"],x["signalTs"],x["symbol"],x["side"],x["route"],float(x["requestedGross"]),
      {"historicalEntryReferenceOpenPrice":x["entryReferenceOpenPrice"],"generic12hCandidateCooldown":True},None))
fet=loadjson(sources["FET"])
assert fet["pinnedSHA"]==pins["FET"] and fet["newNativeCount"]==11
for x in fet["events"]:
 events.append(mk("FET",x["entryTs"],x["signalTs"],x["symbol"],x["side"],x["route"],float(x["requestedGross"]),
      {"historicalEntryReferenceOpenPrice":x["entryReferenceOpenPrice"],"sourceVolumeRatio":x["volumeRatio"]},None))
hype=loadjson(sources["HYPE"])
assert hype["sourceSha"]==pins["HYPE"] and hype["acceptedCount"]==35
for x in hype["accepted"]:
 events.append(mk("HYPE",x["entryTs"],x["asofFeatures"]["entryTs"]-3_600_000,x["route"] and "HYPEUSDT","LONG",x["route"],float(x["grossModel"]),
      {"historicalEntryReferenceOpenPrice":x["asterH1EntryOpen"],"sourceH48ExitBoundaryOpen":x["asterH1H48ExitBoundaryOpen"],
      "candidateExitBoundaryTs":x["exitTs"]},"HYPE_CURRENT_TIME_ONLY_H48"))
events.sort(key=lambda x:(x["entryTs"],x["runner"],x["symbol"],x["route"],x["side"]))
assert len(events)==1790,len(events)
uniqueKeys=set()
for event in events:
 k=(event["runner"],event["entryTs"],event["symbol"],event["side"],event["route"])
 assert k not in uniqueKeys,k
 uniqueKeys.add(k)
byRunner=collections.Counter(x["runner"] for x in events)
assert byRunner=={"V4":1394,"PENGU":117,"Q102":49,"IDLE":184,"FET":11,"HYPE":35},byRunner
# Candidate concurrency only, never infer actual active positions or account acceptance.
times=collections.defaultdict(list)
slots=collections.defaultdict(list)
for e in events:
 times[e["entryTs"]].append(e)
 slots[(e["entryTs"],e["symbol"])].append(e)
collisions=[]
for (at,sym),values in sorted(slots.items()):
 if len(values)<2:continue
 collisions.append({"entryTs":at,"utc":utc(at),"symbol":sym,"simultaneousCandidateCount":len(values),
 "sides":sorted({x["side"] for x in values}),"runners":sorted({x["runner"] for x in values}),
 "sumRequestedGrossIfAllExecuted":round(sum(x["requestedGross"] for x in values),8),
 "examples":[{"runner":x["runner"],"route":x["route"],"side":x["side"],"gross":x["requestedGross"]} for x in values],
 "note":"Only same-time raw candidate contention; not proof that any order was accepted."})
atAny=[{"entryTs":at,"utc":utc(at),"signalCount":len(values),"runnerCount":len({x["runner"] for x in values})}
  for at,values in sorted(times.items()) if len(values)>1]
opp=collections.defaultdict(list)
for e in events:opp[(e["symbol"],e["side"])].append(e)
# Pairwise raw timestamps within 48h not treated as fill conflicts.
provenance={}
for k,p in sources.items():
 provenance[k]={"relativeToResearchBase":str(p.relative_to(P107)) if p.is_relative_to(P107) else str(p),
 "sha256":sha(p),"bytes":p.stat().st_size}
out={
 "schema":"p107-current-pin-six-runner-raw-candidate-chronological-union/v1",
 "periodUtc":[utc(START),utc(END)],"sourcePinnedSHA":pins,
 "inputProvenance":provenance,
 "sourceOnlyAndNoAutoTrade":True,"runnerCoverage":{"included":sorted(byRunner),"absent":["V52"],"q102DataCoverageFailClosed":1691,"q102NativeFunctionOnlyAtGridCount":499},
 "coverage":dict(sorted(byRunner.items())),"totalRawCandidates":len(events),"uniqueUTCEntryTimestamps":len(times),
 "simultaneousMultipleCandidateTimeCount":len(atAny),
 "simultaneousSameSymbolCandidateSlotCount":len(collisions),
 "simultaneousSameSymbolCandidateExamples":collisions[:30],
 "simultaneousMultipleCandidateExamples":atAny[:20],
 "sleeveExposureAndRecentOrderCooldownNotReplayed":True,
 "noSignedExecutionsOrSTOPOrPortfolioAdmission":True,"no10Or30BpsNAV":True,
 "currentSTABLE4FullParity":False}
result=OUT/"P107_SIX_RUNNER_1790_RAW_CANDIDATE_CONCURRENCY_AUDIT_20261123.json"
result.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
reg=OUT/"P107_SIX_RUNNER_1790_CHRONOLOGICAL_NATIVE_CANDIDATES_20261123.jsonl"
reg.write_text("\n".join(json.dumps(e,ensure_ascii=False,separators=(",",":")) for e in events)+"\n",encoding="utf8")
out["sourceResultSHA256"]=sha(reg)
result.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print(json.dumps({"TOTAL":len(events),"BY_RUNNER":dict(byRunner),"uniqueTimes":len(times),"multi_candidate_times":len(atAny),"same_symbol_exact_collisions":len(collisions),"same_symbol_examples":collisions[:6],"sha256":sha(reg)},ensure_ascii=False))
