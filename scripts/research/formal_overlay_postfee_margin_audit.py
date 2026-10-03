"""Audit existing 20-case Overlay replay ledgers for post-fee Gross and 5x margin reserve parity.

This does not reconstruct historical venue account snapshots or filters. It asks a
narrow causal question over the already-produced replay: after each modeled entry fee
is actually deducted, would marked exposure still fit the Production BASE caps and a
reconstructed 5x Cross account with the 15% available-balance reserve?

Historical reported availableBalance is not invented. The reconstructed balance is
equity - marked_notional/5 and is labeled model evidence only.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
from typing import Any

HOUR_MS = 3_600_000
CRYPTO_CAP = 3.0
STOCK_CAP = 4.0
TOTAL_CAP = 4.25
LEVERAGE = 5.0
BASE_RESERVE_PCT = 15.0
EPS = 1e-9


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def market(data_root: Path, symbols: set[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for symbol in sorted(symbols):
        crypto = data_root / "normalized" / "aster" / "klines" / f"{symbol}.jsonl"
        stock = data_root / "normalized" / "aster_stock" / "klines" / f"{symbol}.jsonl"
        source = crypto if crypto.is_file() else stock
        if not source.is_file():
            raise RuntimeError(f"MARK_SOURCE_MISSING:{symbol}")
        rows = load_jsonl(source)
        rows.sort(key=lambda row: int(row["event_time_ms"]))
        times = [int(row["event_time_ms"]) for row in rows]
        if len(times) != len(set(times)):
            raise RuntimeError(f"DUPLICATE_MARK_BAR:{symbol}")
        out[symbol] = {"rows": rows, "times": times, "source": source.as_posix(), "sha256": sha256(source)}
    return out


def mark(series: dict[str, Any], ts: int) -> float | None:
    rows = series["rows"]
    times = series["times"]
    index = bisect_right(times, ts) - 1
    if index < 0:
        return None
    row = rows[index]
    start = int(row["event_time_ms"])
    if start == ts:
        return float(row["open"])
    if ts >= start + HOUR_MS:
        return float(row["close"]) if ts == start + HOUR_MS else None
    if index < 1:
        return None
    previous = rows[index - 1]
    if int(previous["event_time_ms"]) + HOUR_MS != start:
        return None
    return float(previous["close"])


def side_sign(side: str) -> float:
    return 1.0 if side == "LONG" else -1.0


def snapshot(active: dict[int, dict[str, Any]], wallet: float, ts: int, market_data: dict[str, dict[str, Any]]) -> dict[str, float]:
    unrealized = 0.0
    crypto_notional = 0.0
    stock_notional = 0.0
    for position in active.values():
        px = mark(market_data[position["symbol"]], ts)
        if px is None:
            raise RuntimeError(f"UNVERIFIED_ACTIVE_POSITION_MARK:{position['symbol']}:{ts}")
        qty = abs(float(position["quantity"]))
        notional = qty * px
        unrealized += side_sign(position["side"]) * qty * (px - float(position["entry_price"]))
        if position["strategy_id"] == "V52":
            stock_notional += notional
        else:
            crypto_notional += notional
    equity = wallet + unrealized
    if not math.isfinite(equity) or equity <= 0:
        raise RuntimeError(f"NONPOSITIVE_EQUITY:{ts}:{equity}")
    total_notional = crypto_notional + stock_notional
    required_initial_margin = total_notional / LEVERAGE
    reconstructed_available = equity - required_initial_margin
    reserve = equity * BASE_RESERVE_PCT / 100
    return {
        "equity": equity,
        "crypto_notional": crypto_notional,
        "stock_notional": stock_notional,
        "total_notional": total_notional,
        "crypto_gross": crypto_notional / equity,
        "stock_gross": stock_notional / equity,
        "total_gross": total_notional / equity,
        "required_initial_margin": required_initial_margin,
        "reconstructed_available": reconstructed_available,
        "reserve": reserve,
        "available_minus_reserve": reconstructed_available - reserve,
    }


def audit_scenario(events_path: Path, market_data: dict[str, dict[str, Any]]) -> dict[str, Any]:
    events = load_jsonl(events_path)
    active: dict[int, dict[str, Any]] = {}
    wallet: float | None = None
    counts = Counter()
    worst = {
        "total_gross_excess": (0.0, None),
        "crypto_gross_excess": (0.0, None),
        "stock_gross_excess": (0.0, None),
        "reserve_shortfall": (0.0, None),
        "entry_postfee_gross_increase": (0.0, None),
    }
    entry_rows: list[dict[str, Any]] = []

    for seq, event in enumerate(events):
        event_type = str(event.get("event_type"))
        ts = int(event["ts_ms"])
        if wallet is None:
            wallet = float(event.get("wallet_after_event", 0.0))
        if event_type == "MONTHLY_CONTRIBUTION":
            wallet = float(event["wallet_after_event"])
            continue
        if wallet is None:
            raise RuntimeError("WALLET_UNINITIALIZED")

        if event_type == "MODELED_ENTRY":
            fee = float(event["fee_settlement"])
            wallet_before_fee = float(event["wallet_after_event"]) + fee
            pre = snapshot(active, wallet_before_fee, ts, market_data)
            position_id = int(event["position_id"])
            if position_id in active:
                raise RuntimeError(f"DUPLICATE_ACTIVE_POSITION:{position_id}")
            active[position_id] = {
                "strategy_id": str(event["strategy_id"]),
                "symbol": str(event["symbol"]),
                "side": str(event["side"]),
                "quantity": float(event["quantity"]),
                "entry_price": float(event["modeled_price_usd"]),
            }
            wallet = float(event["wallet_after_event"])
            post = snapshot(active, wallet, ts, market_data)
            gross_increase = float(event["accepted_gross"])
            requested_notional = float(event["notional_settlement"])
            postfee_entry_gross = requested_notional / post["equity"]
            fee_ratio_effect = postfee_entry_gross - gross_increase

            violations = []
            total_excess = max(0.0, post["total_gross"] - TOTAL_CAP)
            crypto_excess = max(0.0, post["crypto_gross"] - CRYPTO_CAP)
            stock_excess = max(0.0, post["stock_gross"] - STOCK_CAP)
            reserve_shortfall = max(0.0, -post["available_minus_reserve"])
            if total_excess > EPS:
                violations.append("POSTFEE_TOTAL_GROSS")
            # Sleeve caps block exposure-increasing entries in that sleeve; they
            # do not force-trim a different sleeve that passively moved above a
            # cap. Therefore test crypto only for crypto entries and stock only
            # for V52 stock entries.
            if event["strategy_id"] != "V52" and crypto_excess > EPS:
                violations.append("POSTFEE_CRYPTO_GROSS")
            if event["strategy_id"] == "V52" and stock_excess > EPS:
                violations.append("POSTFEE_STOCK_GROSS")
            if reserve_shortfall > 1e-8:
                violations.append("RECONSTRUCTED_5X_RESERVE")

            if violations:
                counts.update(violations)
            counts["MODELED_ENTRY"] += 1
            if post["total_gross"] >= TOTAL_CAP - 1e-6:
                counts["ENTRY_NEAR_TOTAL_CAP"] += 1

            row = {
                "seq": seq,
                "ts_ms": ts,
                "position_id": position_id,
                "candidate_id": event.get("candidate_id"),
                "strategy_id": event["strategy_id"],
                "symbol": event["symbol"],
                "accepted_gross": gross_increase,
                "entry_fee": fee,
                "pre_fee_equity": pre["equity"],
                "post_fee_equity": post["equity"],
                "post_fee_entry_gross": postfee_entry_gross,
                "entry_gross_fee_increase": fee_ratio_effect,
                "post_crypto_gross": post["crypto_gross"],
                "post_stock_gross": post["stock_gross"],
                "post_total_gross": post["total_gross"],
                "required_initial_margin_5x": post["required_initial_margin"],
                "reconstructed_available_balance": post["reconstructed_available"],
                "required_base_reserve": post["reserve"],
                "available_minus_reserve": post["available_minus_reserve"],
                "violations": violations,
            }
            entry_rows.append(row)

            metrics = {
                "total_gross_excess": total_excess,
                "crypto_gross_excess": crypto_excess,
                "stock_gross_excess": stock_excess,
                "reserve_shortfall": reserve_shortfall,
                "entry_postfee_gross_increase": max(0.0, fee_ratio_effect),
            }
            for key, value in metrics.items():
                if value > worst[key][0]:
                    worst[key] = (value, row)
            continue

        wallet = float(event["wallet_after_event"])
        if event_type == "MODELED_EXIT":
            position_id = int(event["position_id"])
            if position_id not in active:
                raise RuntimeError(f"EXIT_WITHOUT_ACTIVE_POSITION:{position_id}")
            del active[position_id]
        elif event_type == "FUNDING":
            if int(event["position_id"]) not in active:
                raise RuntimeError(f"FUNDING_WITHOUT_ACTIVE_POSITION:{event['position_id']}")

    if active:
        raise RuntimeError(f"ACTIVE_POSITIONS_REMAIN:{sorted(active)}")
    violations = [row for row in entry_rows if row["violations"]]
    margin_violations = [
        row for row in entry_rows
        if "POSTFEE_TOTAL_GROSS" in row["violations"] or "RECONSTRUCTED_5X_RESERVE" in row["violations"]
    ]
    sleeve_warnings = [
        row for row in entry_rows
        if "POSTFEE_CRYPTO_GROSS" in row["violations"] or "POSTFEE_STOCK_GROSS" in row["violations"]
    ]
    return {
        "event_rows": len(events),
        "entry_rows": len(entry_rows),
        "violation_entries": len(violations),
        "margin_violation_entries": len(margin_violations),
        "postfee_sleeve_warning_entries": len(sleeve_warnings),
        "violation_counts": dict(sorted(counts.items())),
        "worst": {
            key: {
                "value": value,
                "entry": row,
            }
            for key, (value, row) in worst.items()
        },
        "first_violations": violations[:25],
    }


def write_json(path: Path, payload: Any) -> str:
    raw = (json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--replay-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    release = args.release_root.resolve()
    replay = args.replay_root.resolve()
    data_root = release / "market-Aster-H1-funding-and-manifests"
    scenario_event_paths = sorted(replay.glob("*/PRICE_MODEL_*BPS/portfolio-events.jsonl"))
    if len(scenario_event_paths) != 20:
        raise RuntimeError(f"EXPECTED_20_SCENARIOS_FOUND:{len(scenario_event_paths)}")

    symbols: set[str] = set()
    for path in scenario_event_paths:
        for row in load_jsonl(path):
            if row.get("symbol"):
                symbols.add(str(row["symbol"]))
    market_data = market(data_root, symbols)

    scenarios = {}
    aggregate = Counter()
    for path in scenario_event_paths:
        key = f"{path.parent.parent.name}/{path.parent.name}"
        result = audit_scenario(path, market_data)
        scenarios[key] = result
        aggregate["entries"] += result["entry_rows"]
        aggregate["violation_entries"] += result["violation_entries"]
        aggregate["margin_violation_entries"] += result["margin_violation_entries"]
        aggregate["postfee_sleeve_warning_entries"] += result["postfee_sleeve_warning_entries"]
        for name, value in result["violation_counts"].items():
            aggregate[name] += value

    status = (
        "PASS_RECONSTRUCTED_POSTFEE_5X_RESERVE"
        if aggregate["margin_violation_entries"] == 0
        else "FAIL_POSTFEE_MARGIN_PARITY_DIAGNOSTIC"
    )
    payload = {
        "schema_version": 1,
        "status": status,
        "certification_issued": False,
        "historical_account_margin_parity": False,
        "assumptions": {
            "crypto_gross_cap": CRYPTO_CAP,
            "stock_gross_cap": STOCK_CAP,
            "total_gross_cap": TOTAL_CAP,
            "required_leverage": LEVERAGE,
            "base_available_balance_reserve_pct": BASE_RESERVE_PCT,
            "available_balance_model": "post-fee H1 marked equity minus total marked notional / 5",
            "mark_semantics": "same causal H1 mark rule as frozen formal replay",
        },
        "aggregate": dict(sorted(aggregate.items())),
        "scenarios": scenarios,
        "market_sources": {
            symbol: {"source": item["source"], "sha256": item["sha256"]}
            for symbol, item in sorted(market_data.items())
        },
        "ruling": (
            "This audit can prove or disprove internal post-fee BASE-cap and reconstructed 5x reserve "
            "consistency of the existing replay. It cannot prove historical Aster availableBalance, "
            "symbol filters, leverage/margin read-back, pending/lock latency, or actual fill chronology."
        ),
    }
    digest = write_json(args.output.resolve(), payload)
    print(json.dumps({"status": status, "aggregate": payload["aggregate"], "manifest_sha256": digest}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
