"""Research-only gross-normalized direction error audit (no training or trading).

The direction proxy is entry-to-exit realized price direction, NOT a causal
signal-label proof. Results must not generate online gates without independent
out-of-sample validation, full native pin parity and owner approval.
"""
import argparse
import collections
import csv
import hashlib
import json
import math
from pathlib import Path

from stable4_research_dd_independent_audit import audit_case

HALF = "2026-04-01T00:00:00Z"
REQUIRED = {"trade_id", "strategy", "route", "symbol", "side", "entry_utc",
            "exit_utc", "model_entry_price", "model_exit_price", "notional_jpy",
            "gross_x", "net_pnl_jpy"}


def evaluate_trade(row):
    if not REQUIRED.issubset(row):
        raise ValueError("TRADE_REQUIRED_COLUMNS_MISSING")
    side = row["side"]
    if side not in ("LONG", "SHORT"):
        raise ValueError("TRADE_SIDE_UNKNOWN")
    try:
        entry = float(row["model_entry_price"])
        exit_price = float(row["model_exit_price"])
        notional = float(row["notional_jpy"])
        gross = float(row["gross_x"])
        pnl = float(row["net_pnl_jpy"])
    except (ValueError, TypeError) as exc:
        raise ValueError("TRADE_NUMERIC_INVALID") from exc
    if (not all(math.isfinite(v) for v in (entry, exit_price, notional, gross, pnl))
            or min(entry, exit_price, notional, gross) <= 0):
        raise ValueError("TRADE_PRICE_NOTIONAL_OR_GROSS_INVALID")
    entry_time = row["entry_utc"]
    exit_time = row["exit_utc"]
    if not (isinstance(entry_time, str) and isinstance(exit_time, str)
            and entry_time.endswith("Z") and entry_time < exit_time
            and isinstance(row["trade_id"], str) and row["trade_id"].strip()):
        raise ValueError("TRADE_TIME_OR_ID_INVALID")
    direction = (exit_price - entry) * (1 if side == "LONG" else -1)
    return {
        "period": "earlier" if entry_time < HALF else "later",
        "priceDirection": "correct" if direction > 0 else
                          "wrong" if direction < 0 else "flat",
        "netWin": pnl > 0,
        "netReturnPctOfNotional": 100.0 * pnl / notional,
        "strategy": row["strategy"], "route": row["route"],
        "symbol": row["symbol"], "side": side,
    }


def aggregate(rows):
    if not rows:
        return {"n": 0, "netWinPct": None, "wrongPriceDirectionPct": None,
                "meanNetReturnPctOfNotional": None}
    n = len(rows)
    return {
        "n": n,
        "netWinPct": 100 * sum(bool(x["netWin"]) for x in rows) / n,
        "wrongPriceDirectionPct": 100 * sum(x["priceDirection"] == "wrong"
                                            for x in rows) / n,
        "flatPriceDirectionCount": sum(x["priceDirection"] == "flat" for x in rows),
        "correctDirectionButNetLossCount":
            sum(x["priceDirection"] == "correct" and not x["netWin"]
                for x in rows),
        "meanNetReturnPctOfNotional":
            sum(x["netReturnPctOfNotional"] for x in rows) / n,
    }


def analyze_model(folder, cost_bps):
    matches = list(Path(folder).glob("*" + str(cost_bps) + "BPS_FILLS.csv"))
    if len(matches) != 1 or matches[0].is_symlink():
        raise ValueError("TRADE_SOURCE_MISSING_OR_AMBIGUOUS")
    path = matches[0]
    rows = []
    ids = set()
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            digest.update(chunk)
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not REQUIRED.issubset(reader.fieldnames):
            raise ValueError("TRADE_CSV_SCHEMA_INVALID")
        for raw in reader:
            if raw["trade_id"] in ids:
                raise ValueError("DUPLICATED_TRADE_ID")
            ids.add(raw["trade_id"])
            rows.append(evaluate_trade(raw))
    grouped = collections.defaultdict(list)
    for x in rows:
        grouped[(x["strategy"], x["route"], x["side"])].append(x)
    route_metrics = []
    for (strategy, route, side), vals in sorted(grouped.items()):
        a = [x for x in vals if x["period"] == "earlier"]
        b = [x for x in vals if x["period"] == "later"]
        overall, earlier, later = aggregate(vals), aggregate(a), aggregate(b)
        # A review candidate is not an automatic filter. A single period,
        # one expensive route, or small sample cannot authorize changes.
        review = (
            earlier["n"] >= 10 and later["n"] >= 10
            and all(x["wrongPriceDirectionPct"] > 50
                    and x["meanNetReturnPctOfNotional"] < 0
                    for x in (earlier, later))
        )
        route_metrics.append({
            "strategy": strategy, "route": route, "side": side,
            "overall": overall, "earlier": earlier, "later": later,
            "crossPeriodReviewOnly": review,
        })
    return {
        "costBpsRoundtrip": cost_bps,
        "decisionAudit": audit_decisions(folder, cost_bps),
        "fillLedgerSha256": digest.hexdigest(),
        "tradeCount": len(rows),
        "overall": aggregate(rows),
        "routeSideGroups": route_metrics,
        "routesNeedingIndependentReview":
            sum(x["crossPeriodReviewOnly"] for x in route_metrics),
    }



def summarize_decisions(rows):
    """Policy-block coverage; never equate a blocked candidate with a fill."""
    needed = {"signal_id", "strategy", "utc", "decision", "reason", "requested_gross"}
    by_strategy = collections.defaultdict(lambda: collections.Counter())
    later_v4 = collections.Counter()
    all_v4 = collections.Counter()
    ids = set()
    total = 0
    for row in rows:
        if not needed.issubset(row) or not row["signal_id"]:
            raise ValueError("DECISION_ROW_INCOMPLETE")
        if row["signal_id"] in ids:
            raise ValueError("DUPLICATE_DECISION_SIGNAL")
        ids.add(row["signal_id"])
        total += 1
        strategy = row["strategy"]
        reason = row["reason"]
        if row["decision"] not in ("MODEL_ENTER", "BLOCK"):
            raise ValueError("DECISION_STATUS_UNKNOWN")
        by_strategy[strategy][row["decision"]] += 1
        if strategy == "V4":
            all_v4[reason] += 1
            if row["utc"] >= "2026-03-01T00:00:00Z":
                later_v4[reason] += 1
    return {
        "totalDecisions": total,
        "byStrategy": {k: dict(v) for k, v in sorted(by_strategy.items())},
        "v4AllReasons": dict(all_v4),
        "v4AfterMarchReasons": dict(later_v4),
        "v4AfterMarchCandidates": sum(later_v4.values()),
        "v4AfterMarchDdHoldBlocks": later_v4.get(
            "V4_MAX_DRAWDOWN_21PCT_HOLD", 0),
        "sourceCandidateAbsenceProven": False,
        "v4DrawdownOwnerAndResetSemanticsCertified": False,
    }


def audit_decisions(folder, cost_bps):
    files = list(Path(folder).glob("*" + str(cost_bps) + "BPS_DECISIONS.csv"))
    if len(files) != 1 or files[0].is_symlink():
        raise ValueError("DECISIONS_SOURCE_MISSING_OR_AMBIGUOUS")
    with files[0].open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or not {
                "signal_id", "strategy", "utc", "decision", "reason",
                "requested_gross"}.issubset(reader.fieldnames):
            raise ValueError("DECISIONS_SOURCE_COLUMNS_INVALID")
        return summarize_decisions(reader)

def audit(folder):
    dd = audit_case(folder)
    results = [analyze_model(folder, bps) for bps in (10, 30)]
    for x in results:
        if x["tradeCount"] != dd["resultsByCostBps"][str(x["costBpsRoundtrip"])]["modeledFills"]:
            raise ValueError("FILL_COUNT_DOES_NOT_MATCH_MODEL")
    return {
        "schema": "disdex-stable4-route-direction-research-audit/v1",
        "case": Path(folder).name,
        "riskDdPassed": dd["riskDdPassed"],
        "results": results,
        "directionProxyNotTrueSignalLabel": True,
        "periodSplitTrainingHoldoutCertified": False,
        "exactPinnedProductionParityVerified": False,
        "liveGatesDerivedOrAuthorized": False,
        "productionMutated": False,
        "status": "RESEARCH_DIAGNOSTIC_ONLY_NOT_LIVE_APPROVAL",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--case-dir", type=Path, required=True)
    p.add_argument("--output-json", type=Path)
    args = p.parse_args()
    result = audit(args.case_dir)
    raw = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if args.output_json:
        with args.output_json.open("x", encoding="utf-8") as out:
            out.write(raw)
    print(raw)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())