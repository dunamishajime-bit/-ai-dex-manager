"""V52 V50 strictly as-of, one-slot hourly research ledger.

This models trades on Aster *stock perpetual* prices, using Yahoo underlying
reference prices for the basis/eligibility signal. Unlike the production
execution route it does not have live L2, queue, funding, or cross-strategy
portfolio snapshots. Never report these modeled trades as exchange fills.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, time, timedelta, timezone

from .calendars import nyse_close_utc
import hashlib
import json
import math
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .manifest import load_manifest
from .v52_price_only_scan import (STOCKS, asof_price, read_stock_perp_bars,
                                  verified_policy)
from .v52_research_bridge import load_price_only_research
from .yahoo_v52 import load_yahoo_bars

NY = ZoneInfo("America/New_York")
HOUR_MS = 3_600_000
CHECKPOINT_YAHOO_AGE_MS = 15 * 60_000


def _forced_flat_ms(entry_ms: int, policy: dict) -> int:
    """End the modeled slot by the first 3h, 15:30 NY, or official session close."""
    entry_utc = datetime.fromtimestamp(entry_ms / 1000, timezone.utc)
    local = entry_utc.astimezone(NY)
    official_close = nyse_close_utc(local.date())
    if official_close is None or entry_utc >= official_close:
        raise ValueError("V52_ENTRY_OUTSIDE_NYSE_SESSION")
    final_1530 = datetime.combine(local.date(), time(15, 30), NY).astimezone(timezone.utc)
    expires = entry_utc + timedelta(hours=float(policy["maximumHoldingHours"]))
    return int(min(official_close, final_1530, expires).timestamp() * 1000)


def _advance_checkpoint(position: dict) -> None:
    """Schedule the exact daily forced exit even when it is between hourly bars."""
    previous = position["next_checkpoint_ms"]
    limit = position["forced_flat_ms"]
    position["next_checkpoint_ms"] = min(previous + HOUR_MS, limit)
    if position["next_checkpoint_ms"] <= previous:
        raise ValueError("V52_NON_ADVANCING_CHECKPOINT")


def _load_prices(root: Path, scan_manifest: dict) -> tuple[dict, dict]:
    yahoo, perp = {}, {}
    hashes = scan_manifest.get("source_sha256") or {}
    for ticker in sorted(STOCKS):
        for kind, part, relative in (
            ("yahoo", yahoo, f"normalized/yahoo/60m/{ticker}.jsonl"),
            ("aster_perp", perp,
             f"normalized/aster_stock/klines/{ticker}USDT.jsonl"),
        ):
            path = root / relative
            expected = hashes.get(f"{kind}_{ticker}")
            if expected is None:
                if path.exists():
                    raise ValueError("V52_PRICE_FILE_ADDED_AFTER_ORIGINAL_SCAN")
                part[ticker] = ()
                continue
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError(f"V52_INPUT_FILE_HASH_OR_AVAILABILITY_MISMATCH:{kind}_{ticker}")
            part[ticker] = (load_yahoo_bars(path, ticker) if kind == "yahoo"
                            else read_stock_perp_bars(path, ticker))
    return yahoo, perp


def _checkpoint(position: dict, when_ms: int, yahoo: dict, perp: dict, policy: dict
               ) -> dict[str, Any]:
    symbol = position["equity_reference_symbol"]
    eq, eq_status, eq_end, _ = asof_price(
        yahoo[symbol], symbol, when_ms, max_age_ms=CHECKPOINT_YAHOO_AGE_MS)
    future, ft_status, ft_end, _ = asof_price(
        perp[symbol], symbol, when_ms)
    if eq is None or future is None:
        return {
            "status": "UNRESOLVED_EXIT_PRICE",
            "reason": f"YAHOO:{eq_status}/ASTER:{ft_status}",
            "yahoo_end_ms": eq_end, "aster_end_ms": ft_end,
        }
    basis = (future / eq - 1) * 10_000
    initial = position["entry_basis_bps"]
    if abs(basis) <= float(policy["convergenceBps"]) or basis * initial <= 0:
        reason = "BASIS_CONVERGED"
    elif abs(basis) >= float(policy["basisStopMultiple"]) * abs(initial):
        reason = "BASIS_STOP"
    elif when_ms >= position["forced_flat_ms"]:
        reason = "TIME_OR_SESSION_FLAT"
    else:
        reason = "HOLD"
    return {
        "status": "CHECKPOINT_VERIFIED_PRICE_ONLY", "reason": reason,
        "basis_bps": basis, "aster_exit_price_usd": future,
        "yahoo_exit_reference_usd": eq,
        "yahoo_end_ms": eq_end, "aster_end_ms": ft_end,
    }


def replay_v52_research(
    data_root: Path, scan_root: Path, output_root: Path, *,
    round_trip_cost_bps: float = 11.0,
    slot_gross: float = 2.0,
    manifest_path: Path = Path(__file__).with_name("runtime_source_manifest.json"),
) -> dict[str, Any]:
    if (not all(math.isfinite(value) for value in (round_trip_cost_bps, slot_gross))
            or round_trip_cost_bps < 0 or not 0 < slot_gross <= 2.0):
        raise ValueError("V52_INVALID_RESEARCH_COST_OR_GROSS")
    data_root, scan_root = Path(data_root), Path(scan_root)
    manifest = load_manifest(manifest_path)
    candidates, provenance = load_price_only_research(scan_root, manifest["runtime_sha"])
    scan_manifest = json.loads((scan_root / "price-only-scan-manifest.json").read_text())
    policy, policy_hash = verified_policy(
        manifest, manifest_path.parent / "runtime_source_snapshot")
    if scan_manifest.get("runtime_policy_sha256") != policy_hash:
        raise ValueError("V52_SCAN_POLICY_SHA_MISMATCH")
    yahoo, perp = _load_prices(data_root, scan_manifest)
    selected = sorted(candidates, key=lambda row: (
        row["decision_ts_ms"], row["equity_reference_symbol"] if "equity_reference_symbol" in row
        else row["symbol"]))
    trades: list[dict] = []
    skipped: list[dict] = []
    position: dict | None = None
    unresolved = False
    counters: Counter[str] = Counter()
    for row in selected:
        ts = int(row["decision_ts_ms"])
        if position is not None:
            while position["next_checkpoint_ms"] <= ts and not unresolved:
                checkpoint_ts = position["next_checkpoint_ms"]
                snap = _checkpoint(position, checkpoint_ts, yahoo, perp, policy)
                if snap["status"] != "CHECKPOINT_VERIFIED_PRICE_ONLY":
                    unresolved = True
                    trades.append({**position, "status": "UNRESOLVED_MODEL_EXIT",
                                   "unresolved_ts_ms": checkpoint_ts, **snap,
                                   "modeled_return_on_equity": None,
                                   "modeled_pnl_usd": None})
                    counters["UNRESOLVED_MODEL_EXIT"] += 1
                    break
                if snap["reason"] != "HOLD":
                    # Price-only close estimates exclude funding and actual execution.
                    direction = 1 if position["side"] == "LONG" else -1
                    gross_price_return = (snap["aster_exit_price_usd"] /
                                          position["aster_entry_price_usd"] - 1) * direction
                    modeled_fraction = slot_gross * (
                        gross_price_return - round_trip_cost_bps / 10_000)
                    trades.append({
                        **position, **snap, "status": "MODELED_CLOSED_TRADE",
                        "exit_ts_ms": checkpoint_ts,
                        "gross_price_return": gross_price_return,
                        "assumed_round_trip_cost_bps": round_trip_cost_bps,
                        "modeled_return_on_equity": modeled_fraction,
                        "exchange_fill_verified": False,
                        "funding_usdt": None,
                        "execution_slippage_verified": False,
                    })
                    counters[snap["reason"]] += 1
                    position = None
                    break
                _advance_checkpoint(position)
        if unresolved:
            skipped.append({"symbol": row["symbol"], "decision_ts_ms": ts,
                            "reason": "PREVIOUS_POSITION_EXIT_NOT_VERIFIABLE"})
            counters["BLOCKED_BY_UNRESOLVED_EXIT"] += 1
            continue
        if position is not None:
            skipped.append({"symbol": row["symbol"], "decision_ts_ms": ts,
                            "reason": "SINGLE_V50_SLOT_ALREADY_OPEN"})
            counters["BLOCKED_BY_V50_SLOT"] += 1
            continue
        sym = row["symbol"].removesuffix("USDT")
        eq, eq_status, eq_end, _ = asof_price(yahoo[sym], sym, ts,
                                             max_age_ms=CHECKPOINT_YAHOO_AGE_MS)
        future, ft_status, ft_end, _ = asof_price(perp[sym], sym, ts)
        if (eq is None or future is None or
                not math.isclose(eq, float(row["yahoo_reference_usd"]), rel_tol=1e-9) or
                not math.isclose(future, float(row["aster_price_usd"]), rel_tol=1e-9)):
            skipped.append({
                "symbol": row["symbol"], "decision_ts_ms": ts,
                "reason": "ENTRY_PRICE_CHAIN_UNVERIFIED",
                "yahoo_status": eq_status, "aster_status": ft_status,
                "yahoo_end_ms": eq_end, "aster_end_ms": ft_end,
            })
            counters["ENTRY_PRICE_CHAIN_UNVERIFIED"] += 1
            continue
        position = {
            "strategy_id": "V52", "route": "V50_POST_OPEN_BASIS",
            "decision_model": provenance["model"], "symbol": row["symbol"],
            "equity_reference_symbol": sym, "side": row["side"],
            "entry_ts_ms": ts, "entry_basis_bps": float(row["entry_basis_bps"]),
            "aster_entry_price_usd": future, "yahoo_entry_reference_usd": eq,
            "forced_flat_ms": _forced_flat_ms(ts, policy),
            "next_checkpoint_ms": min(ts + HOUR_MS, _forced_flat_ms(ts, policy)),
            "slot_gross": slot_gross, "historical_fill_verified": False,
        }
        counters["MODELED_ENTRY"] += 1
    # Drain the final in-sample open position until the earlier of NY close
    # and the approved 3h holding limit; no candles past the period are used.
    if position is not None and not unresolved:
        end_date = scan_manifest["period_end_exclusive"]
        end_ms = int(datetime.fromisoformat(end_date + "T00:00:00+00:00").timestamp()*1000)
        while position is not None and position["next_checkpoint_ms"] < end_ms:
            checkpoint_ts = position["next_checkpoint_ms"]
            snap = _checkpoint(position, checkpoint_ts, yahoo, perp, policy)
            if snap["status"] != "CHECKPOINT_VERIFIED_PRICE_ONLY":
                trades.append({**position, **snap, "status": "UNRESOLVED_MODEL_EXIT",
                               "unresolved_ts_ms": checkpoint_ts,
                               "modeled_return_on_equity": None})
                counters["UNRESOLVED_MODEL_EXIT"] += 1
                unresolved = True
                break
            if snap["reason"] != "HOLD":
                direction = 1 if position["side"] == "LONG" else -1
                gross_price_return = (snap["aster_exit_price_usd"] /
                                      position["aster_entry_price_usd"] - 1) * direction
                trades.append({
                    **position, **snap, "status": "MODELED_CLOSED_TRADE",
                    "exit_ts_ms": checkpoint_ts,
                    "gross_price_return": gross_price_return,
                    "assumed_round_trip_cost_bps": round_trip_cost_bps,
                    "modeled_return_on_equity": slot_gross *
                    (gross_price_return - round_trip_cost_bps / 10_000),
                    "exchange_fill_verified": False, "funding_usdt": None,
                })
                counters[snap["reason"]] += 1
                position = None
            else:
                _advance_checkpoint(position)
        if position is not None and not unresolved:
            trades.append({**position, "status": "OPEN_AT_SAMPLE_END",
                           "modeled_return_on_equity": None})
            counters["OPEN_AT_SAMPLE_END"] += 1
            unresolved = True
    closed = [trade for trade in trades if trade["status"] == "MODELED_CLOSED_TRADE"]
    complete = (not unresolved and
                sum(counters[k] for k in ("MODELED_ENTRY",)) == len(closed))
    returns = [trade["modeled_return_on_equity"] for trade in closed]
    result = {
        "model": "V52_SINGLE_SLOT_HOURLY_PRICE_ONLY",
        "status": ("RESEARCH_PRICE_MODEL_CLOSED_SAMPLE" if complete else
                   "NOT_VERIFIABLE_INCOMPLETE_PRICE_MODEL"),
        "full_five_strategy_portfolio_backtest": False,
        "audited_live_execution_parity": False,
        "source_runtime_sha": manifest["runtime_sha"],
        "source_research_scan_sha256": provenance["scan_sha256"],
        "selected_unallocated_candidates": len(candidates),
        "modeled_entries": counters["MODELED_ENTRY"],
        "modeled_closed_trades": len(closed),
        "unresolved_exit_trades": counters["UNRESOLVED_MODEL_EXIT"],
        "entry_skipped": len(skipped),
        "skipped_reasons": dict(Counter(row["reason"] for row in skipped)),
        "exit_reasons": {key: counters[key] for key in
                          ("BASIS_CONVERGED", "BASIS_STOP", "TIME_OR_SESSION_FLAT")},
        "assumed_round_trip_cost_bps": round_trip_cost_bps,
        "assumed_single_slot_gross": slot_gross,
        "funding_cost_known": False,
        "portfolio_competition_verified": False,
        "trade_returns_are_percentage_points": False,
        "price_model_closed_trade_mean_return": (
            sum(returns) / len(returns) if complete and returns else None),
        "price_model_closed_trade_win_rate": (
            sum(item > 0 for item in returns) / len(returns)
            if complete and returns else None),
        "verified_final_equity_jpy": None,
        "verified_profit_factor": None,
        "verified_max_drawdown": None,
        "limitations": [
            "not integrated with V12 PENGU Q102 FET or shared DD governor",
            "Yahoo H1 and Aster H1 are completed-bar proxies, not simultaneous live quotes",
            "intrahour basis stops and book fill/queue cannot be reconstructed",
            "fee estimate only; Aster historical account fees and funding unresolved",
            "excluded or missing reference prices fail closed",
        ],
    }
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "v52-model-ledger.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True, allow_nan=False) + "\n"
                for item in trades + skipped), encoding="utf-8")
    (output_root / "v52-model-summary.json").write_text(
        json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + "\n",
        encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--scan-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--round-trip-cost-bps", type=float, default=11.0)
    args = parser.parse_args()
    out = replay_v52_research(args.data_root, args.scan_root, args.output_root,
                              round_trip_cost_bps=args.round_trip_cost_bps)
    print(json.dumps({key: out[key] for key in (
        "status", "selected_unallocated_candidates", "modeled_entries",
        "modeled_closed_trades", "unresolved_exit_trades",
        "skipped_reasons", "exit_reasons",
        "price_model_closed_trade_mean_return",
        "price_model_closed_trade_win_rate")}, sort_keys=True))


if __name__ == "__main__":
    main()
