#!/usr/bin/env python3
"""
Multi-perpetual cross-sectional momentum backtest.

The strategy does not try to predict BTC direction from one indicator. It uses:
- a dynamic liquid universe of major USD-M perpetuals,
- cross-sectional relative-strength ranking,
- BTC regime-dependent long/short books,
- inverse-volatility and covariance-aware sizing,
- weekly/3-day low-turnover rebalancing,
- volatility targeting, position caps, and drawdown de-risking,
- parameter selection only before the 2024 holdout,
- an ensemble of diverse configurations.

Important: the fixed major-coin universe introduces survivorship bias. This test is
a research screen, not a production approval.
"""

from __future__ import annotations

import io
import json
import math
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import requests

SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
    "DOGEUSDT", "SOLUSDT", "LINKUSDT", "LTCUSDT", "DOTUSDT", "AVAXUSDT",
]
START_MONTH = "2020-01"
END_MONTH = "2026-06"
SELECTION_START = pd.Timestamp("2021-01-01", tz="UTC")
HOLDOUT_START = pd.Timestamp("2024-01-01", tz="UTC")
ANNUAL_BARS = 6 * 365.25
ONE_WAY_COST = 0.0006
ADVERSE_FUNDING_8H = 0.00005
OUTPUT_DIR = Path("backtest_output_cross_section")
CACHE_DIR = Path(".cache/multiperp_4h")


@dataclass(frozen=True)
class Candidate:
    name: str
    momentum_days: tuple[int, int, int]
    long_k: int
    short_k: int
    bull_short_fraction: float
    bear_long_fraction: float
    target_vol: float
    rebalance_days: int
    max_gross: float = 1.75
    max_asset_weight: float = 0.35


@dataclass
class Simulation:
    returns: pd.Series
    equity: pd.Series
    positions: pd.DataFrame
    turnover: pd.Series
    trading_cost: pd.Series
    funding_cost: pd.Series
    regime: pd.Series
    dd_multiplier: pd.Series


def periods() -> list[pd.Period]:
    return list(pd.period_range(START_MONTH, END_MONTH, freq="M"))


def _timestamp(series: pd.Series) -> pd.Series:
    x = pd.to_numeric(series, errors="coerce")
    median = x.dropna().median()
    unit = "us" if median > 10**14 else "ms"
    return pd.to_datetime(x, unit=unit, utc=True, errors="coerce")


def parse_kline(raw: bytes) -> pd.DataFrame:
    cols = [
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades", "taker_buy_base",
        "taker_buy_quote", "ignore",
    ]
    frame = pd.read_csv(io.BytesIO(raw), header=None)
    frame = frame.iloc[:, : min(frame.shape[1], len(cols))]
    frame.columns = cols[: frame.shape[1]]
    frame["timestamp"] = _timestamp(frame["open_time"])
    for col in ["open", "high", "low", "close", "volume", "quote_volume"]:
        if col in frame:
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
    if "quote_volume" not in frame:
        frame["quote_volume"] = frame["volume"] * frame["close"]
    return frame[
        ["timestamp", "open", "high", "low", "close", "volume", "quote_volume"]
    ].dropna()


def download_one(symbol: str, period: pd.Period) -> tuple[str, pd.Period, pd.DataFrame | None]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = period.strftime("%Y-%m")
    cached = CACHE_DIR / f"{symbol}-4h-{stamp}.csv"
    if cached.exists() and cached.stat().st_size > 0:
        return symbol, period, pd.read_csv(cached, parse_dates=["timestamp"])
    url = (
        "https://data.binance.vision/data/futures/um/monthly/klines/"
        f"{symbol}/4h/{symbol}-4h-{stamp}.zip"
    )
    session = requests.Session()
    session.headers.update({"User-Agent": "disdex-cross-sectional-research/1.0"})
    for attempt in range(3):
        try:
            response = session.get(url, timeout=60)
            if response.status_code == 404:
                return symbol, period, None
            response.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
                if not names:
                    return symbol, period, None
                frame = parse_kline(archive.read(names[0]))
                frame.to_csv(cached, index=False)
                return symbol, period, frame
        except Exception as exc:
            if attempt == 2:
                print(f"WARN {symbol} {stamp}: {exc}")
                return symbol, period, None
            time.sleep(0.75 * (attempt + 1))
    return symbol, period, None


def load_universe() -> dict[str, pd.DataFrame]:
    jobs = [(symbol, period) for symbol in SYMBOLS for period in periods()]
    collected: dict[str, list[pd.DataFrame]] = {s: [] for s in SYMBOLS}
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = [pool.submit(download_one, symbol, period) for symbol, period in jobs]
        for n, future in enumerate(as_completed(futures), start=1):
            symbol, period, frame = future.result()
            if frame is not None and not frame.empty:
                collected[symbol].append(frame)
            if n % 100 == 0:
                print(f"Downloaded/checked {n}/{len(jobs)} monthly files")
    out: dict[str, pd.DataFrame] = {}
    for symbol, frames in collected.items():
        if not frames:
            continue
        frame = pd.concat(frames, ignore_index=True)
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
        frame = (
            frame.drop_duplicates("timestamp", keep="last")
            .sort_values("timestamp")
            .set_index("timestamp")
        )
        out[symbol] = frame
        print(f"{symbol}: {len(frame):,} bars, {frame.index.min()} -> {frame.index.max()}")
    if "BTCUSDT" not in out or len(out) < 7:
        raise RuntimeError("Insufficient multi-asset coverage")
    return out


def aligned_panel(data: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    index = pd.date_range(
        min(frame.index.min() for frame in data.values()),
        max(frame.index.max() for frame in data.values()),
        freq="4h",
        tz="UTC",
    )
    panels = {}
    for field in ["open", "close", "quote_volume"]:
        panels[field] = pd.DataFrame(
            {symbol: frame[field].reindex(index) for symbol, frame in data.items()},
            index=index,
        )
    panels["asset_return"] = panels["open"].shift(-1) / panels["open"] - 1.0
    return panels


def features(panel: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame | pd.Series]:
    close = panel["close"]
    logret = np.log(close).diff()
    rv21 = logret.rolling(21 * 6, min_periods=14 * 6).std() * math.sqrt(ANNUAL_BARS)
    liquidity = panel["quote_volume"].rolling(30 * 6, min_periods=10 * 6).median()
    btc = close["BTCUSDT"]
    btc_ema60 = btc.ewm(span=60 * 6, adjust=False, min_periods=60 * 6).mean()
    btc_ema200 = btc.ewm(span=200 * 6, adjust=False, min_periods=200 * 6).mean()
    btc_mom90 = btc / btc.shift(90 * 6) - 1.0
    regime = pd.Series("neutral", index=close.index, dtype="object")
    regime.loc[(btc > btc_ema200) & (btc_ema60 > btc_ema200) & (btc_mom90 > 0)] = "bull"
    regime.loc[(btc < btc_ema200) & (btc_ema60 < btc_ema200) & (btc_mom90 < 0)] = "bear"
    available_history = close.notna().rolling(180 * 6, min_periods=1).sum() >= 150 * 6
    return {
        "close": close,
        "asset_return": panel["asset_return"],
        "rv21": rv21,
        "liquidity": liquidity,
        "regime": regime,
        "available_history": available_history,
    }


def momentum_score(close: pd.DataFrame, rv21: pd.DataFrame, days: tuple[int, int, int]) -> pd.DataFrame:
    sleeves = []
    for horizon in days:
        lr = np.log(close / close.shift(horizon * 6))
        hvol = rv21.clip(lower=0.10) * math.sqrt(horizon / 365.25)
        sleeves.append(np.tanh(lr / hvol.replace(0, np.nan) / 1.75))
    score = sum(sleeves) / len(sleeves)
    return score.sub(score.median(axis=1), axis=0)


def inverse_vol_book(
    selected: list[str],
    side: float,
    rv_row: pd.Series,
    gross: float,
    max_asset_weight: float,
) -> pd.Series:
    if not selected or gross <= 0:
        return pd.Series(dtype=float)
    vols = rv_row[selected].replace([np.inf, -np.inf], np.nan).dropna().clip(lower=0.15)
    if vols.empty:
        return pd.Series(dtype=float)
    weights = 1.0 / vols
    weights = weights / weights.sum() * gross
    weights = weights.clip(upper=max_asset_weight)
    if weights.sum() > 0:
        weights = weights / weights.sum() * min(gross, max_asset_weight * len(weights))
    return side * weights


def target_positions(
    fx: dict[str, pd.DataFrame | pd.Series],
    candidate: Candidate,
) -> pd.DataFrame:
    close = fx["close"]
    rv21 = fx["rv21"]
    liquidity = fx["liquidity"]
    available = fx["available_history"]
    regime = fx["regime"]
    asset_ret = fx["asset_return"]
    score = momentum_score(close, rv21, candidate.momentum_days)
    targets = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    rebalance_bars = candidate.rebalance_days * 6
    for i in range(200 * 6, len(close) - 1):
        if i % rebalance_bars != 0:
            targets.iloc[i] = targets.iloc[i - 1]
            continue
        valid = (
            available.iloc[i]
            & close.iloc[i].notna()
            & rv21.iloc[i].notna()
            & liquidity.iloc[i].notna()
        )
        valid_symbols = list(close.columns[valid])
        if len(valid_symbols) < candidate.long_k + candidate.short_k + 2:
            targets.iloc[i] = targets.iloc[i - 1]
            continue
        liq_ranked = (
            liquidity.iloc[i][valid_symbols]
            .sort_values(ascending=False)
            .head(min(9, len(valid_symbols)))
            .index
        )
        ranked = score.iloc[i][liq_ranked].dropna().sort_values()
        if len(ranked) < candidate.long_k + candidate.short_k:
            targets.iloc[i] = targets.iloc[i - 1]
            continue
        longs = list(ranked.tail(candidate.long_k).index)
        shorts = list(ranked.head(candidate.short_k).index)
        state = regime.iloc[i]
        if state == "bull":
            long_gross, short_gross = 1.0, candidate.bull_short_fraction
            shorts = [s for s in shorts if ranked[s] < -0.15]
        elif state == "bear":
            long_gross, short_gross = candidate.bear_long_fraction, 1.0
            longs = [s for s in longs if ranked[s] > 0.15]
        else:
            long_gross, short_gross = 0.60, 0.60
        w = pd.Series(0.0, index=close.columns)
        lw = inverse_vol_book(longs, 1.0, rv21.iloc[i], long_gross, candidate.max_asset_weight)
        sw = inverse_vol_book(shorts, -1.0, rv21.iloc[i], short_gross, candidate.max_asset_weight)
        w.loc[lw.index] += lw
        w.loc[sw.index] += sw
        history = asset_ret.iloc[max(0, i - 30 * 6):i][w.index]
        active = w[w != 0].index
        if len(active) and len(history) >= 20:
            cov = history[active].cov().to_numpy(float) * ANNUAL_BARS
            vec = w[active].to_numpy(float)
            variance = float(vec @ cov @ vec)
            estimated_vol = math.sqrt(max(variance, 1e-10))
            scale = min(candidate.target_vol / estimated_vol, 2.0)
            w *= scale
        gross_now = float(w.abs().sum())
        if gross_now > candidate.max_gross:
            w *= candidate.max_gross / gross_now
        w = w.clip(-candidate.max_asset_weight, candidate.max_asset_weight)
        targets.iloc[i] = w
    return targets.ffill().fillna(0.0)


def simulate(
    fx: dict[str, pd.DataFrame | pd.Series],
    target: pd.DataFrame,
    funding_8h: float = ADVERSE_FUNDING_8H,
    one_way_cost: float = ONE_WAY_COST,
    risk_scale: float = 1.0,
    use_dd_overlay: bool = True,
) -> Simulation:
    returns_matrix = fx["asset_return"].fillna(0.0)
    planned = target.shift(1).fillna(0.0) * risk_scale
    planned = planned.clip(-0.60, 0.60)
    ret = np.zeros(len(planned))
    turnover = np.zeros(len(planned))
    tcost = np.zeros(len(planned))
    fcost = np.zeros(len(planned))
    ddmult = np.ones(len(planned))
    actual = np.zeros_like(planned.to_numpy(float))
    equity = 1.0
    peak = 1.0
    previous = np.zeros(planned.shape[1], dtype=float)
    p = planned.to_numpy(float)
    r = returns_matrix.to_numpy(float)
    for i in range(len(planned)):
        dd = equity / peak - 1.0
        mult = 1.0
        if use_dd_overlay:
            if dd <= -0.25:
                mult = 0.25
            elif dd <= -0.16:
                mult = 0.50
            elif dd <= -0.10:
                mult = 0.75
        pos = p[i] * mult
        change = float(np.abs(pos - previous).sum())
        trade_cost = one_way_cost * change
        fund_cost = float(np.abs(pos).sum()) * funding_8h / 2.0
        bar_ret = max(float(np.nansum(pos * r[i])) - trade_cost - fund_cost, -0.95)
        ret[i] = bar_ret
        turnover[i] = change
        tcost[i] = trade_cost
        fcost[i] = fund_cost
        ddmult[i] = mult
        actual[i] = pos
        equity *= 1.0 + bar_ret
        peak = max(peak, equity)
        previous = pos
    ret_s = pd.Series(ret, index=planned.index, name="strategy_return")
    return Simulation(
        returns=ret_s,
        equity=(1 + ret_s).cumprod().rename("equity"),
        positions=pd.DataFrame(actual, index=planned.index, columns=planned.columns),
        turnover=pd.Series(turnover, index=planned.index, name="turnover"),
        trading_cost=pd.Series(tcost, index=planned.index, name="trading_cost"),
        funding_cost=pd.Series(fcost, index=planned.index, name="funding_cost"),
        regime=fx["regime"].copy(),
        dd_multiplier=pd.Series(ddmult, index=planned.index, name="dd_multiplier"),
    )


def cut(series: pd.Series, start: pd.Timestamp, end: pd.Timestamp | None = None) -> pd.Series:
    if end is None:
        return series.loc[series.index >= start]
    return series.loc[(series.index >= start) & (series.index < end)]


def max_dd(ret: pd.Series) -> float:
    eq = (1 + ret).cumprod()
    return float((eq / eq.cummax() - 1).min())


def cagr(ret: pd.Series) -> float:
    days = max((ret.index[-1] - ret.index[0]).total_seconds() / 86400, 1)
    total = float((1 + ret).prod())
    return -1.0 if total <= 0 else total ** (365.25 / days) - 1


def sharpe(ret: pd.Series) -> float:
    sd = ret.std(ddof=1)
    return float(ret.mean() / sd * math.sqrt(ANNUAL_BARS)) if sd > 0 else float("nan")


def summarize(sim: Simulation, start: pd.Timestamp, end: pd.Timestamp | None = None) -> dict:
    ret = cut(sim.returns, start, end)
    pos = sim.positions.loc[ret.index]
    turn = cut(sim.turnover, start, end)
    monthly = (1 + ret).resample("ME").prod() - 1
    years = max((ret.index[-1] - ret.index[0]).total_seconds() / (365.25 * 86400), 1 / 365.25)
    return {
        "start": str(ret.index.min()),
        "end": str(ret.index.max()),
        "total_return": float((1 + ret).prod() - 1),
        "cagr": cagr(ret),
        "max_drawdown": max_dd(ret),
        "sharpe": sharpe(ret),
        "average_month": float(monthly.mean()),
        "median_month": float(monthly.median()),
        "best_month": float(monthly.max()),
        "worst_month": float(monthly.min()),
        "positive_month_ratio": float((monthly > 0).mean()),
        "months_ge_20pct": int((monthly >= 0.20).sum()),
        "months_ge_50pct": int((monthly >= 0.50).sum()),
        "annual_turnover": float(turn.sum() / years),
        "average_gross": float(pos.abs().sum(axis=1).mean()),
        "average_net": float(pos.sum(axis=1).mean()),
        "max_gross": float(pos.abs().sum(axis=1).max()),
        "trading_cost_total": float(cut(sim.trading_cost, start, end).sum()),
        "funding_cost_total": float(cut(sim.funding_cost, start, end).sum()),
    }


def score_selection(stats: dict, annual: pd.Series) -> float:
    if len(annual) < 3:
        return -999.0
    return (
        1.4 * float(annual.median())
        + 0.5 * float(annual.min())
        + 0.4 * stats["cagr"]
        + 0.10 * np.nan_to_num(stats["sharpe"], nan=-3.0)
        + 0.70 * stats["max_drawdown"]
        + 0.10 * float((annual > 0).mean())
        - 0.0015 * stats["annual_turnover"]
    )


def candidates() -> list[Candidate]:
    horizons = [(7, 21, 63), (14, 42, 84), (21, 63, 126)]
    out = []
    n = 1
    for h in horizons:
        for long_k in [2, 3]:
            for short_k in [2, 3]:
                for bull_short in [0.0, 0.25]:
                    for target_vol in [0.25, 0.35, 0.45]:
                        for rebalance in [3, 7]:
                            out.append(
                                Candidate(
                                    name=f"X{n:03d}",
                                    momentum_days=h,
                                    long_k=long_k,
                                    short_k=short_k,
                                    bull_short_fraction=bull_short,
                                    bear_long_fraction=0.25,
                                    target_vol=target_vol,
                                    rebalance_days=rebalance,
                                )
                            )
                            n += 1
    return out


def choose_diverse(ranked: pd.DataFrame, cmap: dict[str, Candidate], count: int = 7) -> list[Candidate]:
    selected = []
    for row in ranked.itertuples(index=False):
        c = cmap[row.name]
        sig = (c.momentum_days, c.long_k, c.short_k, c.rebalance_days)
        if any((x.momentum_days, x.long_k, x.short_k, x.rebalance_days) == sig for x in selected):
            continue
        selected.append(c)
        if len(selected) == count:
            return selected
    return selected


def fmt_pct(x: float) -> str:
    return "n/a" if not np.isfinite(x) else f"{x * 100:.2f}%"


def fmt_num(x: float) -> str:
    return "n/a" if not np.isfinite(x) else f"{x:.2f}"


def table(rows: list[dict], cols: list[tuple[str, str, str]]) -> str:
    lines = [
        "| " + " | ".join(label for _, label, _ in cols) + " |",
        "| " + " | ".join("---" for _ in cols) + " |",
    ]
    for row in rows:
        vals = []
        for key, _, kind in cols:
            value = row[key]
            if kind == "pct":
                vals.append(fmt_pct(float(value)))
            elif kind == "num":
                vals.append(fmt_num(float(value)))
            elif kind == "int":
                vals.append(str(int(value)))
            else:
                vals.append(str(value))
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines)


def benchmark(fx: dict[str, pd.DataFrame | pd.Series]) -> pd.Series:
    ret = fx["asset_return"].fillna(0.0)
    valid = fx["available_history"] & fx["close"].notna()
    weights = valid.astype(float)
    weights = weights.div(weights.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    scheduled = pd.DataFrame(np.nan, index=weights.index, columns=weights.columns)
    scheduled.iloc[:: 30 * 6] = weights.iloc[:: 30 * 6]
    scheduled = scheduled.ffill().fillna(0.0).shift(1).fillna(0.0)
    turn = scheduled.diff().abs().sum(axis=1).fillna(scheduled.abs().sum(axis=1))
    return (scheduled * ret).sum(axis=1) - ONE_WAY_COST * turn


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    data = load_universe()
    panel = aligned_panel(data)
    fx = features(panel)
    index = fx["close"].index
    valid_index = index[
        (index >= SELECTION_START)
        & (index <= pd.Timestamp("2026-06-30 20:00", tz="UTC"))
    ]
    for key, value in list(fx.items()):
        fx[key] = value.loc[valid_index]
    fx["asset_return"] = fx["asset_return"].fillna(0.0)
    grid = candidates()
    cmap = {c.name: c for c in grid}
    targets = {}
    selection_rows = []
    print(f"Evaluating {len(grid)} cross-sectional candidates")
    for c in grid:
        target = target_positions(fx, c)
        targets[c.name] = target
        sim = simulate(fx, target)
        stats = summarize(sim, SELECTION_START, HOLDOUT_START)
        annual = (1 + cut(sim.returns, SELECTION_START, HOLDOUT_START)).resample("YE").prod() - 1
        selection_rows.append(
            {
                **asdict(c),
                **stats,
                "selection_score": score_selection(stats, annual),
                "positive_years": int((annual > 0).sum()),
                "worst_year": float(annual.min()),
                "median_year": float(annual.median()),
            }
        )
    ranking = pd.DataFrame(selection_rows).sort_values(
        ["selection_score", "cagr"], ascending=False
    )
    chosen = choose_diverse(ranking, cmap, 7)
    chosen_names = [c.name for c in chosen]
    print("Chosen:", chosen_names)
    ensemble_target = sum(targets[name] for name in chosen_names) / len(chosen_names)
    ensemble = simulate(fx, ensemble_target)
    selection_stats = summarize(ensemble, SELECTION_START, HOLDOUT_START)
    holdout_stats = summarize(ensemble, HOLDOUT_START)
    full_stats = summarize(ensemble, SELECTION_START)
    member_rows = []
    for c in chosen:
        member_rows.append({**asdict(c), **summarize(simulate(fx, targets[c.name]), HOLDOUT_START)})
    sensitivity = []
    for cost_bps in [4, 6, 8, 10, 12]:
        for funding_bp in [0.0, 0.00005, 0.00010]:
            sim = simulate(
                fx,
                ensemble_target,
                one_way_cost=cost_bps / 10000,
                funding_8h=funding_bp,
            )
            sensitivity.append(
                {
                    "cost_bps": cost_bps,
                    "funding_bp_8h": funding_bp * 10000,
                    **summarize(sim, HOLDOUT_START),
                }
            )
    scales = []
    for scale in [0.75, 1.0, 1.25, 1.5, 2.0]:
        scales.append(
            {
                "scale": scale,
                **summarize(simulate(fx, ensemble_target, risk_scale=scale), HOLDOUT_START),
            }
        )
    bench_ret = benchmark(fx)
    fake = Simulation(
        returns=bench_ret,
        equity=(1 + bench_ret).cumprod(),
        positions=pd.DataFrame(0.0, index=bench_ret.index, columns=fx["close"].columns),
        turnover=pd.Series(0.0, index=bench_ret.index),
        trading_cost=pd.Series(0.0, index=bench_ret.index),
        funding_cost=pd.Series(0.0, index=bench_ret.index),
        regime=fx["regime"],
        dd_multiplier=pd.Series(1.0, index=bench_ret.index),
    )
    benchmark_stats = summarize(fake, HOLDOUT_START)
    monthly = (1 + cut(ensemble.returns, HOLDOUT_START)).resample("ME").prod() - 1
    positions_export = ensemble.positions.copy()
    positions_export["strategy_return"] = ensemble.returns
    positions_export["equity"] = ensemble.equity
    positions_export["turnover"] = ensemble.turnover
    positions_export["regime"] = ensemble.regime
    positions_export.to_csv(OUTPUT_DIR / "positions_and_equity.csv")
    ranking.to_csv(OUTPUT_DIR / "candidate_selection.csv", index=False)
    pd.DataFrame(member_rows).to_csv(OUTPUT_DIR / "selected_members_holdout.csv", index=False)
    pd.DataFrame(sensitivity).to_csv(OUTPUT_DIR / "sensitivity.csv", index=False)
    monthly.rename("return").to_csv(OUTPUT_DIR / "holdout_monthly.csv")
    payload = {
        "universe": list(fx["close"].columns),
        "chosen": [asdict(c) for c in chosen],
        "selection": selection_stats,
        "holdout": holdout_stats,
        "full": full_stats,
        "members": member_rows,
        "sensitivity": sensitivity,
        "scales": scales,
        "benchmark": benchmark_stats,
    }
    (OUTPUT_DIR / "metrics.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    summary_cols = [
        ("period", "Period", "str"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
        ("average_month", "Avg month", "pct"),
        ("median_month", "Median month", "pct"),
        ("best_month", "Best month", "pct"),
        ("worst_month", "Worst month", "pct"),
        ("positive_month_ratio", "Positive months", "pct"),
        ("average_gross", "Avg gross", "num"),
        ("annual_turnover", "Annual turnover", "num"),
        ("months_ge_50pct", "Months >=50%", "int"),
    ]
    summary = [
        {"period": "Selection 2021-2023", **selection_stats},
        {"period": "Holdout 2024+", **holdout_stats},
        {"period": "Full 2021+", **full_stats},
    ]
    member_cols = [
        ("name", "Member", "str"),
        ("momentum_days", "Momentum", "str"),
        ("long_k", "Long K", "int"),
        ("short_k", "Short K", "int"),
        ("bull_short_fraction", "Bull short", "num"),
        ("target_vol", "Target vol", "pct"),
        ("rebalance_days", "Rebalance days", "int"),
        ("total_return", "Holdout return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
    ]
    sens_cols = [
        ("cost_bps", "Cost bps", "int"),
        ("funding_bp_8h", "Funding bp/8h", "num"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
    ]
    scale_cols = [
        ("scale", "Scale", "num"),
        ("total_return", "Return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown", "Max DD", "pct"),
        ("sharpe", "Sharpe", "num"),
        ("best_month", "Best month", "pct"),
        ("worst_month", "Worst month", "pct"),
        ("months_ge_50pct", "Months >=50%", "int"),
    ]
    robust = sum(
        1 for row in member_rows if row["total_return"] > 0 and row["max_drawdown"] > -0.35
    )
    report = f"""# Multi-Perpetual Cross-Sectional Backtest

## Thesis

The return source is **relative strength among liquid large-cap perpetuals**, not a single BTC directional forecast. The strategy ranks assets, builds a regime-dependent long/short book, sizes by inverse volatility and covariance, and rebalances only every 3 or 7 days.

## Test design

- Universe: {", ".join(fx["close"].columns)}
- Data: {fx["close"].index.min()} through {fx["close"].index.max()}
- Selection: 2021-2023
- Untouched holdout: 2024 onward
- Pre-declared candidates: {len(grid)}
- Selected ensemble members: {chosen_names}
- Cost: {ONE_WAY_COST * 10000:.0f} bps per unit of position change
- Base funding stress: {ADVERSE_FUNDING_8H * 10000:.1f} bp per 8 hours on absolute gross
- Maximum portfolio gross: 1.75x
- Entries are based on completed 4H data and applied to the next 4H open

## Ensemble results

{table(summary, summary_cols)}

## Seven independently selected members

{table(member_rows, member_cols)}

## Cost and funding stress — holdout

{table(sensitivity, sens_cols)}

## Risk scale — holdout

{table(scales, scale_cols)}

## Holdout equal-weight long-only universe benchmark

{table([{"period": "benchmark", **benchmark_stats}], summary_cols)}

## Mechanical assessment

- Positive, sub-35% DD members: {robust}/{len(member_rows)}
- Base holdout return: {fmt_pct(holdout_stats["total_return"])}
- Base holdout CAGR: {fmt_pct(holdout_stats["cagr"])}
- Base holdout max DD: {fmt_pct(holdout_stats["max_drawdown"])}
- Base holdout Sharpe: {fmt_num(holdout_stats["sharpe"])}
- 50% months: {holdout_stats["months_ge_50pct"]}

## Critical limitations

1. The major-coin universe was fixed with hindsight and therefore has survivorship bias.
2. Binance USD-M is a proxy for Aster; contract availability, fills, funding, and outages differ.
3. Funding is stressed as a constant adverse charge rather than exact symbol-by-symbol history.
4. Candle data cannot reproduce order-book slippage, liquidation queues, or ADL.
5. Candidate search creates selection bias even with a held-out period. Forward paper trading is still mandatory.
"""
    (OUTPUT_DIR / "report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
