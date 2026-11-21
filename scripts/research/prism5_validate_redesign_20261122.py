#!/usr/bin/env python3
"""PRISM5 evidence-lock validator: verify research result, never deploy.

Independently audit 53 pinned natural source trades, 10 direct native matches,
9 repriced deferred entries and market-wide 12h causal training chronology.

A p=0.60 selective subset of 2/41 is NOT a statistically meaningful 80%
PENGU win rate, and a 12h market-direction prediction isn't a native trade
win probability. Native STOPs, shared Gross and real venue fills not proven.
"""
from __future__ import annotations
import csv,json,math,statistics
from collections import Counter
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(r"C:\Users\dis\Documents\DisDex_Research\WINRATE_DEEP_20261122\phase2_results")
def j(name):return json.loads((OUT/name).read_text(encoding="utf8"))
def csvread(name):
 with (OUT/name).open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
structure=j("PRISM5_PENGU_V20_STRUCTURE_53_SUMMARY.json")
repriced=j("PRISM5_PENGU_V20_STRUCTURE_NATIVE_REPRICED_19.json")
market=j("PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_SUMMARY.json")
led=csvread("PRISM5_PENGU_V20_STRUCTURE_53_CLASSIFICATION.csv")
native=repriced["events"]
if Counter(x["period"] for x in led)!={"PRE_2025_AUG_SEP":6,
  "BASE_2025_2026":40,"POST_2026_OCT_NOV":7}:
 raise ValueError("53_SOURCE_EVENT_COUNTS_CHANGED")
if structure["native_pin"]!="1657e173d250ad58f53e62f7bb0a3428fb405496":
 raise ValueError("SOURCE_PIN_NOT_FROZEN")
if len(led)!=53 or repriced["sourceDirectCount"]!=10 or repriced["sourceDeferredCount"]!=9:
 raise ValueError("NEW_ENGINE_EXPECTED_53_10_9")
if len(native)!=19 or repriced["directNativeExitParity"]!=10 or repriced["unresolved"]:
 raise ValueError("NEW_EXIT_NOT_NATIVE_RECONCILED")
# Original source is kept alongside redesigned exit for independent audit.
for x in native:
 if x["entryFeatureReferenceTs"]!=x["entryTs"]-3600000:
  raise ValueError("NEW_ENTRY_USED_NON_CLOSED_H1")
 if x["sourceNativeRuntimeSha"]!=structure["native_pin"]:
  raise ValueError("V20_EXIT_SOURCE_PIN_CHANGED")
 if abs(x["rawReturn"]-(1-x["exitPrice"]/x["entryPrice"]))>1e-10:
  raise ValueError("SHORT_NATIVE_RETURN_MISMATCH")
 if abs(x["cost10NetReturn"]-(x["rawReturn"]-.001))>1e-12:
  raise ValueError("COST10_PRICE_RECALC_FAIL")
 if abs(x["cost30NetReturn"]-(x["rawReturn"]-.003))>1e-12:
  raise ValueError("COST30_PRICE_RECALC_FAIL")
 if x["kind"]=="DIRECT":
  if x["entryTs"]!=x["sourceOriginalEntryTs"]:
   raise ValueError("DIRECT_ENTRY_CHANGED")
 else:
  if x["entryTs"]<=x["sourceOriginalEntryTs"]:
   raise ValueError("DEFERRED_ENTRY_NOT_DELAYED")
source={x["original_signal_id"]:x for x in led}
# IDs overlap across periods. Re-evaluate exact source by (period,id).
source={(x["period"],x["original_signal_id"]):x for x in led}
for x in native:
 orig=source[(x["period"],x["sourceOriginalId"])]
 if x["kind"]=="DIRECT":
  if orig["v20_final_action"]!="ENTER_SHORT_CANDIDATE":
   raise ValueError("DIRECT_ID_WAS_NOT_APPROVED")
 else:
  if orig["v20_final_action"]!="DEFERRED_SHORT_NATIVE_EXIT_REQUIRED":
   raise ValueError("DELAYED_ID_NOT_WAIT_CONFIRMED")
  if int(orig["deferred_entryTs"])!=x["entryTs"]:
   raise ValueError("DELAYS_DID_NOT_MATCH")
base30=next(x for x in structure["aggregate"]
            if x["period"]=="ALL_ALREADY_SEEN" and x["fee_bps"]==30)
new30=next(x for x in repriced["cohorts"]
           if x["period"]=="ALL_KNOWN_PERIODS" and x["kind"]=="ALL_REPRICE_BUT_NOT_PORTFOLIO" and x["costBps"]==30)
if base30["original"]["n"]!=53 or base30["original"]["wins"]!=29:
 raise ValueError("SOURCE_NATIVE_ORIGINAL_WINRATE_CHANGED")
if new30["qty"]!=19 or new30["winnerQty"]!=9:
 raise ValueError("REDESIGN_MODEL_WIN_RATE_CHANGED")
direct=[x for x in native if x["kind"]=="DIRECT"]
deferred=[x for x in native if x["kind"]=="DEFERRED"]
if sum(x["cost30NetReturn"]>0 for x in direct)!=5:
 raise ValueError("DIRECT_NATIVE_WIN_RECALC_FAIL")
if sum(x["cost30NetReturn"]>0 for x in deferred)!=4:
 raise ValueError("DEFERRED_NATIVE_WIN_RECALC_FAIL")
if market["candidate_count"]!=53:raise ValueError("MARKET_MISSING_CANDIDATES")
scored=csvread("PRISM5_H1_12H_MONTHLY_CAUSAL_CLASSIFIER_CANDIDATES.csv")
if len(scored)!=53:raise ValueError("MARKET_SCORED_CANDIDATE_TAPE_CHANGED")
known=0;training_contract=[]
for x in scored:
 if not x["p_short_decline_12h"]:continue
 known+=1
 if not x["train_cutoff"]:raise ValueError("MODEL_SCORE_WITHOUT_PREDECISION_TRAINING")
 if int(x["train_cutoff"])>int(x["entryTs"])-24*3600000:
  raise ValueError("TRAINED_ON_UNMATURED_FUTURE_MARKET_PRICE")
 if not 0<=float(x["p_short_decline_12h"])<=1:
  raise ValueError("INVALID_MARKET_PROBABILITY")
if known!=41:raise ValueError("EXPECTED_MARKET_SCORE_COVERAGE_CHANGED")
scores=[z for z in market["cohort_winrate"] if z["period"]=="ALL_SEEN"]
bytheta={z["threshold"]:z for z in scores}
if bytheta[.6]["retained_n"]!=2 or bytheta[.7]["retained_n"]!=0:
 raise ValueError("MARKET_MODEL_WAS_NOT_FALSIFIED_AS_EXPECTED")
for month,z in market["monthly_training_cutoffs"].items():
 if z["model"]!="FROZEN_SHRUNK_LOGIT_12H":continue
 if z["last_matured_label_ts"]>z["month_start"]-24*3600000:
  raise ValueError("MONTHLY_TRAIN_MATURITY_LEAK")
calib=[z for z in market["monthly_model_quality"] if z["auc"] is not None]
if not calib:raise ValueError("NEVER_EVALUATED_MARKET_MODEL")
# Avoid claiming an economic lift: the market target and trade target differ.
qa={
 "schema":"disdex-prism5-pengu-v20-regime-redesign-independent-evidence/v1",
 "status":"VERIFIED_RESEARCH_REJECTED_AS_LIVE_CANDIDATE",
 "source_native_short_53":{"n":53,"wins_30bps":29,"wr30_pct":round(100*29/53,2)},
 "structural_reprice_19":{
  "n":19,"direct_n":10,"deferred_n":9,
  "wins_30bps":9,"wr30_pct":round(900/19,2),
  "mean_return30_pct":round(100*statistics.mean(x["cost30NetReturn"] for x in native),4),
  "direct_native_source_exact_parity":10,
  "deferred_native_source_replay":9},
 "marketwide_12h":{"candidate_total":53,"market_prediction_scored":41,
  "monthly_training_label_embargo_hours":24,
  "score_threshold_0_60_retained_n":2,
  "score_threshold_0_70_retained_n":0,
  "monthly_prediction_auc_median":round(statistics.median(x["auc"] for x in calib),5),
  "score_is_not_native_trade_win_probability":True},
 "test_status":{"structural_asof_and_quality_unit_pass":12,"native_direct_pure_function_parity_pass":10},
 "cannot_claim":["All PENGU 80% achieved","Full portfolio drawdown 20% achieved",
   "The 2/2 retained cohort estimates a true 100% win probability",
   "Pre/source/post periods are untouched blind test datasets",
   "Derived per-trade exits are historical signed exchange fills"],
 "no_live_change":True}
(OUT/"PRISM5_INDEPENDENT_RESULT_VALIDATION.json").write_text(
 json.dumps(qa,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf8")
print("PRISM5_INDEPENDENT_AUDIT_PASS",json.dumps(qa,ensure_ascii=False),flush=True)
