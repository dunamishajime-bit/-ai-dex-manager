"""Acquire and freeze source data for a local formal-five-logic BT run.

Raw market data and normalized files are written only under the ignored local
``research-runs/formal-five-logic-bt`` tree. This module never accesses VPS
credentials and never writes to Production.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Any

from . import sources
from .aster_h1_repair import reconstruct_aster_h1, valid_h1
from .manifest import load_manifest


REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = Path(__file__).resolve().with_name("runtime_source_manifest.json")
START_DATE = date(2025, 8, 10)
END_DATE = date(2026, 8, 11)  # exclusive UTC date; includes the final full H1 bar
WARMUP_START = date(2025, 1, 1)
HOUR_MS = 3_600_000


def _time_ms(day: date) -> int:
    return int(datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)


def extract_universes(manifest_path: Path = MANIFEST_PATH) -> dict[str, list[str]]:
    """Extract strategy symbol sets from the audited source/config manifest."""
    manifest = load_manifest(manifest_path)
    snapshot = manifest_path.parent / "runtime_source_snapshot"
    v12_text = (snapshot / "config/v12X1AllRuntime.ts").read_text(encoding="utf-8")
    v12_match = re.search(r"universe:\s*\[([^\]]+)\]", v12_text)
    if not v12_match:
        raise ValueError("V12_UNIVERSE_NOT_FOUND_IN_AUDITED_CONFIG")
    v12 = [f"{value}USDT" for value in re.findall(r"\"([A-Z0-9]+)\"", v12_match.group(1))]

    live_symbols = manifest["config_allowlist"]["live_process_environment"].get("QUALITY102_CAUSAL_V1_SYMBOLS")
    if not isinstance(live_symbols, list) or not live_symbols:
        raise ValueError("Q102_HIGH_VOL_UNIVERSE_NOT_IN_AUDITED_ALLOWLIST")
    model_text = (snapshot / "config/disdexQuality102CausalV4Model.ts").read_text(encoding="utf-8")
    s34_symbols = sorted(set(re.findall(r"symbol:\s*\"([A-Z0-9]+)\"", model_text)))
    q102 = sorted(set([*live_symbols, *s34_symbols]))
    return {
        "V12": sorted(set(v12)),
        "PENGU": ["BTCUSDT", "PENGUUSDT"],
        "Q102": q102,
        "FET": ["FETUSDT"],
        "crypto_union": sorted(set([*v12, "BTCUSDT", "PENGUUSDT", *q102, "FETUSDT"])),
    }


def _write_bytes(path: Path, payload: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, payload: Any) -> str:
    raw = (json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    return _write_bytes(path, raw)


def _save_collection(root: Path, source: str, kind: str, symbol: str, collection: Any) -> dict[str, Any]:
    safe = re.sub(r"[^A-Z0-9._-]", "_", symbol)
    page_records = []
    for index, raw in enumerate(collection.raw_responses, start=1):
        relative = Path("raw") / source / kind / safe / f"page-{index:04d}.json"
        digest = _write_bytes(root / relative, raw)
        page_records.append({"path": relative.as_posix(), "sha256": digest, "bytes": len(raw)})
    return {"page_count": len(page_records), "pages": page_records}


def _normalize_klines(source: str, symbol: str, rows: list[list[Any]]) -> list[dict[str, Any]]:
    """Normalize venue H1 rows while keeping the canonical strategy symbol."""
    output = []
    for row in rows:
        if len(row) < 6:
            raise ValueError(f"MALFORMED_KLINE:{source}:{symbol}")
        event_ms = int(row[0])
        if source == "okx":
            # OKX swap history: ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm.
            # volCcy is base-asset volume; volCcyQuote is quote-asset volume.
            if len(row) < 8:
                raise ValueError(f"MALFORMED_OKX_KLINE:{symbol}")
            close_ms = event_ms + HOUR_MS - 1
            base_volume = float(row[6])
            quote_volume = float(row[7])
        elif source == "bybit":
            # Bybit linear history: start,o,h,l,c,volume,turnover.
            close_ms = event_ms + HOUR_MS - 1
            base_volume = float(row[5])
            quote_volume = float(row[6]) if len(row) > 6 else None
        else:
            # Binance/Aster futures kline layout.
            if len(row) < 7:
                raise ValueError(f"MALFORMED_KLINE:{source}:{symbol}")
            close_ms = int(row[6])
            base_volume = float(row[5])
            quote_volume = float(row[7]) if len(row) > 7 else None
        output.append({
            "source": source,
            "exchange": source.upper(),
            "instrument": symbol,
            "interval": "1h",
            "event_time_ms": event_ms,
            "close_time_ms": close_ms,
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "base_volume": base_volume,
            "quote_volume": quote_volume,
        })
    return output


def acquire(root: str | Path, *, warmup_start: date = WARMUP_START, start_date: date = START_DATE, end_date_exclusive: date = END_DATE, venues: tuple[str, ...] = ("aster", "binance", "bybit", "okx"), sleep_seconds: float = 0.12) -> dict[str, Any]:
    """Acquire primary Aster candles/funding plus same-contract venue metadata.

    Alternative OHLC is retained only for venue validation/coverage. Strategy
    signals always use Aster OHLC. Proxy L2 is fetched separately after signal
    timestamps are known, preventing thousands of unused archive downloads.
    """
    if end_date_exclusive <= start_date or warmup_start > start_date or sleep_seconds < 0:
        raise ValueError("invalid acquisition range or pacing")
    target = Path(root).resolve()
    target.mkdir(parents=True, exist_ok=True)
    universes = extract_universes()
    symbols = universes["crypto_union"]
    start_ms, end_ms = _time_ms(warmup_start), _time_ms(end_date_exclusive) - 1
    metadata: dict[str, Any] = {
        "schema_version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runtime_sha": load_manifest(MANIFEST_PATH)["runtime_sha"],
        "requested": {"warmup_start": warmup_start.isoformat(), "period_start": start_date.isoformat(), "period_end_inclusive": (end_date_exclusive.fromordinal(end_date_exclusive.toordinal() - 1)).isoformat(), "end_exclusive": end_date_exclusive.isoformat()},
        "universes": universes,
        "venues": {},
        "fred": None,
    }

    for venue in venues:
        if venue not in {"aster", "binance", "bybit", "okx"}:
            raise ValueError(f"unsupported venue: {venue}")
        if sleep_seconds:
            time.sleep(sleep_seconds)
        catalog = sources.fetch_instrument_catalog(venue)
        catalog_record = _save_collection(target, venue, "catalog", "all", catalog)
        _write_json(target / "normalized" / venue / "catalog.json", catalog.rows)
        meta_by_asset: dict[str, Any] = {}
        for base in sorted({symbol.removesuffix("USDT") for symbol in symbols}):
            expected = f"{base}-USDT-SWAP" if venue == "okx" else f"{base}USDT"
            raw = next((row for row in catalog.rows if row.get("instId" if venue == "okx" else "symbol") == expected), None)
            if raw is None:
                meta_by_asset[expected] = {"status": "NOT_LISTED_IN_CURRENT_CATALOG"}
                continue
            try:
                native = sources.verify_native_instrument(venue, expected, raw)
                meta_by_asset[expected] = {
                    "status": "VERIFIED",
                    "contract_type": native.contract_type,
                    "market_status_now": native.status,
                    "quote_asset": native.quote_asset,
                    "listed_from_ms": native.listed_from_ms,
                    "listed_until_ms": native.listed_until_ms,
                }
            except ValueError as error:
                meta_by_asset[expected] = {"status": "NOT_VERIFIED", "reason": str(error)}
        venue_record: dict[str, Any] = {"catalog": catalog_record, "instruments": meta_by_asset, "klines": {}, "funding": {}}

        # Acquire the requested venue's own H1/funding.  The canonical strategy
        # symbol (e.g. BTCUSDT) is preserved in normalized rows while the native
        # venue instrument (e.g. BTC-USDT-SWAP on OKX) is recorded separately.
        for symbol in symbols:
            time.sleep(sleep_seconds) if sleep_seconds else None
            base = symbol.removesuffix("USDT")
            native_symbol = f"{base}-USDT-SWAP" if venue == "okx" else symbol
            status = meta_by_asset.get(native_symbol, {})
            verified = status.get("status") == "VERIFIED" and status.get("listed_from_ms", end_ms + 1) <= end_ms
            if not verified:
                venue_record["klines"][symbol] = {
                    "status": "NOT_VERIFIED_INSTRUMENT", "native_instrument": native_symbol,
                    "row_count": 0,
                }
                venue_record["funding"][symbol] = {
                    "status": "NOT_VERIFIED_INSTRUMENT", "native_instrument": native_symbol,
                    "row_count": 0,
                }
                continue
            try:
                acquisition = sources.fetch_historical_klines(
                    venue, native_symbol, start_ms, end_ms)
            except Exception as error:
                venue_record["klines"][symbol] = {
                    "status": "ACQUISITION_FAILED", "native_instrument": native_symbol,
                    "reason": str(error)[:200], "row_count": 0,
                }
                continue
            saved = _save_collection(target, venue, "klines", symbol, acquisition)
            normalized = _normalize_klines(venue, symbol, acquisition.rows)
            malformed_rows = [
                (index, row) for index, row in enumerate(normalized)
                if not valid_h1(row)
            ]
            repair_evidence: list[dict[str, Any]] = []
            unresolved_malformed: list[dict[str, Any]] = []
            if venue == "aster":
                # Historical Aster H1 occasionally violates OHLC bounds.
                # Only independently verified native M1 can replace such a bar.
                for bad_index, original in malformed_rows:
                    hour_ms = int(original["event_time_ms"])
                    if len(repair_evidence) + len(unresolved_malformed) >= 24:
                        unresolved_malformed.append({
                            "hour_ms": hour_ms, "reason": "REPAIR_ATTEMPT_LIMIT_REACHED"})
                        continue
                    if sleep_seconds:
                        time.sleep(sleep_seconds)
                    try:
                        m1 = sources.fetch_historical_klines(
                            "aster", native_symbol, hour_ms, hour_ms + HOUR_MS - 1,
                            interval="1m")
                        if (m1.source != "aster" or m1.native_instrument != native_symbol
                                or m1.interval != "1m"):
                            raise ValueError("M1_NATIVE_SOURCE_METADATA_MISMATCH")
                        raw_evidence = _save_collection(
                            target, "aster", "ohlc_m1_repair",
                            f"{symbol}_{hour_ms}", m1)
                        fixed = reconstruct_aster_h1(symbol, hour_ms, m1.rows)
                        original_hash = hashlib.sha256(json.dumps(
                            original, sort_keys=True, separators=(",", ":")
                        ).encode()).hexdigest()
                        fixed_hash = hashlib.sha256(json.dumps(
                            fixed, sort_keys=True, separators=(",", ":")
                        ).encode()).hexdigest()
                        normalized[bad_index] = fixed
                        repair_evidence.append({
                            "hour_ms": hour_ms, "original_h1_sha256": original_hash,
                            "reconstructed_h1_sha256": fixed_hash,
                            "m1_native_rows": len(m1.rows), "raw_m1": raw_evidence,
                        })
                    except (RuntimeError, OSError, ValueError, TypeError, KeyError) as error:
                        unresolved_malformed.append({
                            "hour_ms": hour_ms, "reason": str(error)[:140]})
            else:
                unresolved_malformed = [
                    {"hour_ms": int(row["event_time_ms"]),
                     "reason": f"{venue.upper()}_SOURCE_H1_INVALID_NO_REPAIR"}
                    for _, row in malformed_rows
                ]

            normalized_path = Path("normalized") / venue / "klines" / f"{symbol}.jsonl"
            content = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
                              for row in normalized).encode("utf-8")
            digest = _write_bytes(target / normalized_path, content)
            coverage = [row["event_time_ms"] for row in normalized]
            gaps = sum((right - left) != HOUR_MS for left, right in zip(coverage, coverage[1:]))
            in_period = [row for row in normalized if start_ms <= row["event_time_ms"] <= end_ms]
            venue_record["klines"][symbol] = {
                "status": "ACQUIRED" if normalized else "NO_ROWS",
                "native_instrument": native_symbol,
                "requested_start_ms": start_ms, "requested_end_ms": end_ms,
                "first_open_ms": acquisition.actual_start_ms,
                "last_open_ms": acquisition.actual_end_ms,
                "row_count": len(normalized), "period_row_count": len(in_period),
                "hour_gaps": gaps, "malformed_source_h1": len(malformed_rows),
                "reconstructed_from_native_m1": len(repair_evidence),
                "unresolved_malformed_source_h1": len(unresolved_malformed),
                "ohlc_repair_evidence": repair_evidence,
                "unresolved_ohlc_source": unresolved_malformed,
                "normalized_path": normalized_path.as_posix(),
                "normalized_sha256": digest, "raw": saved,
            }
            try:
                funding = sources.fetch_historical_funding(
                    venue, native_symbol, start_ms, end_ms)
                raw = _save_collection(target, venue, "funding", symbol, funding)
                funding_path = Path("normalized") / venue / "funding" / f"{symbol}.jsonl"
                normalized_funding = []
                for row in funding.rows:
                    ts_key = "fundingRateTimestamp" if venue == "bybit" else "fundingTime"
                    normalized_funding.append({
                        "source": venue, "exchange": venue.upper(), "instrument": symbol,
                        "native_instrument": native_symbol,
                        "event_time_ms": int(row[ts_key]),
                        "funding_rate": float(row["fundingRate"]),
                    })
                funding_content = "".join(
                    json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
                    for row in normalized_funding).encode("utf-8")
                funding_sha = _write_bytes(target / funding_path, funding_content)
                venue_record["funding"][symbol] = {
                    "status": "ACQUIRED" if normalized_funding else "NO_ROWS",
                    "native_instrument": native_symbol,
                    "row_count": len(normalized_funding),
                    "first_ms": normalized_funding[0]["event_time_ms"] if normalized_funding else None,
                    "last_ms": normalized_funding[-1]["event_time_ms"] if normalized_funding else None,
                    "normalized_path": funding_path.as_posix(),
                    "normalized_sha256": funding_sha, "raw": raw,
                }
            except Exception as error:
                venue_record["funding"][symbol] = {
                    "status": "ACQUISITION_FAILED", "native_instrument": native_symbol,
                    "reason": str(error)[:200], "row_count": 0,
                }
        metadata["venues"][venue] = venue_record
        _write_json(target / "acquisition-progress.json", metadata)

    if "aster" in venues:
        # An external FX-provider failure must not discard hours of fully
        # acquired, independently verifiable Aster candles and funding.
        # Preserve partial provenance and still run the audited *signal*
        # scans. Portfolio equity/P&L remains blocked until FX is restored.
        try:
            fx = sources.fetch_fred_dexjpus(warmup_start, end_date_exclusive)
            if not fx.observations:
                raise ValueError("FRED_RETURNED_NO_USABLE_FX_OBSERVATIONS")
            fx_raw_path = Path("raw/fred/DEXJPUS.csv")
            raw_sha = _write_bytes(target / fx_raw_path, fx.raw_response)
            fx_path = Path("normalized/fred/DEXJPUS.jsonl")
            fx_content = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in fx.observations).encode("utf-8")
            fx_sha = _write_bytes(target / fx_path, fx_content)
            metadata["fred"] = {"status": "ACQUIRED", "source_url": fx.source_url, "raw_path": fx_raw_path.as_posix(), "raw_sha256": raw_sha, "normalized_path": fx_path.as_posix(), "normalized_sha256": fx_sha, "observations": len(fx.observations)}
        except (RuntimeError, OSError, ValueError) as error:
            metadata["fred"] = {
                "status": "NOT_VERIFIABLE_FX_PROVIDER_UNAVAILABLE",
                "source": "FRED DEXJPUS", "error_type": type(error).__name__,
                "observations": 0, "portfolio_accounting_permitted": False,
            }
        _write_json(target / "acquisition-progress.json", metadata)

    metadata["status"] = (
        "ACQUISITION_PARTIAL_FX_NOT_VERIFIABLE"
        if "aster" in venues and (metadata.get("fred") or {}).get("status") != "ACQUIRED"
        else "ACQUISITION_COMPLETE_REQUIRES_VALIDATION"
    )
    metadata["acquisition_manifest_sha256"] = _write_json(target / "acquisition-manifest.json", metadata)
    return metadata


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, help="Local ignored acquisition directory")
    parser.add_argument("--warmup-start", type=date.fromisoformat, default=WARMUP_START)
    parser.add_argument("--period-start", type=date.fromisoformat, default=START_DATE)
    parser.add_argument("--end-exclusive", type=date.fromisoformat, default=END_DATE)
    parser.add_argument("--venues", nargs="+", default=["aster", "binance", "bybit", "okx"])
    args = parser.parse_args(argv)
    summary = acquire(args.data_root, warmup_start=args.warmup_start, start_date=args.period_start, end_date_exclusive=args.end_exclusive, venues=tuple(args.venues))
    print(json.dumps({"status": summary["status"], "universe_counts": {key: len(value) for key, value in summary["universes"].items()}, "venue_status": {key: {"symbols": len(value["klines"]), "acquired": sum(item.get("status") == "ACQUIRED" for item in value["klines"].values())} for key, value in summary["venues"].items()}, "data_root": str(Path(args.data_root).resolve()), "manifest_sha256": summary["acquisition_manifest_sha256"]}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
