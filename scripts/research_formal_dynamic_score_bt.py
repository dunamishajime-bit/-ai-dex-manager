"""Auditable dynamic-score replay helpers for the recovered formal H1 archive.

This module is research-only.  It never reads credentials, talks to a venue, or
changes a live runtime.  The full replay entry point is added below the pure
causal scoring and allocation helpers so the latter can be tested without
loading the archived replay package.
"""

from __future__ import annotations

import argparse
from bisect import bisect_right
import copy
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import heapq
import importlib
import importlib.util
import json
import math
from pathlib import Path
import sys
from typing import Any, Iterable, Sequence


HOUR_MS = 3_600_000
DAY_MS = 24 * HOUR_MS
DEFAULT_MAX_BT_BONUS = 10.0
MIN_CONFIDENT_TRADES = 50.0
FULL_OBSERVATION_DAYS = 90.0
PENGU_HARD_CAP = 0.75
PERIOD_START_MS = int(datetime(2025, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)
PERIOD_END_MS = int(datetime(2026, 8, 10, tzinfo=timezone.utc).timestamp() * 1000)
CRYPTO_GROSS_CAP = 3.0
STOCK_GROSS_CAP = 4.0
TOTAL_GROSS_CAP = 4.25
DAILY_LOSS_LIMIT = 0.075
FET_MIN = 0.05
MIN_ORDER_NOTIONAL_USD = 5.0
STRATEGY_PRIORITY = {"V52": 0, "PENGU": 1, "V12": 2, "Q102": 3, "FET": 4}
STRATEGY_CAPS = {"V12": 2.0, "PENGU": PENGU_HARD_CAP, "Q102": 3.0, "FET": 1.0, "V52": 4.0}
Q102_FAMILY_CAPS = {"HIGH_VOL": 1.0, "MR": 0.75, "BRK": 0.75, "REV": 1.5, "PB": 2.0}


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _normalised(value: Any) -> float:
    number = _finite(value, math.nan)
    if not math.isfinite(number):
        return 0.0
    return min(1.0, max(0.0, number))


def _value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def _completed_return72h(entry_ts_ms: int, market_rows: Sequence[dict[str, Any]]) -> float | None:
    by_ts = {int(row["event_time_ms"]): _finite(row.get("close"), math.nan) for row in market_rows}
    last = by_ts.get(int(entry_ts_ms) - HOUR_MS)
    prior = by_ts.get(int(entry_ts_ms) - 73 * HOUR_MS)
    if last is None or prior is None or not (math.isfinite(last) and math.isfinite(prior) and prior > 0):
        return None
    return last / prior - 1.0


def _signal_entry_ts(signal_row: dict[str, Any]) -> int | None:
    signal = signal_row.get("signal")
    if not isinstance(signal, dict):
        return None
    raw = _value(signal, "entryTs", "entry_ts_ms")
    return int(raw) if isinstance(raw, (int, float)) and math.isfinite(float(raw)) else None


def market_fit_for_candidate(
    candidate: dict[str, Any],
    signal_rows: Sequence[dict[str, Any]],
    market_rows: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    """Return the same causal score family used by live entry approval.

    V12 uses its completed signal score.  FET uses the completed volume ratio
    and the exact completed H1 72-hour return used by ``fetCompletedReturn72h``.
    Other recovered strategies deliberately use the named live neutral
    fallback because their current live contract has no comparable score.
    """

    strategy = str(candidate.get("strategy_id") or candidate.get("strategy") or "")
    entry_ts = int(candidate.get("entry_ts_ms") or 0)
    signal_ts = int(candidate.get("signal_ts_ms") or entry_ts)
    if strategy == "V12":
        for row in signal_rows:
            row_symbol = str(row.get("symbol") or "").upper()
            candidate_symbol = str(candidate.get("symbol") or "").upper()
            row_ts = int(row.get("reference_ts_ms") or row.get("entry_ts_ms") or row.get("decision_ts_ms") or 0)
            if row_ts != signal_ts and row_ts != entry_ts:
                continue
            if row_symbol and candidate_symbol and row_symbol != candidate_symbol:
                continue
            nested = row.get("candidate") if isinstance(row.get("candidate"), dict) else row.get("signal")
            if not isinstance(nested, dict):
                continue
            raw_score = _value(nested, "score", "marketFitScore", "market_fit_score")
            if isinstance(raw_score, (int, float)) and math.isfinite(float(raw_score)):
                return {
                    "value": max(0.0, float(raw_score)),
                    "source": "V12_COMPLETED_SIGNAL_SCORE_V1",
                }
        return {"value": 50.0, "source": "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1"}

    if strategy == "FET":
        for row in signal_rows:
            if _signal_entry_ts(row) != entry_ts:
                continue
            signal = row.get("signal")
            if not isinstance(signal, dict):
                continue
            volume_ratio = _value(signal, "volumeRatio", "volume_ratio")
            return72h = _completed_return72h(entry_ts, market_rows)
            if isinstance(volume_ratio, (int, float)) and math.isfinite(float(volume_ratio)) and return72h is not None:
                return {
                    "value": max(0.0, min(100.0, 50.0 + 5.0 * float(volume_ratio) + 100.0 * return72h)),
                    "source": "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1",
                    "volumeRatio": float(volume_ratio),
                    "return72h": return72h,
                }
        return {"value": 50.0, "source": "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1"}

    return {"value": 50.0, "source": "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1"}


def _prior_metrics(prior_rows: Sequence[dict[str, Any]], cost_bps: float) -> dict[str, float]:
    returns: list[float] = []
    for row in prior_rows:
        gross_return = _finite(_value(row, "unit_price_return", "gross_price_return"), math.nan)
        funding = _finite(row.get("funding_return_per_gross"), 0.0)
        if not math.isfinite(gross_return):
            continue
        returns.append(gross_return + funding - cost_bps / 10_000.0)
    if not returns:
        return {
            "returnPct": 0.0,
            "profitFactor": 0.0,
            "winRatePct": 0.0,
            "maxDrawdownPct": 0.0,
            "tradeCount": 0.0,
            "observationDays": 0.0,
        }
    gains = sum(value for value in returns if value > 0)
    losses = -sum(value for value in returns if value < 0)
    equity = 1.0
    peak = equity
    max_drawdown = 0.0
    for value in returns:
        equity *= 1.0 + value
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = min(max_drawdown, equity / peak - 1.0)
    signal_times = [int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0) for row in prior_rows]
    observation_days = (max(signal_times) - min(signal_times)) / DAY_MS if signal_times else 0.0
    return {
        "returnPct": sum(returns) * 100.0,
        # A wins-only prior has no finite PF denominator.  Preserve that fact
        # as JSON null; never emit +/-inf into an auditable artifact.
        "profitFactor": gains / losses if losses > 0 else (None if gains > 0 else 0.0),
        "winRatePct": sum(value > 0 for value in returns) / len(returns) * 100.0,
        "maxDrawdownPct": abs(max_drawdown) * 100.0,
        "tradeCount": float(len(returns)),
        "observationDays": observation_days,
    }


def build_rolling_prior_table(rows: Iterable[dict[str, Any]], round_trip_cost_bps: float) -> dict[str, Any]:
    """Build a frozen, causal prior table from already closed earlier rows.

    The row for a candidate can only use a same-strategy trade whose exit is
    at or before that candidate's signal timestamp.  The table is versioned so
    it cannot be mistaken for a live-updated prior.
    """

    source_rows = [dict(row) for row in rows]
    source_rows.sort(key=lambda row: (int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0), str(row.get("strategy_id"))))
    result: dict[str, Any] = {
        "version": "rolling-closed-trades/v1",
        "trainingPeriod": {"start": None, "end": None},
        "roundTripCostBps": float(round_trip_cost_bps),
        "source": "formal-recovered-candidate-ledger-only-closed-before-signal",
        "rows": {},
    }
    valid_times = [int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0) for row in source_rows if int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0) > 0]
    if valid_times:
        result["trainingPeriod"] = {"startMs": min(valid_times), "endMsExclusive": max(valid_times)}

    for index, current in enumerate(source_rows):
        strategy = str(current.get("strategy_id") or current.get("strategy") or "UNKNOWN")
        signal_ts = int(current.get("signal_ts_ms") or current.get("entry_ts_ms") or 0)
        prior = [
            row for prior_index, row in enumerate(source_rows)
            if prior_index != index
            and str(row.get("strategy_id") or row.get("strategy") or "UNKNOWN") == strategy
            and int(row.get("exit_ts_ms") or 0) > 0
            and int(row.get("exit_ts_ms") or 0) <= signal_ts
            and int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0) < signal_ts
        ]
        row_id = f"{strategy}:{signal_ts}"
        result["rows"][row_id] = {
            "strategy": strategy,
            "signalTsMs": signal_ts,
            "priorIds": [f"{strategy}:{int(row.get('signal_ts_ms') or row.get('entry_ts_ms') or 0)}" for row in prior],
            "metrics": _prior_metrics(prior, round_trip_cost_bps),
        }
    return result


def calculate_bt_prior_bonus(metrics: dict[str, Any] | None, max_bonus: float = DEFAULT_MAX_BT_BONUS) -> float:
    if not isinstance(metrics, dict):
        return 0.0
    return_pct = _finite(metrics.get("returnPct"), math.nan)
    profit_factor = _finite(metrics.get("profitFactor"), math.nan)
    win_rate_pct = _finite(metrics.get("winRatePct"), math.nan)
    max_drawdown_pct = _finite(metrics.get("maxDrawdownPct"), math.nan)
    trade_count = _finite(metrics.get("tradeCount"), math.nan)
    observation_days = _finite(metrics.get("observationDays"), math.nan)
    performance = (
        0.30 * _normalised(return_pct / 50.0 if math.isfinite(return_pct) else math.nan)
        + 0.25 * _normalised((profit_factor - 1.0) / 2.0 if math.isfinite(profit_factor) else math.nan)
        + 0.20 * _normalised((win_rate_pct - 50.0) / 30.0 if math.isfinite(win_rate_pct) else math.nan)
        + 0.25 * _normalised(1.0 - max_drawdown_pct / 50.0 if math.isfinite(max_drawdown_pct) else math.nan)
    )
    confidence = _normalised(trade_count / MIN_CONFIDENT_TRADES if math.isfinite(trade_count) else math.nan)
    horizon = _normalised(observation_days / FULL_OBSERVATION_DAYS if math.isfinite(observation_days) else math.nan)
    return max(0.0, _finite(max_bonus)) * performance * confidence * horizon


def _candidate_score(candidate: dict[str, Any]) -> tuple[float, float]:
    bonus = calculate_bt_prior_bonus(candidate.get("btPrior"))
    score = _finite(candidate.get("marketFitScore")) + bonus
    score -= max(0.0, _finite(candidate.get("correlationPenalty")))
    score -= max(0.0, _finite(candidate.get("concentrationPenalty")))
    score -= max(0.0, _finite(candidate.get("stalePenalty")))
    return bonus, score


def allocate_dynamic_candidates(
    candidates: Sequence[dict[str, Any]],
    *,
    crypto_available: float,
    stock_available: float,
    total_available: float,
    equity_usd: float,
    strategy_available: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Allocate minimums then score-weighted target headroom in gross units."""

    class_remaining = {
        "CRYPTO": max(0.0, _finite(crypto_available)),
        "STOCK": max(0.0, _finite(stock_available)),
    }
    total_remaining = max(0.0, _finite(total_available))
    strategy_remaining = defaultdict(lambda: float("inf"))
    if strategy_available:
        for strategy, amount in strategy_available.items():
            strategy_remaining[str(strategy)] = max(0.0, _finite(amount))
    rejected: list[dict[str, Any]] = []
    eligible: list[dict[str, Any]] = []
    strategy_caps = {"V12": 2.0, "PENGU": PENGU_HARD_CAP, "Q102": 3.0, "FET": 1.0, "V52": 4.0}

    for candidate in candidates:
        row = dict(candidate)
        candidate_id = str(row.get("id") or row.get("candidate_id") or "")
        asset_class = str(row.get("asset_class") or row.get("assetClass") or "")
        if asset_class not in class_remaining:
            rejected.append({"id": candidate_id, "reason": "INVALID_ASSET_CLASS"})
            continue
        strategy = str(row.get("strategy_id") or row.get("strategy") or "")
        hard_cap = strategy_caps.get(strategy, float("inf"))
        minimum = max(0.0, _finite(row.get("minGross") if "minGross" in row else row.get("min_gross")))
        target = max(0.0, _finite(row.get("targetGross") if "targetGross" in row else row.get("target_gross")))
        maximum = max(0.0, _finite(row.get("maxGross") if "maxGross" in row else row.get("max_gross")))
        minimum = min(minimum, hard_cap)
        target = min(target, hard_cap)
        maximum = min(maximum, hard_cap)
        min_notional = row.get("minNotionalUsd", row.get("min_notional_usd"))
        if min_notional is not None:
            if not isinstance(min_notional, (int, float)) or isinstance(min_notional, bool) or not math.isfinite(float(min_notional)) or not (equity_usd > 0):
                rejected.append({"id": candidate_id, "reason": "MIN_NOTIONAL_NOT_MET"})
                continue
            minimum = max(minimum, float(min_notional) / equity_usd)
        if not (minimum > 0 and maximum + 1e-12 >= minimum and class_remaining[asset_class] + 1e-12 >= minimum and total_remaining + 1e-12 >= minimum and strategy_remaining[strategy] + 1e-12 >= minimum):
            rejected.append({"id": candidate_id, "reason": "MIN_GROSS_NOT_MET"})
            continue
        bonus, score = _candidate_score(row)
        row.update({
            "id": candidate_id,
            "strategy_id": strategy,
            "asset_class": asset_class,
            "btPriorBonus": bonus,
            "finalScore": score,
            "minGross": minimum,
            "targetGross": max(minimum, min(target, maximum)),
            "maxGross": maximum,
            "allocatedGross": 0.0,
        })
        eligible.append(row)

    eligible.sort(key=lambda row: (-_finite(row.get("finalScore")), str(row.get("id"))))
    admitted: list[dict[str, Any]] = []
    for row in eligible:
        minimum = _finite(row.get("minGross"))
        if minimum > class_remaining[row["asset_class"]] + 1e-12 or minimum > total_remaining + 1e-12:
            rejected.append({"id": row["id"], "reason": "MIN_GROSS_NOT_MET"})
            continue
        row["allocatedGross"] = minimum
        class_remaining[row["asset_class"]] -= minimum
        total_remaining -= minimum
        strategy_remaining[row["strategy_id"]] -= minimum
        admitted.append(row)

    for _ in range(max(1, len(admitted))):
        open_rows = [
            row for row in admitted
            if row["allocatedGross"] < row["targetGross"] - 1e-12
            and class_remaining[row["asset_class"]] > 1e-12
            and strategy_remaining[row["strategy_id"]] > 1e-12
            and _finite(row.get("finalScore")) > 0
        ]
        if not open_rows or total_remaining <= 1e-12:
            break
        weights = {id(row): _finite(row.get("finalScore")) * max(0.0, row["targetGross"] - row["allocatedGross"]) for row in open_rows}
        weight_sum = sum(weights.values())
        if weight_sum <= 0:
            break
        distributed = 0.0
        proposals = [(row, total_remaining * weights[id(row)] / weight_sum) for row in open_rows]
        class_proposals = defaultdict(float)
        strategy_proposals = defaultdict(float)
        for row, amount in proposals:
            class_proposals[row["asset_class"]] += amount
            strategy_proposals[row["strategy_id"]] += amount
        scales = {
            name: min(1.0, class_remaining[name] / amount) if amount > 0 else 1.0
            for name, amount in class_proposals.items()
        }
        strategy_scales = {
            name: min(1.0, strategy_remaining[name] / amount) if amount > 0 else 1.0
            for name, amount in strategy_proposals.items()
        }
        for row, proposal in proposals:
            amount = min(
                proposal * scales[row["asset_class"]] * strategy_scales[row["strategy_id"]],
                row["targetGross"] - row["allocatedGross"],
                strategy_remaining[row["strategy_id"]],
            )
            row["allocatedGross"] += amount
            class_remaining[row["asset_class"]] -= amount
            strategy_remaining[row["strategy_id"]] -= amount
            distributed += amount
        total_remaining -= distributed
        if distributed <= 1e-12:
            break

    allocations = [dict(row) for row in admitted]
    totals = {
        "cryptoGross": sum(_finite(row.get("allocatedGross")) for row in allocations if row["asset_class"] == "CRYPTO"),
        "stockGross": sum(_finite(row.get("allocatedGross")) for row in allocations if row["asset_class"] == "STOCK"),
    }
    totals["totalGross"] = totals["cryptoGross"] + totals["stockGross"]
    rejected.sort(key=lambda row: str(row["id"]))
    return {"allocations": allocations, "rejected": rejected, "totals": totals, "residual": {
        "cryptoGross": max(0.0, _finite(crypto_available) - totals["cryptoGross"]),
        "stockGross": max(0.0, _finite(stock_available) - totals["stockGross"]),
        "totalGross": max(0.0, _finite(total_available) - totals["totalGross"]),
    }}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"INVALID_JSONL:{path}:{line_number}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"JSONL_ROW_NOT_OBJECT:{path}:{line_number}")
            rows.append(value)
    return rows


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_recovered_replay_module(source_root: Path):
    """Load the archived replay implementation without copying or modifying it."""

    source_root = Path(source_root).resolve()
    package_name = f"formal_replay_{hashlib.sha1(str(source_root).encode()).hexdigest()[:12]}"
    if package_name not in sys.modules:
        init_path = source_root / "__init__.py"
        spec = importlib.util.spec_from_file_location(
            package_name, init_path, submodule_search_locations=[str(source_root)]
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"FORMAL_REPLAY_PACKAGE_LOAD_FAILED:{source_root}")
        package = importlib.util.module_from_spec(spec)
        sys.modules[package_name] = package
        spec.loader.exec_module(package)
    return importlib.import_module(f"{package_name}.portfolio_price_model")


def load_formal_candidates(candidate_ledger: Path, v52_ledger_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load the recovered crypto candidates and the SHA-pinned V52 ledger."""

    candidates = _read_jsonl(Path(candidate_ledger))
    v52_root = Path(v52_ledger_root)
    v52_rows = _read_jsonl(v52_root / "v52-model-ledger.jsonl")
    v52_summary = json.loads((v52_root / "v52-model-summary.json").read_text(encoding="utf-8"))
    assumed_gross = float(v52_summary.get("assumed_single_slot_gross") or 2.0)
    for row in v52_rows:
        status = row.get("status")
        if status == "SKIPPED_CANDIDATE":
            candidates.append({
                "strategy_id": "V52",
                "symbol": row.get("symbol"),
                "side": row.get("side"),
                "entry_ts_ms": int(row.get("decision_ts_ms") or 0),
                "signal_ts_ms": int(row.get("decision_ts_ms") or 0),
                "status": "V52_PREALLOCATION_SKIPPED",
                "exclusion_reason": str(row.get("reason") or "SKIPPED_CANDIDATE"),
                "requested_gross": assumed_gross,
                "entry_price": row.get("aster_entry_price_usd"),
                "v52_source_session": row.get("session"),
            })
        elif status == "MODELED_CLOSED_TRADE":
            candidates.append({
                "strategy_id": "V52",
                "symbol": row.get("symbol"),
                "side": row.get("side"),
                "entry_ts_ms": int(row["entry_ts_ms"]),
                "signal_ts_ms": int(row["entry_ts_ms"]),
                "entry_price": float(row["aster_entry_price_usd"]),
                "requested_gross": float(row.get("slot_gross") or 2.0),
                "status": "MODELED_CLOSED_TRADE",
                "exit_ts_ms": int(row["exit_ts_ms"]),
                "exit_price": float(row["aster_exit_price_usd"]),
                "exit_reason": row.get("reason") or row.get("exit_reason") or "V52_MODELED_EXIT",
                "unit_price_return": float(row.get("gross_price_return") or 0.0),
                "route": "V50_POST_OPEN_BASIS",
                "v52_entry_basis_bps": row.get("entry_basis_bps"),
                "v52_yahoo_entry_reference_usd": row.get("yahoo_entry_reference_usd"),
                "v52_source_session": row.get("session"),
            })
    candidates.sort(key=lambda row: (
        int(row.get("entry_ts_ms") or 0),
        STRATEGY_PRIORITY.get(str(row.get("strategy_id")), 99),
        str(row.get("symbol") or ""),
    ))
    for index, row in enumerate(candidates, start=1):
        row["_model_candidate_id"] = f"C{index:06d}"
    return candidates, {
        "v52Status": v52_summary.get("status"),
        "v52Summary": v52_summary,
        "candidateCount": len(candidates),
    }


def attach_causal_scores_and_prior(
    candidates: list[dict[str, Any]],
    *,
    signal_paths: dict[str, Path],
    market_by_symbol: dict[str, list[dict[str, Any]]],
    round_trip_cost_bps: float,
) -> dict[str, Any]:
    signal_rows = {strategy: _read_jsonl(path) for strategy, path in signal_paths.items() if Path(path).is_file()}
    prior_source_rows = [
        row for row in candidates
        if row.get("status") == "MODELED_CLOSED_TRADE"
        and int(row.get("exit_ts_ms") or 0) > 0
    ]
    prior_table = build_rolling_prior_table(prior_source_rows, round_trip_cost_bps)
    score_counts: Counter[str] = Counter()
    for row in candidates:
        strategy = str(row.get("strategy_id") or "")
        score = market_fit_for_candidate(
            row,
            signal_rows.get(strategy, []),
            market_by_symbol.get(str(row.get("symbol") or ""), []),
        )
        row["marketFitScore"] = score["value"]
        row["marketFitScoreSource"] = score["source"]
        if "return72h" in score:
            row["marketFitReturn72h"] = score["return72h"]
        if "volumeRatio" in score:
            row["marketFitVolumeRatio"] = score["volumeRatio"]
        score_counts[score["source"]] += 1
        signal_ts = int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or 0)
        prior_key = f"{strategy}:{signal_ts}"
        prior_row = prior_table["rows"].get(prior_key)
        if prior_row and prior_row["metrics"]["tradeCount"] > 0:
            row["btPrior"] = prior_row["metrics"]
            row["btPriorVersion"] = prior_table["version"]
    return {"priorTable": prior_table, "scoreCounts": dict(score_counts), "signalRows": signal_rows}


def _q102_family_cap(candidate: dict[str, Any]) -> float:
    family = str(candidate.get("family") or "").upper()
    return Q102_FAMILY_CAPS.get(family, STRATEGY_CAPS["Q102"])


def _research_cap(candidate: dict[str, Any]) -> float:
    strategy = str(candidate.get("strategy_id") or "")
    if strategy == "Q102":
        return _q102_family_cap(candidate)
    return STRATEGY_CAPS.get(strategy, 0.0)


def _asset_class(candidate: dict[str, Any]) -> str:
    return "STOCK" if str(candidate.get("strategy_id") or "") == "V52" else "CRYPTO"


def _intent_bounds(candidate: dict[str, Any], equity: float, strategy_room: float) -> dict[str, Any]:
    strategy = str(candidate.get("strategy_id") or "")
    cap = _research_cap(candidate)
    requested = min(max(0.0, _finite(candidate.get("requested_gross"))), cap, max(0.0, strategy_room))
    if strategy == "V12":
        per_position_cap = 1.0
        minimum = 1.0 / equity if equity > 0 else math.inf
    elif strategy == "PENGU":
        per_position_cap = PENGU_HARD_CAP
        # Recovery V8 has an audited 0.50x first leg.  The new 0.75x value is
        # a hard ceiling; it must not erase that existing protective sizing.
        minimum = min(requested, PENGU_HARD_CAP)
    elif strategy == "Q102":
        per_position_cap = cap
        minimum = MIN_ORDER_NOTIONAL_USD / equity if equity > 0 else math.inf
    elif strategy == "FET":
        per_position_cap = 1.0
        minimum = max(FET_MIN, MIN_ORDER_NOTIONAL_USD / equity) if equity > 0 else math.inf
    else:
        per_position_cap = 2.0
        minimum = MIN_ORDER_NOTIONAL_USD / equity if equity > 0 else math.inf
    target = min(requested, per_position_cap)
    return {
        **candidate,
        "id": str(candidate["_model_candidate_id"]),
        "strategy_id": strategy,
        "asset_class": _asset_class(candidate),
        "marketFitScore": _finite(candidate.get("marketFitScore"), 50.0),
        "btPrior": candidate.get("btPrior"),
        "targetGross": target,
        "minGross": minimum,
        "maxGross": min(per_position_cap, cap, max(0.0, strategy_room)),
    }


def _dynamic_portfolio_scenario(
    candidates: list[dict[str, Any]],
    data_root: Path,
    replay: Any,
    *,
    round_trip_cost_bps: float,
    scenario_id: str,
    fx_series: list[tuple[int, float]] | None,
) -> dict[str, Any]:
    """Replay the formal candidate tape with dynamic allocation at each entry.

    Exit, funding, cash, MTM, daily-loss and PENGU lifecycle behavior follows
    the recovered portfolio replay contract.  Only the admission order and
    gross sizing are changed: hard-gated candidates are collected for one
    timestamp, then passed through the tested score allocator as one cycle.
    """

    cost_side = round_trip_cost_bps / 2.0 / 10_000.0
    deposits = replay._monthly_deposits()
    currency = "USD" if fx_series is not None else "NOMINAL_JPY"
    rate_at = (lambda ts: replay.asof_jpy_per_usd(fx_series, ts)) if fx_series is not None else (lambda _ts: 1.0)
    modeled_rows = [row for row in candidates if row.get("status") == "MODELED_CLOSED_TRADE"]
    symbols = {str(row["symbol"]) for row in modeled_rows if row.get("symbol")}
    market = replay._market(Path(data_root), symbols)

    candidate_decisions: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)

    def record_decision(candidate: dict[str, Any], decision: str, reason: str, ts: int, **details: Any) -> None:
        candidate_decisions.append({
            "candidate_id": candidate["_model_candidate_id"],
            "strategy_id": candidate.get("strategy_id"),
            "symbol": candidate.get("symbol"),
            "side": candidate.get("side"),
            "route": candidate.get("route"),
            "entry_version": candidate.get("entry_version"),
            "family": candidate.get("family"),
            "rank": candidate.get("rank"),
            "signal_ts_ms": candidate.get("signal_ts_ms"),
            "entry_ts_ms": candidate.get("entry_ts_ms"),
            "candidate_entry_price_usd": candidate.get("entry_price"),
            "candidate_exit_ts_ms": candidate.get("exit_ts_ms"),
            "candidate_exit_price_usd": candidate.get("exit_price"),
            "requested_gross": candidate.get("requested_gross"),
            "market_fit_score": candidate.get("marketFitScore"),
            "market_fit_score_source": candidate.get("marketFitScoreSource"),
            "bt_prior_version": candidate.get("btPriorVersion"),
            "upstream_status": candidate.get("status"),
            "decision_ts_ms": ts,
            "decision": decision,
            "reason": reason,
            **details,
        })

    for row in candidates:
        if (row.get("status") == "MODELED_CLOSED_TRADE"
                and PERIOD_START_MS <= int(row.get("entry_ts_ms") or 0) < PERIOD_END_MS
                and int(row.get("exit_ts_ms") or 0) <= PERIOD_END_MS):
            by_entry[int(row["entry_ts_ms"])].append(row)
        else:
            record_decision(
                row,
                "EXCLUDED_PREALLOCATION",
                str(row.get("exclusion_reason") or row.get("status") or "UNKNOWN"),
                int(row.get("signal_ts_ms") or row.get("entry_ts_ms") or PERIOD_START_MS),
            )

    candidate_times = sorted(by_entry)
    deposit_times = sorted(deposits)
    candidate_i = 0
    deposit_i = 0
    scheduled: list[tuple[int, int, str, int, Any]] = []
    sequence = 0
    wallet = 0.0
    deposited_units = 0.0
    active: dict[int, dict[str, Any]] = {}
    next_position_id = 1
    completed: list[dict[str, Any]] = []
    event_cashflow: dict[int, float] = defaultdict(float)
    rejected = Counter()
    pengu_route_until: dict[str, int] = defaultdict(int)
    pengu_hold_until = 0
    pengu_cooldown_until = 0
    pengu_risk_equity = 1.0
    pengu_risk_peak = 1.0
    daily_pnl: dict[str, float] = defaultdict(float)
    daily_start_equity: dict[str, float] = {}
    daily_blocked: set[str] = set()
    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)
    allocation_rows: list[dict[str, Any]] = []
    allocation_rejections: list[dict[str, Any]] = []

    def push(ts: int, order: int, kind: str, pid: int, payload: Any = None) -> None:
        nonlocal sequence
        sequence += 1
        heapq.heappush(scheduled, (ts, order, kind, pid, (sequence, payload)))

    def record_day_pnl(ts: int, amount: float) -> None:
        day = replay._day(ts)
        if day not in daily_start_equity:
            daily_start_equity[day] = max(1e-9, replay._equity(wallet, active, market, ts))
        daily_pnl[day] += amount
        if daily_pnl[day] / max(daily_start_equity[day], 1e-9) <= -DAILY_LOSS_LIMIT:
            daily_blocked.add(day)

    def finalize_position(pid: int, ts: int, exit_price: float, reason: str) -> None:
        nonlocal wallet, pengu_risk_equity, pengu_risk_peak, pengu_hold_until, pengu_cooldown_until
        position = active.pop(pid, None)
        if not position:
            return
        quantity = position["quantity"]
        price_pnl = replay._side_sign(position["side"]) * quantity * (exit_price - position["entry_price"])
        exit_fee = abs(quantity * exit_price) * cost_side
        cash = price_pnl - exit_fee
        wallet += cash
        event_cashflow[ts] += cash
        position["price_pnl"] += price_pnl
        position["exit_fee"] += exit_fee
        total = position["price_pnl"] + position["funding_pnl"] - position["entry_fee"] - position["exit_fee"]
        position.update({
            "exit_ts_ms": ts,
            "exit_price": exit_price,
            "exit_reason_actual": reason,
            "total_pnl_jpy": total,
            "wallet_after_exit": wallet,
            "modeled_realized_pnl_jpy_at_exit_fx": total * rate_at(ts),
            "reference_fx_exit_jpy_per_usd": rate_at(ts),
            "settlement_currency": currency,
            "historical_fill_verified": False,
        })
        completed.append(position)
        events.append({
            "event_type": "MODELED_EXIT",
            "ts_ms": ts,
            "candidate_id": position.get("candidate_id"),
            "position_id": pid,
            "strategy_id": position["strategy_id"],
            "symbol": position["symbol"],
            "side": position["side"],
            "quantity": quantity,
            "modeled_price_usd": exit_price,
            "fee_settlement": exit_fee,
            "price_pnl_settlement": price_pnl,
            "net_cashflow_settlement": cash,
            "total_trade_pnl_settlement": total,
            "reference_fx_jpy_per_usd": rate_at(ts),
            "exit_reason": reason,
            "wallet_after_event": wallet,
            "historical_fill_verified": False,
        })
        record_day_pnl(ts, cash)
        if position["strategy_id"] == "V12":
            v12_cooldown_by_symbol[position["symbol"]] = ts + 2 * replay.HOUR
        if position["strategy_id"] == "PENGU":
            account_return = total / max(position["entry_equity"], 1e-9)
            pengu_risk_equity *= 1.0 + account_return
            pengu_risk_peak = max(pengu_risk_peak, pengu_risk_equity)
            if pengu_risk_equity / pengu_risk_peak - 1.0 <= -0.17:
                pengu_hold_until = max(pengu_hold_until, ts + 72 * replay.HOUR)
            hard = "HARD_STOP" in reason
            pengu_cooldown_until = max(pengu_cooldown_until, ts + (24 if hard else 6) * replay.HOUR)
            if hard:
                route = position.get("route") or "BASE_V64_LONG"
                pengu_route_until[route] = max(pengu_route_until[route], ts + 60 * replay.HOUR)

    def preempt_fet(ts: int, reason: str) -> bool:
        fet_rows = [(pid, row) for pid, row in active.items() if row["strategy_id"] == "FET"]
        if not fet_rows:
            return False
        pid, position = fet_rows[0]
        mark = replay._mark(market, position["symbol"], ts)
        if mark is None:
            return False
        finalize_position(pid, ts, mark, reason)
        return True

    while True:
        next_candidate = candidate_times[candidate_i] if candidate_i < len(candidate_times) else math.inf
        next_deposit = deposit_times[deposit_i] if deposit_i < len(deposit_times) else math.inf
        next_scheduled = scheduled[0][0] if scheduled else math.inf
        ts = min(next_candidate, next_deposit, next_scheduled)
        if not math.isfinite(ts) or ts >= PERIOD_END_MS:
            break

        while deposit_i < len(deposit_times) and deposit_times[deposit_i] == ts:
            amount_jpy = deposits[ts]
            amount_units = amount_jpy / rate_at(ts)
            wallet += amount_units
            deposited_units += amount_units
            event_cashflow[ts] += amount_units
            events.append({
                "event_type": "MONTHLY_CONTRIBUTION",
                "ts_ms": ts,
                "contribution_jpy": amount_jpy,
                "settlement_currency": currency,
                "settlement_cashflow": amount_units,
                "reference_fx_jpy_per_usd": rate_at(ts),
                "wallet_after_event": wallet,
            })
            deposit_i += 1
        day = replay._day(ts)
        if day not in daily_start_equity:
            daily_start_equity[day] = max(1e-9, replay._equity(wallet, active, market, ts))

        while scheduled and scheduled[0][0] == ts:
            _, _, kind, pid, wrapped = heapq.heappop(scheduled)
            _, payload = wrapped
            position = active.get(pid)
            if not position:
                continue
            if kind == "funding":
                mark = replay._mark(market, position["symbol"], ts)
                if mark is None:
                    position["coverage_failures"].append(f"FUNDING_MARK_MISSING:{ts}")
                    continue
                rate = float(payload)
                cash = -replay._side_sign(position["side"]) * abs(position["quantity"] * mark) * rate
                wallet += cash
                event_cashflow[ts] += cash
                position["funding_pnl"] += cash
                events.append({
                    "event_type": "FUNDING",
                    "ts_ms": ts,
                    "position_id": pid,
                    "candidate_id": position.get("candidate_id"),
                    "strategy_id": position["strategy_id"],
                    "symbol": position["symbol"],
                    "funding_rate": rate,
                    "modeled_mark_price_usd": mark,
                    "cashflow_settlement": cash,
                    "reference_fx_jpy_per_usd": rate_at(ts),
                    "wallet_after_event": wallet,
                })
                record_day_pnl(ts, cash)
            elif kind == "partial":
                fraction = min(1.0, max(0.0, float(payload.get("quantityFraction") or 0.5)))
                close_qty = position["quantity"] * fraction
                price = float(payload["price"])
                price_pnl = replay._side_sign(position["side"]) * close_qty * (price - position["entry_price"])
                fee = abs(close_qty * price) * cost_side
                cash = price_pnl - fee
                wallet += cash
                event_cashflow[ts] += cash
                position["price_pnl"] += price_pnl
                position["exit_fee"] += fee
                position["quantity"] -= close_qty
                position["partial_actual"] = {"ts": ts, "price": price, "fraction": fraction}
                events.append({
                    "event_type": "MODELED_PARTIAL_EXIT",
                    "ts_ms": ts,
                    "candidate_id": position.get("candidate_id"),
                    "position_id": pid,
                    "strategy_id": position["strategy_id"],
                    "symbol": position["symbol"],
                    "quantity": close_qty,
                    "modeled_price_usd": price,
                    "fraction": fraction,
                    "price_pnl_settlement": price_pnl,
                    "fee_settlement": fee,
                    "net_cashflow_settlement": cash,
                    "reference_fx_jpy_per_usd": rate_at(ts),
                    "wallet_after_event": wallet,
                    "historical_fill_verified": False,
                })
                record_day_pnl(ts, cash)
            elif kind == "exit":
                finalize_position(pid, ts, float(position["planned_exit_price"]), str(position["planned_exit_reason"]))

        if candidate_i < len(candidate_times) and candidate_times[candidate_i] == ts:
            hard_eligible: list[dict[str, Any]] = []
            for candidate in sorted(by_entry[ts], key=lambda row: (STRATEGY_PRIORITY.get(str(row["strategy_id"]), 99), str(row.get("symbol") or ""))):
                strategy = str(candidate["strategy_id"])
                cap = _research_cap(candidate)
                if cap <= 0:
                    record_decision(candidate, "REJECTED_RESEARCH_POLICY", f"{strategy}:CAP_ZERO", ts)
                    rejected[f"{strategy}:CAP_ZERO"] += 1
                    continue
                if day in daily_blocked:
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:SHARED_DAILY_LOSS", ts)
                    rejected[f"{strategy}:SHARED_DAILY_LOSS"] += 1
                    continue
                if strategy == "PENGU":
                    route = candidate.get("route") or "BASE_V64_LONG"
                    if ts < pengu_cooldown_until:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:COOLDOWN", ts)
                        rejected["PENGU:COOLDOWN"] += 1
                        continue
                    if ts < pengu_hold_until:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:DD_HOLD", ts)
                        rejected["PENGU:DD_HOLD"] += 1
                        continue
                    if ts < pengu_route_until[route]:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "PENGU:ROUTE_QUARANTINE", ts)
                        rejected["PENGU:ROUTE_QUARANTINE"] += 1
                        continue
                if strategy == "V12" and ts < v12_cooldown_by_symbol[str(candidate["symbol"])]:
                    record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SYMBOL_COOLDOWN", ts)
                    rejected["V12:SYMBOL_COOLDOWN"] += 1
                    continue
                active_same = [position for position in active.values() if position["strategy_id"] == strategy]
                if strategy in {"PENGU", "Q102", "FET", "V52"} and active_same:
                    record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:SLOT_OCCUPIED", ts)
                    rejected[f"{strategy}:SLOT_OCCUPIED"] += 1
                    continue
                if strategy == "V12":
                    if any(position["symbol"] == candidate["symbol"] for position in active_same):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
                    rank3 = int(candidate.get("rank") or 0) == 3
                    if rank3 and any(int(position.get("rank") or 0) == 3 for position in active_same):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:RANK3_SLOT_OCCUPIED", ts)
                        rejected["V12:RANK3_SLOT_OCCUPIED"] += 1
                        continue
                    if not rank3 and sum(int(position.get("rank") or 0) != 3 for position in active_same) >= 2:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:BASE_SLOTS_FULL", ts)
                        rejected["V12:BASE_SLOTS_FULL"] += 1
                        continue
                    if len(active_same) >= 3:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:MAX_POSITIONS", ts)
                        rejected["V12:MAX_POSITIONS"] += 1
                        continue
                hard_eligible.append(candidate)

            # Preserve the existing core-over-FET preemption rule before the
            # one-cycle allocator is evaluated.  No other position is closed.
            if hard_eligible:
                equity_before = replay._equity(wallet, active, market, ts)
                if equity_before > 0:
                    total_gross_before = sum(replay._gross(position, market, ts, equity_before) for position in active.values())
                    crypto_gross_before = sum(replay._gross(position, market, ts, equity_before) for position in active.values() if position["strategy_id"] != "V52")
                    core = [row for row in hard_eligible if str(row["strategy_id"]) in {"PENGU", "V12", "Q102"}]
                    if core and any(
                        min(
                            max(0.0, _research_cap(row) - sum(replay._gross(position, market, ts, equity_before) for position in active.values() if position["strategy_id"] == row["strategy_id"])),
                            max(0.0, CRYPTO_GROSS_CAP - crypto_gross_before),
                            max(0.0, TOTAL_GROSS_CAP - total_gross_before),
                        ) + 1e-12 < min(max(0.0, _finite(row.get("requested_gross"))), _research_cap(row))
                        for row in core
                    ):
                        chosen = max(core, key=lambda row: (_finite(row.get("marketFitScore")), str(row["_model_candidate_id"])))
                        preempt_fet(ts, f"CORE_PREEMPT:{chosen['strategy_id']}")

            equity = replay._equity(wallet, active, market, ts)
            if equity > 0 and hard_eligible:
                active_gross_by_strategy = defaultdict(float)
                for position in active.values():
                    active_gross_by_strategy[position["strategy_id"]] += replay._gross(position, market, ts, equity)
                strategy_available = {
                    strategy: max(0.0, _research_cap({"strategy_id": strategy}) - active_gross_by_strategy[strategy])
                    for strategy in {str(row["strategy_id"]) for row in hard_eligible}
                }
                crypto_gross = sum(replay._gross(position, market, ts, equity) for position in active.values() if position["strategy_id"] != "V52")
                stock_gross = sum(replay._gross(position, market, ts, equity) for position in active.values() if position["strategy_id"] == "V52")
                total_gross = crypto_gross + stock_gross
                intents = [
                    _intent_bounds(row, equity, strategy_available[str(row["strategy_id"])])
                    for row in hard_eligible
                ]
                allocation = allocate_dynamic_candidates(
                    intents,
                    crypto_available=max(0.0, CRYPTO_GROSS_CAP - crypto_gross),
                    stock_available=max(0.0, STOCK_GROSS_CAP - stock_gross),
                    total_available=max(0.0, TOTAL_GROSS_CAP - total_gross),
                    equity_usd=equity,
                    strategy_available=strategy_available,
                )
                allocation_by_id = {str(row["id"]): row for row in allocation["allocations"]}
                rejected_by_id = {str(row["id"]): row["reason"] for row in allocation["rejected"]}
                for candidate in hard_eligible:
                    candidate_id = str(candidate["_model_candidate_id"])
                    allocated = allocation_by_id.get(candidate_id)
                    if allocated is None:
                        reason = f"DYNAMIC:{rejected_by_id.get(candidate_id, 'NO_EXECUTABLE_GROSS')}"
                        allocation_rejections.append({"id": candidate_id, "reason": reason})
                        record_decision(candidate, "REJECTED_PORTFOLIO", reason, ts)
                        rejected[reason] += 1
                        continue
                    allocation_rows.append({
                        "id": candidate_id,
                        "strategy_id": candidate["strategy_id"],
                        "symbol": candidate["symbol"],
                        "signal_ts_ms": candidate.get("signal_ts_ms"),
                        "market_fit_score": candidate.get("marketFitScore"),
                        "market_fit_score_source": candidate.get("marketFitScoreSource"),
                        "bt_prior_version": candidate.get("btPriorVersion"),
                        "bt_prior_bonus": allocated.get("btPriorBonus"),
                        "final_score": allocated.get("finalScore"),
                        "min_gross": allocated.get("minGross"),
                        "target_gross": allocated.get("targetGross"),
                        "max_gross": allocated.get("maxGross"),
                        "allocated_gross": allocated.get("allocatedGross"),
                    })
                for allocated in sorted(allocation["allocations"], key=lambda row: (-_finite(row.get("finalScore")), str(row["id"]))):
                    candidate = next(row for row in hard_eligible if str(row["_model_candidate_id"]) == str(allocated["id"]))
                    strategy = str(candidate["strategy_id"])
                    accepted_gross = _finite(allocated.get("allocatedGross"))
                    target_gross = _finite(allocated.get("targetGross"))
                    if strategy == "FET" and accepted_gross + 1e-12 < FET_MIN:
                        record_decision(candidate, "REJECTED_PORTFOLIO", "FET:RESIDUAL_LT_MIN", ts)
                        rejected["FET:RESIDUAL_LT_MIN"] += 1
                        continue
                    if accepted_gross <= 1e-12:
                        record_decision(candidate, "REJECTED_PORTFOLIO", f"{strategy}:NO_GROSS_ROOM", ts)
                        rejected[f"{strategy}:NO_GROSS_ROOM"] += 1
                        continue
                    entry_price = float(candidate["entry_price"])
                    notional = equity * accepted_gross
                    quantity = notional / entry_price
                    entry_fee = notional * cost_side
                    wallet -= entry_fee
                    event_cashflow[ts] -= entry_fee
                    record_day_pnl(ts, -entry_fee)
                    pid = next_position_id
                    next_position_id += 1
                    position = {
                        "position_id": pid,
                        "strategy_id": strategy,
                        "symbol": candidate["symbol"],
                        "side": candidate["side"],
                        "entry_ts_ms": ts,
                        "entry_price": entry_price,
                        "entry_equity": equity,
                        "accepted_gross": accepted_gross,
                        "notional_entry_jpy": notional,
                        "quantity": quantity,
                        "original_quantity": quantity,
                        "entry_fee": entry_fee,
                        "exit_fee": 0.0,
                        "price_pnl": 0.0,
                        "funding_pnl": 0.0,
                        "planned_exit_ts_ms": int(candidate["exit_ts_ms"]),
                        "planned_exit_price": float(candidate["exit_price"]),
                        "planned_exit_reason": candidate.get("exit_reason") or "MODELED_EXIT",
                        "rank": candidate.get("rank"),
                        "route": candidate.get("route"),
                        "entry_version": candidate.get("entry_version"),
                        "family": candidate.get("family"),
                        "candidate_id": candidate["_model_candidate_id"],
                        "source_runtime_sha": candidate.get("source_runtime_sha"),
                        "candidate_requested_gross": target_gross,
                        "coverage_failures": [],
                    }
                    active[pid] = position
                    record_decision(
                        candidate,
                        "ACCEPTED_MODELED_ENTRY",
                        "DYNAMIC_SCORE_GROSS_ALLOCATED",
                        ts,
                        position_id=pid,
                        accepted_gross=accepted_gross,
                        modeled_entry_quantity=quantity,
                        modeled_entry_price_usd=entry_price,
                        modeled_entry_notional_settlement=notional,
                        modeled_entry_fee_settlement=entry_fee,
                        entry_equity_settlement=equity,
                        final_score=allocated.get("finalScore"),
                        bt_prior_bonus=allocated.get("btPriorBonus"),
                        reference_fx_jpy_per_usd=rate_at(ts),
                        historical_fill_verified=False,
                    )
                    events.append({
                        "event_type": "MODELED_ENTRY",
                        "ts_ms": ts,
                        "candidate_id": candidate["_model_candidate_id"],
                        "position_id": pid,
                        "strategy_id": strategy,
                        "symbol": candidate["symbol"],
                        "side": candidate["side"],
                        "modeled_price_usd": entry_price,
                        "quantity": quantity,
                        "accepted_gross": accepted_gross,
                        "notional_settlement": notional,
                        "fee_settlement": entry_fee,
                        "wallet_after_event": wallet,
                        "historical_fill_verified": False,
                    })
                    push(position["planned_exit_ts_ms"], 2, "exit", pid)
                    partial = candidate.get("partial")
                    if partial and ts < int(partial["ts"]) < position["planned_exit_ts_ms"]:
                        push(int(partial["ts"]), 1, "partial", pid, partial)
                    for funding_ts, funding_rate in replay._scheduled_funding(data_root, position["symbol"], ts, position["planned_exit_ts_ms"]):
                        push(funding_ts, 0, "funding", pid, funding_rate)
            else:
                for candidate in hard_eligible:
                    record_decision(candidate, "REJECTED_PORTFOLIO", "EQUITY_INVALID_OR_NO_DYNAMIC_ROOM", ts)
                    rejected["EQUITY_INVALID_OR_NO_DYNAMIC_ROOM"] += 1
            candidate_i += 1

    for pid in list(active):
        position = active[pid]
        mark = replay._mark(market, position["symbol"], PERIOD_END_MS - replay.HOUR)
        if mark is not None:
            finalize_position(pid, PERIOD_END_MS, mark, "PERIOD_END_MODEL_FLAT")

    if len(candidate_decisions) != len(candidates):
        raise ValueError(f"CANDIDATE_DECISION_LEDGER_INCOMPLETE:{len(candidate_decisions)}:{len(candidates)}")

    trades_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    trades_by_exit: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for trade in completed:
        trades_by_entry[int(trade["entry_ts_ms"])].append(trade)
        trades_by_exit[int(trade["exit_ts_ms"])].append(trade)
    curve: list[tuple[int, float]] = []
    cash = 0.0
    open_curve: dict[int, dict[str, Any]] = {}
    peak = 0.0
    max_dd = 0.0
    monthly: dict[str, float] = {}
    missing_mtm = 0
    missing_examples: list[dict[str, Any]] = []
    event_times = sorted(set(event_cashflow) | set(trades_by_entry) | set(trades_by_exit))
    event_index = 0
    for mark_ts in range(PERIOD_START_MS, PERIOD_END_MS + 1, replay.HOUR):
        while event_index < len(event_times) and event_times[event_index] <= mark_ts:
            event_ts = event_times[event_index]
            cash += event_cashflow.get(event_ts, 0.0)
            for trade in trades_by_exit.get(event_ts, []):
                open_curve.pop(int(trade["position_id"]), None)
            for trade in trades_by_entry.get(event_ts, []):
                if int(trade["exit_ts_ms"]) > event_ts:
                    open_curve[int(trade["position_id"])] = trade
            event_index += 1
        unrealized = 0.0
        for trade in open_curve.values():
            mark = replay._mark(market, trade["symbol"], mark_ts)
            if mark is None:
                missing_mtm += 1
                if len(missing_examples) < 20:
                    missing_examples.append({"symbol": trade["symbol"], "ts_ms": mark_ts})
                continue
            quantity = float(trade["original_quantity"])
            partial = trade.get("partial_actual")
            if partial and mark_ts >= int(partial["ts"]):
                quantity *= 1.0 - float(partial["fraction"])
            unrealized += replay._side_sign(trade["side"]) * quantity * (mark - float(trade["entry_price"]))
        equity = (cash + unrealized) * rate_at(mark_ts)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0 if peak > 0 else 0.0)
        monthly[datetime.fromtimestamp(mark_ts / 1000, timezone.utc).strftime("%Y-%m")] = equity
        curve.append((mark_ts, equity))

    pnls = [float(row["total_pnl_jpy"]) for row in completed]
    gains = sum(value for value in pnls if value > 0)
    losses = -sum(value for value in pnls if value < 0)
    strategy_pnl: defaultdict[str, float] = defaultdict(float)
    strategy_trades: Counter[str] = Counter()
    outcome: dict[str, dict[str, Any]] = {}
    for row in completed:
        strategy = str(row["strategy_id"])
        strategy_pnl[strategy] += float(row["total_pnl_jpy"]) * rate_at(int(row["exit_ts_ms"]))
        strategy_trades[strategy] += 1
        bucket = outcome.setdefault(strategy, {"trades": 0, "winningTrades": 0, "grossWin": 0.0, "grossLossAbs": 0.0, "netPnl": 0.0})
        pnl_jpy = float(row["total_pnl_jpy"]) * rate_at(int(row["exit_ts_ms"]))
        bucket["trades"] += 1
        bucket["winningTrades"] += int(pnl_jpy > 0)
        bucket["grossWin"] += max(0.0, pnl_jpy)
        bucket["grossLossAbs"] += max(0.0, -pnl_jpy)
        bucket["netPnl"] += pnl_jpy
    for bucket in outcome.values():
        bucket["winRate"] = bucket["winningTrades"] / bucket["trades"] if bucket["trades"] else None
        bucket["profitFactor"] = bucket["grossWin"] / bucket["grossLossAbs"] if bucket["grossLossAbs"] > 0 else None
    final_equity = curve[-1][1] if curve else wallet * rate_at(PERIOD_END_MS)
    final_rate = rate_at(PERIOD_END_MS)
    closed_pnl = sum(pnls)
    cashflow_total = sum(event_cashflow.values())
    tolerance = max(1e-6, abs(wallet) * 1e-9)
    if abs((deposited_units + closed_pnl) - wallet) > tolerance:
        raise ValueError("DYNAMIC_PORTFOLIO_TRADE_PNL_WALLET_RECONCILIATION_FAILED")
    if abs(cashflow_total - wallet) > tolerance:
        raise ValueError("DYNAMIC_PORTFOLIO_CASHFLOW_WALLET_RECONCILIATION_FAILED")
    return {
        "scenario_id": scenario_id,
        "mode": "DYNAMIC_SCORE",
        "status": "INCOMPLETE_MTM_H1_PRICE_MODEL" if missing_mtm else "COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED",
        "missing_active_position_mtm_hours": missing_mtm,
        "missing_mtm_examples": missing_examples,
        "round_trip_cost_bps": round_trip_cost_bps,
        "settlement_currency": currency,
        "initial_jpy": 10_000.0,
        "monthly_jpy": 10_000.0,
        "contributed_jpy": sum(deposits.values()),
        "final_equity_jpy": final_equity,
        "net_profit_jpy": final_equity - sum(deposits.values()),
        "profit_factor": gains / losses if losses > 0 else None,
        "win_rate": sum(value > 0 for value in pnls) / len(pnls) if pnls else None,
        "maximum_mtm_drawdown": None if missing_mtm else max_dd,
        "closed_trades": len(completed),
        "accounting_reconciliation": {
            "status": "PASS",
            "wallet_settlement_units": wallet,
            "closed_trade_pnl_settlement_units": closed_pnl,
            "event_cashflow_settlement_units": cashflow_total,
            "deposit_settlement_units": deposited_units,
            "final_fx_jpy_per_usd": final_rate,
            "equity_minus_wallet_jpy": final_equity - wallet * final_rate,
            "intrahour_events": sum(event_ts % replay.HOUR != 0 for event_ts in event_times),
        },
        "strategy_pnl_jpy": dict(strategy_pnl),
        "strategy_trades": dict(strategy_trades),
        "strategy_trade_outcome_aggregates": outcome,
        "candidate_decision_rows": len(candidate_decisions),
        "candidate_decision_counts": {
            strategy: {
                decision: dict(reasons)
                for decision, reasons in decisions.items()
            }
            for strategy, decisions in _decision_counts(candidate_decisions).items()
        },
        "rejected_entries": dict(rejected),
        "monthly_equity_jpy": monthly,
        "dynamic_score_diagnostics": {
            "allocation_rows": allocation_rows,
            "allocation_rejections": allocation_rejections,
            "marketFit": {
                "futurePnlUsed": False,
                "v12Source": "V12_COMPLETED_SIGNAL_SCORE_V1",
                "fetSource": "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1",
                "neutralSource": "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1",
            },
            "btPrior": {
                "version": "rolling-closed-trades/v1",
                "roundTripCostBps": round_trip_cost_bps,
                "futureOutcomeUsed": False,
            },
        },
        "trade_rows": completed,
        "candidate_decision_rows_full": sorted(candidate_decisions, key=lambda row: (int(row["decision_ts_ms"]), str(row["candidate_id"]))),
        "event_rows": events,
    }


def _decision_counts(rows: Sequence[dict[str, Any]]) -> dict[str, dict[str, Counter]]:
    grouped: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    for row in rows:
        grouped[str(row.get("strategy_id"))][str(row.get("decision"))][str(row.get("reason"))] += 1
    return grouped


def _write_jsonl(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _scenario_name(cost_bps: float) -> str:
    return "PRICE_MODEL_10BPS" if abs(cost_bps - 10.0) < 1e-12 else f"PRICE_MODEL_SEVERE_{int(cost_bps)}BPS"


def render_research_report(summary: dict[str, Any]) -> str:
    lines = [
        "# DisDex dynamic score / GROSS formal BT recovery",
        "",
        "LIVE=false",
        "",
        "This artifact is a reproducible research backtest, not a venue execution certificate. "
        "The replay uses recovered Aster H1/funding and modeled fills; it does not claim historical L2 fills.",
        "",
        "## Allocation contract",
        "",
        "- DYNAMIC_SCORE uses causal `marketFitScore` first and a capped `rolling-closed-trades/v1` BT prior bonus.",
        "- PENGU hard cap: 0.75x; crypto cap: 3.0x; stock cap: 4.0x; total cap: 4.25x.",
        "- FET uses the completed H1 `entry-1h` and `entry-73h` closes for `return72h` plus the archived volume ratio.",
        "- V12 uses the recovered completed signal score; PENGU/Q102/V52 use the named neutral live fallback because no comparable current live score field was present.",
        "- HYPE and Idle are absent from the recovered annual formal candidate ledger and are not fabricated into the result.",
        "",
        "## Matched results",
        "",
        "| mode | cost | final equity JPY | PF | win rate | max MTM DD | closed trades | status |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in summary.get("scenarios", []):
        lines.append(
            f"| {row.get('mode')} | {row.get('scenario_id')} | "
            f"{float(row.get('final_equity_jpy', 0.0)):.6f} | "
            f"{row.get('profit_factor')} | "
            f"{float(row.get('win_rate', 0.0)) * 100.0:.6f}% | "
            f"{float(row.get('maximum_mtm_drawdown', 0.0)) * 100.0:.6f}% | "
            f"{row.get('closed_trades')} | {row.get('status')} |"
        )
    lines.extend([
        "",
        "## Per-strategy results",
        "",
        "The figures below are modeled settlement results under the stated cost scenario and are not live fills.",
        "",
    ])
    for row in summary.get("scenarios", []):
        lines.append(f"### {row.get('mode')} / {row.get('scenario_id')}")
        lines.append("")
        lines.append("| strategy | modeled PnL JPY | trades |")
        lines.append("|---|---:|---:|")
        pnl = row.get("strategy_pnl_jpy", {}) or {}
        trades = row.get("strategy_trades", {}) or {}
        for strategy in sorted(set(pnl) | set(trades)):
            lines.append(f"| {strategy} | {float(pnl.get(strategy, 0.0)):.6f} | {trades.get(strategy, 0)} |")
        lines.append("")
    lines.extend([
        "## Authentication boundary",
        "",
        "`COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED` means the H1 mark/funding replay and internal accounting reconciliation completed. "
        "It does not authenticate historical order-book execution, independent holdout performance, or current LIVE eligibility.",
        "",
        "The formal annual source is restored and replayable, but the recovered data does not contain an independent out-of-sample dynamic-allocation tape. "
        "Therefore this artifact must remain research/shadow evidence until the LIVE gates are separately proven.",
        "",
    ])
    return "\n".join(lines)


def build_research_manifest(
    *,
    output_root: Path,
    summary: dict[str, Any],
    implementation_sha: str,
    source_files: Sequence[Path],
) -> dict[str, Any]:
    references = []
    for path in source_files:
        path = Path(path)
        if not path.is_file():
            continue
        references.append({"path": str(path), "sha256": _sha256(path), "bytes": path.stat().st_size})
    return {
        "artifactType": "DISDEX_FORMAL_DYNAMIC_SCORE_BT",
        "live": False,
        "executionStatus": "RESEARCH_ONLY",
        "implementationSha": implementation_sha,
        "researchScriptSha256": _sha256(Path(__file__).resolve()),
        "period": {"startMs": PERIOD_START_MS, "endExclusiveMs": PERIOD_END_MS},
        "startingEquityConvention": summary["startingEquityConvention"],
        "roundTripCostScenariosBps": summary["costScenariosBps"],
        "allocation": {
            "formula": "marketFitScore + cappedBtPriorBonus - penalties",
            "btPriorVersion": "rolling-closed-trades/v1",
            "maxBtBonus": DEFAULT_MAX_BT_BONUS,
            "punguHardCap": PENGU_HARD_CAP,
            "riskCaps": summary["riskCaps"],
        },
        "sourceReferences": references,
        "summary": summary,
        "limitations": summary["limitations"],
    }


def run_formal_bt(
    *,
    data_root: Path,
    candidate_ledger: Path,
    v52_ledger_root: Path,
    signal_paths: dict[str, Path],
    replay_source_root: Path,
    ecb_fx_root: Path,
    output_root: Path,
    costs: Sequence[float] = (10.0, 30.0),
    implementation_sha: str = "UNSET",
) -> dict[str, Any]:
    """Run matched BASELINE and DYNAMIC_SCORE formal H1 price-model cases."""

    data_root = Path(data_root).resolve()
    candidate_ledger = Path(candidate_ledger).resolve()
    v52_ledger_root = Path(v52_ledger_root).resolve()
    replay_source_root = Path(replay_source_root).resolve()
    ecb_fx_root = Path(ecb_fx_root).resolve()
    output_root = Path(output_root).resolve()
    for required in (data_root, candidate_ledger, v52_ledger_root, replay_source_root, ecb_fx_root):
        if not required.exists():
            raise FileNotFoundError(f"FORMAL_BT_INPUT_MISSING:{required}")
    replay = load_recovered_replay_module(replay_source_root)
    fx_series = replay.load_ecb_cross(ecb_fx_root)
    base_candidates, input_meta = load_formal_candidates(candidate_ledger, v52_ledger_root)
    modeled_symbols = {str(row["symbol"]) for row in base_candidates if row.get("status") == "MODELED_CLOSED_TRADE" and row.get("symbol")}
    market = replay._market(data_root, modeled_symbols)
    fet_rows = _read_jsonl(data_root / "normalized/aster/klines/FETUSDT.jsonl")
    risk_caps = {
        "FET": 1.0,
        "Q102_BRK": 0.75,
        "Q102_MR": 0.75,
        "Q102_HIGH_VOL": 1.0,
        "Q102_REV": 1.5,
        "Q102_PB": 2.0,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    all_results: dict[str, Any] = {"status": "COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED", "periodStartMs": PERIOD_START_MS, "periodEndExclusiveMs": PERIOD_END_MS, "scenarios": [], "inputMeta": input_meta}

    for cost_bps in costs:
        scenario_id = _scenario_name(float(cost_bps))
        baseline_candidates = copy.deepcopy(base_candidates)
        replay.PENGU_CAP = PENGU_HARD_CAP
        baseline_market = replay._market(data_root, modeled_symbols)
        baseline = replay._portfolio_scenario(
            baseline_candidates,
            data_root,
            baseline_market,
            round_trip_cost_bps=float(cost_bps),
            scenario_id=scenario_id,
            fx_series=fx_series,
            risk_caps=risk_caps,
        )
        baseline["mode"] = "BASELINE"
        baseline["punguHardCap"] = PENGU_HARD_CAP
        baseline["riskCaps"] = risk_caps
        baseline_dir = output_root / "BASELINE" / scenario_id
        baseline_dir.mkdir(parents=True, exist_ok=True)
        _write_jsonl(baseline_dir / "portfolio-trades.jsonl", baseline.pop("trade_rows"))
        _write_jsonl(baseline_dir / "candidate-decisions.jsonl", baseline.pop("candidate_decision_rows_full"))
        _write_jsonl(baseline_dir / "portfolio-events.jsonl", baseline.pop("event_rows"))
        (baseline_dir / "metrics.json").write_text(json.dumps(baseline, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        all_results["scenarios"].append(baseline)

        dynamic_candidates = copy.deepcopy(base_candidates)
        score_meta = attach_causal_scores_and_prior(
            dynamic_candidates,
            signal_paths=signal_paths,
            market_by_symbol={"FETUSDT": fet_rows},
            round_trip_cost_bps=float(cost_bps),
        )
        dynamic = _dynamic_portfolio_scenario(
            dynamic_candidates,
            data_root,
            replay,
            round_trip_cost_bps=float(cost_bps),
            scenario_id=scenario_id,
            fx_series=fx_series,
        )
        dynamic["mode"] = "DYNAMIC_SCORE"
        dynamic["punguHardCap"] = PENGU_HARD_CAP
        dynamic["riskCaps"] = risk_caps
        dynamic["scoreSourceCounts"] = score_meta["scoreCounts"]
        dynamic_dir = output_root / "DYNAMIC_SCORE" / scenario_id
        dynamic_dir.mkdir(parents=True, exist_ok=True)
        _write_jsonl(dynamic_dir / "portfolio-trades.jsonl", dynamic.pop("trade_rows"))
        _write_jsonl(dynamic_dir / "candidate-decisions.jsonl", dynamic.pop("candidate_decision_rows_full"))
        _write_jsonl(dynamic_dir / "portfolio-events.jsonl", dynamic.pop("event_rows"))
        (dynamic_dir / "bt-prior-table.json").write_text(json.dumps(score_meta["priorTable"], sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (dynamic_dir / "metrics.json").write_text(json.dumps(dynamic, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        all_results["scenarios"].append(dynamic)

    summary = {
        "status": all_results["status"],
        "periodStartMs": PERIOD_START_MS,
        "periodEndExclusiveMs": PERIOD_END_MS,
        "startingEquityConvention": {"initialJpy": 10_000.0, "monthlyJpy": 10_000.0, "monthlyCount": 13},
        "costScenariosBps": [float(cost) for cost in costs],
        "punguHardCap": PENGU_HARD_CAP,
        "riskCaps": risk_caps,
        "candidateCount": input_meta["candidateCount"],
        "v52Status": input_meta["v52Status"],
        "scenarios": [
            {
                "mode": row["mode"],
                "scenario_id": row["scenario_id"],
                "final_equity_jpy": row["final_equity_jpy"],
                "profit_factor": row["profit_factor"],
                "win_rate": row["win_rate"],
                "maximum_mtm_drawdown": row["maximum_mtm_drawdown"],
                "closed_trades": row["closed_trades"],
                "strategy_pnl_jpy": row.get("strategy_pnl_jpy", {}),
                "strategy_trades": row.get("strategy_trades", {}),
                "score_source_counts": row.get("scoreSourceCounts", {}),
                "status": row["status"],
            }
            for row in all_results["scenarios"]
        ],
        "limitations": [
            "H1 bar-price fills are modeled, not historical order-book fills.",
            "ECB USD/JPY cross is a delayed reference, not executable USDTJPY or FRED parity.",
            "Dynamic score prior is rolling closed-trades/v1 and in-sample; no independent holdout was recovered.",
            "HYPE and Idle have no matching annual formal candidate ledger in the recovered archive and are not fabricated into this BT.",
            "V52 source tape is SHA-restored historical price-model evidence; it is not a live execution tape.",
        ],
    }
    (output_root / "portfolio-bt-summary.json").write_text(json.dumps(summary, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    source_files = [
        candidate_ledger,
        v52_ledger_root / "v52-model-ledger.jsonl",
        v52_ledger_root / "v52-model-summary.json",
        data_root / "normalized/aster/klines/FETUSDT.jsonl",
        data_root / "normalized/aster/funding/FETUSDT.jsonl",
        ecb_fx_root / "ecb-fx-cross-manifest.json",
        ecb_fx_root / "normalized/ecb/usdjpy-cross.jsonl",
        replay_source_root / "portfolio_price_model.py",
        replay_source_root / "crypto_price_model.py",
    ] + list(signal_paths.values())
    manifest = build_research_manifest(
        output_root=output_root,
        summary=summary,
        implementation_sha=implementation_sha,
        source_files=source_files,
    )
    (output_root / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (output_root / "report.md").write_text(render_research_report(summary), encoding="utf-8")
    (output_root / "README.md").write_text(
        "# Dynamic score allocation formal BT recovery\n\n"
        "This folder contains the reproducible BASELINE/DYNAMIC_SCORE H1 price-model replay for research only.\n\n"
        "- `LIVE=false`\n"
        "- Period: 2025-08-10 through 2026-08-10 (UTC)\n"
        "- Initial JPY 10,000 plus JPY 10,000 monthly contributions\n"
        "- Cost cases: 10bps and severe 30bps\n"
        "- PENGU hard cap: 0.75x\n"
        "- See `manifest.json` for source hashes and `report.md` for the comparison.\n",
        encoding="utf-8",
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--candidate-ledger", type=Path, required=True)
    parser.add_argument("--v52-ledger-root", type=Path, required=True)
    parser.add_argument("--replay-source-root", type=Path, required=True)
    parser.add_argument("--ecb-fx-root", type=Path, required=True)
    parser.add_argument("--v12-signal", type=Path, required=True)
    parser.add_argument("--pengu-signal", type=Path, required=True)
    parser.add_argument("--q102-signal", type=Path, required=True)
    parser.add_argument("--fet-signal", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--implementation-sha", default="UNSET")
    args = parser.parse_args()
    summary = run_formal_bt(
        data_root=args.data_root,
        candidate_ledger=args.candidate_ledger,
        v52_ledger_root=args.v52_ledger_root,
        signal_paths={"V12": args.v12_signal, "PENGU": args.pengu_signal, "Q102": args.q102_signal, "FET": args.fet_signal},
        replay_source_root=args.replay_source_root,
        ecb_fx_root=args.ecb_fx_root,
        output_root=args.output_root,
        implementation_sha=args.implementation_sha,
    )
    print(json.dumps(summary, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
