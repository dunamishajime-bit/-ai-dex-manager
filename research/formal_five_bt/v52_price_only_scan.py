"""Source-anchored V52 hourly basis research (NOT LIVE-equivalent decisions).

Yahoo equity reference H1 + Aster stock-perp H1 generate a strictly as-of,
price-only V50 scenario. Live V11 and V50 depth/spread/microsecond quote
gates cannot be reconstructed from hourly prices: rows are modeled research
candidates, never observed LIVE signals or verified execution.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence
from zoneinfo import ZoneInfo

from .calendars import is_nyse_core_open, nyse_close_utc
from .manifest import load_manifest
from .yahoo_v52 import YahooBar, STOCKS, load_yahoo_bars

NY = ZoneInfo("America/New_York")
START = date(2025, 8, 10)
END_EXCLUSIVE = date(2026, 8, 11)
INITIAL_GAP_END = date(2025, 9, 29)
PRICE_MAX_AGE_MS = 65 * 60_000
V50_WINDOW_TIMES = (time(11, 30), time(12, 30), time(13, 30))
MODEL_ID = "V52_HOURLY_PRICE_ONLY_RESEARCH"


@dataclass(frozen=True)
class PerpBar:
    symbol: str
    end_ms: int
    close: float
    source_sha256: str


def read_stock_perp_bars(path: Path, symbol: str) -> tuple[PerpBar, ...]:
    if symbol not in STOCKS:
        raise ValueError("INVALID_STOCK_SYMBOL")
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    output = []
    last_open = -1
    for line in raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if (row.get("source") != "aster" or row.get("interval") != "1h"
                or row.get("instrument") != symbol + "USDT"):
            raise ValueError("ASTER_STOCK_SOURCE_OR_CONTRACT_MISMATCH")
        opened = int(row["event_time_ms"])
        closed = int(row["close_time_ms"])
        values = [float(row[k]) for k in ("open", "high", "low", "close")]
        if (opened <= last_open or opened % 3_600_000 != 0 or closed != opened + 3_600_000 - 1
                or not all(math.isfinite(v) and v > 0 for v in values)
                or values[1] < max(values[0], values[3])
                or values[2] > min(values[0], values[3])):
            raise ValueError("ASTER_STOCK_NONCAUSAL_OR_INVALID_HOUR")
        output.append(PerpBar(symbol, closed + 1, values[3], digest))
        last_open = opened
    return tuple(output)


def asof_price(
    bars: Sequence[YahooBar] | Sequence[PerpBar],
    symbol: str,
    timestamp_ms: int,
    *,
    max_age_ms: int = PRICE_MAX_AGE_MS,
) -> tuple[float | None, str, int | None, str | None]:
    """Take only completed bars from the same New York calendar day."""
    if max_age_ms < 0:
        raise ValueError("BAD_MAX_AGE")
    end_times = [bar.end_ms for bar in bars]
    if end_times != sorted(end_times):
        raise ValueError("HISTORY_NOT_SORTED")
    i = bisect_right(end_times, timestamp_ms) - 1
    if i < 0:
        return None, "NO_COMPLETED_BAR", None, None
    bar = bars[i]
    if bar.symbol != symbol or timestamp_ms - bar.end_ms > max_age_ms:
        return None, "STALE_OR_WRONG_INSTRUMENT", bar.end_ms, None
    decision_day = datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc).astimezone(NY).date()
    bar_day = datetime.fromtimestamp((bar.end_ms - 1) / 1000, timezone.utc).astimezone(NY).date()
    if decision_day != bar_day:
        return None, "PREVIOUS_SESSION_BAR", bar.end_ms, None
    return float(bar.close), "ASOF_HOURLY_PRICE", bar.end_ms, bar.source_sha256


def verified_policy(manifest: Mapping[str, Any], snapshot: Path) -> tuple[dict, str]:
    config = snapshot / "config/v52V50Runtime.json"
    raw = config.read_bytes()
    recorded = next((row["sha256"] for row in manifest["files"]
                     if row["path"] == "config/v52V50Runtime.json"), None)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != recorded:
        raise ValueError("V52_AUDITED_CONFIG_SHA256_MISMATCH")
    policy = json.loads(raw)
    if (policy.get("strategy") != "V50_POST_OPEN_BASIS"
            or policy.get("windowPolicy") != "POST_EARLY3"):
        raise ValueError("V52_UNEXPECTED_AUDITED_POLICY")
    return policy, digest


def model_v50_at_window(
    decision_day: date,
    window: time,
    yahoo: Mapping[str, Sequence[YahooBar]],
    perp: Mapping[str, Sequence[PerpBar]],
    policy: Mapping[str, Any],
    *,
    assumed_round_trip_cost_bps: float = 11.0,
) -> list[dict[str, Any]]:
    """Emit raw per-symbol gate traces with at most one selected price-only model."""
    if window not in V50_WINDOW_TIMES:
        raise ValueError("UNSUPPORTED_V50_WINDOW")
    if not math.isfinite(assumed_round_trip_cost_bps) or assumed_round_trip_cost_bps < 0:
        raise ValueError("INVALID_ASSUMED_COST")
    entered = datetime.combine(decision_day, window, NY).astimezone(timezone.utc)
    capture = entered - timedelta(seconds=10)
    entry_ms = int(entered.timestamp() * 1000)
    capture_ms = int(capture.timestamp() * 1000)
    if decision_day < INITIAL_GAP_END or not is_nyse_core_open(entered):
        return []
    rows: list[dict[str, Any]] = []
    for symbol in sorted(STOCKS):
        gates = {}
        audit = {}
        for stage, timestamp in (("capture", capture_ms), ("entry", entry_ms)):
            reference, ref_status, ref_ts, ref_hash = asof_price(yahoo.get(symbol, ()), symbol, timestamp)
            future, future_status, future_ts, future_hash = asof_price(perp.get(symbol, ()), symbol, timestamp)
            audit[stage] = {
                "yahoo_usd": reference, "aster_perp_usd": future,
                "yahoo_status": ref_status, "aster_status": future_status,
                "yahoo_end_ms": ref_ts, "aster_end_ms": future_ts,
                "yahoo_source_sha256": ref_hash, "aster_source_sha256": future_hash,
            }
            gates[stage.upper() + "_PRICE_ASOF"] = (
                "PASS" if reference is not None and future is not None else "NOT_VERIFIABLE")
        before = audit["capture"]
        after = audit["entry"]
        capture_basis = ((before["aster_perp_usd"] / before["yahoo_usd"] - 1) * 10_000
                         if before["aster_perp_usd"] and before["yahoo_usd"] else None)
        entry_basis = ((after["aster_perp_usd"] / after["yahoo_usd"] - 1) * 10_000
                       if after["aster_perp_usd"] and after["yahoo_usd"] else None)
        reasons = []
        if capture_basis is None or entry_basis is None:
            reasons.append("MISSING_CAUSAL_PRICE_INPUT")
        else:
            if abs(entry_basis) < float(policy["minimumEntryBasisBps"]):
                reasons.append("BASIS_BELOW_MINIMUM")
            if capture_basis * entry_basis <= 0:
                reasons.append("SIGN_CHANGED")
            if max(0.0, abs(entry_basis) - abs(capture_basis)) > 10.0:
                reasons.append("ADVERSE_BASIS_MOVE")
            if assumed_round_trip_cost_bps > float(policy["maximumRoundTripCostBps"]):
                reasons.append("COST_EXCEEDS_MAXIMUM")
            edge = abs(entry_basis) - float(policy["convergenceBps"]) - assumed_round_trip_cost_bps
            if edge < float(policy["minimumNetEdgeBps"]):
                reasons.append("MODEL_NET_EDGE_TOO_SMALL")
        gates["PRICE_ONLY_BASIS_GATE"] = "PASS" if not reasons else "FAIL"
        gates["HISTORICAL_SPREAD_AND_BOOK_DEPTH"] = "BYPASSED_PRICE_ONLY_MODEL"
        gates["MICROSECOND_REFERENCE_AND_PORTFOLIO"] = "NOT_VERIFIABLE"
        rows.append({
            "strategy_id": "V52", "route": "V50_POST_OPEN_BASIS",
            "decision_model": MODEL_ID, "symbol": symbol + "USDT",
            "equity_reference_symbol": symbol, "window_ny": window.strftime("%H:%M"),
            "decision_ts_ms": entry_ms, "capture_ts_ms": capture_ms,
            "source_runtime_sha": None, "capture_basis_bps": capture_basis,
            "entry_basis_bps": entry_basis,
            "side": ("SHORT" if entry_basis > 0 else "LONG") if entry_basis is not None else None,
            "assumed_round_trip_cost_bps": assumed_round_trip_cost_bps,
            "status": "PRICE_ONLY_MODEL_ELIGIBLE" if not reasons else "MODEL_REJECTED",
            "reasons": reasons, "gates": gates, "asof": audit,
            "aster_entry_reference_price_usd": after["aster_perp_usd"],
            "yahoo_entry_reference_price_usd": after["yahoo_usd"],
            "shared_allocation_status": "NOT_EVALUATED",
            "historical_aster_fill_verified": False, "realized_pnl_usdt": None,
        })
    eligible = [row for row in rows if row["status"] == "PRICE_ONLY_MODEL_ELIGIBLE"]
    if eligible:
        winner = sorted(eligible, key=lambda row: (-abs(row["entry_basis_bps"]),
                                                   row["equity_reference_symbol"]))[0]
        winner["status"] = "PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"
        for item in eligible:
            if item is not winner:
                item["status"] = "PRICE_ONLY_MODEL_NOT_TOP_RANK"
    return rows


def run_price_only_scan(
    data_root: Path,
    output_root: Path,
    *,
    manifest_path: Path = Path(__file__).with_name("runtime_source_manifest.json"),
    start: date = START,
    end_exclusive: date = END_EXCLUSIVE,
    assumed_round_trip_cost_bps: float = 11.0,
) -> dict[str, Any]:
    if start >= end_exclusive:
        raise ValueError("INVALID_PERIOD")
    manifest = load_manifest(manifest_path)
    policy, policy_sha = verified_policy(manifest, manifest_path.parent / "runtime_source_snapshot")
    data_root = Path(data_root)
    output_root = Path(output_root)
    yahoo: dict[str, Sequence[YahooBar]] = {}
    perp: dict[str, Sequence[PerpBar]] = {}
    source_hashes: dict[str, str | None] = {}
    for symbol in sorted(STOCKS):
        yp = data_root / "normalized/yahoo/60m" / f"{symbol}.jsonl"
        ap = data_root / "normalized/aster_stock/klines" / f"{symbol}USDT.jsonl"
        yahoo[symbol] = load_yahoo_bars(yp, symbol) if yp.is_file() else ()
        perp[symbol] = read_stock_perp_bars(ap, symbol) if ap.is_file() else ()
        source_hashes["yahoo_" + symbol] = hashlib.sha256(yp.read_bytes()).hexdigest() if yp.is_file() else None
        source_hashes["aster_perp_" + symbol] = hashlib.sha256(ap.read_bytes()).hexdigest() if ap.is_file() else None
    output_root.mkdir(parents=True, exist_ok=True)
    decision_path = output_root / "decisions" / "V52-hourly-price-model.jsonl"
    decision_path.parent.mkdir(parents=True, exist_ok=True)
    counters = Counter()
    with decision_path.open("w", encoding="utf-8") as output:
        day = start
        while day < end_exclusive:
            if nyse_close_utc(day) is not None:
                for window in V50_WINDOW_TIMES:
                    rows = model_v50_at_window(
                        day, window, yahoo, perp, policy,
                        assumed_round_trip_cost_bps=assumed_round_trip_cost_bps)
                    for row in rows:
                        row["source_runtime_sha"] = manifest["runtime_sha"]
                        counters[row["status"]] += 1
                        for reason in row["reasons"]:
                            counters["reason:" + reason] += 1
                        output.write(json.dumps(row, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n")
            day += timedelta(days=1)
    raw = decision_path.read_bytes()
    result = {
        "schema_version": 1, "model": MODEL_ID,
        "status": "RESEARCH_PRICE_ONLY_NOT_LIVE_PARITY",
        "runtime_sha": manifest["runtime_sha"], "runtime_policy_sha256": policy_sha,
        "period_start": start.isoformat(), "period_end_exclusive": end_exclusive.isoformat(),
        "assumed_round_trip_cost_bps": assumed_round_trip_cost_bps,
        "lookahead_guard": "bar_end_ms <= decision_ms, same NY calendar day, max_age_65_minutes",
        "unverified_gates": ["real exchange spread/depth/queue", "second-level reference and Aster mid",
                             "shared portfolio competition", "verified entry and exit fills"],
        "v11_status": "NOT_VERIFIABLE_10_AM_REFERENCE_CAPTURE_FROM_HOURLY_DATA",
        "counts": dict(sorted(counters.items())),
        "source_sha256": source_hashes,
        "decision_output": {"relative_path": "decisions/V52-hourly-price-model.jsonl",
                            "rows": sum(v for k, v in counters.items() if not k.startswith("reason:")),
                            "sha256": hashlib.sha256(raw).hexdigest()},
        "profit_metrics": None,
    }
    (output_root / "price-only-scan-manifest.json").write_text(
        json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--estimated-cost-bps", type=float, default=11.0)
    args = parser.parse_args()
    result = run_price_only_scan(
        args.data_root, args.output_root, assumed_round_trip_cost_bps=args.estimated_cost_bps)
    print(json.dumps({"status": result["status"], "counts": result["counts"],
                      "unverified_gates": result["unverified_gates"]}, sort_keys=True))


if __name__ == "__main__":
    main()
