"""Verify and stage V52 hourly price-only research selections for portfolio replay.

Research candidates are not audited live SIGNAL rows. This bridge preserves
their distinct provenance and blocks duplicate selection in the same window;
it never treats selection as allocation, a venue fill, or realized profit.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from .v52_price_only_scan import MODEL_ID

SELECTED = "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"


def load_price_only_research(scan_root: Path, expected_runtime_sha: str
                             ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    root = Path(scan_root)
    manifest_path = root / "price-only-scan-manifest.json"
    if not manifest_path.is_file():
        raise ValueError("V52_RESEARCH_MANIFEST_MISSING")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("model") != MODEL_ID or
            manifest.get("status") != "RESEARCH_PRICE_ONLY_NOT_LIVE_PARITY" or
            manifest.get("runtime_sha") != expected_runtime_sha):
        raise ValueError("V52_RESEARCH_MODEL_OR_RUNTIME_MISMATCH")
    output = manifest.get("decision_output") or {}
    if output.get("relative_path") != "decisions/V52-hourly-price-model.jsonl":
        raise ValueError("V52_RESEARCH_UNEXPECTED_DECISION_PATH")
    path = root / output["relative_path"]
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != output.get("sha256"):
        raise ValueError("V52_RESEARCH_DECISION_HASH_MISMATCH")
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if len(rows) != output.get("rows"):
        raise ValueError("V52_RESEARCH_DECISION_COUNT_MISMATCH")
    grouped: dict[tuple[int, str], int] = {}
    last = (-1, "")
    accepted: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for row in rows:
        if (row.get("strategy_id") != "V52" or row.get("decision_model") != MODEL_ID or
                row.get("source_runtime_sha") != expected_runtime_sha or
                row.get("route") != "V50_POST_OPEN_BASIS"):
            raise ValueError("V52_RESEARCH_ROW_PROVENANCE_MISMATCH")
        ts = int(row["decision_ts_ms"])
        symbol = str(row["equity_reference_symbol"])
        if ts <= 0 or symbol not in {"AMZN", "META", "MSFT", "NVDA", "TSLA"}:
            raise ValueError("V52_RESEARCH_INVALID_TIME_OR_SYMBOL")
        # Source scan writes one row per stock in each time window.
        key = (ts, symbol)
        if key <= last:
            raise ValueError("V52_RESEARCH_ROWS_OUT_OF_ORDER_OR_DUPLICATED")
        last = key
        status = str(row.get("status"))
        counts[status] += 1
        if status == SELECTED:
            grouped[(ts, row["window_ny"])] = grouped.get((ts, row["window_ny"]), 0) + 1
            if (row.get("shared_allocation_status") != "NOT_EVALUATED" or
                    row.get("historical_aster_fill_verified") is not False or
                    row.get("realized_pnl_usdt") is not None or
                    row.get("aster_entry_reference_price_usd") is None or
                    row.get("yahoo_entry_reference_price_usd") is None):
                raise ValueError("V52_RESEARCH_SELECTED_ROW_UNVERIFIED")
            accepted.append({
                "strategy_id": "V52", "research_model": MODEL_ID,
                "source_status": SELECTED, "status": "RESEARCH_CANDIDATE_UNALLOCATED",
                "symbol": row["symbol"], "side": row["side"],
                "decision_ts_ms": ts, "window_ny": row["window_ny"],
                "entry_basis_bps": row["entry_basis_bps"],
                "aster_price_usd": row["aster_entry_reference_price_usd"],
                "yahoo_reference_usd": row["yahoo_entry_reference_price_usd"],
                "assumed_round_trip_cost_bps": row["assumed_round_trip_cost_bps"],
                "source_runtime_sha": expected_runtime_sha,
                "candidate_signal": False,
                "research_candidate": True,
                "shared_allocation_status": "NOT_EVALUATED",
                "fill_verified": False, "realized_pnl_usdt": None,
            })
    if any(count != 1 for count in grouped.values()):
        raise ValueError("V52_RESEARCH_MULTIPLE_SELECTED_PER_WINDOW")
    expected_counts = manifest.get("counts") or {}
    if {k: v for k, v in counts.items()} != {
            k: v for k, v in expected_counts.items() if not k.startswith("reason:")}:
        raise ValueError("V52_RESEARCH_MANIFEST_COUNT_MISMATCH")
    return accepted, {
        "status": "VERIFIED_RESEARCH_INPUT_NOT_LIVE_SIGNAL",
        "model": MODEL_ID, "selection_count": len(accepted),
        "selection_is_fill": False, "selection_is_live_signal": False,
        "selection_is_allocated": False, "status_counts": dict(counts),
        "scan_sha256": hashlib.sha256(raw).hexdigest(),
        "policy_sha256": manifest.get("runtime_policy_sha256"),
        "source_sha256": manifest.get("source_sha256"),
        "assumed_round_trip_cost_bps": manifest.get("assumed_round_trip_cost_bps"),
    }
