#!/usr/bin/env python3
"""
BTC regime-ensemble backtest.

Research goals
--------------
1. Build a cost-aware BTC perpetual strategy from structurally different sleeves,
   not a single indicator rule.
2. Select candidate configurations only on 2020-2023 data.
3. Keep 2024 onward as an untouched holdout.
4. Use next-bar execution, realistic turnover costs, actual Binance funding when
   available, volatility targeting, rebalance hysteresis, and a fixed drawdown overlay.
5. Report all selected candidates and cost/funding sensitivities rather than only
   the prettiest result.

This is research code, not production trading code or a profit guarantee.
"""

from __future__ import annotations

import io
import json
import math
import time
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import requests

from btc_simple_backtest import DATA_END, DATA_START, SYMBOL, load_data

OUTPUT_DIR = Path("backtest_output_advanced")
FUNDING_CACHE_DIR = Path(".cache/btcusdt_funding")
ANNUAL_4H_BARS = 6 * 365.25
SELECTION_START = pd.Timestamp("2020-01-01", tz="UTC")
HOLDOUT_START = pd.Timestamp("2024-01-01", tz="UTC")
BASE_ONE_WAY_COST = 0.0006
FALLBACK_ADVERSE_FUNDING_8H = 0.00005


@dataclass(frozen=True)
class Candidate:
    name: str
    momentum_days: tuple[int, int, int]
    breakout_entry_days: int
    breakout_exit_days: int
    target_vol: float
    short_multiplier: float
    trend_quality_floor: float
    rebalance_band: float = 0.12
    max_abs_exposure: float = 1.50


@dataclass
class SimulationResult:
    returns: pd.Series
    equity: pd.Series
    position: pd.Series
    desired: pd.Series
    turnover: pd.Series
    trading_cost: pd.Series
    funding_cost: pd.Series
    drawdown_multiplier: pd.Series


def month_range(start: str, end: str) -> Iterable[pd.Period]:
    return pd.period_range(start=start, end=end, freq="M")


def _parse_timestamp(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.notna().sum() == 0:
        return pd.to_datetime(values, utc=True, errors="coerce")
    median = numeric.dropna().median()
    if median > 10**16:
        unit = "ns"
    elif median > 10**13:
        unit = "us"
    elif median > 10**11:
        unit = "ms"
    else:
        unit = "s"
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def _parse_funding_csv(raw: bytes) -> pd.DataFrame:
    frame = pd.read_csv(io.BytesIO(raw))
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    time_candidates = ["calc_time", "funding_time", "timestamp", "time", "fundingtime"]
    rate_candidates = ["last_funding_rate", "funding_rate", "fundingrate", "rate"]
    time_col = next((c for c in time_candidates if c in frame.columns), None)
    rate_col = next((c for c in rate_candidates if c in frame.columns), None)
    if time_col is None or rate_col is None:
        frame = pd.read_csv(io.BytesIO(raw), header=None)
        if frame.shape[1] < 2:
            raise ValueError(f"Unexpected funding CSV shape: {frame.shape}")
        frame = frame.iloc[:, :3]
        if frame.shape[1] == 3:
            frame.columns = ["calc_time", "funding_interval_hours", "last_funding_rate"]
        else:
            frame.columns = ["calc_time", "last_funding_rate"]
        time_col, rate_col = "calc_time", "last_funding_rate"
    out = pd.DataFrame(
        {
            "timestamp": _parse_timestamp(frame[time_col]),
            "funding_rate": pd.to_numeric(frame[rate_col], errors="coerce"),
        }
    ).dropna()
    return out.loc[out["funding_rate"].abs() < 0.05]


def load_actual_funding() -> pd.Series:
    FUNDING_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": "disdex-btc-regime-research/1.0"})
    frames: list[pd.DataFrame] = []
    for period in month_range(DATA_START, DATA_END):
        stamp = period.strftime("%Y-%m")
        cached = FUNDING_CACHE_DIR / f"{SYMBOL}-funding-{stamp}.csv"
        if cached.exists() and cached.stat().st_size > 0:
            frame = pd.read_csv(cached, parse_dates=["timestamp"])
            frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
            frames.append(frame)
            continue
        url = (
            "https://data.binance.vision/data/futures/um/monthly/fundingRate/"
            f"{SYMBOL}/{SYMBOL}-fundingRate-{stamp}.zip"
        )
        downloaded = False
        for attempt in range(3):
            try:
                response = session.get(url, timeout=90)
                if response.status_code == 404:
                    break
                response.raise_for_status()
                with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                    names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
                    if not names:
                        raise ValueError(f"No CSV in funding archive {url}")
                    frame = _parse_funding_csv(archive.read(names[0]))
                    frame.to_csv(cached, index=False)
                    frames.append(frame)
                    downloaded = True
                    break
            except Exception as exc:
                if attempt == 2:
                    print(f"WARN funding download failed {stamp}: {exc}")
                else:
                    time.sleep(1.0 * (attempt + 1))
        if not downloaded and not cached.exists():
            print(f"SKIP funding month: {stamp}")
    if not frames:
        return pd.Series(dtype=float, name="funding_rate")
    funding = pd.concat(frames, ignore_index=True)
    funding["timestamp"] = pd.to_datetime(funding["timestamp"], utc=True)
    funding = (
        funding.drop_duplicates("timestamp", keep="last")
        .sort_values("timestamp")
        .set_index("timestamp")["funding_rate"]
        .astype(float)
    )
    print(
        f"Loaded {len(funding):,} funding observations: "
        f"{funding.index.min()} -> {funding.index.max()}"
    )
    return funding


def resample_4h(data: pd.DataFrame) -> pd.DataFrame:
    h4 = data[["open", "high", "low", "close", "volume"]].resample(
        "4h", label="left", closed="left"
    ).agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    ).dropna()
    h4["next_open_return"] = h4["open"].shift(-1) / h4["open"] - 1.0
    return h4


def true_range(frame: pd.DataFrame) -> pd.Series:
    previous = frame["close"].shift(1)
    return pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous).abs(),
            (frame["low"] - previous).abs(),
        ],
        axis=1,
    ).max(axis=1)


def adx(frame: pd.DataFrame, period: int = 42) -> pd.Series:
    up = frame["high"].diff()
    down = -frame["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=frame.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=frame.index)
    tr = true_range(frame)
    atr_smoothed = tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / atr_smoothed.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / atr_smoothed.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def efficiency_ratio(close: pd.Series, period: int) -> pd.Series:
    direction = (close - close.shift(period)).abs()
    noise = close.diff().abs().rolling(period, min_periods=period).sum()
    return direction / noise.replace(0, np.nan)


def prepare_features(h4: pd.DataFrame) -> pd.DataFrame:
    out = h4.copy()
    log_close = np.log(out["close"])
    out["r4h"] = out["close"].pct_change()
    out["log_r4h"] = log_close.diff()
    out["ema_30d"] = out["close"].ewm(span=30 * 6, adjust=False, min_periods=30 * 6).mean()
    out["ema_90d"] = out["close"].ewm(span=90 * 6, adjust=False, min_periods=90 * 6).mean()
    out["ema_200d"] = out["close"].ewm(span=200 * 6, adjust=False, min_periods=200 * 6).mean()
    out["mom_7d"] = out["close"] / out["close"].shift(7 * 6) - 1
    out["mom_30d"] = out["close"] / out["close"].shift(30 * 6) - 1
    out["mom_90d"] = out["close"] / out["close"].shift(90 * 6) - 1
    out["rv_7d"] = out["log_r4h"].rolling(7 * 6).std() * math.sqrt(ANNUAL_4H_BARS)
    out["rv_21d"] = out["log_r4h"].rolling(21 * 6).std() * math.sqrt(ANNUAL_4H_BARS)
    out["rv_60d"] = out["log_r4h"].rolling(60 * 6).std() * math.sqrt(ANNUAL_4H_BARS)
    out["rv_blend"] = pd.concat(
        [out["rv_7d"], 0.85 * out["rv_21d"], 0.70 * out["rv_60d"]], axis=1
    ).max(axis=1)
    out["rv_90pct"] = out["rv_21d"].rolling(180 * 6, min_periods=90 * 6).quantile(0.90)
    out["er_7d"] = efficiency_ratio(out["close"], 7 * 6)
    out["er_21d"] = efficiency_ratio(out["close"], 21 * 6)
    out["adx_7d"] = adx(out, 7 * 6)
    er_score = ((0.65 * out["er_7d"] + 0.35 * out["er_21d"]) - 0.10) / 0.28
    adx_score = (out["adx_7d"] - 14.0) / 22.0
    out["trend_quality"] = (
        0.55 * er_score.clip(0, 1) + 0.45 * adx_score.clip(0, 1)
    ).clip(0, 1)
    out["structural_bull"] = (
        (out["close"] > out["ema_200d"])
        & (out["ema_30d"] > out["ema_90d"])
        & (out["ema_90d"].diff(30) > 0)
    )
    out["structural_bear"] = (
        (out["close"] < out["ema_200d"])
        & (out["ema_30d"] < out["ema_90d"])
        & (out["mom_90d"] < 0)
    )
    return out


def normalized_momentum(features: pd.DataFrame, days: int) -> pd.Series:
    bars = days * 6
    log_return = np.log(features["close"] / features["close"].shift(bars))
    horizon_vol = features["rv_21d"].clip(lower=0.08) * math.sqrt(days / 365.25)
    z = log_return / horizon_vol.replace(0, np.nan)
    return np.tanh(z / 1.75)


def breakout_state(
    features: pd.DataFrame,
    entry_days: int,
    exit_days: int,
    short_multiplier: float,
    quality_floor: float,
) -> pd.Series:
    entry_bars = entry_days * 6
    exit_bars = exit_days * 6
    prev_high = features["high"].rolling(entry_bars).max().shift(1)
    prev_low = features["low"].rolling(entry_bars).min().shift(1)
    long_exit = features["low"].rolling(exit_bars).min().shift(1)
    short_exit = features["high"].rolling(exit_bars).max().shift(1)
    close = features["close"].to_numpy(float)
    high_entry = prev_high.to_numpy(float)
    low_entry = prev_low.to_numpy(float)
    long_exit_arr = long_exit.to_numpy(float)
    short_exit_arr = short_exit.to_numpy(float)
    quality = features["trend_quality"].to_numpy(float)
    bull = features["structural_bull"].fillna(False).to_numpy(bool)
    bear = features["structural_bear"].fillna(False).to_numpy(bool)
    mom30 = features["mom_30d"].to_numpy(float)
    state = np.zeros(len(features), dtype=float)
    current = 0.0
    for i in range(len(features)):
        if current > 0:
            if (
                (not np.isnan(long_exit_arr[i]) and close[i] < long_exit_arr[i])
                or (not bull[i] and mom30[i] < 0)
            ):
                current = 0.0
        elif current < 0:
            if (
                (not np.isnan(short_exit_arr[i]) and close[i] > short_exit_arr[i])
                or (not bear[i] and mom30[i] > 0)
            ):
                current = 0.0
        if current == 0:
            if (
                bull[i]
                and quality[i] >= quality_floor
                and not np.isnan(high_entry[i])
                and close[i] > high_entry[i]
                and mom30[i] > 0
            ):
                current = 1.0
            elif (
                short_multiplier > 0
                and bear[i]
                and quality[i] >= quality_floor
                and not np.isnan(low_entry[i])
                and close[i] < low_entry[i]
                and mom30[i] < -0.05
            ):
                current = -short_multiplier
        state[i] = current
    return pd.Series(state, index=features.index, name="breakout_state")


def candidate_desired_exposure(features: pd.DataFrame, candidate: Candidate) -> pd.Series:
    tsmom = pd.concat(
        [normalized_momentum(features, days) for days in candidate.momentum_days],
        axis=1,
    ).mean(axis=1).clip(-1, 1)
    structural = pd.Series(0.0, index=features.index)
    structural.loc[features["structural_bull"]] = 1.0
    structural.loc[features["structural_bear"]] = -candidate.short_multiplier
    slow = (0.72 * tsmom + 0.28 * structural).clip(-1, 1)
    slow = slow.where(slow >= 0, slow * candidate.short_multiplier)
    slow = slow.where((slow >= 0) | features["structural_bear"], 0.0)
    breakout = breakout_state(
        features,
        candidate.breakout_entry_days,
        candidate.breakout_exit_days,
        candidate.short_multiplier,
        candidate.trend_quality_floor,
    )
    quality_gate = 0.30 + 0.70 * features["trend_quality"].clip(0, 1)
    raw = (0.68 * slow + 0.32 * breakout) * quality_gate
    extreme_vol = features["rv_21d"] > features["rv_90pct"]
    raw = raw.where(
        ~(extreme_vol & (raw > 0) & (features["mom_7d"] < 0)),
        raw * 0.35,
    )
    raw = raw.where(
        ~(extreme_vol & (raw < 0) & (features["mom_7d"] > 0)),
        raw * 0.35,
    )
    vol_scalar = candidate.target_vol / features["rv_blend"].clip(lower=0.10)
    desired = (raw * vol_scalar).clip(
        -candidate.max_abs_exposure, candidate.max_abs_exposure
    )
    return desired.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def funding_by_4h_bar(
    features: pd.DataFrame, actual_funding: pd.Series
) -> tuple[pd.Series, bool]:
    if actual_funding.empty:
        fallback = pd.Series(
            FALLBACK_ADVERSE_FUNDING_8H / 2.0,
            index=features.index,
            name="funding_rate",
        )
        return fallback, False
    grouped = actual_funding.groupby(actual_funding.index.floor("4h")).sum()
    aligned = grouped.reindex(features.index, fill_value=0.0).astype(float)
    coverage_start = max(features.index.min(), actual_funding.index.min().floor("4h"))
    coverage_end = min(features.index.max(), actual_funding.index.max().ceil("4h"))
    expected = features.loc[
        (features.index >= coverage_start) & (features.index <= coverage_end)
    ]
    observed_ratio = float((aligned.loc[expected.index] != 0).mean()) if len(expected) else 0.0
    print(f"Funding non-zero 4H interval ratio: {observed_ratio:.3f}")
    return aligned.rename("funding_rate"), True


def apply_hysteresis(desired: pd.Series, band: float) -> pd.Series:
    values = desired.to_numpy(float)
    actual = np.zeros(len(values), dtype=float)
    current = 0.0
    for i, target in enumerate(values):
        sign_change = current != 0 and target != 0 and np.sign(current) != np.sign(target)
        flatten = current != 0 and abs(target) < band * 0.45
        large_change = abs(target - current) >= band
        daily_rebalance = i % 6 == 0 and abs(target - current) >= band * 0.55
        if sign_change or flatten or large_change or daily_rebalance:
            current = target
        actual[i] = current
    return pd.Series(actual, index=desired.index, name="target_position")


def simulate(
    features: pd.DataFrame,
    desired: pd.Series,
    funding_rate: pd.Series,
    one_way_cost: float = BASE_ONE_WAY_COST,
    funding_mode: str = "actual",
    leverage_scale: float = 1.0,
    use_drawdown_overlay: bool = True,
) -> SimulationResult:
    signal_position = apply_hysteresis(desired * leverage_scale, band=0.12)
    planned = signal_position.shift(1).fillna(0.0).clip(-2.5, 2.5)
    asset_ret = features["next_open_return"].fillna(0.0).to_numpy(float)
    planned_arr = planned.to_numpy(float)
    funding_arr = funding_rate.reindex(features.index, fill_value=0.0).to_numpy(float)
    returns = np.zeros(len(features), dtype=float)
    actual_position = np.zeros(len(features), dtype=float)
    turnover = np.zeros(len(features), dtype=float)
    trading_cost = np.zeros(len(features), dtype=float)
    funding_cost = np.zeros(len(features), dtype=float)
    dd_multiplier = np.ones(len(features), dtype=float)
    equity = 1.0
    peak = 1.0
    previous_position = 0.0
    for i in range(len(features)):
        drawdown = equity / peak - 1.0
        multiplier = 1.0
        if use_drawdown_overlay:
            if drawdown <= -0.20:
                multiplier = 0.25
            elif drawdown <= -0.12:
                multiplier = 0.50
            elif drawdown <= -0.08:
                multiplier = 0.75
        pos = planned_arr[i] * multiplier
        change = abs(pos - previous_position)
        exec_cost = one_way_cost * change
        if funding_mode == "none":
            fund_cost = 0.0
        elif funding_mode == "adverse":
            fund_cost = abs(pos) * FALLBACK_ADVERSE_FUNDING_8H / 2.0
        else:
            fund_cost = pos * funding_arr[i]
        bar_ret = max(pos * asset_ret[i] - exec_cost - fund_cost, -0.95)
        returns[i] = bar_ret
        actual_position[i] = pos
        turnover[i] = change
        trading_cost[i] = exec_cost
        funding_cost[i] = fund_cost
        dd_multiplier[i] = multiplier
        equity *= 1.0 + bar_ret
        peak = max(peak, equity)
        previous_position = pos
    ret_series = pd.Series(returns, index=features.index, name="strategy_return")
    return SimulationResult(
        returns=ret_series,
        equity=(1.0 + ret_series).cumprod().rename("equity"),
        position=pd.Series(actual_position, index=features.index, name="position"),
        desired=desired.rename("desired"),
        turnover=pd.Series(turnover, index=features.index, name="turnover"),
        trading_cost=pd.Series(trading_cost, index=features.index, name="trading_cost"),
        funding_cost=pd.Series(funding_cost, index=features.index, name="funding_cost"),
        drawdown_multiplier=pd.Series(dd_multiplier, index=features.index, name="drawdown_multiplier"),
    )


def period_slice(
    series: pd.Series, start: pd.Timestamp, end: pd.Timestamp | None = None
) -> pd.Series:
    if end is None:
        return series.loc[series.index >= start]
    return series.loc[(series.index >= start) & (series.index < end)]


def max_drawdown(returns: pd.Series) -> float:
    if returns.empty:
        return float("nan")
    equity = (1.0 + returns).cumprod()
    return float((equity / equity.cummax() - 1.0).min())


def annualized_return(returns: pd.Series) -> float:
    if returns.empty:
        return float("nan")
    elapsed_days = max((returns.index[-1] - returns.index[0]).total_seconds() / 86400, 1)
    total = float((1.0 + returns).prod())
    if total <= 0:
        return -1.0
    return total ** (365.25 / elapsed_days) - 1.0


def sharpe_ratio(returns: pd.Series) -> float:
    if returns.empty or returns.std(ddof=1) <= 0:
        return float("nan")
    return float(returns.mean() / returns.std(ddof=1) * math.sqrt(ANNUAL_4H_BARS))


def downside_ratio(returns: pd.Series) -> float:
    downside = returns.clip(upper=0)
    denom = downside.std(ddof=1)
    if returns.empty or denom <= 0:
        return float("nan")
    return float(returns.mean() / denom * math.sqrt(ANNUAL_4H_BARS))


def summarize(
    result: SimulationResult,
    start: pd.Timestamp,
    end: pd.Timestamp | None = None,
) -> dict:
    ret = period_slice(result.returns, start, end)
    pos = period_slice(result.position, start, end)
    turn = period_slice(result.turnover, start, end)
    tcost = period_slice(result.trading_cost, start, end)
    fcost = period_slice(result.funding_cost, start, end)
    monthly = (1.0 + ret).resample("ME").prod() - 1.0
    years = max(
        (ret.index[-1] - ret.index[0]).total_seconds() / (365.25 * 86400),
        1 / 365.25,
    )
    return {
        "start": str(ret.index.min()),
        "end": str(ret.index.max()),
        "total_return": float((1.0 + ret).prod() - 1.0),
        "cagr": annualized_return(ret),
        "max_drawdown": max_drawdown(ret),
        "sharpe": sharpe_ratio(ret),
        "sortino": downside_ratio(ret),
        "positive_month_ratio": float((monthly > 0).mean()),
        "average_month": float(monthly.mean()),
        "median_month": float(monthly.median()),
        "best_month": float(monthly.max()),
        "worst_month": float(monthly.min()),
        "months_ge_20pct": int((monthly >= 0.20).sum()),
        "months_ge_50pct": int((monthly >= 0.50).sum()),
        "annual_turnover": float(turn.sum() / years),
        "average_abs_exposure": float(pos.abs().mean()),
        "max_abs_exposure": float(pos.abs().max()),
        "trading_cost_total": float(tcost.sum()),
        "funding_cost_total": float(fcost.sum()),
        "bars": int(len(ret)),
    }


def yearly_returns(returns: pd.Series) -> pd.Series:
    return (1.0 + returns).resample("YE").prod() - 1.0


def selection_score(stats: dict, annual: pd.Series) -> float:
    if len(annual) < 4:
        return -999.0
    return (
        1.50 * float(annual.median())
        + 0.45 * float(annual.min())
        + 0.35 * stats["cagr"]
        + 0.08 * np.nan_to_num(stats["sharpe"], nan=-3.0)
        + 0.65 * stats["max_drawdown"]
        + 0.12 * float((annual > 0).mean())
        - 0.0025 * stats["annual_turnover"]
    )


def generate_candidates() -> list[Candidate]:
    momentum_sets = [(14, 42, 84), (21, 63, 126), (28, 84, 168)]
    breakouts = [(20, 10), (30, 12), (55, 20)]
    target_vols = [0.20, 0.28, 0.36]
    shorts = [0.0, 0.35, 0.60]
    quality_floors = [0.30, 0.45]
    candidates: list[Candidate] = []
    counter = 1
    for mom in momentum_sets:
        for entry_days, exit_days in breakouts:
            for target_vol in target_vols:
                for short_mult in shorts:
                    for quality in quality_floors:
                        candidates.append(
                            Candidate(
                                name=f"C{counter:03d}",
                                momentum_days=mom,
                                breakout_entry_days=entry_days,
                                breakout_exit_days=exit_days,
                                target_vol=target_vol,
                                short_multiplier=short_mult,
                                trend_quality_floor=quality,
                            )
                        )
                        counter += 1
    return candidates


def choose_diverse(
    ranked: pd.DataFrame,
    candidate_map: dict[str, Candidate],
    count: int = 7,
) -> list[Candidate]:
    selected: list[Candidate] = []
    for row in ranked.itertuples(index=False):
        candidate = candidate_map[row.name]
        signature = (
            candidate.momentum_days,
            candidate.breakout_entry_days,
            candidate.short_multiplier,
        )
        if any(
            (c.momentum_days, c.breakout_entry_days, c.short_multiplier) == signature
            for c in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) >= count:
            break
    if len(selected) < count:
        for row in ranked.itertuples(index=False):
            candidate = candidate_map[row.name]
            if candidate not in selected:
                selected.append(candidate)
            if len(selected) >= count:
                break
    return selected


def fmt_pct(value: float) -> str:
    return "n/a" if value is None or not np.isfinite(value) else f"{value * 100:.2f}%"


def fmt_num(value: float) -> str:
    return "n/a" if value is None or not np.isfinite(value) else f"{value:.2f}"


def markdown_table(rows: list[dict], columns: list[tuple[str, str, str]]) -> str:
    header = "| " + " | ".join(label for _, label, _ in columns) + " |"
    sep = "| " + " | ".join("---" for _ in columns) + " |"
    body: list[str] = []
    for row in rows:
        rendered = []
        for key, _, kind in columns:
            value = row.get(key)
            if kind == "pct":
                rendered.append(fmt_pct(float(value)))
            elif kind == "num":
                rendered.append(fmt_num(float(value)))
            elif kind == "int":
                rendered.append(str(int(value)))
            else:
                rendered.append(str(value))
        body.append("| " + " | ".join(rendered) + " |")
    return "\n".join([header, sep, *body])


def bootstrap_monthly(
    monthly: pd.Series, seed: int = 20260715, samples: int = 20000
) -> dict:
    if len(monthly) < 12:
        return {}
    rng = np.random.default_rng(seed)
    arr = monthly.to_numpy(float)
    one_year = rng.choice(arr, size=(samples, 12), replace=True)
    annual = np.prod(1.0 + one_year, axis=1) - 1.0
    return {
        "median_bootstrap_annual": float(np.median(annual)),
        "p10_bootstrap_annual": float(np.quantile(annual, 0.10)),
        "p90_bootstrap_annual": float(np.quantile(annual, 0.90)),
        "probability_any_50pct_month_in_year": float((np.max(one_year, axis=1) >= 0.50).mean()),
        "probability_any_minus_20pct_month_in_year": float((np.min(one_year, axis=1) <= -0.20).mean()),
    }


def benchmark_returns(features: pd.DataFrame) -> dict[str, pd.Series]:
    asset = features["next_open_return"].fillna(0.0)
    long_flat_signal = (features["close"] > features["ema_200d"]).astype(float)
    long_flat_pos = long_flat_signal.shift(1).fillna(0.0)
    long_flat_turn = long_flat_pos.diff().abs().fillna(long_flat_pos.abs())
    return {
        "buy_hold": asset,
        "ema200_long_flat": long_flat_pos * asset - BASE_ONE_WAY_COST * long_flat_turn,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    data_15m = load_data()
    h4 = resample_4h(data_15m)
    features = prepare_features(h4)
    features = features.loc[features.index >= SELECTION_START].copy()
    features = features.iloc[:-1].copy()
    actual_funding = load_actual_funding()
    funding_rate, actual_funding_used = funding_by_4h_bar(features, actual_funding)
    selection_mask = (features.index >= SELECTION_START) & (features.index < HOLDOUT_START)
    holdout_mask = features.index >= HOLDOUT_START
    if selection_mask.sum() < 4 * 300 * 6 or holdout_mask.sum() < 365 * 6:
        raise RuntimeError("Insufficient selection or holdout data")
    candidates = generate_candidates()
    candidate_map = {candidate.name: candidate for candidate in candidates}
    desired_cache: dict[str, pd.Series] = {}
    selection_rows: list[dict] = []
    print(f"Evaluating {len(candidates)} pre-declared candidate configurations...")
    for candidate in candidates:
        desired = candidate_desired_exposure(features, candidate)
        desired_cache[candidate.name] = desired
        sim = simulate(features, desired, funding_rate)
        stats = summarize(sim, SELECTION_START, HOLDOUT_START)
        annual = yearly_returns(period_slice(sim.returns, SELECTION_START, HOLDOUT_START))
        selection_rows.append(
            {
                **asdict(candidate),
                **stats,
                "positive_years": int((annual > 0).sum()),
                "worst_year": float(annual.min()),
                "median_year": float(annual.median()),
                "selection_score": selection_score(stats, annual),
            }
        )
    selection_df = pd.DataFrame(selection_rows).sort_values(
        ["selection_score", "cagr"], ascending=False
    )
    selected = choose_diverse(selection_df, candidate_map, count=7)
    selected_names = [c.name for c in selected]
    print(f"Selected pre-holdout ensemble members: {selected_names}")
    ensemble_desired = pd.concat(
        [desired_cache[name] for name in selected_names], axis=1
    ).median(axis=1).clip(-1.5, 1.5)
    ensemble = simulate(features, ensemble_desired, funding_rate)
    selection_stats = summarize(ensemble, SELECTION_START, HOLDOUT_START)
    holdout_stats = summarize(ensemble, HOLDOUT_START)
    full_stats = summarize(ensemble, SELECTION_START)
    selected_oos_rows: list[dict] = []
    for candidate in selected:
        sim = simulate(features, desired_cache[candidate.name], funding_rate)
        selected_oos_rows.append({**asdict(candidate), **summarize(sim, HOLDOUT_START)})
    sensitivity_rows: list[dict] = []
    for cost_bps in [4, 6, 8, 10, 12]:
        for funding_mode in ["actual", "none", "adverse"]:
            sim = simulate(
                features,
                ensemble_desired,
                funding_rate,
                one_way_cost=cost_bps / 10000,
                funding_mode=funding_mode,
            )
            sensitivity_rows.append(
                {"cost_bps": cost_bps, "funding_mode": funding_mode, **summarize(sim, HOLDOUT_START)}
            )
    leverage_rows: list[dict] = []
    for scale in [0.75, 1.0, 1.25, 1.5, 2.0]:
        sim = simulate(features, ensemble_desired, funding_rate, leverage_scale=scale)
        leverage_rows.append({"leverage_scale": scale, **summarize(sim, HOLDOUT_START)})
    benchmarks = benchmark_returns(features)
    benchmark_rows: list[dict] = []
    for name, returns in benchmarks.items():
        fake = SimulationResult(
            returns=returns,
            equity=(1 + returns).cumprod(),
            position=pd.Series(1.0, index=returns.index),
            desired=pd.Series(1.0, index=returns.index),
            turnover=pd.Series(0.0, index=returns.index),
            trading_cost=pd.Series(0.0, index=returns.index),
            funding_cost=pd.Series(0.0, index=returns.index),
            drawdown_multiplier=pd.Series(1.0, index=returns.index),
        )
        benchmark_rows.append({"name": name, **summarize(fake, HOLDOUT_START)})
    holdout_monthly = (1.0 + period_slice(ensemble.returns, HOLDOUT_START)).resample("ME").prod() - 1.0
    bootstrap = bootstrap_monthly(holdout_monthly)
    export = pd.DataFrame(
        {
            "open": features["open"],
            "close": features["close"],
            "asset_next_open_return": features["next_open_return"],
            "trend_quality": features["trend_quality"],
            "rv_21d": features["rv_21d"],
            "desired": ensemble.desired,
            "position": ensemble.position,
            "strategy_return": ensemble.returns,
            "equity": ensemble.equity,
            "turnover": ensemble.turnover,
            "trading_cost": ensemble.trading_cost,
            "funding_cost": ensemble.funding_cost,
            "drawdown_multiplier": ensemble.drawdown_multiplier,
        }
    )
    export.to_csv(OUTPUT_DIR / "equity_and_positions.csv")
    selection_df.to_csv(OUTPUT_DIR / "candidate_selection.csv", index=False)
    pd.DataFrame(selected_oos_rows).to_csv(OUTPUT_DIR / "selected_candidates_holdout.csv", index=False)
    pd.DataFrame(sensitivity_rows).to_csv(OUTPUT_DIR / "sensitivity.csv", index=False)
    holdout_monthly.rename("return").to_csv(OUTPUT_DIR / "holdout_monthly_returns.csv")
    payload = {
        "data": {
            "start": str(features.index.min()),
            "end": str(features.index.max()),
            "bars_4h": len(features),
            "actual_funding_used": actual_funding_used,
        },
        "selected_candidates": [asdict(c) for c in selected],
        "selection": selection_stats,
        "holdout": holdout_stats,
        "full": full_stats,
        "selected_candidate_holdout": selected_oos_rows,
        "sensitivity": sensitivity_rows,
        "leverage": leverage_rows,
        "benchmarks": benchmark_rows,
        "bootstrap": bootstrap,
    }
    (OUTPUT_DIR / "metrics.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    main_columns = [
        ("period", "Period", "str"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
        ("sortino", "Sortino", "num"),
        ("average_month", "Avg month", "pct"),
        ("median_month", "Median month", "pct"),
        ("best_month", "Best month", "pct"),
        ("worst_month", "Worst month", "pct"),
        ("positive_month_ratio", "Positive months", "pct"),
        ("annual_turnover", "Annual turnover", "num"),
        ("average_abs_exposure", "Avg exposure", "num"),
        ("months_ge_50pct", "Months >=50%", "int"),
    ]
    summary_rows = [
        {"period": "Selection 2020-2023", **selection_stats},
        {"period": "Holdout 2024+", **holdout_stats},
        {"period": "Full 2020+", **full_stats},
    ]
    selected_columns = [
        ("name", "Candidate", "str"),
        ("momentum_days", "Momentum days", "str"),
        ("breakout_entry_days", "BO entry", "int"),
        ("breakout_exit_days", "BO exit", "int"),
        ("target_vol", "Target vol", "pct"),
        ("short_multiplier", "Short scale", "num"),
        ("trend_quality_floor", "Quality floor", "num"),
        ("total_return", "Holdout return", "pct"),
        ("cagr", "Holdout CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
    ]
    sensitivity_columns = [
        ("cost_bps", "Cost/side bps", "int"),
        ("funding_mode", "Funding", "str"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
        ("annual_turnover", "Annual turnover", "num"),
    ]
    leverage_columns = [
        ("leverage_scale", "Scale", "num"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
        ("best_month", "Best month", "pct"),
        ("worst_month", "Worst month", "pct"),
        ("months_ge_50pct", "Months >=50%", "int"),
    ]
    benchmark_columns = [
        ("name", "Benchmark", "str"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
    ]
    selected_lookup = selection_df.set_index("name")
    selected_pre_holdout = []
    for candidate in selected:
        row = selected_lookup.loc[candidate.name].to_dict()
        selected_pre_holdout.append(
            {
                "name": candidate.name,
                "momentum_days": candidate.momentum_days,
                "breakout_entry_days": candidate.breakout_entry_days,
                "breakout_exit_days": candidate.breakout_exit_days,
                "target_vol": candidate.target_vol,
                "short_multiplier": candidate.short_multiplier,
                "trend_quality_floor": candidate.trend_quality_floor,
                "selection_score": row["selection_score"],
                "selection_cagr": row["cagr"],
                "selection_dd": row["max_drawdown"],
                "positive_years": row["positive_years"],
            }
        )
    conclusion: list[str] = []
    if holdout_stats["total_return"] > 0 and holdout_stats["sharpe"] >= 0.8:
        conclusion.append("The frozen ensemble retained a positive holdout edge after costs.")
    elif holdout_stats["total_return"] > 0:
        conclusion.append("The holdout result was positive, but risk-adjusted strength remained modest.")
    else:
        conclusion.append("The frozen ensemble failed the holdout and must not be deployed.")
    if holdout_stats["months_ge_50pct"] == 0:
        conclusion.append("No 50% month occurred at the base risk level; 50% monthly is not supported.")
    else:
        conclusion.append("At least one 50% month occurred, but isolated tail months do not establish a sustainable target.")
    robust_positive = sum(
        1
        for row in selected_oos_rows
        if row["total_return"] > 0 and row["max_drawdown"] > -0.35
    )
    conclusion.append(
        f"{robust_positive}/{len(selected_oos_rows)} independently selected ensemble members "
        "were positive in the holdout with drawdown better than -35%."
    )
    report = f"""# BTC Regime-Ensemble Backtest

Generated in GitHub Actions. The architecture and candidate grid were declared before inspecting the 2024+ holdout.

## Architecture

This combines multi-horizon time-series momentum, Donchian breakout state, asymmetric long/short structural filters, trend-quality gating, blended-volatility targeting, cost-aware hysteresis, fixed drawdown de-risking, and a median ensemble of seven diverse configurations selected only on 2020-2023.

Signal is calculated after each completed 4H bar and filled at the next 4H open.

## Data and assumptions

- Market proxy: Binance USD-M `{SYMBOL}` perpetual
- Source candles: 15-minute public archive, aggregated to 4H
- Data: {features.index.min()} through {features.index.max()}
- Candidate-selection period: 2020-01-01 through 2023-12-31
- Untouched holdout: 2024-01-01 onward
- Candidate configurations screened pre-holdout: {len(candidates)}
- Base execution cost: {BASE_ONE_WAY_COST * 10000:.0f} bps per side per unit of exposure changed
- Actual Binance funding loaded: {actual_funding_used}
- Maximum base exposure: 1.5x before sensitivity scaling

## Frozen ensemble result

{markdown_table(summary_rows, main_columns)}

## Seven members selected before holdout

{markdown_table(selected_oos_rows, selected_columns)}

## Pre-holdout selection audit

```json
{json.dumps(selected_pre_holdout, ensure_ascii=False, indent=2, default=str)}
```

## Holdout execution and funding sensitivity

{markdown_table(sensitivity_rows, sensitivity_columns)}

## Holdout risk-scale sensitivity

{markdown_table(leverage_rows, leverage_columns)}

## Holdout benchmarks

{markdown_table(benchmark_rows, benchmark_columns)}

## Bootstrap diagnostic from holdout monthly returns

```json
{json.dumps(bootstrap, ensure_ascii=False, indent=2)}
```

## Mechanical conclusion

{" ".join(conclusion)}

## Limits

1. Binance is a proxy for Aster. Aster fills, fees, funding, mark price, ADL, liquidation, and outages can differ.
2. Candle backtests cannot reproduce order-book impact or transient spread expansion.
3. Screening many pre-declared configurations still creates selection bias; the untouched holdout and member dispersion reduce but do not remove it.
4. A positive holdout is not permission to target 50% monthly. Risk must be set from tolerated drawdown and forward evidence.
"""
    (OUTPUT_DIR / "report.md").write_text(report, encoding="utf-8")
    print("\n" + report)


if __name__ == "__main__":
    main()
