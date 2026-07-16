#!/usr/bin/env python3
"""Run PENGU reserved 15% + one 10% scanner slot across 30 satellites.

PENGU keeps the original 288-rule adaptive 72-hour logic. Non-PENGU symbols
use the same regime/reversal structure with a smaller 72-rule grid to reduce
search degrees of freedom. The current Aster perpetual universe is queried
before the run and the first 30 supported candidates are monitored.

Research only. Real and automatic paper trading remain disabled.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

import requests

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import run_high_vol_scanner_portfolio_v1 as v1
import run_high_vol_scanner_portfolio_v2 as v2
import run_pengu_adaptive_72h_v2 as core


# display symbol, Binance USD-M archive symbol, possible Aster symbols
CANDIDATES = [
    ("DOGE", "DOGEUSDT", ["DOGEUSDT"]),
    ("SUI", "SUIUSDT", ["SUIUSDT"]),
    ("SEI", "SEIUSDT", ["SEIUSDT"]),
    ("APT", "APTUSDT", ["APTUSDT"]),
    ("ARB", "ARBUSDT", ["ARBUSDT"]),
    ("OP", "OPUSDT", ["OPUSDT"]),
    ("PEPE", "1000PEPEUSDT", ["1000PEPEUSDT", "PEPEUSDT"]),
    ("WIF", "WIFUSDT", ["WIFUSDT"]),
    ("BONK", "1000BONKUSDT", ["1000BONKUSDT", "BONKUSDT"]),
    ("NEAR", "NEARUSDT", ["NEARUSDT"]),
    ("AVAX", "AVAXUSDT", ["AVAXUSDT"]),
    ("LINK", "LINKUSDT", ["LINKUSDT"]),
    ("AAVE", "AAVEUSDT", ["AAVEUSDT"]),
    ("UNI", "UNIUSDT", ["UNIUSDT"]),
    ("FET", "FETUSDT", ["FETUSDT"]),
    ("LDO", "LDOUSDT", ["LDOUSDT"]),
    ("INJ", "INJUSDT", ["INJUSDT"]),
    ("TIA", "TIAUSDT", ["TIAUSDT"]),
    ("JUP", "JUPUSDT", ["JUPUSDT"]),
    ("ENA", "ENAUSDT", ["ENAUSDT"]),
    ("ONDO", "ONDOUSDT", ["ONDOUSDT"]),
    ("ADA", "ADAUSDT", ["ADAUSDT"]),
    ("XRP", "XRPUSDT", ["XRPUSDT"]),
    ("SOL", "SOLUSDT", ["SOLUSDT"]),
    ("FIL", "FILUSDT", ["FILUSDT"]),
    ("RENDER", "RENDERUSDT", ["RENDERUSDT"]),
    ("TAO", "TAOUSDT", ["TAOUSDT"]),
    ("TRX", "TRXUSDT", ["TRXUSDT"]),
    ("DOT", "DOTUSDT", ["DOTUSDT"]),
    ("LTC", "LTCUSDT", ["LTCUSDT"]),
    # Backups if any primary symbol is not currently available on Aster.
    ("ATOM", "ATOMUSDT", ["ATOMUSDT"]),
    ("ETC", "ETCUSDT", ["ETCUSDT"]),
    ("BCH", "BCHUSDT", ["BCHUSDT"]),
    ("ICP", "ICPUSDT", ["ICPUSDT"]),
    ("CRV", "CRVUSDT", ["CRVUSDT"]),
    ("DYDX", "DYDXUSDT", ["DYDXUSDT"]),
    ("GALA", "GALAUSDT", ["GALAUSDT"]),
    ("MANA", "MANAUSDT", ["MANAUSDT"]),
    ("SAND", "SANDUSDT", ["SANDUSDT"]),
    ("WLD", "WLDUSDT", ["WLDUSDT"]),
    ("STRK", "STRKUSDT", ["STRKUSDT"]),
    ("ZK", "ZKUSDT", ["ZKUSDT"]),
    ("NOT", "NOTUSDT", ["NOTUSDT"]),
    ("ETHFI", "ETHFIUSDT", ["ETHFIUSDT"]),
    ("ORDI", "ORDIUSDT", ["ORDIUSDT"]),
    ("STX", "STXUSDT", ["STXUSDT"]),
    ("IMX", "IMXUSDT", ["IMXUSDT"]),
    ("SHIB", "1000SHIBUSDT", ["1000SHIBUSDT", "SHIBUSDT"]),
    ("FLOKI", "1000FLOKIUSDT", ["1000FLOKIUSDT", "FLOKIUSDT"]),
]


def compact_satellite_grid() -> list[core.Rule]:
    return [
        core.Rule(long_drop, long_rsi, short_rally, short_rsi, hard_stop)
        for long_drop in (0.08, 0.10, 0.12)
        for long_rsi in (35, 40)
        for short_rally in (0.05, 0.08, 0.10)
        for short_rsi in (60, 65)
        for hard_stop in (0.10, 0.15)
    ]


def current_aster_symbols() -> tuple[set[str], dict[str, object]]:
    endpoint = "https://fapi.asterdex.com/fapi/v1/exchangeInfo"
    result: dict[str, object] = {"endpoint": endpoint}
    try:
        response = requests.get(endpoint, timeout=30)
        response.raise_for_status()
        payload = response.json()
        active = {
            str(row.get("symbol"))
            for row in payload.get("symbols", [])
            if row.get("status") == "TRADING"
            and row.get("contractType") == "PERPETUAL"
        }
        result.update({"endpoint_ok": True, "active_perpetual_count": len(active)})
        return active, result
    except Exception as exc:
        result.update({"endpoint_ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return set(), result


def choose_universe(active: set[str], limit: int = 30) -> tuple[dict[str, str], list[dict[str, object]]]:
    selected: dict[str, str] = {"PENGU": "PENGUUSDT"}
    audit: list[dict[str, object]] = []

    for display, binance_symbol, aster_options in CANDIDATES:
        matched = next((item for item in aster_options if item in active), None) if active else None
        eligible = matched is not None if active else True
        audit.append(
            {
                "display": display,
                "binance_symbol": binance_symbol,
                "aster_options": aster_options,
                "aster_match": matched,
                "selected": False,
                "selection_basis": "ASTER_TRADING" if active else "ASTER_ENDPOINT_UNAVAILABLE_FALLBACK",
            }
        )
        if eligible and len(selected) - 1 < limit:
            selected[display] = binance_symbol
            audit[-1]["selected"] = True

    # Keep the requested monitor count even if the current endpoint returns
    # fewer mapped names; such fills are explicitly marked unverified.
    if len(selected) - 1 < limit:
        for row in audit:
            if row["selected"]:
                continue
            selected[str(row["display"])] = str(row["binance_symbol"])
            row["selected"] = True
            row["selection_basis"] = "UNVERIFIED_FILL_TO_30"
            if len(selected) - 1 >= limit:
                break

    return selected, audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/high_vol_scanner_30"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/high_vol_scanner_30"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    active, endpoint_audit = current_aster_symbols()
    universe, selection_audit = choose_universe(active, limit=30)
    v1.SYMBOLS = universe

    original_grid = core.rule_grid
    original_builder = v1.build_symbol_candidates

    def build_with_symbol_specific_grid(symbol: str, exchange_symbol: str, data):
        core.rule_grid = original_grid if symbol == "PENGU" else compact_satellite_grid
        return original_builder(symbol, exchange_symbol, data)

    v1.build_symbol_candidates = build_with_symbol_specific_grid

    universe_payload = {
        "pengu_conditions_changed": False,
        "pengu_rule_count": len(original_grid()),
        "satellite_rule_count": len(compact_satellite_grid()),
        "requested_non_pengu_count": 30,
        "selected_non_pengu_count": len(universe) - 1,
        "symbols": universe,
        "aster_endpoint": endpoint_audit,
        "selection_audit": selection_audit,
    }
    (args.output / "universe_selection.json").write_text(
        json.dumps(universe_payload, indent=2), encoding="utf-8"
    )

    sys.argv = [
        sys.argv[0],
        "--output", str(args.output),
        "--cache", str(args.cache),
    ]
    try:
        v2.main()
    finally:
        core.rule_grid = original_grid
        v1.build_symbol_candidates = original_builder

    summary_path = args.output / "summary.json"
    if summary_path.exists():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        summary["universe_selection"] = universe_payload
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
