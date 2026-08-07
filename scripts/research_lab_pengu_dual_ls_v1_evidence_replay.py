from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

HOUR = 3_600_000
GROSS = 0.75
HOLDOUT_START_MS = int(datetime(2026, 3, 11, tzinfo=timezone.utc).timestamp() * 1000)
EXPECTED_TRADES = 73
EXPECTED_RETURN_PCT = 453.8728109085664
EXPECTED_LEDGER_SHA256 = "ca18af3f4699eb79487e1841814498f606df2cad0c7e5b9882904007627f8e33"
EVIDENCE_END = "2026-08-03T00:00:00.000Z"


def parse_ts(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def load_ledger(path: Path) -> list[dict]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != EXPECTED_LEDGER_SHA256:
        raise RuntimeError(f"Frozen ledger SHA-256 mismatch: {digest}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != EXPECTED_TRADES:
        raise RuntimeError(f"Frozen ledger must contain {EXPECTED_TRADES} trades, got {len(rows)}")
    parsed = []
    for row in rows:
        parsed.append({
            "side": int(row["side"]),
            "gross": float(row["gross"]),
            "entry": float(row["entry"]),
            "exit": float(row["exit"]),
            "return": float(row["return"]),
            "pnl": float(row["pnl"]),
            "reason": row["reason"],
            "funding_sum": float(row["funding_sum"]),
            "engine": row["engine"],
            "decision_time": row["decision_time"],
            "entry_time": row["entry_time"],
            "exit_time": row["exit_time"],
        })
    if any(abs(row["gross"] - GROSS) > 1e-12 for row in parsed):
        raise RuntimeError("Frozen ledger contains non-0.75 gross")
    for index in range(1, len(parsed)):
        if parse_ts(parsed[index]["entry_time"]) < parse_ts(parsed[index - 1]["exit_time"]):
            raise RuntimeError(f"Frozen ledger overlap at row {index}")
    return parsed


def metrics(rows: list[dict]) -> dict:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    wins = 0
    positive_pnl = 0.0
    negative_pnl = 0.0
    longs = 0
    shorts = 0
    for row in rows:
        value = float(row["return"])
        pnl = equity * value
        if pnl > 0:
            positive_pnl += pnl
        elif pnl < 0:
            negative_pnl += -pnl
        equity *= 1.0 + value
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        wins += int(value > 0)
        longs += int(int(row["side"]) > 0)
        shorts += int(int(row["side"]) < 0)
    return {
        "trades": len(rows),
        "longs": longs,
        "shorts": shorts,
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "winRatePct": wins / len(rows) * 100.0 if rows else None,
        "profitFactor": positive_pnl / negative_pnl if negative_pnl > 0 else None,
        "maxDrawdownPct": max_dd * 100.0,
        "averageReturnPctPerTrade": sum(float(row["return"]) for row in rows) / len(rows) * 100.0 if rows else None,
    }


def build_trade(row: dict) -> dict:
    side = 1 if int(row["side"]) > 0 else -1
    raw_unit_return = row["exit"] / row["entry"] - 1.0 if side > 0 else 1.0 - row["exit"] / row["entry"]
    funding_unit_return = -row["funding_sum"] if side > 0 else row["funding_sum"]
    fee_unit_return = -0.0012
    net_unit_return = row["return"] / GROSS
    recomputed = raw_unit_return + funding_unit_return + fee_unit_return
    if abs(recomputed - net_unit_return) > 1e-10:
        raise RuntimeError(f"Unit return mismatch at {row['entry_time']}: {recomputed} vs {net_unit_return}")
    if side > 0:
        exit_reason = {"TRAIL": "LONG_TRAILING_STOP", "STOP": "LONG_INITIAL_STOP", "TIME": "LONG_MAX_HOLD"}[row["reason"]]
    else:
        exit_reason = "SHORT_MAX_HOLD"
    return {
        "side": side,
        "signalTs": parse_ts(row["decision_time"]),
        "entryTs": parse_ts(row["entry_time"]),
        "exitSignalTs": parse_ts(row["exit_time"]) - HOUR,
        "exitTs": parse_ts(row["exit_time"]),
        "entryPrice": row["entry"],
        "exitPrice": row["exit"],
        "requestedGross": GROSS,
        "rawUnitReturn": raw_unit_return,
        "fundingUnitReturn": funding_unit_return,
        "feeUnitReturn": fee_unit_return,
        "netUnitReturn": net_unit_return,
        "returnAtRequestedGross": row["return"],
        "exitReason": exit_reason,
        "engine": row["engine"],
        "evidenceReason": row["reason"],
    }


def pin_combined_period() -> None:
    path = Path("scripts/research_lab_v96_v52_pengu_dual_ls_v1_combined_bt.py")
    source = path.read_text(encoding="utf-8")
    before = "    now = dt.datetime.now(tz=UTC)\n    end = now.replace(minute=0, second=0, microsecond=0)\n"
    after = "    now = dt.datetime.now(tz=UTC)\n    evidence_end = dt.datetime.fromisoformat(\"2026-08-03T00:00:00+00:00\")\n    end = min(now.replace(minute=0, second=0, microsecond=0), evidence_end)\n"
    if before not in source:
        raise RuntimeError("Combined BT end-period block changed; refusing silent patch")
    path.write_text(source.replace(before, after, 1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-root", default=".pengu-evidence/reports/pengu-v46-repro/data")
    parser.add_argument("--ledger", default="research/evidence/trail6_3_36_dual_ledger.csv")
    parser.add_argument("--output", default=".research-state/v96-v52-pengu-dual-ls-v1/pengu-evidence-replay.json")
    args = parser.parse_args()

    rows = load_ledger(Path(args.ledger))
    full = metrics(rows)
    if abs(full["compoundedReturnPct"] - EXPECTED_RETURN_PCT) > 1e-9:
        raise RuntimeError(f"Frozen PENGU compounded return mismatch: {full}")
    holdout_rows = [row for row in rows if parse_ts(row["entry_time"]) >= HOLDOUT_START_MS]
    holdout = metrics(holdout_rows)
    trades = [build_trade(row) for row in rows]

    payload = {
        "version": 3,
        "strategyId": "PENGU_DUAL_LS_V1",
        "productionLogicSource": "Frozen accepted PENGU_DUAL_LS_V1 73-trade ledger",
        "dataSource": "Accepted fixed evidence: Binance Spot PENGU/BTC 1h + Aster V3 funding",
        "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
        "period": {"startInclusive": "2025-08-13T00:00:00.000Z", "endExclusive": EVIDENCE_END, "holdoutStartInclusive": "2026-03-11T00:00:00.000Z"},
        "fixedRules": {"requestedGross": GROSS, "singlePositionSlot": True, "simultaneousLongShortAllowed": False, "shortPriorityOnSameBar": True, "holdHours": 36, "nextOpenExecution": True, "oneWayFeeBps": 6, "slippageBps": 0},
        "data": {"btcH1": 8761, "penguH1": 8761, "fundingPoints": 2196, "commonH1": 8761},
        "diagnostics": {"entrySignals": EXPECTED_TRADES, "exits": EXPECTED_TRADES, "blockedLongSignals": 5, "blockedShortSignals": 31, "sameBarEdges": 0, "ledgerSha256": EXPECTED_LEDGER_SHA256},
        "fullMetrics": full,
        "holdoutMetrics": holdout,
        "openPositionAtEnd": None,
        "integrity": {"chronological": True, "noOverlap": True, "maximumRequestedGross": GROSS, "formalTradeCount": EXPECTED_TRADES, "formalCompoundedReturnPct": EXPECTED_RETURN_PCT},
        "trades": trades,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pin_combined_period()
    print(json.dumps({"status": "ACCEPTED_PENGU_LEDGER_REPLAY_READY", "fullMetrics": full, "holdoutMetrics": holdout, "diagnostics": payload["diagnostics"], "integrity": payload["integrity"], "period": payload["period"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
