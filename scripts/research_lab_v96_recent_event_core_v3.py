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
START = dt.datetime(2025, 8, 13, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
F1 = dt.datetime(2025, 12, 1, tzinfo=UTC)
F2 = dt.datetime(2026, 3, 1, tzinfo=UTC)
F3 = dt.datetime(2026, 6, 1, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
F1_MS = int(F1.timestamp() * 1000)
F2_MS = int(F2.timestamp() * 1000)
F3_MS = int(F3.timestamp() * 1000)
HOUR = 3_600_000
BAR_HOURS = 6
BAR_MS = BAR_HOURS * HOUR
DAY_MS = 86_400_000
GROSS = 0.75
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
V2_BENCHMARK = 59.573573
T8_BENCHMARK = 49.57
CACHE_ROOT = Path.cwd() / ".cache" / "perp-research-usdm"


@dataclass(frozen=True)
class ExitProfile:
    exit_id: str
    min_hold_hours: int
    max_hold_hours: int
    adverse_12h_pct: float
    trend_sma_days: int
    profit_trigger_pct: float
    giveback_ratio: float


@dataclass(frozen=True)
class StrategyConfig:
    config_id: str
    family: str
    lookback_days: int
    threshold_pct: float
    confirm_pct: float
    confirm_hours: int
    relative_pct: float
    breakout_days: int
    btc_mom7_min: float
    volume_floor: float
    exit_profile: ExitProfile


@dataclass
class Position:
    symbol: str
    side: int
    entry_price: float
    entry_ts: int
    bars_held: int
    best_favorable_pct: float
    exit_profile: ExitProfile


_feature_cache: Dict[Tuple[Any, ...], Any] = {}
_funding_cache: Dict[int, Dict[int, float]] = {}


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


def pf(values: Sequence[float]) -> Optional[float]:
    wins = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return wins / losses if losses > 1e-15 else (999.0 if wins > 0 else None)


def resample(candles: Sequence[dict]) -> List[dict]:
    groups: Dict[int, List[dict]] = {}
    for row in candles:
        ts = int(row["ts"])
        groups.setdefault(ts // BAR_MS * BAR_MS, []).append(row)
    out: List[dict] = []
    for ts, rows in sorted(groups.items()):
        rows = sorted(rows, key=lambda r: int(r["ts"]))
        if len(rows) != BAR_HOURS:
            continue
        out.append({
            "ts": ts,
            "open": float(rows[0]["open"]),
            "high": max(float(r["high"]) for r in rows),
            "low": min(float(r["low"]) for r in rows),
            "close": float(rows[-1]["close"]),
            "volume": sum(float(r.get("volume", 0.0)) for r in rows),
        })
    return out


def load_market() -> dict:
    core.v4.END = END_MS
    core.CORE_END = END_MS
    raw = {symbol: core.load_aster_symbol(CACHE_ROOT, symbol) for symbol in SYMBOLS}
    bars = {symbol: resample(raw[symbol]["candles"]) for symbol in SYMBOLS}
    indexes = {symbol: {int(row["ts"]): i for i, row in enumerate(rows)} for symbol, rows in bars.items()}
    funding: Dict[str, Dict[int, float]] = {}
    for symbol in SYMBOLS:
        buckets: Dict[int, float] = {}
        for point in raw[symbol].get("funding", []):
            ts = int(point["ts"])
            bucket = ts // BAR_MS * BAR_MS
            buckets[bucket] = buckets.get(bucket, 0.0) + float(point["rate"])
        funding[symbol] = buckets
    times = [int(row["ts"]) for row in bars["BTC"] if START_MS - 45 * DAY_MS <= int(row["ts"]) < END_MS]
    return {"bars": bars, "indexes": indexes, "funding": funding, "times": times}


def momentum(rows: Sequence[dict], idx: int, n: int) -> Optional[float]:
    key = ("mom", id(rows), idx, n)
    if key in _feature_cache:
        return _feature_cache[key]
    prior = idx - n
    value = None
    if prior >= 0 and float(rows[prior]["close"]) > 0:
        value = (float(rows[idx]["close"]) / float(rows[prior]["close"]) - 1.0) * 100.0
    _feature_cache[key] = value
    return value


def sma(rows: Sequence[dict], idx: int, n: int) -> Optional[float]:
    key = ("sma", id(rows), idx, n)
    if key in _feature_cache:
        return _feature_cache[key]
    value = None if idx - n + 1 < 0 else sum(float(r["close"]) for r in rows[idx-n+1:idx+1]) / n
    _feature_cache[key] = value
    return value


def prior_high(rows: Sequence[dict], idx: int, n: int) -> Optional[float]:
    key = ("high", id(rows), idx, n)
    if key in _feature_cache:
        return _feature_cache[key]
    value = None if idx - n < 0 else max(float(r["high"]) for r in rows[idx-n:idx])
    _feature_cache[key] = value
    return value


def volume_ratio(rows: Sequence[dict], idx: int, recent: int = 8, base: int = 32) -> Optional[float]:
    key = ("vol", id(rows), idx, recent, base)
    if key in _feature_cache:
        return _feature_cache[key]
    value = None
    if idx - base + 1 >= 0:
        current = [float(r.get("volume", 0.0)) for r in rows[idx-recent+1:idx+1]]
        prior = [float(r.get("volume", 0.0)) for r in rows[idx-base+1:idx-recent+1]]
        denom = sum(prior) / len(prior) if prior else 0.0
        if denom > 0:
            value = (sum(current) / len(current)) / denom
    _feature_cache[key] = value
    return value


def exit_profiles() -> List[ExitProfile]:
    return [
        ExitProfile("FIXED72", 72, 72, 999.0, 0, 999.0, 0.0),
        ExitProfile("FIXED96", 96, 96, 999.0, 0, 999.0, 0.0),
        ExitProfile("M24_X96_A2", 24, 96, 2.0, 0, 999.0, 0.0),
        ExitProfile("M24_X120_A2", 24, 120, 2.0, 0, 999.0, 0.0),
        ExitProfile("M24_X120_A3_S5", 24, 120, 3.0, 5, 999.0, 0.0),
        ExitProfile("M24_X120_TRAIL6", 24, 120, 3.0, 0, 6.0, 0.50),
        ExitProfile("M36_X144_TRAIL8", 36, 144, 3.0, 0, 8.0, 0.55),
    ]


def configs() -> List[StrategyConfig]:
    result: List[StrategyConfig] = []
    exits = exit_profiles()

    # Promising recent short-pullback neighborhood, now with adaptive exits.
    for lb, threshold, confirm, confirm_h, rel, xp in itertools.product(
        (5, 7), (6.0, 8.0, 10.0), (1.0, 1.5), (6, 12), (0.0, 4.0), exits
    ):
        result.append(StrategyConfig(
            f"SP_L{lb}_T{threshold:g}_C{confirm:g}_Q{confirm_h}_R{rel:g}_{xp.exit_id}",
            "SHORT_PULLBACK", lb, threshold, confirm, confirm_h, rel, 0, 0.0, 0.0, xp,
        ))

    # Event breakout long: no continuous trend exposure, only completed-bar breakouts.
    long_exits = [xp for xp in exits if xp.exit_id in ("FIXED48", "FIXED72", "M24_X96_A2", "M24_X120_A2", "M24_X120_TRAIL6")]
    # FIXED48 is defined explicitly here to keep the common exit set compact.
    fixed48 = ExitProfile("FIXED48", 48, 48, 999.0, 0, 999.0, 0.0)
    long_exits = [fixed48, exits[0], exits[2], exits[3], exits[5]]
    for breakout, mom7, btc7, rel, vol, xp in itertools.product(
        (5, 10, 20), (5.0, 9.0), (0.0, 4.0), (0.0, 3.0), (0.8, 1.0), long_exits
    ):
        result.append(StrategyConfig(
            f"LB_B{breakout}_M{mom7:g}_BTC{btc7:g}_R{rel:g}_V{vol:g}_{xp.exit_id}",
            "LONG_BREAKOUT", 7, mom7, 0.0, 6, rel, breakout, btc7, vol, xp,
        ))

    # Explicit regime router: same short family in weak regimes, breakout long in strong regimes.
    router_exits = [exits[0], exits[2], exits[3], exits[5]]
    for threshold, confirm, breakout, long_mom, btc7, xp in itertools.product(
        (6.0, 8.0), (1.0, 1.5), (5, 10), (5.0, 9.0), (0.0, 4.0), router_exits
    ):
        result.append(StrategyConfig(
            f"ROUTER_ST{threshold:g}_SC{confirm:g}_B{breakout}_LM{long_mom:g}_BTC{btc7:g}_{xp.exit_id}",
            "REGIME_ROUTER", 5, threshold, confirm, 12, 4.0, breakout, btc7, 0.8, xp,
        ))

    unique = {cfg.config_id: cfg for cfg in result}
    return list(unique.values())


def _short_signal(cfg: StrategyConfig, ts: int, market: dict) -> Optional[Tuple[float, str, int, dict]]:
    bars, indexes = market["bars"], market["indexes"]
    btc_idx = indexes["BTC"].get(ts)
    if btc_idx is None:
        return None
    btc_rows = bars["BTC"]
    best = None
    for symbol in SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        rows = bars[symbol]
        lb = int(cfg.lookback_days * 24 / BAR_HOURS)
        move = momentum(rows, idx, lb)
        confirm = momentum(rows, idx, max(1, cfg.confirm_hours // BAR_HOURS))
        avg20 = sma(rows, idx, int(20 * 24 / BAR_HOURS))
        btc_move = momentum(btc_rows, btc_idx, lb)
        if move is None or confirm is None or avg20 is None or btc_move is None:
            continue
        relative = move - btc_move
        close = float(rows[idx]["close"])
        if move <= -cfg.threshold_pct and confirm >= cfg.confirm_pct and close < avg20 and relative <= -cfg.relative_pct:
            score = -move + max(0.0, -relative) * 0.35 + confirm * 0.20
            item = (score, symbol, -1, {"movePct": move, "confirmPct": confirm, "relativePct": relative, "signalFamily": "SHORT_PULLBACK"})
            if best is None or item[0] > best[0] or (item[0] == best[0] and item[1] > best[1]):
                best = item
    return best


def _long_signal(cfg: StrategyConfig, ts: int, market: dict) -> Optional[Tuple[float, str, int, dict]]:
    bars, indexes = market["bars"], market["indexes"]
    btc_idx = indexes["BTC"].get(ts)
    if btc_idx is None:
        return None
    btc_rows = bars["BTC"]
    btc7 = momentum(btc_rows, btc_idx, int(7 * 24 / BAR_HOURS))
    btc20 = sma(btc_rows, btc_idx, int(20 * 24 / BAR_HOURS))
    if btc7 is None or btc20 is None or btc7 < cfg.btc_mom7_min or float(btc_rows[btc_idx]["close"]) <= btc20:
        return None
    best = None
    for symbol in ("ETH", "BNB", "SOL", "LINK", "AVAX"):
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        rows = bars[symbol]
        mom7 = momentum(rows, idx, int(7 * 24 / BAR_HOURS))
        btc_sym = momentum(btc_rows, btc_idx, int(7 * 24 / BAR_HOURS))
        high = prior_high(rows, idx, int(cfg.breakout_days * 24 / BAR_HOURS))
        vol = volume_ratio(rows, idx)
        if mom7 is None or btc_sym is None or high is None or vol is None:
            continue
        relative = mom7 - btc_sym
        close = float(rows[idx]["close"])
        if close > high and mom7 >= cfg.threshold_pct and relative >= cfg.relative_pct and vol >= cfg.volume_floor:
            score = mom7 + relative * 0.35 + vol * 0.50
            item = (score, symbol, 1, {"mom7Pct": mom7, "relativePct": relative, "volumeRatio": vol, "signalFamily": "LONG_BREAKOUT"})
            if best is None or item[0] > best[0] or (item[0] == best[0] and item[1] > best[1]):
                best = item
    return best


def signal(cfg: StrategyConfig, ts: int, market: dict) -> Optional[Tuple[str, int, dict]]:
    if cfg.family == "SHORT_PULLBACK":
        item = _short_signal(cfg, ts, market)
    elif cfg.family == "LONG_BREAKOUT":
        item = _long_signal(cfg, ts, market)
    else:
        bars, indexes = market["bars"], market["indexes"]
        bi = indexes["BTC"].get(ts)
        if bi is None:
            return None
        btc = bars["BTC"]
        btc7 = momentum(btc, bi, int(7 * 24 / BAR_HOURS))
        btc20 = sma(btc, bi, int(20 * 24 / BAR_HOURS))
        if btc7 is None or btc20 is None:
            return None
        strong = float(btc[bi]["close"]) > btc20 and btc7 >= cfg.btc_mom7_min
        item = _long_signal(cfg, ts, market) if strong else _short_signal(cfg, ts, market)
    if item is None:
        return None
    score, symbol, side, meta = item
    return symbol, side, {"score": score, **meta}


def should_exit(position: Position, ts: int, market: dict) -> bool:
    xp = position.exit_profile
    if position.bars_held * BAR_HOURS >= xp.max_hold_hours:
        return True
    if position.bars_held * BAR_HOURS < xp.min_hold_hours:
        return False
    idx = market["indexes"][position.symbol].get(ts)
    if idx is None:
        return False
    rows = market["bars"][position.symbol]
    adverse12 = momentum(rows, idx, 2)
    if adverse12 is not None:
        if position.side < 0 and adverse12 >= xp.adverse_12h_pct:
            return True
        if position.side > 0 and adverse12 <= -xp.adverse_12h_pct:
            return True
    if xp.trend_sma_days > 0:
        avg = sma(rows, idx, int(xp.trend_sma_days * 24 / BAR_HOURS))
        if avg is not None:
            close = float(rows[idx]["close"])
            if position.side < 0 and close > avg:
                return True
            if position.side > 0 and close < avg:
                return True
    if xp.profit_trigger_pct < 900 and position.best_favorable_pct >= xp.profit_trigger_pct:
        idx = market["indexes"][position.symbol].get(ts)
        close = float(rows[idx]["close"])
        favorable = position.side * (close / position.entry_price - 1.0) * 100.0
        if favorable <= position.best_favorable_pct * xp.giveback_ratio:
            return True
    return False


def simulate(cfg: StrategyConfig, market: dict, severe: bool) -> Tuple[List[dict], List[dict]]:
    bars, indexes = market["bars"], market["indexes"]
    times = [ts for ts in market["times"] if START_MS <= ts < END_MS]
    position: Optional[Position] = None
    pending = None
    exit_next = False
    prior_weights: Dict[str, float] = {}
    rows_out: List[dict] = []
    entries: List[dict] = []
    cost_bps = 50.0 if severe else 10.0
    adverse_bps = 3.0 if severe else 0.0

    for ts in times:
        if position is not None and exit_next:
            position = None
            exit_next = False

        if position is None and pending is not None:
            symbol, side, meta = pending
            idx = indexes[symbol].get(ts)
            if idx is not None:
                position = Position(symbol, side, float(bars[symbol][idx]["open"]), ts, 0, 0.0, cfg.exit_profile)
                entries.append({"entryTs": ts, "signalTs": ts - BAR_MS, "symbol": symbol, "side": side, **meta})
            pending = None

        weights: Dict[str, float] = {}
        value = 0.0
        if position is not None:
            weights[position.symbol] = position.side * GROSS
            idx = indexes[position.symbol].get(ts)
            if idx is not None:
                bar = bars[position.symbol][idx]
                value += position.side * GROSS * (float(bar["close"]) / float(bar["open"]) - 1.0)
                value -= position.side * GROSS * market["funding"][position.symbol].get(ts, 0.0)
                if severe:
                    value -= GROSS * adverse_bps / 10_000.0

        turnover = sum(abs(weights.get(s, 0.0) - prior_weights.get(s, 0.0)) for s in set(weights) | set(prior_weights))
        value -= turnover * cost_bps / 10_000.0
        gross = sum(abs(v) for v in weights.values())
        rows_out.append({"ts": ts, "return": value, "gross": gross, "maxGross": gross, "regime": -1 if any(v < 0 for v in weights.values()) else 1 if any(v > 0 for v in weights.values()) else 0})
        prior_weights = dict(weights)

        if position is not None:
            position.bars_held += 1
            idx = indexes[position.symbol].get(ts)
            if idx is not None:
                close = float(bars[position.symbol][idx]["close"])
                favorable = position.side * (close / position.entry_price - 1.0) * 100.0
                position.best_favorable_pct = max(position.best_favorable_pct, favorable)
            exit_next = should_exit(position, ts, market)

        if position is None and pending is None:
            pending = signal(cfg, ts, market)

    return rows_out, entries


def metrics(rows: Sequence[dict], entries: Sequence[dict], start: int, end: int) -> dict:
    active = [r for r in rows if start <= int(r["ts"]) < end]
    values = [float(r["return"]) for r in active]
    equity = peak = 1.0
    max_dd = 0.0
    months: Dict[str, List[float]] = {}
    for row in active:
        equity *= max(0.001, 1.0 + float(row["return"]))
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        key = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(key, []).append(float(row["return"]))
    month_returns = {k: compound(v) * 100.0 for k, v in months.items()}
    trades = [x for x in entries if start <= int(x["entryTs"]) < end]
    years = max(1e-9, (end - start) / (365.25 * DAY_MS))
    return {
        "tradeEpisodes": len(trades),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else None,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": pf(values),
        "positiveMonthRatio": sum(v > 0 for v in month_returns.values()) / len(month_returns) if month_returns else 0.0,
        "monthlyReturnsPct": month_returns,
    }


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def evaluate(cfg: StrategyConfig, market: dict) -> Tuple[dict, List[dict], List[dict]]:
    normal, entries = simulate(cfg, market, False)
    severe, severe_entries = simulate(cfg, market, True)
    windows = {"fold1": (START_MS, F1_MS), "fold2": (F1_MS, F2_MS), "fold3": (F2_MS, F3_MS), "lateEvaluation": (F3_MS, END_MS), "full": (START_MS, END_MS)}
    out = {"variantId": cfg.config_id, "config": asdict(cfg)}
    for name, (start, end) in windows.items():
        out[name] = {"normal": metrics(normal, entries, start, end), "severe": metrics(severe, severe_entries, start, end)}
    folds = [out[x]["normal"] for x in ("fold1", "fold2", "fold3")]
    folds_s = [out[x]["severe"] for x in ("fold1", "fold2", "fold3")]
    pre = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in folds]) * 100.0
    pre_s = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in folds_s]) * 100.0
    pos = sum(finite(x["compoundedReturnPct"]) > 0 for x in folds)
    pos_s = sum(finite(x["compoundedReturnPct"]) > 0 for x in folds_s)
    worst_dd = min(finite(x["maxDrawdownPct"], -99) for x in folds)
    trades = sum(int(x["tradeEpisodes"]) for x in folds)
    avg_pf = sum(min(5.0, finite(x["profitFactor"])) for x in folds) / 3.0
    eligible = bool(trades >= 10 and pos == 3 and pos_s >= 2 and pre >= 20 and pre_s >= 10 and worst_dd >= -12 and avg_pf >= 1.15)
    score = pre + 0.65 * pre_s + 5.0 * (pos + pos_s) + 5.0 * max(0.0, avg_pf - 1.0) - 0.25 * abs(worst_dd) if eligible else -1e12
    out["preSelection"] = {"eligible": eligible, "score": score, "compoundedReturnPct": pre, "severeCompoundedReturnPct": pre_s, "positiveFolds": pos, "positiveSevereFolds": pos_s, "tradeEpisodes": trades, "worstFoldDrawdownPct": worst_dd, "averageFoldProfitFactor": avg_pf}
    return out, normal, severe


def compact(row: dict) -> dict:
    return {k: row[k] for k in ("variantId", "config", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-event-core-v3")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    market = load_market()

    results: List[dict] = []
    replays: Dict[str, Tuple[List[dict], List[dict]]] = {}
    for cfg in configs():
        row, normal, severe = evaluate(cfg, market)
        results.append(row)
        replays[row["variantId"]] = (normal, severe)

    eligible = sorted((r for r in results if r["preSelection"]["eligible"]), key=lambda r: (r["preSelection"]["score"], r["variantId"]), reverse=True)
    ranked = sorted(results, key=lambda r: (r["preSelection"]["score"], r["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    normal, severe = replays[selected["variantId"]]
    full, full_s = selected["full"]["normal"], selected["full"]["severe"]
    late, late_s = selected["lateEvaluation"]["normal"], selected["lateEvaluation"]["severe"]
    late_pass = bool(late["tradeEpisodes"] >= 2 and finite(late["compoundedReturnPct"]) > 0 and finite(late_s["compoundedReturnPct"]) > 0 and finite(late["maxDrawdownPct"], -99) >= -8 and finite(late["profitFactor"]) > 1.05)
    beats_v2 = bool(finite(full["compoundedReturnPct"]) > V2_BENCHMARK and finite(full_s["compoundedReturnPct"]) > 35 and finite(full["maxDrawdownPct"], -99) >= -12 and finite(full["profitFactor"]) > 1.30)
    status = "V96_RECENT_EVENT_CORE_V3_PASS" if selected["preSelection"]["eligible"] and late_pass and beats_v2 else "V96_RECENT_EVENT_CORE_V3_DIAGNOSTIC"

    top_full = sorted(results, key=lambda r: finite(r["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)[:20]
    payload = rounded({
        "version": 3,
        "strategyId": "V96_RECENT_EVENT_CORE_V3_ADAPTIVE_EXIT_ROUTER",
        "status": status,
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat(), "selectionFolds": [[START.isoformat(), F1.isoformat()], [F1.isoformat(), F2.isoformat()], [F2.isoformat(), F3.isoformat()]], "lateEvaluationStartInclusive": F3.isoformat()},
        "architecture": {"barHours": BAR_HOURS, "gross": GROSS, "onePositionMaximum": True, "completedBarSignalsOnly": True, "nextBarOpenEntriesAndExits": True, "families": ["SHORT_PULLBACK_ADAPTIVE_EXIT", "LONG_BREAKOUT", "REGIME_ROUTER"]},
        "benchmarks": {"T8ReturnPct": T8_BENCHMARK, "V2SelectedReturnPct": V2_BENCHMARK},
        "candidateCounts": {"tested": len(results), "preSelectionEligible": len(eligible)},
        "selected": compact(selected),
        "selectedPassesLateEvaluation": late_pass,
        "selectedBeatsV2": beats_v2,
        "topPreSelection": [compact(r) for r in ranked[:20]],
        "topFullDiagnosticOnly": [compact(r) for r in top_full],
        "familySummary": {
            family: {
                "tested": sum(r["config"]["family"] == family for r in results),
                "eligible": sum(r["config"]["family"] == family and r["preSelection"]["eligible"] for r in results),
                "bestPreScore": max((finite(r["preSelection"]["score"], -1e12) for r in results if r["config"]["family"] == family), default=-1e12),
                "bestFullReturnPctDiagnostic": max((finite(r["full"]["normal"]["compoundedReturnPct"], -1e12) for r in results if r["config"]["family"] == family), default=-1e12),
            } for family in sorted({r["config"]["family"] for r in results})
        },
        "selectionPolicy": {"lateEvaluationUsedForRanking": False, "fullPeriodUsedForRanking": False, "rankedOnlyOnFirstThreeFolds": True, "topFullDiagnosticOnlyNotEligibleForPromotion": True},
        "selectedReplay": {"strategyId": "V96_RECENT_EVENT_CORE_V3_ADAPTIVE_EXIT_ROUTER", "variantId": selected["variantId"], "normal": normal, "severe": severe},
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    (output / "v96-recent-event-core-v3.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Recent Event Core V3 — Adaptive Exit + Router",
        "",
        f"- Status: **{status}**",
        f"- Tested: **{len(results)}** / Eligible: **{len(eligible)}**",
        f"- Selected: **{selected['variantId']}**",
        f"- Full: **{full['compoundedReturnPct']}%** / Severe **{full_s['compoundedReturnPct']}%** / DD **{full['maxDrawdownPct']}%** / PF **{full['profitFactor']}**",
        f"- Late: **{late['compoundedReturnPct']}%** / Severe **{late_s['compoundedReturnPct']}%** / PF **{late['profitFactor']}**",
        f"- Beats V2 {V2_BENCHMARK}%: **{beats_v2}** / Late pass: **{late_pass}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v3.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
