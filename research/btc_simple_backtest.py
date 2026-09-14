#!/usr/bin/env python3
"""
Reproducible BTCUSDT 15-minute futures backtest.

Purpose:
- Screen a deliberately simple "4H trend + 15m pullback" strategy.
- Avoid fitting parameters to the out-of-sample period.
- Include taker/slippage costs and a conservative funding drag.
- Compare a fixed baseline with a small robustness grid.

This is research code, not production trading code.
"""

from __future__ import annotations

import io
import json
import math
import os
import time
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import requests


DATA_START = os.getenv("BTC_DATA_START", "2020-01")
DATA_END = os.getenv("BTC_DATA_END", "2026-06")
SYMBOL = "BTCUSDT"
INTERVAL = "15m"
OUTPUT_DIR = Path("backtest_output")
CACHE_DIR = Path(".cache/btcusdt_15m")

# Conservative execution assumptions.
ONE_WAY_COST = 0.0006       # 6 bps per side: fee + slippage allowance.
FUNDING_PER_8H = 0.0001     # 1 bp every 8h, always charged (conservative).
MAX_HOLD_BARS = 5 * 24 * 4  # 5 days on 15m bars.
OOS_START = pd.Timestamp("2024-01-01", tz="UTC")


@dataclass(frozen=True)
class StrategyParams:
    h4_fast: int = 50
    h4_slow: int = 200
    pullback_ema: int = 20
    local_trend_ema: int = 50
    atr_period: int = 14
    stop_atr: float = 1.5
    target_atr: float = 3.0


def month_range(start: str, end: str) -> Iterable[pd.Period]:
    return pd.period_range(start=start, end=end, freq="M")


def _to_utc_datetime(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    median = numeric.dropna().median()
    if pd.isna(median):
        raise ValueError("No valid timestamps found")
    unit = "us" if median > 10**14 else "ms"
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def _parse_binance_kline_csv(raw: bytes) -> pd.DataFrame:
    cols = [
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades", "taker_buy_base",
        "taker_buy_quote", "ignore",
    ]
    frame = pd.read_csv(io.BytesIO(raw), header=None)
    # Some archives may include a header row.
    if frame.shape[1] < 6:
        raise ValueError(f"Unexpected Binance kline shape: {frame.shape}")
    frame = frame.iloc[:, : min(frame.shape[1], len(cols))]
    frame.columns = cols[: frame.shape[1]]
    frame["timestamp"] = _to_utc_datetime(frame["open_time"])
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame[["timestamp", "open", "high", "low", "close", "volume"]].dropna()


def _download_month(period: pd.Period, session: requests.Session) -> pd.DataFrame | None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = period.strftime("%Y-%m")
    cached = CACHE_DIR / f"{SYMBOL}-{INTERVAL}-{stamp}.csv"
    if cached.exists() and cached.stat().st_size > 0:
        return pd.read_csv(cached, parse_dates=["timestamp"])

    url = (
        "https://data.binance.vision/data/futures/um/monthly/klines/"
        f"{SYMBOL}/{INTERVAL}/{SYMBOL}-{INTERVAL}-{stamp}.zip"
    )
    for attempt in range(3):
        try:
            response = session.get(url, timeout=90)
            if response.status_code == 404:
                print(f"SKIP missing month: {stamp}")
                return None
            response.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
                if not names:
                    raise ValueError(f"No CSV in archive {url}")
                parsed = _parse_binance_kline_csv(archive.read(names[0]))
                parsed.to_csv(cached, index=False)
                print(f"Downloaded {stamp}: {len(parsed):,} bars")
                return parsed
        except Exception as exc:
            if attempt == 2:
                print(f"WARN failed {stamp}: {exc}")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def _fallback_github_data(session: requests.Session) -> pd.DataFrame:
    urls = [
        "https://raw.githubusercontent.com/ArthurRoque/BTCUSDT/main/BTCUSDT_15MIN_2017_2020.csv",
        "https://raw.githubusercontent.com/ArthurRoque/BTCUSDT/main/BTCUSDT_15MIN_2021_2023.csv",
    ]
    frames: list[pd.DataFrame] = []
    for url in urls:
        response = session.get(url, timeout=180)
        response.raise_for_status()
        frame = pd.read_csv(io.BytesIO(response.content))
        frame.columns = [str(c).strip().lower() for c in frame.columns]
        frame["timestamp"] = pd.to_datetime(frame["date"], utc=True, errors="coerce")
        for col in ["open", "high", "low", "close", "volume"]:
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
        frames.append(frame[["timestamp", "open", "high", "low", "close", "volume"]])
    return pd.concat(frames, ignore_index=True).dropna()


def load_data() -> pd.DataFrame:
    session = requests.Session()
    session.headers.update({"User-Agent": "disdex-btc-research/1.0"})
    frames = [
        frame
        for period in month_range(DATA_START, DATA_END)
        if (frame := _download_month(period, session)) is not None
    ]

    if len(frames) < 12:
        print("Monthly archive coverage is insufficient; using GitHub fallback through 2023.")
        frames.append(_fallback_github_data(session))

    data = pd.concat(frames, ignore_index=True)
    data["timestamp"] = pd.to_datetime(data["timestamp"], utc=True)
    data = (
        data.drop_duplicates("timestamp", keep="last")
        .sort_values("timestamp")
        .set_index("timestamp")
    )
    start = pd.Timestamp(f"{DATA_START}-01", tz="UTC")
    end = (pd.Period(DATA_END, freq="M") + 1).start_time.tz_localize("UTC")
    data = data.loc[(data.index >= start) & (data.index < end)]
    expected_step = pd.Timedelta(minutes=15)
    gaps = data.index.to_series().diff().gt(expected_step).sum()
    print(
        f"Loaded {len(data):,} bars: {data.index.min()} -> {data.index.max()} "
        f"(gaps >15m: {int(gaps)})"
    )
    if len(data) < 200 * 24 * 4:
        raise RuntimeError("Not enough 15-minute data for a meaningful test")
    return data


def atr(frame: pd.DataFrame, period: int) -> pd.Series:
    previous_close = frame["close"].shift(1)
    tr = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous_close).abs(),
            (frame["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def prepare_features(data: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    out = data.copy()
    out["atr"] = atr(out, params.atr_period)
    out["pullback_ema"] = out["close"].ewm(
        span=params.pullback_ema, adjust=False, min_periods=params.pullback_ema
    ).mean()
    out["local_trend_ema"] = out["close"].ewm(
        span=params.local_trend_ema,
        adjust=False,
        min_periods=params.local_trend_ema,
    ).mean()

    h4 = out[["open", "high", "low", "close", "volume"]].resample(
        "4h", label="right", closed="left"
    ).agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    ).dropna()
    h4["fast"] = h4["close"].ewm(
        span=params.h4_fast, adjust=False, min_periods=params.h4_fast
    ).mean()
    h4["slow"] = h4["close"].ewm(
        span=params.h4_slow, adjust=False, min_periods=params.h4_slow
    ).mean()
    h4["fast_slope"] = h4["fast"].diff(3)

    # The 4H bar is labelled at its closing boundary, so forward-filling does not
    # expose incomplete future 4H information to earlier 15m bars.
    aligned = h4[["close", "fast", "slow", "fast_slope"]].reindex(
        out.index, method="ffill"
    )
    out["h4_close"] = aligned["close"]
    out["h4_fast"] = aligned["fast"]
    out["h4_slow"] = aligned["slow"]
    out["h4_fast_slope"] = aligned["fast_slope"]

    out["long_regime"] = (
        (out["h4_close"] > out["h4_fast"])
        & (out["h4_fast"] > out["h4_slow"])
        & (out["h4_fast_slope"] > 0)
    )
    out["short_regime"] = (
        (out["h4_close"] < out["h4_fast"])
        & (out["h4_fast"] < out["h4_slow"])
        & (out["h4_fast_slope"] < 0)
    )

    # Signal on completed 15m close; execution is the next bar open.
    out["long_signal"] = (
        out["long_regime"]
        & (out["close"].shift(1) <= out["pullback_ema"].shift(1))
        & (out["close"] > out["pullback_ema"])
        & (out["close"] > out["local_trend_ema"])
    )
    out["short_signal"] = (
        out["short_regime"]
        & (out["close"].shift(1) >= out["pullback_ema"].shift(1))
        & (out["close"] < out["pullback_ema"])
        & (out["close"] < out["local_trend_ema"])
    )
    return out.dropna(
        subset=[
            "atr", "pullback_ema", "local_trend_ema",
            "h4_close", "h4_fast", "h4_slow", "h4_fast_slope",
        ]
    )


def run_backtest(features: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    idx = features.index
    o = features["open"].to_numpy(float)
    h = features["high"].to_numpy(float)
    l = features["low"].to_numpy(float)
    c = features["close"].to_numpy(float)
    a = features["atr"].to_numpy(float)
    long_regime = features["long_regime"].to_numpy(bool)
    short_regime = features["short_regime"].to_numpy(bool)
    long_signal = features["long_signal"].to_numpy(bool)
    short_signal = features["short_signal"].to_numpy(bool)

    position: dict | None = None
    trades: list[dict] = []

    for i in range(len(features) - 1):
        if position is not None and i >= position["entry_i"]:
            direction = position["direction"]
            exit_price: float | None = None
            exit_reason: str | None = None

            # Conservative rule: if stop and target are both touched in one bar,
            # assume the stop happened first.
            if direction == 1:
                if l[i] <= position["stop"]:
                    exit_price, exit_reason = position["stop"], "stop"
                elif h[i] >= position["target"]:
                    exit_price, exit_reason = position["target"], "target"
                elif not long_regime[i]:
                    exit_price, exit_reason = c[i], "regime_flip"
            else:
                if h[i] >= position["stop"]:
                    exit_price, exit_reason = position["stop"], "stop"
                elif l[i] <= position["target"]:
                    exit_price, exit_reason = position["target"], "target"
                elif not short_regime[i]:
                    exit_price, exit_reason = c[i], "regime_flip"

            if (
                exit_price is None
                and i - position["entry_i"] + 1 >= MAX_HOLD_BARS
            ):
                exit_price, exit_reason = c[i], "time_exit"

            if exit_price is not None:
                held_bars = i - position["entry_i"] + 1
                gross = direction * (exit_price / position["entry_price"] - 1)
                funding = FUNDING_PER_8H * (held_bars * 0.25 / 8)
                net = gross - 2 * ONE_WAY_COST - funding
                trades.append(
                    {
                        "entry_time": idx[position["entry_i"]],
                        "exit_time": idx[i],
                        "side": "long" if direction == 1 else "short",
                        "entry_price": position["entry_price"],
                        "exit_price": exit_price,
                        "stop_price": position["stop"],
                        "target_price": position["target"],
                        "held_bars": held_bars,
                        "held_hours": held_bars * 0.25,
                        "gross_return": gross,
                        "execution_cost": 2 * ONE_WAY_COST,
                        "funding_drag": funding,
                        "net_return_1x": net,
                        "exit_reason": exit_reason,
                    }
                )
                position = None

        if position is None:
            direction = 1 if long_signal[i] else (-1 if short_signal[i] else 0)
            if direction and np.isfinite(a[i]) and a[i] > 0:
                entry_i = i + 1
                entry_price = o[entry_i]
                risk = params.stop_atr * a[i]
                target_distance = params.target_atr * a[i]
                if direction == 1:
                    stop = entry_price - risk
                    target = entry_price + target_distance
                else:
                    stop = entry_price + risk
                    target = entry_price - target_distance
                if stop > 0 and target > 0:
                    position = {
                        "direction": direction,
                        "entry_i": entry_i,
                        "entry_price": entry_price,
                        "stop": stop,
                        "target": target,
                    }

    if position is not None:
        i = len(features) - 1
        held_bars = i - position["entry_i"] + 1
        direction = position["direction"]
        gross = direction * (c[i] / position["entry_price"] - 1)
        funding = FUNDING_PER_8H * (held_bars * 0.25 / 8)
        trades.append(
            {
                "entry_time": idx[position["entry_i"]],
                "exit_time": idx[i],
                "side": "long" if direction == 1 else "short",
                "entry_price": position["entry_price"],
                "exit_price": c[i],
                "stop_price": position["stop"],
                "target_price": position["target"],
                "held_bars": held_bars,
                "held_hours": held_bars * 0.25,
                "gross_return": gross,
                "execution_cost": 2 * ONE_WAY_COST,
                "funding_drag": funding,
                "net_return_1x": gross - 2 * ONE_WAY_COST - funding,
                "exit_reason": "end_of_data",
            }
        )

    result = pd.DataFrame(trades)
    if not result.empty:
        result["entry_time"] = pd.to_datetime(result["entry_time"], utc=True)
        result["exit_time"] = pd.to_datetime(result["exit_time"], utc=True)
    return result


def equity_and_monthly(
    trades: pd.DataFrame,
    start: pd.Timestamp,
    end: pd.Timestamp,
    leverage: float,
) -> tuple[pd.Series, pd.Series]:
    daily_index = pd.date_range(
        start=start.normalize(), end=end.normalize(), freq="D", tz="UTC"
    )
    equity = pd.Series(1.0, index=daily_index, dtype=float)
    current = 1.0
    exit_events: dict[pd.Timestamp, float] = {}
    for row in trades.itertuples(index=False):
        scaled_return = leverage * float(row.net_return_1x)
        # Guard against impossible negative equity in an approximate leverage
        # sensitivity run; this is also a visible failure signal.
        current *= max(0.0, 1.0 + scaled_return)
        exit_events[pd.Timestamp(row.exit_time).normalize()] = current
        if current <= 0:
            break
    for date, value in exit_events.items():
        if date in equity.index:
            equity.loc[date] = value
    equity = equity.replace(1.0, np.nan) if exit_events else equity
    equity.iloc[0] = 1.0
    equity = equity.ffill().fillna(1.0)
    monthly = equity.resample("ME").last().pct_change().dropna()
    return equity, monthly


def metric_block(
    trades: pd.DataFrame,
    start: pd.Timestamp,
    end: pd.Timestamp,
    leverage: float,
    total_bars: int,
) -> dict:
    if trades.empty:
        return {
            "leverage": leverage,
            "trades": 0,
            "total_return": 0.0,
            "cagr": 0.0,
            "max_drawdown_realized": 0.0,
            "monthly_sharpe": 0.0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "avg_trade": 0.0,
            "median_trade": 0.0,
            "exposure": 0.0,
            "positive_month_rate": 0.0,
            "average_month": 0.0,
            "median_month": 0.0,
            "best_month": 0.0,
            "worst_month": 0.0,
            "months_ge_10pct": 0,
            "months_ge_20pct": 0,
            "months_ge_50pct": 0,
        }
    equity, monthly = equity_and_monthly(trades, start, end, leverage)
    returns = leverage * trades["net_return_1x"].astype(float)
    years = max((end - start).total_seconds() / (365.25 * 86400), 1 / 365.25)
    total_return = float(equity.iloc[-1] - 1.0)
    cagr = float(equity.iloc[-1] ** (1 / years) - 1) if equity.iloc[-1] > 0 else -1.0
    drawdown = equity / equity.cummax() - 1.0
    wins = returns[returns > 0]
    losses = returns[returns < 0]
    gross_profit = float(wins.sum())
    gross_loss = float(-losses.sum())
    monthly_std = float(monthly.std(ddof=1)) if len(monthly) > 1 else 0.0
    monthly_sharpe = (
        float(monthly.mean() / monthly_std * math.sqrt(12))
        if monthly_std > 0
        else 0.0
    )
    return {
        "leverage": leverage,
        "trades": int(len(trades)),
        "total_return": total_return,
        "cagr": cagr,
        "max_drawdown_realized": float(drawdown.min()),
        "monthly_sharpe": monthly_sharpe,
        "win_rate": float((returns > 0).mean()),
        "profit_factor": float(gross_profit / gross_loss) if gross_loss > 0 else math.inf,
        "avg_trade": float(returns.mean()),
        "median_trade": float(returns.median()),
        "exposure": float(trades["held_bars"].sum() / max(total_bars, 1)),
        "positive_month_rate": float((monthly > 0).mean()) if len(monthly) else 0.0,
        "average_month": float(monthly.mean()) if len(monthly) else 0.0,
        "median_month": float(monthly.median()) if len(monthly) else 0.0,
        "best_month": float(monthly.max()) if len(monthly) else 0.0,
        "worst_month": float(monthly.min()) if len(monthly) else 0.0,
        "months_ge_10pct": int((monthly >= 0.10).sum()),
        "months_ge_20pct": int((monthly >= 0.20).sum()),
        "months_ge_50pct": int((monthly >= 0.50).sum()),
    }


def fmt_pct(value: float) -> str:
    if not np.isfinite(value):
        return "∞"
    return f"{value * 100:.2f}%"


def fmt_num(value: float) -> str:
    if not np.isfinite(value):
        return "∞"
    return f"{value:.2f}"


def markdown_table(rows: list[dict], columns: list[tuple[str, str, str]]) -> str:
    header = "| " + " | ".join(title for _, title, _ in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    body = []
    for row in rows:
        cells = []
        for key, _, kind in columns:
            value = row[key]
            if kind == "pct":
                cells.append(fmt_pct(float(value)))
            elif kind == "num":
                cells.append(fmt_num(float(value)))
            else:
                cells.append(str(value))
        body.append("| " + " | ".join(cells) + " |")
    return "\n".join([header, separator, *body])


def period_trades(trades: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    if trades.empty:
        return trades.copy()
    return trades.loc[
        (trades["entry_time"] >= start) & (trades["entry_time"] <= end)
    ].copy()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    data = load_data()

    baseline = StrategyParams()
    baseline_features = prepare_features(data, baseline)
    baseline_trades = run_backtest(baseline_features, baseline)
    if baseline_trades.empty:
        raise RuntimeError("Baseline produced no trades")

    full_start, full_end = baseline_features.index.min(), baseline_features.index.max()
    oos_end = full_end
    full_rows = [
        metric_block(
            baseline_trades, full_start, full_end, leverage,
            len(baseline_features),
        )
        for leverage in (1.0, 2.0, 3.0)
    ]

    oos = period_trades(baseline_trades, OOS_START, oos_end)
    oos_bars = int((baseline_features.index >= OOS_START).sum())
    oos_rows = [
        metric_block(oos, OOS_START, oos_end, leverage, oos_bars)
        for leverage in (1.0, 2.0, 3.0)
    ]

    variants: list[dict] = []
    for h4_fast, h4_slow in [(40, 160), (50, 200), (60, 240)]:
        for pullback in [16, 20, 24]:
            params = StrategyParams(
                h4_fast=h4_fast,
                h4_slow=h4_slow,
                pullback_ema=pullback,
            )
            features = prepare_features(data, params)
            trades = run_backtest(features, params)
            trades_oos = period_trades(trades, OOS_START, features.index.max())
            metrics = metric_block(
                trades_oos,
                OOS_START,
                features.index.max(),
                1.0,
                int((features.index >= OOS_START).sum()),
            )
            variants.append(
                {
                    "h4_fast": h4_fast,
                    "h4_slow": h4_slow,
                    "pullback_ema": pullback,
                    **metrics,
                }
            )
            print(
                f"Variant {h4_fast}/{h4_slow}, PB{pullback}: "
                f"OOS return {metrics['total_return']:.2%}, "
                f"DD {metrics['max_drawdown_realized']:.2%}, "
                f"trades {metrics['trades']}"
            )

    baseline_trades.to_csv(OUTPUT_DIR / "trades.csv", index=False)

    buy_hold_full = float(data["close"].iloc[-1] / data["close"].iloc[0] - 1)
    oos_prices = data.loc[data.index >= OOS_START, "close"]
    buy_hold_oos = (
        float(oos_prices.iloc[-1] / oos_prices.iloc[0] - 1)
        if len(oos_prices) > 1
        else float("nan")
    )

    variant_returns = np.array([v["total_return"] for v in variants], dtype=float)
    variant_dd = np.array([v["max_drawdown_realized"] for v in variants], dtype=float)
    variant_positive = int((variant_returns > 0).sum())

    payload = {
        "assumptions": {
            "symbol_proxy": "Binance USD-M BTCUSDT perpetual",
            "data_interval": INTERVAL,
            "data_start": str(data.index.min()),
            "data_end": str(data.index.max()),
            "entry": "signal on 15m close, execution next bar open",
            "one_way_cost": ONE_WAY_COST,
            "funding_per_8h_always_charged": FUNDING_PER_8H,
            "intrabar_ambiguity": "stop assumed before target",
            "max_hold_bars": MAX_HOLD_BARS,
            "oos_start": str(OOS_START),
            "drawdown_note": "realized-equity drawdown; open-position mark-to-market drawdown is not included",
        },
        "baseline_params": asdict(baseline),
        "buy_and_hold": {
            "full_total_return": buy_hold_full,
            "oos_total_return": buy_hold_oos,
        },
        "baseline_full": full_rows,
        "baseline_oos": oos_rows,
        "robustness_oos_1x": variants,
        "robustness_summary": {
            "positive_variants": variant_positive,
            "variant_count": len(variants),
            "median_return": float(np.median(variant_returns)),
            "worst_return": float(np.min(variant_returns)),
            "best_return": float(np.max(variant_returns)),
            "median_realized_dd": float(np.median(variant_dd)),
            "worst_realized_dd": float(np.min(variant_dd)),
        },
    }
    (OUTPUT_DIR / "metrics.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    main_columns = [
        ("leverage", "Leverage", "num"),
        ("trades", "Trades", "int"),
        ("total_return", "Total return", "pct"),
        ("cagr", "CAGR", "pct"),
        ("max_drawdown_realized", "Realized DD", "pct"),
        ("monthly_sharpe", "Monthly Sharpe", "num"),
        ("win_rate", "Win rate", "pct"),
        ("profit_factor", "Profit factor", "num"),
        ("average_month", "Avg month", "pct"),
        ("median_month", "Median month", "pct"),
        ("best_month", "Best month", "pct"),
        ("worst_month", "Worst month", "pct"),
        ("months_ge_50pct", "Months ≥50%", "int"),
    ]
    robustness_columns = [
        ("h4_fast", "H4 fast", "int"),
        ("h4_slow", "H4 slow", "int"),
        ("pullback_ema", "15m PB EMA", "int"),
        ("trades", "Trades", "int"),
        ("total_return", "OOS return", "pct"),
        ("cagr", "OOS CAGR", "pct"),
        ("max_drawdown_realized", "Realized DD", "pct"),
        ("profit_factor", "PF", "num"),
        ("average_month", "Avg month", "pct"),
        ("best_month", "Best month", "pct"),
        ("months_ge_50pct", "Months ≥50%", "int"),
    ]

    baseline_1x_oos = oos_rows[0]
    conclusion = []
    if baseline_1x_oos["total_return"] <= 0:
        conclusion.append(
            "The fixed baseline failed out-of-sample after costs; it should not be deployed."
        )
    elif baseline_1x_oos["profit_factor"] < 1.2:
        conclusion.append(
            "The baseline was profitable out-of-sample, but the edge is too thin for deployment."
        )
    else:
        conclusion.append(
            "The baseline retained a positive out-of-sample edge, but still requires mark-to-market drawdown and live forward testing."
        )
    if oos_rows[2]["months_ge_50pct"] == 0:
        conclusion.append(
            "Even the approximate 3x sensitivity produced no 50% month in the out-of-sample period."
        )
    else:
        conclusion.append(
            "A 50% month occurred only under leverage sensitivity; this is not evidence that 50% monthly is sustainable."
        )
    if variant_positive < math.ceil(len(variants) * 2 / 3):
        conclusion.append(
            "Fewer than two-thirds of nearby parameter variants were profitable, indicating weak robustness."
        )
    else:
        conclusion.append(
            "At least two-thirds of nearby parameter variants were profitable, which is a useful robustness signal."
        )

    report = f"""# BTC Simple Pullback Backtest

Generated in GitHub Actions. This is a screening test, not a promise of future profit.

## Test design

- Market proxy: Binance USD-M `{SYMBOL}` perpetual, 15-minute candles
- Data: {data.index.min()} through {data.index.max()}
- Development/context period: data before {OOS_START.date()}
- Out-of-sample period: {OOS_START.date()} through {oos_end.date()}
- Baseline: 4H EMA {baseline.h4_fast}/{baseline.h4_slow} direction plus 15m EMA {baseline.pullback_ema} pullback reclaim
- Entry: signal on completed close, filled at next 15m open
- Stop / target: {baseline.stop_atr:.1f} ATR / {baseline.target_atr:.1f} ATR
- Max holding time: {MAX_HOLD_BARS / 4 / 24:.0f} days
- Cost: {ONE_WAY_COST * 100:.3f}% per side
- Funding stress: {FUNDING_PER_8H * 100:.3f}% every 8 hours, always charged
- Same-bar stop/target ambiguity: stop assumed first
- Buy-and-hold return: full {fmt_pct(buy_hold_full)}, OOS {fmt_pct(buy_hold_oos)}

## Fixed baseline — full period

{markdown_table(full_rows, main_columns)}

## Fixed baseline — out-of-sample

{markdown_table(oos_rows, main_columns)}

## Nearby-parameter robustness — out-of-sample, 1x

{markdown_table(variants, robustness_columns)}

Robustness summary:

- Positive variants: {variant_positive}/{len(variants)}
- Median OOS return: {fmt_pct(float(np.median(variant_returns)))}
- Worst OOS return: {fmt_pct(float(np.min(variant_returns)))}
- Best OOS return: {fmt_pct(float(np.max(variant_returns)))}
- Median realized-equity DD: {fmt_pct(float(np.median(variant_dd)))}
- Worst realized-equity DD: {fmt_pct(float(np.min(variant_dd)))}

## Mechanical conclusion

{" ".join(conclusion)}

## Important limitations

1. Aster-specific fills, fees, liquidation rules, and funding history are not modeled; Binance USD-M is a liquid BTC perpetual proxy.
2. Funding is modeled as a constant adverse drag. Actual funding can help or hurt depending on position direction and regime.
3. Reported drawdown is based on realized trade equity. Open-position mark-to-market drawdown can be materially worse.
4. The 2x and 3x rows are linear sensitivity approximations; they do not model margin calls or liquidation.
5. This test intentionally uses a small fixed parameter grid. Selecting only the best row after seeing results would be overfitting.
"""
    (OUTPUT_DIR / "report.md").write_text(report, encoding="utf-8")
    print("\n" + report)


if __name__ == "__main__":
    main()
