#!/usr/bin/env python3
"""Research-only H48 holding CAP comparison on archived non-HYPE modeled fills.

Preserves earlier original exits, including STOP/TP, and reprices ONLY original
trades held longer than 48h. Not a production-equivalent replay: changing exit
times also changes symbol ownership, wallet equity, Gross usage, funding, and
future eligible entries. No simulated capital curve or max DD is claimed.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

STRATEGIES = ("V4", "PENGU", "Q102", "V52", "FET", "IDLE")
H48_MS = 48 * 3600 * 1000
H1_MS = 3600 * 1000
END_MS = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(131072), b""):
            h.update(data)
    return h.hexdigest()


def milliseconds(value: str) -> int:
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if d.utcoffset() is None:
        raise ValueError("TIMEZONE_REQUIRED")
    return int(d.timestamp() * 1000)


def exact_next_h1_open(open_times: dict[int, float], entry_ms: int) -> float | None:
    target = entry_ms + H48_MS
    bar = ((target + H1_MS - 1) // H1_MS) * H1_MS
    return open_times.get(bar)


def prices_for_symbol(quotes_dir: Path, symbol: str) -> tuple[dict[int, float], str] | None:
    paths = sorted(quotes_dir.glob(symbol + "-1h-*.jsonl.gz"))
    if len(paths) == 0:
        return None
    if len(paths) != 1:
        raise ValueError("DUPLICATE_QUOTE_SOURCE:" + symbol)
    bars = {}
    with gzip.open(paths[0], "rt", encoding="utf-8") as stream:
        for line in stream:
            bar = json.loads(line)
            if not isinstance(bar, list) or len(bar) < 5:
                raise ValueError("INVALID_H1_BAR")
            t = int(bar[0])
            price = float(bar[1])
            if t in bars or not math.isfinite(price) or price <= 0:
                raise ValueError("INVALID_H1_PRICE_OR_DUPLICATE")
            bars[t] = price
    return bars, file_sha256(paths[0])


def audit(fills: Path, quotes_dir: Path) -> dict:
    with fills.open("r", newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    unexpected = {r["strategy"] for r in rows} - {"HYPE"} - set(STRATEGIES)
    if unexpected:
        raise ValueError("UNEXPECTED_STRATEGY:" + ",".join(sorted(unexpected)))
    quoted: dict[str, tuple[dict[int, float], str] | None] = {}
    aggregate = {
        k: {"fills": 0, "original_within_48h": 0,
            "shortened_at_48h": 0, "outside_period": 0, "missing_price": 0,
            "priced": 0, "baseline_gross_wins": 0, "cap48_gross_wins": 0,
            "sum_fixed_notional_gross_delta_jpy": 0.0,
            "gross_return_delta_pct_points_total": 0.0,
            "original_model_price_pnl_mismatch": 0, "sources": set()}
        for k in STRATEGIES
    }

    for row in rows:
        strategy = row["strategy"]
        if strategy == "HYPE":
            continue
        s = aggregate[strategy]
        s["fills"] += 1
        s["sources"].add(row["source_runtime_sha"])
        entry_ms = milliseconds(row["entry_utc"])
        exit_ms = milliseconds(row["exit_utc"])
        if exit_ms < entry_ms:
            raise ValueError("EXIT_BEFORE_ENTRY")
        start, old_exit, notional = (float(row[k]) for k in
                                     ("model_entry_price", "model_exit_price", "notional_jpy"))
        if min(start, old_exit, notional) <= 0 or not all(
            math.isfinite(x) for x in (start, old_exit, notional)
        ):
            raise ValueError("INVALID_TRADE_PRICE_OR_NOTIONAL")
        side = row["side"]
        if side not in ("LONG", "SHORT"):
            raise ValueError("INVALID_SIDE")
        direction = 1 if side == "LONG" else -1
        baseline_ret = direction * (old_exit / start - 1)
        pnl_expected = notional * baseline_ret
        if abs(float(row["pnl_before_cost_jpy"]) - pnl_expected) > max(.01, notional * .0001):
            s["original_model_price_pnl_mismatch"] += 1

        if exit_ms <= entry_ms + H48_MS:
            cap_ret = baseline_ret
            s["original_within_48h"] += 1
        else:
            if entry_ms + H48_MS >= END_MS:
                s["outside_period"] += 1
                continue
            if row["symbol"] not in quoted:
                quoted[row["symbol"]] = prices_for_symbol(quotes_dir, row["symbol"])
            pack = quoted[row["symbol"]]
            quote = exact_next_h1_open(pack[0], entry_ms) if pack else None
            if quote is None:
                s["missing_price"] += 1
                continue
            cap_ret = direction * (quote / start - 1)
            s["shortened_at_48h"] += 1

        s["priced"] += 1
        s["baseline_gross_wins"] += baseline_ret > 0
        s["cap48_gross_wins"] += cap_ret > 0
        s["gross_return_delta_pct_points_total"] += (cap_ret - baseline_ret) * 100
        s["sum_fixed_notional_gross_delta_jpy"] += (cap_ret - baseline_ret) * notional

    out = {}
    for name, value in aggregate.items():
        n = value["priced"]
        row = {key: item for key, item in value.items() if key != "sources"}
        row["source_runtime_shas"] = sorted(value["sources"])
        if n:
            row["baseline_gross_win_pct"] = round(100 * value["baseline_gross_wins"] / n, 2)
            row["cap48_gross_win_pct"] = round(100 * value["cap48_gross_wins"] / n, 2)
            row["mean_price_return_delta_pct_points"] = round(
                value["gross_return_delta_pct_points_total"] / n, 5)
        row["sum_fixed_notional_gross_delta_jpy"] = round(
            row["sum_fixed_notional_gross_delta_jpy"], 2)
        row["gross_return_delta_pct_points_total"] = round(
            row["gross_return_delta_pct_points_total"], 5)
        out[name] = row
    return {"fills_sha256": file_sha256(fills),
            "h1_quote_sha256_for_affected_symbols": {
                k: p[1] for k, p in sorted(quoted.items()) if p},
            "runners": out}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--quotes-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    results = {}
    for fee in (10, 30):
        files = sorted(args.model_dir.glob(f"*_{fee}BPS_FILLS.csv"))
        if len(files) != 1:
            raise SystemExit(f"EXPECTED_SINGLE_{fee}BPS_FILLS")
        results[f"{fee}bps"] = audit(files[0], args.quotes_dir)
    report = {
        "schema": "disdex-nonhype-h48-hold-cap-research/v1",
        "period": "2025-10-01 UTC to 2026-10-01 UTC",
        "hype_modified": False,
        "production_changes": False,
        "orders_sent": 0,
        "h48_policy": "Retain original earlier exit (including STOP); only cap later modeled exits at first H1-open >= entry+48h",
        "portfolio_dd_recomputed": False,
        "final_compounded_equity_recomputed": False,
        "limitations": [
            "Research-only modeled historical fills; no guarantee of current production pin parity",
            "Not a complete replay: shortened exits can change future signal eligibility, slot availability and risk gates",
            "No funding or cost recomputation; fixed-notional JPY deltas are NOT final wallet balance",
            "Some original PENGU realized PnL includes partial events not represented by simple full-notional price return",
            "A 48-hour CAP is different from the HYPE H48 time-only 48-hour exit replacement"
        ],
        "results": results,
    }
    text = json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
