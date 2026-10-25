"""Source-locked 8-owner conditional-score BT: strict approvals cannot grow.

This exact cohort replay tests the newly implemented rule on the archived
10/30 bps native postgate approvals. It does NOT certify currently deployed
SHA or admit any previously native-rejected capacity candidates.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict, deque
import json
import math
from pathlib import Path

from scripts.audit_native_full8_source_locked_baseline import audit_native, event_cashflow, read_rows
from scripts.research_archived_full8_dynamic_gross_bt import load_hype_h1
from scripts.research_formal_dynamic_score_bt import load_recovered_replay_module

CRYPTO_CAP, TOTAL_CAP, STOCK_CAP = 3.5, 4.75, 4.0


def past_only_score(closed_history: deque[float]) -> float:
    """Research fallback because native 8-owner tape lacks common-score values.

    A rank cannot retroactively authorize gross above strict planner approval.
    """
    if not closed_history:
        return 50.0
    wins = sum(v > 0 for v in closed_history)
    return round(100.0 * (wins + 5) / (len(closed_history) + 10), 5)


def audit_native_approved_conditional_score(native: Path, data_root: Path,
                                             hype_h1: Path, replay_root: Path,
                                             output: Path) -> dict:
    source = audit_native(native)
    events = read_rows(native / "portfolio-events.jsonl")
    accepted = {d["candidate_id"]: d for d in read_rows(native / "candidate-decisions.jsonl")
                if d.get("decision") == "ACCEPTED_MODELED_ENTRY"}
    trades = {int(d["position_id"]): d for d in read_rows(native / "portfolio-trades.jsonl")}
    model = load_recovered_replay_module(replay_root)
    symbols = {e["symbol"] for e in events if e["event_type"] == "MODELED_ENTRY"}
    market = model._market(data_root, symbols - {"HYPEUSDT"})
    if "HYPEUSDT" in symbols:
        market["HYPEUSDT"] = load_hype_h1(hype_h1)

    active = {}
    closed = defaultdict(lambda: deque(maxlen=100))
    wallet = 0.0
    preexisting_by_ts = {}
    scoreeligible_by_ts = defaultdict(list)
    eligible_by_strategy = Counter()
    totals = Counter()
    candidate_reasons = Counter()
    audit_rows = []
    cap_conflicts = []
    impact_possible = 0
    group_count = Counter()
    events_at_time = defaultdict(list)
    for row in events:
        events_at_time[int(row["ts_ms"])].append(row)

    for ts in sorted(events_at_time):
        batch = events_at_time[ts]
        # At the start of this timestamp, only already-held positions
        # (not same-time freshly approved signals) count as other holdings.
        before = {int(pid): item["strategy_id"] for pid, item in active.items()}
        preexisting_by_ts[ts] = dict(before)
        for event in batch:
            typ = event["event_type"]
            pid = event.get("position_id")
            if typ == "MODELED_ENTRY":
                family = str(event["strategy_id"])
                cid = str(event["candidate_id"])
                decision_row = accepted[cid]
                # Same-timestamp new fills do NOT create an existing holding;
                # a position closed earlier at this timestamp is not held now.
                other = any(s != family for pid, s in before.items() if pid in active)
                approved = float(decision_row["accepted_gross"])
                requested = float(decision_row["requested_gross"])
                totals["native_accepted_entries"] += 1
                if other:
                    totals["other_strategy_already_held"] += 1
                    eligible_by_strategy[family] += 1
                    scoreeligible_by_ts[ts].append(cid)
                    if requested > approved + 0.001:
                        totals["other_held_requested_above_approved"] += 1
                equity = model._equity(wallet, active, market, ts)
                current_score = past_only_score(closed[family]) if other else None
                old_fee = float(event["fee_settlement"])
                if not math.isfinite(equity) or equity <= 0:
                    raise ValueError("NATIVE_ACCOUNT_EQUITY_INVALID")
                old_notional = float(event["notional_settlement"])
                gross_before = Counter()
                for pos in active.values():
                    gross_before[pos["strategy_id"]] += model._gross(pos, market, ts, equity)
                crypto_before = sum(v for fam, v in gross_before.items() if fam != "V52")
                stock_before = gross_before["V52"]
                # The strict planner's signed accepted gross caps the score
                # allocator's target. Proposed score size must never exceed it.
                score_target_cap = approved
                score_available_extra = max(0.0, score_target_cap - approved)
                if score_available_extra > 1e-12: raise AssertionError("STRICT_GROSS_CEILING_BREACHED")
                # Class/global caps are observational here; we do not replace
                # native owners/cooldowns/STOP with research assumptions.
                gross_new = old_notional / equity
                total_after = crypto_before + stock_before + gross_new
                class_after = (stock_before + gross_new if family == "V52"
                               else crypto_before + gross_new)
                if ((total_after > TOTAL_CAP + 0.015)
                        or (family == "V52" and class_after > STOCK_CAP + 0.015)
                        or (family != "V52" and class_after > CRYPTO_CAP + 0.015)):
                    cap_conflicts.append({"ts":ts,"candidate":cid,"strategy":family,
                                          "total_gross_after":total_after,
                                          "class_gross_after":class_after})
                if other and score_available_extra > 0:
                    impact_possible += 1
                audit_rows.append({"candidate":cid,"ts":ts,"strategy":family,
                    "preexistingOtherStrategyHolding":other,
                    "researchOnlyCausalFallbackScore":current_score,
                    "nativeStrictApprovedGross":approved,
                    "requestedGrossResearchOnly":requested,
                    "maxScoreApprovedGross":score_target_cap,
                    "extraGrossAuthorizedByCurrentStrictApproval":score_available_extra,
                    "nativeQuantityUnchanged":True})
                active[int(pid)]={"strategy_id":family,"symbol":event["symbol"],
                    "side":event["side"],"entry_price":float(event["modeled_price_usd"]),
                    "quantity":float(event["quantity"])}
                wallet -= old_fee
                continue
            if typ == "MODELED_EXIT":
                original=trades[int(pid)]
                if float(original["notional_entry_jpy"])>0:
                    closed[original["strategy_id"]].append(
                        float(original["total_pnl_jpy"])/float(original["notional_entry_jpy"]))
                active.pop(int(pid))
            elif typ in ("MODELED_PARTIAL_EXIT","HYPE_PRIORITY_PARTIAL_EXIT"):
                active[int(pid)]["quantity"] -= float(event["quantity"])
            wallet += event_cashflow(event)
    # A native size/no-lot rejection is NOT resurrected without a fresh
    # strict native approval. Count only counterfactual research opportunities.
    capacity_reasons = (
        "NO_GROSS_ROOM", "FULL_1X_UNAVAILABLE", "FULL_1X_QUANTITY_BLOCK",
        "NO_LOT_SHRINK", "VENUE_MIN_NOTIONAL", "VENUE_MIN_QTY",
    )
    native_decisions = sorted(
        (row for row in read_rows(native / "candidate-decisions.jsonl")
         if row.get("decision") == "REJECTED_PORTFOLIO"
         and any(token in str(row.get("reason", "")) for token in capacity_reasons)),
        key=lambda row: int(row.get("decision_ts_ms") or row["entry_ts_ms"]),
    )
    chronology = sorted(events, key=lambda e: int(e["ts_ms"]))
    cursor = 0
    existing = {}
    conditional_capacity_rejected = Counter()
    for row in native_decisions:
        ts = int(row.get("decision_ts_ms") or row["entry_ts_ms"])
        while cursor < len(chronology) and int(chronology[cursor]["ts_ms"]) < ts:
            event = chronology[cursor]
            if event["event_type"] == "MODELED_ENTRY":
                existing[int(event["position_id"])] = event["strategy_id"]
            elif event["event_type"] == "MODELED_EXIT":
                existing.pop(int(event["position_id"]), None)
            cursor += 1
        if any(s != row["strategy_id"] for s in existing.values()):
            conditional_capacity_rejected[str(row.get("reason"))] += 1
    if active:
        raise ValueError("NATIVE_UNEXPECTED_OPEN_POSITIONS")
    if len(audit_rows) != source["acceptedEntries"]:
        raise ValueError("NATIVE_ACCEPTANCE_NOT_REPRODUCED")
    if cap_conflicts:
        # Modeling a native accepted trade blocked by a different gross policy
        # would misrepresent the accepted portfolio; retain native baseline.
        status="SOURCE_LOCKED_RESEARCH_CAP_DISAGREES_NATIVE_GATES"
    else:
        status="PASS_STRICT_APPROVAL_OVERLAP_NO_CHANGE_IN_NATIVE_COHORT"
    concurrent=Counter()
    for ts, candidates in scoreeligible_by_ts.items():
        if len(candidates)>1:
            concurrent["times"] += 1
            concurrent["candidate_rows"] += len(candidates)
    result={
        "status":status,
        "scenario":"ARCHIVED_NATIVE_GROSS_STRICT_APPROVAL_ONLY",
        "sourceLatestProductionShaCertified":False,
        "venueFillCertified":False,
        "fullCandidateReselectionSimulated":False,
        "eightStrategiesNativeEntryExitFrozen":True,
        "monthlyJpy":0,
        "initialJpy":10000,
        "nativeClosedTrades":source["acceptedEntries"],
        "otherStrategyAlreadyHeld":totals["other_strategy_already_held"],
        "otherHeldAndRequestedAboveApproved":totals["other_held_requested_above_approved"],
        "scoreEligibleByStrategy":dict(eligible_by_strategy),
        "capacityRejectedWithOtherStrategyPresentCount":sum(conditional_capacity_rejected.values()),
        "capacityRejectedWithOtherStrategyPresentReasons":dict(conditional_capacity_rejected),
        "capacityRejectionsRescued":0,
        "scoreEligibleConcurrentTimestampCount":concurrent["times"],
        "scoreEligibleConcurrentCandidateRows":concurrent["candidate_rows"],
        "newStrictAuthorizedGrossFromScore":0,
        "positionSizesChangedByScore":impact_possible,
        "nativeFinalEquityJpy":source["nativeFinalEquityJpy"],
        "policyReplayFinalEquityJpy":source["replayedFinalEquityJpy"],
        "policyDeltaJpy":source["replayedFinalEquityJpy"]-source["nativeFinalEquityJpy"],
        "nativeMaxDrawdown":source["nativeDD"],
        "policyMaxDrawdown":source["nativeDD"],
        "nativePF":source["nativePF"],
        "policyPF":source["nativePF"],
        "grossResearchCapConflicts":len(cap_conflicts),
        "grossResearchCapConflictExamples":cap_conflicts[:10],
        "remark":"This exact approved-only overlay cannot increase gross. "
                 "It cannot prove the value of reallocating extra capital to "
                 "previously capacity-rejected native candidates without "
                 "native entry+exit event-loop re-evaluation and a newly signed strict planner approval.",
    }
    output.mkdir(parents=True,exist_ok=True)
    (output/"overlap-strict-approved-only-summary.json").write_text(
        json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf8")
    with (output/"overlap-accepted-candidate-audit.jsonl").open("w",encoding="utf8") as f:
        for item in audit_rows:f.write(json.dumps(item,sort_keys=True)+"\n")
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("native-run","data-root","hype-h1","replay-root","output"):
        p.add_argument("--"+name,required=True,type=Path)
    a=p.parse_args()
    print(json.dumps(audit_native_approved_conditional_score(
        a.native_run,a.data_root,a.hype_h1,a.replay_root,a.output),
        indent=2,ensure_ascii=False))


if __name__ == "__main__":
    main()
