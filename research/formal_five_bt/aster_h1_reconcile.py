"""Explicit Aster-primary one-hour BTC source recovery from sixty official 1m bars.

Research scenario only: the original Aster 1h candle is never silently corrected.
The original normalized file and original venue pages are preserved separately,
all minute page SHA256 values are recorded, and the acquisition manifest is
updated after a strict same-venue, causal, contiguous-minute proof.  The
unrepaired branch remains a distinct baseline.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable

from . import sources
from .acquire import _write_bytes, _write_json

HOUR_MS = 3_600_000
MINUTE_MS = 60_000
BAD_BTC_HOUR_TS = 1_757_768_400_000
SYMBOL = "BTCUSDT"


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _ohlc_valid(row: dict[str, Any]) -> bool:
    try:
        o, h, l, c = (float(row[name]) for name in ("open", "high", "low", "close"))
    except (KeyError, TypeError, ValueError):
        return False
    return (all(math.isfinite(v) and v > 0 for v in (o, h, l, c))
            and h >= max(o, c) and l <= min(o, c) and h >= l)


def aggregate_exact_aster_minute_hour(
    rows: list[list[Any]], hour_ts: int,
) -> dict[str, Any]:
    """Reject missing, duplicate, shifted, future or impossible minute candles."""
    if not isinstance(hour_ts, int) or hour_ts % HOUR_MS:
        raise ValueError("ASTER_REPAIR_HOUR_NOT_ALIGNED")
    ordered = sorted(rows, key=lambda row: int(row[0]))
    if len(ordered) != 60 or [int(row[0]) for row in ordered] != [
        hour_ts + i * MINUTE_MS for i in range(60)
    ]:
        raise ValueError("ASTER_REPAIR_MINUTE_HISTORY_NOT_60_CONTIGUOUS")
    for row in ordered:
        if len(row) < 8 or int(row[6]) != int(row[0]) + MINUTE_MS - 1:
            raise ValueError("ASTER_REPAIR_MINUTE_CLOSE_TIMESTAMP_INVALID")
        if not _ohlc_valid({
            "open": row[1], "high": row[2],
            "low": row[3], "close": row[4],
        }):
            raise ValueError("ASTER_REPAIR_INVALID_NATIVE_MINUTE_OHLC")
        if not all(math.isfinite(float(row[i])) and float(row[i]) >= 0
                   for i in (5, 7)):
            raise ValueError("ASTER_REPAIR_INVALID_MINUTE_VOLUME")
    result = {
        "source": "aster", "exchange": "ASTER", "instrument": SYMBOL,
        "interval": "1h", "event_time_ms": hour_ts,
        "close_time_ms": hour_ts + HOUR_MS - 1,
        "open": float(ordered[0][1]),
        "high": max(float(row[2]) for row in ordered),
        "low": min(float(row[3]) for row in ordered),
        "close": float(ordered[-1][4]),
        "base_volume": sum(float(row[5]) for row in ordered),
        "quote_volume": sum(float(row[7]) for row in ordered),
    }
    if not _ohlc_valid(result):
        raise ValueError("ASTER_REPAIR_DERIVED_H1_OHLC_INVALID")
    return result


def reconcile_one_primary_hour(
    data_root: str | Path,
    *,
    hour_ts: int = BAD_BTC_HOUR_TS,
    fetch: Callable[..., Any] = sources.fetch_historical_klines,
    allow_valid_noop: bool = False,
) -> dict[str, Any]:
    """Patch a throwaway research data-root; preserve original and audit hashes.

    Only a positively identified invalid native H1 can be replaced.  A
    healthy original, a mismatched manifest, or a non-matching native 1m
    open/close fails closed rather than overwriting an unrelated dataset.
    """
    root = Path(data_root)
    manifest_path = root / "acquisition-manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    source = manifest["venues"]["aster"]["klines"][SYMBOL]
    if source.get("status") != "ACQUIRED":
        raise ValueError("ASTER_REPAIR_ORIGINAL_SOURCE_UNAVAILABLE")
    if manifest.get("aster_h1_reconstruction"):
        raise ValueError("ASTER_REPAIR_ALREADY_APPLIED")
    candle_path = root / source["normalized_path"]
    original = candle_path.read_bytes()
    if _sha(original) != source["normalized_sha256"]:
        raise ValueError("ASTER_REPAIR_ORIGINAL_HASH_MISMATCH")
    rows = [json.loads(line) for line in original.splitlines() if line.strip()]
    indices = [index for index, row in enumerate(rows)
               if int(row["event_time_ms"]) == hour_ts]
    if len(indices) != 1:
        raise ValueError("ASTER_REPAIR_TARGET_MISSING_OR_DUPLICATE")
    old = rows[indices[0]]
    if _ohlc_valid(old):
        if not allow_valid_noop:
            raise ValueError("ASTER_REPAIR_ORIGINAL_IS_ALREADY_VALID")
        # The public primary venue can revise an invalid historic candle
        # between two independent API acquisitions.  Never overwrite a
        # currently valid bar merely to manufacture a 'repaired' sample.
        noop = {
            "scenario": "NATIVE_ASTER_H1_VALID_NO_RECONSTRUCTION",
            "symbol": SYMBOL, "hour_start_ms": hour_ts,
            "validated_contiguous_bars": 0,
            "derived_normalized_sha256": _sha(original),
            "original_normalized_sha256": _sha(original),
            "minute_raw_pages": [],
            "native_h1_ohlc_valid": True,
            "normalized_h1_mutated": False,
        }
        _write_json(root / "aster-h1-reconciliation-status.json", noop)
        return noop
    acquisition = fetch("aster", SYMBOL, hour_ts, hour_ts + HOUR_MS - 1,
                        interval="1m", max_pages=3)
    if (acquisition.source != "aster" or acquisition.native_instrument != SYMBOL
            or acquisition.interval != "1m"):
        raise ValueError("ASTER_REPAIR_NOT_PRIMARY_SOURCE")
    reconstructed = aggregate_exact_aster_minute_hour(acquisition.rows, hour_ts)
    for field in ("open", "close"):
        prior = float(old[field])
        new = reconstructed[field]
        if not math.isfinite(prior) or prior <= 0 or abs(prior / new - 1) > 2 / 10_000:
            raise ValueError(f"ASTER_REPAIR_NATIVE_H1_1M_{field.upper()}_DIVERGENCE_GT_2BPS")
    if len(acquisition.page_hashes) != len(acquisition.raw_responses):
        raise ValueError("ASTER_REPAIR_MINUTE_PAGE_HASH_COUNT_MISMATCH")
    if any(_sha(raw) != digest for raw, digest in zip(
            acquisition.raw_responses, acquisition.page_hashes)):
        raise ValueError("ASTER_REPAIR_MINUTE_PAGE_HASH_MISMATCH")
    old_digest = _sha(original)
    backup_relative = f"raw/aster/reconstruction-original/{SYMBOL}.jsonl"
    backup = root / backup_relative
    if backup.exists():
        raise ValueError("ASTER_REPAIR_BACKUP_ALREADY_EXISTS")
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(original)
    raw_pages = []
    for index, payload in enumerate(acquisition.raw_responses, start=1):
        relative = f"raw/aster/reconstruction-1m/{SYMBOL}-{hour_ts}-page-{index:04d}.json"
        digest = _write_bytes(root / relative, payload)
        raw_pages.append({"path": relative, "sha256": digest})
    rows[indices[0]] = reconstructed
    normalized = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
                         for row in rows).encode()
    updated_digest = _sha(normalized)
    source["normalized_sha256"] = updated_digest
    source["primary_venue_derived_bar_count"] = 1
    source["original_normalized_sha256"] = old_digest
    audit = {
        "scenario": "OFFICIAL_ASTER_1M_RECONSTRUCTED_H1_NOT_RAW_H1_PARITY",
        "symbol": SYMBOL, "hour_start_ms": hour_ts,
        "source_available_at_ms": hour_ts + HOUR_MS,
        "original_normalized_path": backup_relative,
        "original_normalized_sha256": old_digest,
        "derived_normalized_sha256": updated_digest,
        "minute_interval": "1m", "validated_contiguous_bars": 60,
        "minute_raw_pages": raw_pages,
        "reconstructed_bar_sha256": _sha(
            json.dumps(reconstructed, sort_keys=True, separators=(",", ":")).encode()),
        "original_h1_ohlc_valid": False,
        "reconstructed_h1_ohlc_valid": True,
        "original_open_close_within_2bps": True,
    }
    manifest["aster_h1_reconstruction"] = audit
    # Preserve both copies; write the transformed normalized source *only*
    # after the full minute-page provenance checks succeed.
    candle_path.write_bytes(normalized)
    _write_json(manifest_path, manifest)
    audit["normalized_h1_mutated"] = True
    _write_json(root / "aster-h1-reconciliation-status.json", audit)
    return audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--allow-valid-noop", action="store_true",
                        help="Skip mutation if the native H1 is already valid; record distinct no-repair scenario")
    args = parser.parse_args()
    result = reconcile_one_primary_hour(args.data_root, allow_valid_noop=args.allow_valid_noop)
    print(json.dumps({
        "scenario": result["scenario"], "symbol": result["symbol"],
        "hour_start_ms": result["hour_start_ms"],
        "validated_contiguous_bars": result["validated_contiguous_bars"],
        "derived_normalized_sha256": result["derived_normalized_sha256"],
        "minute_page_sha256": [row["sha256"] for row in result["minute_raw_pages"]],
        "normalized_h1_mutated": result["normalized_h1_mutated"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
