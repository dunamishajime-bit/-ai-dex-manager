#!/usr/bin/env python3
"""Research-only two-cost Shared Risk, Gross, V52 denominator ledger audit.

This validates model evidence and flags anomalies. It does not prove order
admission gating at the exchange or a currently running production guard.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
START="2025-10-01T00:00:00Z";END="2026-10-01T00:00:00Z"
CAPS={"crypto":3.0,"stock":1.5,"total":3.5}
SHARED_LOSS_CAP=7.5;V52_LOSS_CAP=3.5
def read(path):
 with path.open(encoding="utf-8-sig",newline="") as f:
  yield from csv.DictReader(f)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def n(value,label):
 try:v=float(value)
 except (ValueError,TypeError):raise ValueError("INVALID_NUMBER:"+label)
 if not math.isfinite(v):raise ValueError("NONFINITE_NUMBER:"+label)
 return v
def eq(a,b):
 return math.isclose(a,b,abs_tol=1e-7,rel_tol=1e-10)
def utc(raw):
 d=datetime.fromisoformat(raw.replace("Z","+00:00"))
 if d.tzinfo is None or d.utcoffset()!=timezone.utc.utcoffset(d):
  raise ValueError("NOT_UTC_TIMESTAMP")
 return d
def checked_loss_event(reported,realized,unrealized,denominator,threshold,label):
    v=n(reported,label+"_loss_pct")
    pnl=n(realized,label+"_realized")+n(unrealized,label+"_unrealized")
    cap=n(denominator,label+"_denominator")
    if cap<=0 or v+1e-7<threshold:
        raise ValueError(label+"_LOSS_BELOW_THRESHOLD_OR_BAD_DENOMINATOR")
    modeled=max(0.,-100*pnl/cap)
    if not eq(v,modeled):
        raise ValueError(label+"_PNL_DENOMINATOR_DRIFT")
    return v

def assert_entry_allowed_at_snapshot(gate,kind):
    if kind=="MODEL_ENTER" and gate:
        raise ValueError("ADMITTED_WHILE_SHARED_DAILY_GATE_ACTIVE")
    if kind not in ("MODEL_ENTER","BLOCK"):
        raise ValueError("DECISION_UNKNOWN")

def audit_case(bps,case_dir):
 if bps not in (10,30):raise ValueError("UNSUPPORTED_BPS")
 def file(tail):
  results=list(case_dir.glob(f"*_{bps}BPS_{tail}"))
  if len(results)!=1:raise ValueError("MISSING_UNIQUE_CASE_FILE:"+tail)
  return results[0]
 manifest=case_dir/"RUN_MANIFEST.json"
 source=json.loads(manifest.read_text("utf8"))
 if source.get("status")!="STRICT_V2_PLUS_V4Q102_PENGU_RECOVERY_REVERSAL_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY" or source.get("period")!=[START,END]:
  raise ValueError("SOURCE_MODEL_CASE_NOT_CERTIFIED_IDENTITY")
 summaries=[x for x in source["results"] if x["cost_bps_roundtrip"]==bps]
 if len(summaries)!=1:raise ValueError("SUMMARY_BPS_CASE_NOT_UNIQUE")
 summary=summaries[0]
 if any(not eq(summary[k+"_cap"],v) for k,v in CAPS.items()) or summary["initial_jpy"]!=10000.:
  raise ValueError("SOURCE_GROSS_CAPS_OR_INITIAL_JPY_DRIFT")
 equity={}
 active_count=Counter();over=Counter();maxgross={k:(0.0,None) for k in CAPS};maxdd=0.;dd_at=None;peak=None
 last=None;equity_count=0
 for row in read(file("EQUITY_30MIN.csv")):
  t=row["utc"];date=utc(t)
  if last and (date-last).total_seconds()!=300:raise ValueError("EQUITY_5M_GRID_DISCONTINUITY")
  if not last and t!=START:raise ValueError("EQUITY_START_MISMATCH")
  last=date;equity_count+=1
  if t in equity:raise ValueError("EQUITY_DUPLICATED_TIME")
  v=n(row["compounded_mtm_equity_jpy"],"equity")
  if v<=0:raise ValueError("EQUITY_NOT_POSITIVE")
  cash=n(row["wallet_cash_jpy"],"cash")
  if peak is None or v>peak:peak=v
  dd=100*(v/peak-1)
  if dd<maxdd:maxdd=dd;dd_at=t
  groups={k:n(row[k+"_gross_x"],"gross_"+k) for k in CAPS}
  if not eq(groups["crypto"]+groups["stock"],groups["total"]):
   raise ValueError("TOTAL_GROSS_NOT_SUM_OF_CATEGORIES")
  if n(row["v4_gross_x"],"v4gross")>groups["crypto"]+1e-7:
   raise ValueError("V4_GROSS_EXCEEDS_CRYPTO")
  if any(x<0 for x in groups.values()):
   raise ValueError("GROSS_IS_NEGATIVE")
  for k,limit in CAPS.items():
   if groups[k]>limit+1e-7:over[k]+=1
   if groups[k]>maxgross[k][0]:maxgross[k]=(groups[k],t)
  if row["daily_gate_block"] not in ("True","False"):
   raise ValueError("DAILY_GATE_NONBOOLEAN")
  active=row["daily_gate_block"]=="True"
  active_count[active]+=1
  equity[t]={"gate":active,"equity":v,"cash":cash,"groups":groups}
 if equity_count!=105121 or last.strftime("%Y-%m-%dT%H:%M:%SZ")!=END:
  raise ValueError("ONE_YEAR_EQUITY_GRID_NOT_COMPLETE")
 if abs(equity[END]["equity"]-summary["final_compounded_jpy"])>1e-6:
  raise ValueError("TERMINAL_EQUITY_SUMMARY_DRIFT")
 decisions=Counter();block=Counter();admit=Counter();seen=set()
 for row in read(file("DECISIONS.csv")):
  ident=row["signal_id"]
  if not ident or ident in seen:raise ValueError("SOURCE_SIGNAL_ID_DUPLICATE")
  seen.add(ident);t=row["utc"]
  if t not in equity or not START<=t<END:raise ValueError("DECISION_NOT_ON_EQUITY_GRID")
  kind=row["decision"]
  assert_entry_allowed_at_snapshot(equity[t]["gate"],kind)
  decisions[kind]+=1
  requested=n(row["requested_gross"],"requested_gross")
  if requested<0:raise ValueError("NEGATIVE_REQUESTED_GROSS")
  if kind=="MODEL_ENTER":
   admit[row["strategy"]]+=1
  else:block[row["reason"]]+=1
 if sum(decisions.values())!=summary["source_intents"]:
  raise ValueError("INTENT_COUNT_DRIFT")
 if dict(block)!=summary["blocked_by_reason"]:
  raise ValueError("BLOCK_REASON_SUMMARY_DRIFT")
 if dict(admit)!=summary["admitted_by_runner"]:
  raise ValueError("ADMISSION_BY_RUNNER_SUMMARY_DRIFT")
 if decisions["MODEL_ENTER"] != summary["modeled_fills"]+summary["terminal_open_count"]:
  raise ValueError("MODEL_ENTER_NOT_EQUAL_FILLS_PLUS_OPEN")
 shared=Counter();peak_loss=0.;outside_trip=[]
 for row in read(file("SHARED_RISK_EVENTS.csv")):
  kind=row["event"];t=row["utc"]
  if kind not in ("TRIP","FLATTEN") or t not in equity:
   raise ValueError("SHARED_RISK_EVENT_UNKNOWN_OR_NOT_ON_GRID")
  shared[kind]+=1
  loss=checked_loss_event(row["loss_pct"],row["settled_crypto_pnl_jpy"],
    row["unrealized_crypto_pnl_jpy"],row["reference_equity_jpy"],SHARED_LOSS_CAP,"SHARED_RISK")
  if kind=="TRIP" and not equity[t]["gate"]:
   outside_trip.append(t)
  peak_loss=max(loss,peak_loss)
 if (shared["TRIP"]!=summary["shared_risk_trip_count"] or
     shared["FLATTEN"]!=summary["shared_risk_flatten_count"]):
  raise ValueError("SHARED_RISK_EVENT_MANIFEST_COUNT_DRIFT")
 if outside_trip:raise ValueError("SHARED_TRIP_NOT_GATED_AT_SAME_SNAPSHOT")
 v52=Counter();maxv52=(0.,None);cap_hist=Counter();overscale=[]
 for row in read(file("V52_DAILY_RISK_EVENTS.csv")):
  kind=row["event"];t=row["utc"];v52[kind]+=1
  if t not in equity:raise ValueError("V52_RISK_TIMESTAMP_NOT_ON_GRID")
  if kind=="DEFERRED_EXIT":
   if row["reason"]!="MISSED_CHECKPOINT_FAIL_CLOSED" or row["loss_pct"] or row["strategy_capital_jpy"]:
    raise ValueError("V52_DEFERRED_EXIT_INCORRECT_EVIDENCE")
   continue
  if kind!="TRIP" or row["reason"]!="V52_DAILY_LOSS_3P5":
   raise ValueError("V52_RISK_EVENT_UNKNOWN")
  loss=checked_loss_event(row["loss_pct"],row["realized_strategy_pnl_jpy"],
    row["unrealized_strategy_pnl_jpy"],row["strategy_capital_jpy"],V52_LOSS_CAP,"V52")
  capital=n(row["strategy_capital_jpy"],"v52_strategy_capital")
  unreal=n(row["unrealized_strategy_pnl_jpy"],"v52_unreal")
  cap_hist[round(capital,2)]+=1
  if loss>maxv52[0]:maxv52=(loss,t)
  if loss>1000 and capital<1000 and equity[t]["equity"]>100000:
   overscale.append({"utc":t,"lossPct":loss,"strategyCapitalJpy":capital,
      "accountEquityJpy":equity[t]["equity"],"v52UnrealizedJpy":unreal})
 if v52["TRIP"]!=summary["v52_daily_trip_count"] or v52["DEFERRED_EXIT"]!=summary["v52_deferred_exit_count"]:
  raise ValueError("V52_RISK_EVENT_COUNT_DRIFT")
 # MODEL replays can exceed admission-time Gross as the current notional
 # drifts with market marks. Model-only snapshots cannot certify entry gates.
 return {"costBps":bps,"source":"HISTORICAL_RESEARCH_ONLY_NOT_LIVE",
   "gridRows":equity_count,"terminalSnapshotAtExcludedEnd":True,
   "decisionCount":sum(decisions.values()),"admittedModel":decisions["MODEL_ENTER"],
   "dailyGateRows":active_count[True],"noModelAdmissionsDuringDailyGate":True,
   "blockedByDailyLossGate":block["DAILY_LOSS_7P5_GATE"],
   "sharedRisk":{"trips":shared["TRIP"],"flattenModelEvents":shared["FLATTEN"],
     "maxTripLossPct":peak_loss,"allEventPercentagesMathVerified":True},
   "v52Risk":{"trips":v52["TRIP"],"deferredModelExits":v52["DEFERRED_EXIT"],
     "maxReportedV52LossPct":maxv52[0],"maxReportedUtc":maxv52[1],
     "sub1000JpyDenominatorEvents":sum(c for k,c in cap_hist.items() if k<1000),
     "extremeDenominatorScaleEvents":len(overscale),
     "extremeSamples":overscale[:3],
     "riskCapitalVsAccountScaleRequiresSourceReview":bool(overscale)},
   "mtmGross":{"sourceCaps":CAPS,"maxObserved":{k:{"grossX":v,"utc":t} for k,(v,t) in maxgross.items()},
     "overCapSnapshots":dict(over),
     "overCapSnapshotsNotProofOfAdmissionViolation":True},
   "mtmEquity":{"maxObservedFiveMinuteDrawdownPct":maxdd,"ddUtc":dd_at,
     "manifestMaxHourlyDrawdownPct":summary["max_hourly_dd_pct"],
     "finalJpy":equity[END]["equity"]},
   "riskGateAndGrossSourceEconomicsCertified":False,
   "signedVenueExecutionCertified":False,
   "productionMutations":0}
def run(folder):
 allcases={str(b):audit_case(b,folder) for b in (10,30)}
 return {"schema":"bt481-model-shared-risk-v52-gross-audit/v1",
 "status":"SOURCE_MODEL_EVENTS_RECONCILED_V52_SCALE_REVIEW_REQUIRED",
 "cases":allcases,"liveTradingUnchanged":True,
 "interpretation":"MTM gross drift does not imply over-cap entry. V52 denominator may be intentional fixed bucket or a model error; cannot assert without source."}
def main():
 a=argparse.ArgumentParser(description=__doc__)
 a.add_argument("--case-dir",required=True,type=Path)
 a.add_argument("--output",required=True,type=Path)
 r=a.parse_args();d=run(r.case_dir)
 d["inputSha256"]={"RUN_MANIFEST":sha(r.case_dir/"RUN_MANIFEST.json")}
 for b in (10,30):
  for suffix in ("EQUITY_30MIN.csv","DECISIONS.csv","SHARED_RISK_EVENTS.csv","V52_DAILY_RISK_EVENTS.csv"):
   p=next(r.case_dir.glob(f"*_{b}BPS_{suffix}"))
   d["inputSha256"][f"{b}BPS_{suffix}"]=sha(p)
 r.output.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf8")
 print(json.dumps({"status":d["status"],"summary":{
   b:{"intents":x["decisionCount"],"trips":x["sharedRisk"]["trips"],
      "v52Extreme":x["v52Risk"]["extremeDenominatorScaleEvents"],
      "mtmOverCapRows":x["mtmGross"]["overCapSnapshots"],
      "max5mDD":round(x["mtmEquity"]["maxObservedFiveMinuteDrawdownPct"],4)}
   for b,x in d["cases"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
