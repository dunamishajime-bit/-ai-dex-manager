"""Re-acquire Yahoo 60m V52 reference data and compare it with the authenticated V52 tape.

This is price-model/source evidence only. It never upgrades V52 to LIVE execution parity:
historical spread/depth/queue, second-level reference, account/margin/filter state, and
verified fills remain outside this evidence layer.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import types
from typing import Any


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_json(path: Path, value: Any) -> str:
    raw = (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def load_release_module(code_root: Path, name: str):
    package = "_formal_v52_release"
    if package not in sys.modules:
        module = types.ModuleType(package)
        module.__path__ = [str(code_root)]
        sys.modules[package] = module
    return importlib.import_module(f"{package}.{name}")


def ts_iso(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, timezone.utc).isoformat()


def key_for_archived(row: dict[str, Any]) -> tuple[int, str]:
    ts = int(row.get("entry_ts_ms", row.get("decision_ts_ms")))
    return ts, str(row["symbol"]).upper()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--work-root", type=Path)
    args = parser.parse_args(argv)

    release = args.release_root.resolve()
    code = release / "all-reconstruction-code-plus-90-file-audited-source"
    fixed_data = release / "market-Aster-H1-funding-and-manifests"
    archived_root = release / "v52-SHA-verified-original-ledger"
    for path in (code, fixed_data, archived_root):
        if not path.exists():
            raise RuntimeError(f"REQUIRED_INPUT_MISSING:{path}")

    yahoo_acquire = load_release_module(code, "yahoo_acquire")
    v52_scan = load_release_module(code, "v52_price_only_scan")

    owned_temp = args.work_root is None
    temp = Path(tempfile.mkdtemp(prefix="formal-v52-price-source-")) if owned_temp else args.work_root.resolve()
    if temp.exists() and not owned_temp:
        shutil.rmtree(temp)
        temp.mkdir(parents=True)
    data_root = temp / "data"
    scan_root = temp / "scan"
    try:
        source_stock = fixed_data / "normalized" / "aster_stock"
        shutil.copytree(source_stock, data_root / "normalized" / "aster_stock")
        coverage = yahoo_acquire.acquire_yahoo_v52(data_root)
        scan = v52_scan.run_price_only_scan(data_root, scan_root)

        current_rows = load_jsonl(scan_root / "decisions" / "V52-hourly-price-model.jsonl")
        archived_rows = load_jsonl(archived_root / "v52-model-ledger.jsonl")
        selected = {
            (int(row["decision_ts_ms"]), str(row["symbol"]).upper()): row
            for row in current_rows
            if row.get("status") == "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"
        }
        archived = {key_for_archived(row): row for row in archived_rows}

        rows_by_key = {
            (int(row["decision_ts_ms"]), str(row["symbol"]).upper()): row
            for row in current_rows
        }
        archived_only = []
        for key in sorted(set(archived) - set(selected)):
            old = archived[key]
            current_same_symbol = rows_by_key.get(key)
            ts, symbol = key
            classification = "MODEL_OR_RANKING_DIVERGENCE"
            details: dict[str, Any] = {}
            if current_same_symbol:
                reasons = list(current_same_symbol.get("reasons") or [])
                if "MISSING_CAUSAL_PRICE_INPUT" in reasons:
                    classification = "CURRENT_YAHOO_PROVIDER_HOLE"
                else:
                    old_yahoo = old.get("yahoo_entry_reference_usd")
                    new_yahoo = current_same_symbol.get("yahoo_entry_reference_price_usd")
                    if old_yahoo is not None and new_yahoo is not None and abs(float(old_yahoo) - float(new_yahoo)) > 1e-9:
                        classification = "YAHOO_HISTORICAL_VALUE_DRIFT"
                        details["archived_yahoo_entry_reference_usd"] = old_yahoo
                        details["current_yahoo_entry_reference_usd"] = new_yahoo
                        details["absolute_price_change_usd"] = abs(float(old_yahoo) - float(new_yahoo))
                details["current_same_symbol_status"] = current_same_symbol.get("status")
                details["current_same_symbol_reasons"] = reasons
                details["current_same_symbol_basis_bps"] = current_same_symbol.get("entry_basis_bps")
            archived_only.append({
                "decision_ts_ms": ts,
                "decision_ts_utc": ts_iso(ts),
                "symbol": symbol,
                "classification": classification,
                "archived_status": old.get("status"),
                "archived_reason": old.get("reason"),
                "archived_basis_bps": old.get("entry_basis_bps"),
                **details,
            })

        regenerated_only = []
        for key in sorted(set(selected) - set(archived)):
            row = selected[key]
            ts, symbol = key
            archived_same_ts = [
                {"symbol": old_symbol, "status": old.get("status"), "basis_bps": old.get("entry_basis_bps")}
                for (old_ts, old_symbol), old in archived.items()
                if old_ts == ts
            ]
            regenerated_only.append({
                "decision_ts_ms": ts,
                "decision_ts_utc": ts_iso(ts),
                "symbol": symbol,
                "current_basis_bps": row.get("entry_basis_bps"),
                "archived_same_timestamp": archived_same_ts,
            })

        coverage_summary = {
            symbol: {
                "status": item.get("status"),
                "rows": item.get("rows"),
                "missing_session_hours": item.get("missing_session_hours"),
                "missing_session_days": item.get("missing_session_days"),
                "page_errors": item.get("page_errors"),
                "normalized_sha256": item.get("normalized_sha256"),
            }
            for symbol, item in sorted((coverage.get("symbols") or {}).items())
        }
        missing_day_sets = [
            set((item.get("missing_session_days") or {}).keys())
            for item in (coverage.get("symbols") or {}).values()
        ]
        common_missing_days = sorted(set.intersection(*missing_day_sets)) if missing_day_sets else []

        classifications = sorted({row["classification"] for row in archived_only})
        status = (
            "PRICE_ONLY_REGEN_EXACT"
            if not archived_only and not regenerated_only
            else "PRICE_ONLY_REGEN_DIVERGES_CURRENT_YAHOO_SOURCE_IS_NOT_IMMUTABLE"
        )
        payload = {
            "schema_version": 1,
            "status": status,
            "certification_issued": False,
            "live_execution_parity": False,
            "fixed_aster_stock_source": "market-Aster-H1-funding-and-manifests/normalized/aster_stock",
            "yahoo_retrieval_model": "Yahoo Finance v8 chart 60m, read-only, re-acquired at audit time",
            "coverage": coverage_summary,
            "common_missing_session_days": common_missing_days,
            "price_scan_status": scan.get("status"),
            "price_scan_counts": scan.get("counts"),
            "price_scan_decision_rows": scan.get("decision_output", {}).get("rows"),
            "price_scan_decision_sha256": scan.get("decision_output", {}).get("sha256"),
            "archived_candidate_rows": len(archived_rows),
            "current_selected_rows": len(selected),
            "archived_only_count": len(archived_only),
            "regenerated_only_count": len(regenerated_only),
            "divergence_classifications": classifications,
            "archived_only": archived_only,
            "regenerated_only": regenerated_only,
            "unverified_live_gates": scan.get("unverified_gates"),
            "v11_status": scan.get("v11_status"),
            "ruling": (
                "Current Yahoo 60m re-acquisition is useful independent price-source evidence, "
                "but Yahoo historical responses are not immutable and current coverage has holes. "
                "The authenticated 99-row V52 tape remains the historical anchor. Neither tape "
                "proves historical LIVE spread/depth/filter/margin/fill parity."
            ),
        }
        digest = write_json(args.output.resolve(), payload)
        print(canonical({
            "status": status,
            "archived_candidate_rows": len(archived_rows),
            "current_selected_rows": len(selected),
            "archived_only_count": len(archived_only),
            "regenerated_only_count": len(regenerated_only),
            "classifications": classifications,
            "manifest_sha256": digest,
        }))
        return 0
    finally:
        if owned_temp:
            shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
