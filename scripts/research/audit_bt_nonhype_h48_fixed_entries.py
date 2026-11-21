#!/usr/bin/env python3
"""Research ONLY: compare six non-HYPE model exit prices with H48 next-H1-open prices.

It deliberately does not rerun entry selection, protective STOP/TP, portfolio
priority, shared Gross, funding, slippage, balances or drawdown. It must never
authorize or modify any LIVE Runner. HYPE is explicitly excluded.
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
from statistics import mean, median

SCHEMA = "disdex-nonhype-h48-fixed-entry-counterfactual/v1"
STRATEGIES = ("FET", "IDLE", "PENGU", "Q102", "V4", "V52")
HOLD_MS = 48 * 60 * 60 * 1000
BAR_MS = 60 * 60 * 1000
END_MS = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
FILL_PATTERN = "*_{fee}BPS_FILLS.csv"
WARNINGS = [
    "H48 price-only scenario retains original modeled entries and sizes, including trades whose existing strategy would exit sooner.",
    "No reexecution of STOP/TP, V4/PENGU/Q102/V52 exits, priority, shared risk, Gross, funding, fees, overlap, or portfolio DD.",
    "These archived STABLE4 fills are NOT proven to match current Production pins or executed venue fills.",
    "HYPE is excluded from changes and analysis; do not deploy this model to any real Runner.",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(131072), b""):
            digest.update(chunk)
    return digest.hexdigest()


def h48_quote_open_ms(entry_ms: int) -> int:
    if isinstance(entry_ms, bool) or not isinstance(entry_ms, int) or entry_ms <= 0:
        raise ValueError("INVALID_ENTRY_MS")
    t = entry_ms + HOLD_MS
    return ((t + BAR_MS - 1) // BAR_MS) * BAR_MS


def load_quotes(path: Path) -> dict[int, float]:
    result: dict[int, float] = {}
    with gzip.open(path, "rt", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            bar = json.loads(line)
            if not isinstance(bar, list) or len(bar) < 5:
                raise ValueError("H1_BAR_MALFORMED")
            utc_ms = int(bar[0])
            price = float(bar[1])
            if not math.isfinite(price) or price <= 0:
                raise ValueError("H1_BAR_OPEN_INVALID")
            if utc_ms in result:
                raise ValueError("H1_BAR_DUPLICATE_TIME")
            result[utc_ms] = price
    return result


def pct(x: float) -> float:
    return round(x * 100, 4)


def analyze_fee(fills_path: Path, quotes_root: Path) -> dict:
    with fills_path.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    relevant = [row for row in rows if row["strategy"] in STRATEGIES]
    unknown = sorted({row["strategy"] for row in rows} - {"HYPE"} - set(STRATEGIES))
    if unknown:
        raise ValueError("UNKNOWN_RUNNER:" + ",".join(unknown))

    quote_files: dict[str, Path] = {}
    quotes: dict[str, dict[int, float]] = {}
    for symbol in sorted({row["symbol"] for row in relevant}):
        matches = sorted(quotes_root.glob(f"{symbol}-1h-*.jsonl.gz"))
        if len(matches) == 1:
            quote_files[symbol] = matches[0]
            quotes[symbol] = load_quotes(matches[0])
        elif len(matches) > 1:
            raise ValueError("DUPLICATE_QUOTE_FILES:" + symbol)

    accum: dict[str, dict] = {}
    for s in STRATEGIES:
        accum[s] = {
            "total_model_exits": 0, "priced": 0, "missing_h1_quotes": 0,
            "48h_outside_period": 0, "baseline_gross_wins": 0, "h48_gross_wins": 0,
            "h48_better": 0, "h48_worse": 0, "h48_equal": 0,
            "baseline_gross_returns": [], "h48_gross_returns": [], "delta_returns": [],
            "model_source_shas": set(),
        }

    for row in relevant:
        state = accum[row["strategy"]]
        state["total_model_exits"] += 1
        state["model_source_shas"].add(row["source_runtime_sha"])
        entry = datetime.fromisoformat(row["entry_utc"].replace("Z", "+00:00"))
        if entry.utcoffset() is None:
            raise ValueError("ENTRY_TIMEZONE_MISSING")
        instant = int(entry.timestamp() * 1000)
        desired = instant + HOLD_MS
        if desired >= END_MS:
            state["48h_outside_period"] += 1
            continue
        quote = quotes.get(row["symbol"], {}).get(h48_quote_open_ms(instant))
        if quote is None:
            state["missing_h1_quotes"] += 1
            continue
        side = row["side"]
        if side not in ("LONG", "SHORT"):
            raise ValueError("INVALID_SIDE:" + side)
        entry_price = float(row["model_entry_price"])
        base_exit = float(row["model_exit_price"])
        if min(entry_price, base_exit, quote) <= 0:
            raise ValueError("PRICE_INVALID")
        direction = 1.0 if side == "LONG" else -1.0
        baseline = direction * (base_exit / entry_price - 1.0)
        h48 = direction * (quote / entry_price - 1.0)
        state["priced"] += 1
        state["baseline_gross_wins"] += baseline > 0
        state["h48_gross_wins"] += h48 > 0
        state["h48_better"] += h48 > baseline + 1e-10
        state["h48_worse"] += h48 < baseline - 1e-10
        state["h48_equal"] += abs(h48 - baseline) <= 1e-10
        state["baseline_gross_returns"].append(baseline)
        state["h48_gross_returns"].append(h48)
        state["delta_returns"].append(h48 - baseline)

    summary = {}
    for runner, state in accum.items():
        n = state["priced"]
        item = {k: value for k, value in state.items() if not isinstance(value, (list, set))}
        item["model_source_shas"] = sorted(state["model_source_shas"])
        if n:
            item.update({
                "baseline_gross_win_pct": round(100 * state["baseline_gross_wins"] / n, 2),
                "h48_gross_win_pct": round(100 * state["h48_gross_wins"] / n, 2),
                "baseline_worst_gross_ret_pct": pct(min(state["baseline_gross_returns"])),
                "h48_worst_gross_ret_pct": pct(min(state["h48_gross_returns"])),
                "h48_mean_gross_ret_pct": pct(mean(state["h48_gross_returns"])),
                "h48_median_gross_ret_pct": pct(median(state["h48_gross_returns"])),
                "mean_gross_ret_delta_pct_points": pct(mean(state["delta_returns"])),
            })
        summary[runner] = item

    return {
        "model_fills_sha256": sha256_file(fills_path),
        "quotes_sha256_by_symbol": {symbol: sha256_file(path) for symbol, path in sorted(quote_files.items())},
        "nonhype": summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--quotes-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    results = {}
    for fee in (10, 30):
        candidates = sorted(args.model_dir.glob(FILL_PATTERN.format(fee=fee)))
        if len(candidates) != 1:
            raise SystemExit(f"EXACT_MODEL_FILLS_REQUIRED:{fee}BPS:{len(candidates)}")
        results[f"{fee}bps"] = analyze_fee(candidates[0], args.quotes_dir)
    report = {
        "schema": SCHEMA,
        "origin": "archived STABLE4 2025-10-01 UTC to 2026-10-01 UTC model fills",
        "h48_quote_policy": "48h after original modeled entry, first available exact H1 bar open at or after threshold (no forward gaps)",
        "orders_sent": 0,
        "hype_modified": False,
        "production_bt_parity_certified": False,
        "portfolio_dd_recomputed": False,
        "warnings": WARNINGS,
        "scenarios": results,
    }
    payload = json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
