from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt

core = crypto_bt.core
v4 = core.v4

START = dt.datetime(2025, 8, 13, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
FOLD1_END = dt.datetime(2025, 12, 1, tzinfo=UTC)
FOLD2_END = dt.datetime(2026, 3, 1, tzinfo=UTC)
FOLD3_END = dt.datetime(2026, 6, 1, tzinfo=UTC)
LATE_EVAL_START = FOLD3_END
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
FOLD1_END_MS = int(FOLD1_END.timestamp() * 1000)
FOLD2_END_MS = int(FOLD2_END.timestamp() * 1000)
FOLD3_END_MS = int(FOLD3_END.timestamp() * 1000)
HOUR = 3_600_000
BAR_HOURS = 6
BAR_MS = BAR_HOURS * HOUR
GROSS = 0.75
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
BASELINE_RECENT_RETURN_PCT = 49.57


@dataclass(frozen=True)
class EventConfig:
    config_id: str
    family: str
    lookback_days: int
    threshold_pct: float
    confirm_pct: float
    hold_hours: int
    confirm_hours: int = 6
    reversal_pct: float = 0.0
    relative_weakness_pct: float = 0.0
    volume_floor: float = 0.0
    btc_filter_pct: float = 0.0
    stop_pct: float = 0.0
    profit_lock_pct: float = 0.0


@dataclass
class Position:
    symbol: str
    side: int
    entry_price: float
    entry_ts: int
    bars_held: int
    max_bars: int
    stop_pct: float
    profit_lock_pct: float
    best_favorable_pct: float = 0.0


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def resample(candles: Sequence[dict], hours: int = BAR_HOURS) -> List[dict]:
    bucket_ms = hours * HOUR
    groups: Dict[int, List[dict]] = {}
    for candle in candles:
        ts = int(candle["ts"])
        bucket = ts // bucket_ms * bucket_ms
        groups.setdefault(bucket, []).append(candle)
    result: List[dict] = []
    for ts, rows in sorted(groups.items()):
        rows = sorted(rows, key=lambda row: int(row["ts"]))
        if len(rows) != hours:
            continue
        result.append({
            "ts": ts,
            "open": float(rows[0]["open"]),
            "high": max(float(row["high"]) for row in rows),
            "low": min(float(row["low"]) for row in rows),
            "close": float(rows[-1]["close"]),
            "volume": sum(float(row.get("volume", 0.0)) for row in rows),
        })
    return result


def load_market() -> dict:
    core.v4.END = END_MS
    core.CORE_END = END_MS
    raw = {symbol: core.load_aster_symbol(symbol) for symbol in SYMBOLS}
    bars = {symbol: resample(raw[symbol]["candles"]) for symbol in SYMBOLS}
    indexes = {symbol: {int(row["ts"]): i for i, row in enumerate(rows)} for symbol, rows in bars.items()}
    times = [int(row["ts"]) for row in bars["BTC"] if START_MS - 45 * 86_400_000 <= int(row["ts"]) < END_MS]
    funding = {symbol: sorted(raw[symbol].get("funding", []), key=lambda row: int(row["ts"])) for symbol in SYMBOLS}
    return {"bars": bars, "indexes": indexes, "times": times, "funding": funding}


def configs() -> List[EventConfig]:
    out: List[EventConfig] = []

    # 1) Faster version of the successful 12h SHORT_PULLBACK family.
    for lb, thr, conf, hold in itertools.product((5, 7, 10), (6.0, 8.0, 10.0, 12.0), (0.75, 1.5, 2.25), (24, 48, 72, 96)):
        out.append(EventConfig(
            f"SP6_L{lb}_T{thr:g}_C{conf:g}_H{hold}", "SHORT_PULLBACK", lb, thr, conf, hold,
            confirm_hours=6,
        ))

    # 2) Require a 12h bounce and optional cross-sectional weakness versus BTC.
    for lb, thr, conf, hold, rel in itertools.product((5, 7, 10), (6.0, 8.0, 10.0), (1.0, 2.0), (48, 72, 96), (2.0, 4.0)):
        out.append(EventConfig(
            f"SP12RW_L{lb}_T{thr:g}_C{conf:g}_H{hold}_R{rel:g}", "SHORT_PULLBACK_REL", lb, thr, conf, hold,
            confirm_hours=12, relative_weakness_pct=rel,
        ))

    # 3) Failed bounce: a prior rebound after a decline, then rejection in the current 6h bar.
    for lb, thr, bounce, reversal, hold in itertools.product((5, 7, 10), (6.0, 8.0, 10.0), (1.0, 2.0), (0.5, 1.0), (48, 72)):
        out.append(EventConfig(
            f"FAILED_L{lb}_T{thr:g}_B{bounce:g}_R{reversal:g}_H{hold}", "FAILED_BOUNCE_SHORT", lb, thr, bounce, hold,
            confirm_hours=12, reversal_pct=reversal,
        ))

    # 4) Relative-weakness continuation: weak alt versus BTC with a small rebound entry.
    for lb, thr, rel, conf, hold in itertools.product((5, 7), (5.0, 8.0, 10.0), (3.0, 5.0), (0.75, 1.5), (48, 72)):
        out.append(EventConfig(
            f"RELWEAK_L{lb}_T{thr:g}_R{rel:g}_C{conf:g}_H{hold}", "RELATIVE_WEAK_SHORT", lb, thr, conf, hold,
            confirm_hours=6, relative_weakness_pct=rel,
        ))

    # 5) Breakdown continuation with volume confirmation.
    for lb, vol, btc_filter, hold in itertools.product((3, 5, 7), (0.8, 1.0, 1.2), (-2.0, 0.0), (24, 48, 72)):
        out.append(EventConfig(
            f"BREAKDOWN_L{lb}_V{vol:g}_B{btc_filter:g}_H{hold}", "SHORT_BREAKDOWN", lb, 0.0, 0.0, hold,
            volume_floor=vol, btc_filter_pct=btc_filter,
        ))

    # 6) Selective rebound long, included so the search is not structurally short-only.
    for lb, thr, conf, hold in itertools.product((3, 5, 7), (6.0, 9.0, 12.0), (1.5, 2.5), (24, 48)):
        out.append(EventConfig(
            f"REBOUND_L{lb}_T{thr:g}_C{conf:g}_H{hold}", "LONG_REBOUND", lb, thr, conf, hold,
            confirm_hours=6, btc_filter_pct=-6.0,
        ))

    # 7) Risk-managed pullback variants: exit on completed-bar stop/profit lock, never intrabar look-ahead.
    for thr, conf, hold, stop, lock in itertools.product((7.0, 9.0, 11.0), (1.0, 1.75), (72, 96), (3.0, 4.5), (5.0, 7.5)):
        out.append(EventConfig(
            f"SPRISK_T{thr:g}_C{conf:g}_H{hold}_S{stop:g}_P{lock:g}", "SHORT_PULLBACK", 7, thr, conf, hold,
            confirm_hours=6, stop_pct=stop, profit_lock_pct=lock,
        ))

    # Deduplicate exact parameter vectors.
    unique: Dict[Tuple[Any, ...], EventConfig] = {}
    for cfg in out:
        key = (
            cfg.family, cfg.lookback_days, cfg.threshold_pct, cfg.confirm_pct, cfg.hold_hours,
            cfg.confirm_hours, cfg.reversal_pct, cfg.relative_weakness_pct, cfg.volume_floor,
            cfg.btc_filter_pct, cfg.stop_pct, cfg.profit_lock_pct,
        )
        unique.setdefault(key, cfg)
    return list(unique.values())


def momentum(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    prior = idx - bars
    if prior < 0:
        return None
    p = float(rows[prior]["close"])
    if p <= 0:
        return None
    return (float(rows[idx]["close"]) / p - 1.0) * 100.0


def sma(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    if idx - bars + 1 < 0:
        return None
    return sum(float(row["close"]) for row in rows[idx-bars+1:idx+1]) / bars


def volume_ratio(rows: Sequence[dict], idx: int, recent: int = 8, base: int = 32) -> Optional[float]:
    if idx - base + 1 < 0 or recent >= base:
        return None
    current = [float(row.get("volume", 0.0)) for row in rows[idx-recent+1:idx+1]]
    prior = [float(row.get("volume", 0.0)) for row in rows[idx-base+1:idx-recent+1]]
    denom = sum(prior) / len(prior) if prior else 0.0
    return (sum(current) / len(current)) / denom if denom > 0 else None


def prior_low(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    if idx - bars < 0:
        return None
    return min(float(row["low"]) for row in rows[idx-bars:idx])


def signal(cfg: EventConfig, ts: int, market: dict) -> Optional[Tuple[str, int, dict]]:
    bars = market["bars"]
    indexes = market["indexes"]
    btc_idx = indexes["BTC"].get(ts)
    if btc_idx is None:
        return None
    btc = bars["BTC"]
    btc_7d = momentum(btc, btc_idx, int(7 * 24 / BAR_HOURS))
    if btc_7d is None:
        return None

    candidates: List[Tuple[float, str, int, dict]] = []
    for symbol in SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        rows = bars[symbol]
        lookback_bars = int(cfg.lookback_days * 24 / BAR_HOURS)
        move = momentum(rows, idx, lookback_bars)
        confirm_bars = max(1, int(cfg.confirm_hours / BAR_HOURS))
        recent = momentum(rows, idx, confirm_bars)
        avg20 = sma(rows, idx, int(20 * 24 / BAR_HOURS))
        if move is None or recent is None or avg20 is None:
            continue
        close = float(rows[idx]["close"])
        btc_move = momentum(btc, btc_idx, lookback_bars)
        relative = move - btc_move if btc_move is not None else 0.0

        if cfg.family == "SHORT_PULLBACK":
            if move <= -cfg.threshold_pct and recent >= cfg.confirm_pct and close < avg20:
                score = -move + 0.30 * recent + max(0.0, -relative) * 0.10
                candidates.append((score, symbol, -1, {"movePct": move, "confirmPct": recent, "relativePct": relative}))

        elif cfg.family == "SHORT_PULLBACK_REL":
            if move <= -cfg.threshold_pct and recent >= cfg.confirm_pct and close < avg20 and relative <= -cfg.relative_weakness_pct:
                score = -move + -relative * 0.35 + recent * 0.20
                candidates.append((score, symbol, -1, {"movePct": move, "confirmPct": recent, "relativePct": relative}))

        elif cfg.family == "FAILED_BOUNCE_SHORT":
            prior_end = idx - 1
            prior_bounce = momentum(rows, prior_end, max(1, int(cfg.confirm_hours / BAR_HOURS))) if prior_end >= 0 else None
            current6 = momentum(rows, idx, 1)
            if prior_bounce is None or current6 is None:
                continue
            if move <= -cfg.threshold_pct and prior_bounce >= cfg.confirm_pct and current6 <= -cfg.reversal_pct and close < avg20:
                score = -move + prior_bounce * 0.20 + (-current6) * 0.50
                candidates.append((score, symbol, -1, {"movePct": move, "priorBouncePct": prior_bounce, "rejectionPct": current6, "relativePct": relative}))

        elif cfg.family == "RELATIVE_WEAK_SHORT":
            if move <= -cfg.threshold_pct and relative <= -cfg.relative_weakness_pct and recent >= cfg.confirm_pct and close < avg20 and btc_7d > -10.0:
                score = -relative + (-move) * 0.25 + recent * 0.20
                candidates.append((score, symbol, -1, {"movePct": move, "confirmPct": recent, "relativePct": relative}))

        elif cfg.family == "SHORT_BREAKDOWN":
            low = prior_low(rows, idx, lookback_bars)
            vol = volume_ratio(rows, idx)
            current6 = momentum(rows, idx, 1)
            if low is None or vol is None or current6 is None:
                continue
            if close < low and vol >= cfg.volume_floor and btc_7d <= cfg.btc_filter_pct and current6 < 0:
                score = -current6 * 0.8 + vol * 0.5 + max(0.0, -relative) * 0.10
                candidates.append((score, symbol, -1, {"movePct": move, "volumeRatio": vol, "relativePct": relative}))

        elif cfg.family == "LONG_REBOUND":
            fast = sma(rows, idx, int(5 * 24 / BAR_HOURS))
            if fast is None:
                continue
            if move <= -cfg.threshold_pct and recent >= cfg.confirm_pct and btc_7d > cfg.btc_filter_pct and close > fast:
                score = recent * 0.7 + (-move) * 0.20 + relative * 0.10
                candidates.append((score, symbol, 1, {"movePct": move, "confirmPct": recent, "relativePct": relative}))

    if not candidates:
        return None
    score, symbol, side, meta = max(candidates, key=lambda item: (item[0], item[1]))
    return symbol, side, {"score": score, **meta}


def funding_for_bar(points: Sequence[dict], ts: int) -> float:
    end = ts + BAR_MS
    return sum(float(row["rate"]) for row in points if ts <= int(row["ts"]) < end)


def simulate(cfg: EventConfig, market: dict, severe: bool = False) -> Tuple[List[dict], List[dict]]:
    bars = market["bars"]
    indexes = market["indexes"]
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    pending: Optional[Tuple[str, int, dict]] = None
    position: Optional[Position] = None
    exits_next_open = False
    rows: List[dict] = []
    entries: List[dict] = []
    prior_weights: Dict[str, float] = {}
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0

    for ts in times:
        # Completed-bar signal from the previous bar enters now, at this bar open.
        if position is None and pending is not None:
            symbol, side, meta = pending
            idx = indexes[symbol].get(ts)
            if idx is not None:
                entry_price = float(bars[symbol][idx]["open"])
                position = Position(
                    symbol=symbol, side=side, entry_price=entry_price, entry_ts=ts,
                    bars_held=0, max_bars=max(1, int(cfg.hold_hours / BAR_HOURS)),
                    stop_pct=cfg.stop_pct, profit_lock_pct=cfg.profit_lock_pct,
                )
                entries.append({"signalTs": ts - BAR_MS, "entryTs": ts, "symbol": symbol, "side": side, **meta})
            pending = None

        # Close-triggered exit decided last bar is executed at this bar open.
        if position is not None and exits_next_open:
            position = None
            exits_next_open = False

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights = {position.symbol: position.side * GROSS}
            idx = indexes[position.symbol].get(ts)
            if idx is not None:
                bar = bars[position.symbol][idx]
                value += position.side * GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                funding = funding_for_bar(market["funding"][position.symbol], ts)
                value -= position.side * GROSS * funding
                if severe:
                    value -= GROSS * adverse_bps / 10_000.0

        turnover = sum(abs(weights.get(s, 0.0) - prior_weights.get(s, 0.0)) for s in set(weights) | set(prior_weights))
        value -= turnover * cost_bps / 10_000.0
        rows.append({"ts": ts, "return": value, "gross": sum(abs(v) for v in weights.values()), "maxGross": sum(abs(v) for v in weights.values()), "regime": -1 if any(v < 0 for v in weights.values()) else 1 if any(v > 0 for v in weights.values()) else 0})
        prior_weights = dict(weights)

        if position is not None:
            position.bars_held += 1
            idx = indexes[position.symbol].get(ts)
            if idx is not None:
                close = float(bars[position.symbol][idx]["close"])
                favorable = position.side * (close / position.entry_price - 1.0) * 100.0
                position.best_favorable_pct = max(position.best_favorable_pct, favorable)
                stop_hit = position.stop_pct > 0 and favorable <= -position.stop_pct
                profit_lock_hit = position.profit_lock_pct > 0 and position.best_favorable_pct >= position.profit_lock_pct and favorable <= position.best_favorable_pct * 0.45
                time_hit = position.bars_held >= position.max_bars
                exits_next_open = stop_hit or profit_lock_hit or time_hit

        # Only seek a new signal when no position will continue beyond this close.
        if position is None and pending is None:
            pending = signal(cfg, ts, market)
        elif position is not None and exits_next_open:
            # Do not reverse on the same close; one cash bar/open transition keeps execution conservative.
            pending = None

    return rows, entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    values = [float(row["return"]) for row in active]
    equity = peak = 1.0
    dd = 0.0
    months: Dict[str, List[float]] = {}
    for row in active:
        value = float(row["return"])
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        dd = min(dd, equity / peak - 1.0)
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(month, []).append(value)
    window_entries = [entry for entry in entries if start <= int(entry["entryTs"]) < end]
    month_returns = {month: compound(vals) * 100.0 for month, vals in months.items()}
    days = max(1e-9, (end - start) / 86_400_000.0)
    years = days / 365.25
    return {
        "events": len(active),
        "tradeEpisodes": len(window_entries),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else None,
        "maxDrawdownPct": dd * 100.0,
        "profitFactor": profit_factor(values),
        "positiveMonthRatio": sum(v > 0 for v in month_returns.values()) / len(month_returns) if month_returns else 0.0,
        "monthlyReturnsPct": month_returns,
    }


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def evaluate(cfg: EventConfig, market: dict) -> Tuple[dict, List[dict], List[dict]]:
    normal, entries = simulate(cfg, market, severe=False)
    severe, severe_entries = simulate(cfg, market, severe=True)
    windows = {
        "fold1": (START_MS, FOLD1_END_MS),
        "fold2": (FOLD1_END_MS, FOLD2_END_MS),
        "fold3": (FOLD2_END_MS, FOLD3_END_MS),
        "lateEvaluation": (FOLD3_END_MS, END_MS),
        "full": (START_MS, END_MS),
    }
    result = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name, (start, end) in windows.items():
        result[name] = {
            "normal": metrics(normal, entries, start, end),
            "severe": metrics(severe, severe_entries, start, end),
        }

    first3 = [result[name]["normal"] for name in ("fold1", "fold2", "fold3")]
    first3s = [result[name]["severe"] for name in ("fold1", "fold2", "fold3")]
    positive_folds = sum(finite(row["compoundedReturnPct"]) > 0 for row in first3)
    positive_severe_folds = sum(finite(row["compoundedReturnPct"]) > 0 for row in first3s)
    pre_return = compound([
        compound([float(r["return"]) for r in normal if start <= int(r["ts"]) < end])
        for start, end in ((START_MS, FOLD1_END_MS), (FOLD1_END_MS, FOLD2_END_MS), (FOLD2_END_MS, FOLD3_END_MS))
    ]) * 100.0
    pre_severe_return = compound([
        compound([float(r["return"]) for r in severe if start <= int(r["ts"]) < end])
        for start, end in ((START_MS, FOLD1_END_MS), (FOLD1_END_MS, FOLD2_END_MS), (FOLD2_END_MS, FOLD3_END_MS))
    ]) * 100.0
    total_pre_trades = sum(row["tradeEpisodes"] for row in first3)
    worst_pre_dd = min(finite(row["maxDrawdownPct"], -99) for row in first3)
    avg_pf = sum(min(5.0, finite(row.get("profitFactor"))) for row in first3) / 3.0

    eligible = bool(
        total_pre_trades >= 10
        and positive_folds >= 2
        and positive_severe_folds >= 2
        and pre_return >= 18.0
        and pre_severe_return >= 12.0
        and worst_pre_dd >= -12.0
        and avg_pf >= 1.15
    )
    score = (
        pre_return
        + 0.60 * pre_severe_return
        + 5.0 * (positive_folds + positive_severe_folds)
        + 4.0 * max(0.0, avg_pf - 1.0)
        - 0.30 * abs(worst_pre_dd)
    ) if eligible else -1e12
    result["preSelection"] = {
        "eligible": eligible,
        "score": score,
        "positiveFolds": positive_folds,
        "positiveSevereFolds": positive_severe_folds,
        "compoundedReturnPct": pre_return,
        "severeCompoundedReturnPct": pre_severe_return,
        "tradeEpisodes": total_pre_trades,
        "worstFoldDrawdownPct": worst_pre_dd,
        "averageFoldProfitFactor": avg_pf,
    }
    return result, normal, severe


def compact(item: dict) -> dict:
    return {key: item[key] for key in ("variantId", "config", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-event-core-v2")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    market = load_market()
    results: List[dict] = []
    replays: Dict[str, Tuple[List[dict], List[dict]]] = {}
    for cfg in configs():
        item, normal, severe = evaluate(cfg, market)
        results.append(item)
        replays[item["variantId"]] = (normal, severe)

    eligible = sorted(
        (item for item in results if item["preSelection"]["eligible"]),
        key=lambda item: (item["preSelection"]["score"], item["variantId"]),
        reverse=True,
    )
    ranked = sorted(results, key=lambda item: (item["preSelection"]["score"], item["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    selected_normal, selected_severe = replays[selected["variantId"]]

    late = selected["lateEvaluation"]["normal"]
    late_s = selected["lateEvaluation"]["severe"]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    selected_passes_late = bool(
        selected["preSelection"]["eligible"]
        and late["tradeEpisodes"] >= 3
        and finite(late["compoundedReturnPct"]) > 0.0
        and finite(late_s["compoundedReturnPct"]) > 0.0
        and finite(late.get("profitFactor")) > 1.05
        and finite(late["maxDrawdownPct"], -99) >= -8.0
    )
    beats_t8 = bool(
        finite(full["compoundedReturnPct"]) > BASELINE_RECENT_RETURN_PCT
        and finite(full_s["compoundedReturnPct"]) > 35.0
        and finite(full["maxDrawdownPct"], -99) >= -12.0
        and finite(full.get("profitFactor")) > 1.30
    )
    passed = selected_passes_late and beats_t8

    payload = rounded({
        "version": 2,
        "strategyId": "V96_RECENT_EVENT_CORE_V2_6H",
        "status": "V96_RECENT_EVENT_CORE_V2_PASS" if passed else "V96_RECENT_EVENT_CORE_V2_DIAGNOSTIC",
        "period": {
            "startInclusive": START.isoformat(),
            "endExclusive": END.isoformat(),
            "selectionFolds": [
                [START.isoformat(), FOLD1_END.isoformat()],
                [FOLD1_END.isoformat(), FOLD2_END.isoformat()],
                [FOLD2_END.isoformat(), FOLD3_END.isoformat()],
            ],
            "lateEvaluationStartInclusive": LATE_EVAL_START.isoformat(),
        },
        "architecture": {
            "barHours": BAR_HOURS,
            "decisionUsesCompletedBarOnly": True,
            "entry": "next 6h bar open",
            "gross": GROSS,
            "onePositionMaximum": True,
            "closeBasedRiskExit": True,
            "intrabarHighLowOrderingUsed": False,
        },
        "benchmark": {
            "previousT8FullReturnPct": BASELINE_RECENT_RETURN_PCT,
            "note": "Previous 12h SHORT_PULLBACK_L7_T8_C1.5_H6 benchmark at Gross 0.75.",
        },
        "candidateCounts": {"tested": len(results), "preSelectionEligible": len(eligible)},
        "selected": compact(selected),
        "selectedPassesLateEvaluation": selected_passes_late,
        "selectedBeatsPreviousT8": beats_t8,
        "topPreSelection": [compact(item) for item in ranked[:20]],
        "familySummary": {
            family: {
                "tested": sum(item["config"]["family"] == family for item in results),
                "eligible": sum(item["config"]["family"] == family and item["preSelection"]["eligible"] for item in results),
                "bestPreScore": max((finite(item["preSelection"]["score"], -1e12) for item in results if item["config"]["family"] == family), default=-1e12),
                "bestFullReturnPct": max((finite(item["full"]["normal"]["compoundedReturnPct"], -1e12) for item in results if item["config"]["family"] == family), default=-1e12),
            }
            for family in sorted({item["config"]["family"] for item in results})
        },
        "selectionPolicy": {
            "lateEvaluationUsedForRanking": False,
            "fullPeriodUsedForRanking": False,
            "rankedOnlyOnFirstThreeChronologicalFolds": True,
            "lateEvaluationIsPristine": False,
            "reasonNotPristine": "The 2026 period has already been inspected in prior V96 research; it is chronological evaluation, not untouched evidence.",
            "promotionTarget": "Full return > 49.57% at fixed Gross 0.75, Severe > 35%, DD >= -12%, PF > 1.30, plus positive late evaluation.",
        },
        "selectedReplay": {
            "strategyId": "V96_RECENT_EVENT_CORE_V2_6H",
            "variantId": selected["variantId"],
            "normal": selected_normal,
            "severe": selected_severe,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })

    json_path = output / "v96-recent-event-core-v2.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# V96 Recent Event Core V2 — 6h",
        "",
        f"- Status: **{payload['status']}**",
        f"- Tested: **{payload['candidateCounts']['tested']}** / Pre-selection eligible: **{payload['candidateCounts']['preSelectionEligible']}**",
        f"- Selected: **{selected['variantId']}**",
        f"- Previous T8 benchmark: **{BASELINE_RECENT_RETURN_PCT}%**",
        f"- Full: **{full['compoundedReturnPct']}%** / Severe **{full_s['compoundedReturnPct']}%** / DD **{full['maxDrawdownPct']}%** / PF **{full['profitFactor']}**",
        f"- Late evaluation: **{late['compoundedReturnPct']}%** / Severe **{late_s['compoundedReturnPct']}%** / DD **{late['maxDrawdownPct']}%** / PF **{late['profitFactor']}**",
        f"- Beats T8 gate: **{beats_t8}** / Late evaluation pass: **{selected_passes_late}**",
        "- Ranking used late evaluation/full period: **NO**",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v2.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
