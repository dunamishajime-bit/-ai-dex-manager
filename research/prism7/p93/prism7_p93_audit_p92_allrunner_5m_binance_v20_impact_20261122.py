#!/usr/bin/env python3
"""P93: source-pinned isolated all-Runner chronological portfolio counterfactual
for owner-selected Binance V20 -> Aster +5m asof M5 gate.

Critical: This audit is not current STABLE4/prod. The older STRICT_V2 engine
was rerun with exact source parity at original 30-minute grid; 5-min paired
before/after both have stock cap1.5, crypto3, total3.5, V52 gross1.5.
NO DD21 hold gate (old core), so cannot claim to restore 673 DD-blocked cases.
No signed fills; M5 mark uses last completed H1 (not intrabar worst).
"""
from pathlib import Path
import csv,json,hashlib,collections,datetime,math,statistics
ROOT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\P92_PAIRED_PORTFOLIO_REPLAY")
P91=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\results\PRISM7_P91_OWNER_ADOPTED_REAL_1Y_BINANCE_TRIGGER_ASTER_CONFIRMED_M5_SOURCE_TAPE_20261122.json")
ORIG=Path(r"C:\tmp\disdex-bt-20251001-20261001\VPS_DD_STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_20261109\RUN_MANIFEST.json")
M=ROOT/"P92_ISOLATED_REPLAY_MANIFEST_20261122.json"
OUT=ROOT/"P93_REAL_HISTORICAL_1Y_ALLRUNNER_PAIRED_5M_DD_BUT_NAV_RETRACTION_AUDIT_20261122.json"
MD=ROOT/"P93_ALLRUNNER_PENGU_BINANCE5M_CHANGED_ORDER_ADMISSION_DD_PROFIT_20261122.md"
REV=ROOT/"P93_REOPENED_VS_NEWLY_BLOCKED_OTHERRUNNER_CANDIDATE_ID_20261122.csv"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pickfile(mode,fee,label):
 files=list((ROOT/mode).glob(f"*_{fee}BPS_{label}.csv"))
 assert len(files)==1,(mode,fee,label,files)
 return files[0]
def decisions(mode,fee):
 return {z["signal_id"]:z for z in csv.DictReader(pickfile(mode,fee,"DECISIONS").open(encoding="utf-8-sig",newline=""))}
def fills(mode,fee):
 return list(csv.DictReader(pickfile(mode,fee,"FILLS").open(encoding="utf-8-sig",newline="")))
def first_divergence(a,b):
 f=pickfile(a,30,"EQUITY_5MIN")
 g=pickfile(b,30,"EQUITY_5MIN")
 count=0;first=None;biggest=None
 with f.open(encoding="utf-8-sig",newline="") as x,g.open(encoding="utf-8-sig",newline="") as y:
  rowsA=csv.DictReader(x);rowsB=csv.DictReader(y)
  for left,right in zip(rowsA,rowsB):
   assert left["utc"]==right["utc"],"PORTFOLIO_5M_CLOCK_NOT_ALIGNED"
   count+=1
   p=float(left["compounded_mtm_equity_jpy"])
   q=float(right["compounded_mtm_equity_jpy"])
   if abs(p-q)>1e-6:
    if first is None:first={"utc":left["utc"],"baselineEquityJPY":p,"candidateEquityJPY":q}
    gap=abs(p-q)
    if biggest is None or gap>biggest["absoluteDifferenceJPY"]:
     biggest={"utc":left["utc"],"absoluteDifferenceJPY":gap}
 assert count==105120,("GRID_5M_ONE_YEAR_MARK_COUNT",count)
 return {"commonFiveMinMarks":count,"firstEconomicDivergence":first,"maxAbsoluteEquityDifference":biggest}
def main():
 spec=json.loads(M.read_text(encoding="utf8"))
 src=json.loads(P91.read_text(encoding="utf8"))
 assert spec["noProductionMutation"] and spec["originalPENGULongAndRecoveryUnchanged"]
 assert src["acceptedBinance5mCausalNativeResearchCandidateCount"]==4
 assert src["sourceOriginalAsterV20NativeYear"]==40
 ori=json.loads(ORIG.read_text(encoding="utf-8-sig"))
 parity=json.loads((ROOT/"PARITY30M"/"RUN_MANIFEST.json").read_text(encoding="utf-8"))
 for a,b in zip(ori["results"],parity["results"]):
  assert a["cost_bps_roundtrip"]==b["cost_bps_roundtrip"]
  for k in ("final_compounded_jpy","max_hourly_dd_pct","modeled_fills","win_rate_pct"):
   assert abs(a[k]-b[k])<1e-8,("ORIGINAL_MODEL_NOT_REPRODUCED",k,a[k],b[k])
 results={}
 diff_rows=[]
 for bps in (10,30):
  a=json.loads((ROOT/"BASE5M_CAPS"/"RUN_MANIFEST.json").read_text(encoding="utf8"))
  b=json.loads((ROOT/"BIN5M_CAPS"/"RUN_MANIFEST.json").read_text(encoding="utf8"))
  old=next(x for x in a["results"] if x["cost_bps_roundtrip"]==bps)
  new=next(x for x in b["results"] if x["cost_bps_roundtrip"]==bps)
  assert old["crypto_cap"]==new["crypto_cap"]==3.0
  assert old["stock_cap"]==new["stock_cap"]==1.5
  assert old["total_cap"]==new["total_cap"]==3.5
  od=decisions("BASE5M_CAPS",bps)
  nd=decisions("BIN5M_CAPS",bps)
  intersection=set(od)&set(nd)
  added=[nd[i] for i in nd.keys()-od.keys()]
  removed=[od[i] for i in od.keys()-nd.keys()]
  assert len(added)==4 and all(x["strategy"]=="PENGU" for x in added)
  assert len(removed)==40 and all(x["strategy"]=="PENGU" for x in removed)
  revived=[(i,od[i],nd[i]) for i in intersection if od[i]["decision"]=="BLOCK" and nd[i]["decision"]=="MODEL_ENTER"]
  newlyblocked=[(i,od[i],nd[i]) for i in intersection if od[i]["decision"]=="MODEL_ENTER" and nd[i]["decision"]=="BLOCK"]
  assert len(revived)==19 and len(newlyblocked)==9
  ar=collections.Counter(x["strategy"] for x in removed)
  nr=collections.Counter(x["strategy"] for x in added)
  oldfills=fills("BASE5M_CAPS",bps);newfills=fills("BIN5M_CAPS",bps)
  oldPengu=collections.Counter(z["route"] for z in oldfills if z["strategy"]=="PENGU")
  newPengu=collections.Counter(z["route"] for z in newfills if z["strategy"]=="PENGU")
  assert oldPengu["SHORT_V20"]==19 and newPengu["SHORT_V20"]==2
  assert all(k!="V4_MAX_DRAWDOWN_21PCT_HOLD" for k in old["blocked_by_reason"])
  for kind,xx in (("REOPENED",revived),("NEWLY_BLOCKED",newlyblocked)):
   for ident,prior,after in sorted(xx):
    diff_rows.append({"bps":bps,"change":kind,"signal_id":ident,"runner":prior["strategy"],
     "oldUTC":prior["utc"],"newUTC":after["utc"],"oldDecision":prior["decision"],
     "oldReason":prior["reason"],"newDecision":after["decision"],"newReason":after["reason"],
     "oldGross":prior["requested_gross"],"newGross":after["requested_gross"]})
  oldnav=old["final_compounded_jpy"];newnav=new["final_compounded_jpy"]
  results[str(bps)]={
   "oldOriginalBeforeCandidateCount":2805,
   "newAfterCandidateCount":2769,
   "originalAllPENGUNativeYear":116,
   "oldOriginalV20SourceNative":40,
   "newBinanceNativeSourceAcceptedBeforeRisk":4,
   "oldPENGUShortSelected":oldPengu["SHORT_V20"],
   "newPENGUShortSelected":newPengu["SHORT_V20"],
   "oldPENGUOtherRoutesSelected":dict((k,v) for k,v in oldPengu.items() if k!="SHORT_V20"),
   "newPENGUOtherRoutesSelected":dict((k,v) for k,v in newPengu.items() if k!="SHORT_V20"),
   "oldNAVJPY":oldnav,"newNAVJPY":newnav,
   "absoluteNAVDeltaJPY":newnav-oldnav,
   "NAVRelativeChangePct":round(100*(newnav/oldnav-1),5),
   "oldMaxDDPct":abs(old["max_hourly_dd_pct"]),
   "newMaxDDPct":abs(new["max_hourly_dd_pct"]),
   "maxDDImprovementPercentagePoints":round(abs(old["max_hourly_dd_pct"])-abs(new["max_hourly_dd_pct"]),5),
   "stillViolates20DD":abs(new["max_hourly_dd_pct"])>20,
   "oldAllRunnerFills":old["modeled_fills"],"newAllRunnerFills":new["modeled_fills"],
   "oldCombinedWRPct":old["win_rate_pct"],"newCombinedWRPct":new["win_rate_pct"],
   "oldRunnerAdmissions":old["admitted_by_runner"],
   "newRunnerAdmissions":new["admitted_by_runner"],
   "oldGateReason":old["blocked_by_reason"],
   "newGateReason":new["blocked_by_reason"],
   "reopenedOldSignalCount":len(revived),
   "reopenedByRunner":dict(collections.Counter(x[1]["strategy"] for x in revived)),
   "reopenedOldGateReason":dict(collections.Counter(x[1]["reason"] for x in revived)),
   "newlyBlockedOldSignalCount":len(newlyblocked),
   "newlyBlockedByRunner":dict(collections.Counter(x[1]["strategy"] for x in newlyblocked)),
   "newlyBlockedReason":dict(collections.Counter(x[2]["reason"] for x in newlyblocked)),
   "oldV4DD21GatePresent":False,"newV4DD21GatePresent":False,
   "reopen673LastResearchV4DD21Gate":None,
   "sourceSchemaNotSignedProductionParity":True}
  assert old["modeled_fills"]==864 and new["modeled_fills"]==857
 expected=first_divergence("BASE5M_CAPS","BIN5M_CAPS")
 with REV.open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(diff_rows[0]));w.writeheader();w.writerows(diff_rows)
 report={
  "schema":"prism7-p93-isolated-allrunner-tradeable-aster-binance5m-nativeV20-rerun5min-paired-bt/v1",
  "status":"OWNER_STRATEGY_CHOSEN__ISOLATED_OLDER_RISK_REPLAY__NOT_PRODUCTION_COMPLETE",
  "period":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z exclusive"],
  "ownerSelectedChange":"Replace only PENGU SHORT_V20 original ASTER native source40 by Binance native original 41->P73 macro 33->frozen ASTER completed5m score 4, on Aster native exits 5m. Other 7 runner source signals unchanged.",
  "sourceOriginalStrictBaseline30minRerunAgainstHistoricalArchivedPASS":True,
  "original30MinuteBaselineSanityOnlyNotComparableTo5Minute":True,
  "baselineANDcandidateReplayedWithSame5mClock":True,
  "selectedGrossSizingOriginalPENGUV20Gross1ToGross0p75":True,
  "ownerGross0p25NeverUsed":True,
  "PENGU_3RoutesAllOthersIntact":True,
  "simulatedFiveMinEquityAndSharedDailyGrossFundsDynamicallyRecomputed":True,
  "notCurrentSTABLE4OrCurrentProd":True,
  "doesNotModelLatestDD21HoldGate":True,
  "doesNotModelLatestWholeFleetStopsAtM5IntrabarExactly":True,
  "sameTimeGridFirstDivergence":expected,
  "resultsByFeeBps":results,
  "sourceSHA256":{
   "original20261109StrictCore":spec["originalEngineSHA256"],
   "sourceBinanceEntryAsterNative5mTape":spec["newOnlyPENGUSHORTBinance5mTapeSHA256"],
   "caseManifest":sha(M),"originalArchived30min":sha(ORIG),
   "baseline5m10Bps":sha(pickfile("BASE5M_CAPS",10,"FILLS")),
   "baseline5m30Bps":sha(pickfile("BASE5M_CAPS",30,"FILLS")),
   "candidate5m10Bps":sha(pickfile("BIN5M_CAPS",10,"FILLS")),
   "candidate5m30Bps":sha(pickfile("BIN5M_CAPS",30,"FILLS")),
   "old30bpsDecisions":sha(pickfile("BASE5M_CAPS",30,"DECISIONS")),
   "new30bpsDecisions":sha(pickfile("BIN5M_CAPS",30,"DECISIONS")),
   "reopenedAndNewlyBlockedSignalCsv":sha(REV)
  },
  "limitations":[
   "P92 is based on 2026-11-09 STRICT_V2 source and original pinned candidate tapes, NOT the 2026-11-22 DD_PRISM3 result and NOT currently deployed STABLE4 or latest Production SHA.",
   "P92 does not model V4_MAX_DRAWDOWN_21PCT_HOLD. The previously observed 673 gate-blocked candidates MUST NOT be claimed restored from P92. Only 19 existing other intake candidates changed from BLOCK to MODEL_ENTER in this older model.",
   "The 5min source calendar uses last completed ASTER H1 for every unrealized mark, not intrabar 5m high risk; actual DD could be larger.",
   "Changing source funding and exposure timing across a different gross setting, modeled V52 gross reduced from 2 to 1.5 in BOTH baseline and changed; they are comparable only to each other, not historical stock4 run.",
   "PENGU old native 40 candidates at gross1.0 vs new four candidates gross.75: stronger DD compression may be from *stopping many profitable trades* rather than improved native direction discrimination.",
   "Real Binance H1 signal to Aster execution used P80 model Aster first positive printed M5 OPEN at/after t+5; signed venue fill, orderbook, actual STOP/partial fills unavailable.",
   "Q102 HIGH_VOL gap, V52 modeled price, static HYPE/IDLE and other original research-only limitations remain.",
   "Consequence is falsification of guaranteed improvement, not authorization to deploy; global DD20 requirement fails even in the more optimistic old replay.",
   "No Runner/Production/GitHub master/Gross/STOP/positions/orders changed."
  ]}
 OUT.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf8")
 md=["# P93：Owner採用『Binance→ASTER＋確定5分足V20』全Runner隔離時系列BT",
  "",
  "旧2026-11-09 Strict V2エンジンを完全隔離。原モデル30分の10bps/30bps実数結果が元アーカイブと完全一致することを先に証明し、その後、両群で同じ5分刻み・Crypto3.0/Stock1.5/Total3.5、V52研究Gross1.5を使用。V20旧ASTER40候補を削除し、Binance41候補のうちP73+完成ASTER M5 Gate後の4候補（総合採用2）に置換。元PENGU LONG/RECOVERYと他Runnerは変更なし。**旧研究エンジンのためProduction完全一致ではない。**",
  "",
  "| 手数料 | 変更前1万円最終 | 新V20最終 | 最大DD変更前 | 最大DD変更後 | DD改善 | 全約定 | V20約定 |",
  "|---|---:|---:|---:|---:|---:|---|---|"]
 for k,v in results.items():
  md.append("| "+k+"bps | "+str(round(v["oldNAVJPY"],2))+
    "円 | "+str(round(v["newNAVJPY"],2))+"円 | "+
    str(round(v["oldMaxDDPct"],2))+"% | "+str(round(v["newMaxDDPct"],2))+"% | "+
    str(v["maxDDImprovementPercentagePoints"])+"pt | "+
    str(v["oldAllRunnerFills"])+"→"+str(v["newAllRunnerFills"])+
    " | "+str(v["oldPENGUShortSelected"])+"→"+str(v["newPENGUShortSelected"])+" |")
 v=results["30"]
 md+=["",
 "30bpsではDDが14.17pt縮小したが最大DDは29.95%でDD20%上限を超えたまま。最終資金は850,333円→551,075円、約35%低下。単にV20を止めるだけでは全体利益の改善は保証されない。",
 "",
 "### 正確な旧候補IDごとの注文許可転換",
 "30bpsで旧BLOCK→新ENTERは"+str(v["reopenedOldSignalCount"])+"件："+json.dumps(v["reopenedByRunner"],ensure_ascii=False)+
 "。旧ENTER→新BLOCKは"+str(v["newlyBlockedOldSignalCount"])+"件："+json.dumps(v["newlyBlockedByRunner"],ensure_ascii=False)+
 "。Gross/日次損失/シンボル占有/優先順位を新たな日時順で判定したもの。旧V20は40候補削除、新Binance4候補追加なので、この差に含めない。",
 "",
 "### 正式統合への制約",
 "**P92エンジンはV4のDD21% HOLDを持たない旧研究モデル**。2026-11-22研究で記録されている『DD21で拒否673件』が何件復活するかは未確認。ユーザーの指示にある最重要再評価は、STABLE4現行Production pinと同じ共有DD, Daily Loss, V52, V4 DD21, Stable4 Q102 H48のエンジン・署名付きSTOPの区別を反映した**別の新旧同時刻再現BT**が必要。",
 "",
 "原Native短期リスク：BINANCE41→P73認可33→ASTER確定5分足で採用候補4。旧ASTER V20は40候補あり、そのうち旧ポートフォリオ採用19。利益を伸ばすV20も多く削除される点が重大。",
 "",
 "保護：Master／LIVE／Runner／既存STOP／Gross／建玉／注文無変更。署名付き約定を装わない。"]
 MD.write_text("\n".join(md)+"\n",encoding="utf8")
 print("P93_PENGU_OWNER_BINANCE5M_ISOLATED_FULLRUNNER_10_30BPS_PAIRED_REPLAY_AUDITED",
  json.dumps({"archiveOriginalStrictParity30M":True,"paired":results,
   "firstDivergence":expected},ensure_ascii=False)[:11000],flush=True)
 print("FILES",OUT,MD,REV)
if __name__=="__main__":main()
