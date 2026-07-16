#!/usr/bin/env python3
"""PENGU 2-3 day high-win-rate swing robot research.

Research-only. Downloads public Binance USD-M futures 1h OHLCV archives,
selects parameters only from pre-validation data, then reports chronological
validation and final holdout performance. Signals execute at the next bar open.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import requests

BARS_PER_DAY = 24
KLINE_COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


@dataclass(frozen=True)
class Candidate:
    slow_ema: int
    fast_ema: int
    pullback_hours: int
    atr_min: float
    volume_ratio: float
    rsi_long_max: float
    rsi_short_min: float
    tp: float
    sl: float
    max_hold_hours: int
    direction_mode: str
    early_exit: bool


@dataclass
class Trade:
    side: int
    signal_time: str
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    gross_return: float
    net_return: float
    hold_hours: int
    exit_reason: str


def month_range(start: str, end: str) -> list[str]:
    periods = pd.period_range(start=start, end=end, freq="M")
    return [str(p) for p in periods]


def _download_zip_csv(url: str, timeout: int = 45) -> pd.DataFrame | None:
    response = requests.get(url, timeout=timeout)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
        if not names:
            raise RuntimeError(f"No CSV in {url}")
        with archive.open(names[0]) as handle:
            return pd.read_csv(handle, header=None)


def download_klines(symbol: str, start_month: str, end_month: str, cache_dir: Path) -> pd.DataFrame:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{symbol}_1h_{start_month}_{end_month}.csv"
    if cache_path.exists():
        data = pd.read_csv(cache_path)
        data["timestamp"] = pd.to_datetime(data["timestamp"], utc=True)
        return data.set_index("timestamp").sort_index()

    frames: list[pd.DataFrame] = []
    for month in month_range(start_month, end_month):
        url = (
            "https://data.binance.vision/data/futures/um/monthly/klines/"
            f"{symbol}/1h/{symbol}-1h-{month}.zip"
        )
        raw = _download_zip_csv(url)
        if raw is None:
            print(f"WARN missing archive: {url}", file=sys.stderr)
            continue
        raw = raw.iloc[:, : len(KLINE_COLUMNS)]
        raw.columns = KLINE_COLUMNS[: raw.shape[1]]
        frames.append(raw)

    if not frames:
        raise RuntimeError(f"No archive data downloaded for {symbol}")

    df = pd.concat(frames, ignore_index=True)
    for col in ["open", "high", "low", "close", "volume", "quote_volume", "trades"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    ts_numeric = pd.to_numeric(df["open_time"], errors="coerce")
    unit = "us" if float(ts_numeric.dropna().median()) > 1e14 else "ms"
    df["timestamp"] = pd.to_datetime(ts_numeric, unit=unit, utc=True)
    df = (
        df[["timestamp", "open", "high", "low", "close", "volume", "quote_volume", "trades"]]
        .dropna()
        .drop_duplicates("timestamp")
        .sort_values("timestamp")
    )
    df.to_csv(cache_path, index=False)
    return df.set_index("timestamp")


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False, min_periods=span).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def build_features(pengu: pd.DataFrame, btc: pd.DataFrame, candidate: Candidate) -> pd.DataFrame:
    btc_aligned = btc.reindex(pengu.index).ffill()
    out = pengu.copy()
    out["ema_fast"] = ema(out["close"], candidate.fast_ema)
    out["ema_slow"] = ema(out["close"], candidate.slow_ema)
    out["ema_trigger"] = ema(out["close"], 12)
    out["rsi"] = rsi(out["close"], 14)
    out["atr_pct"] = atr(out, 14) / out["close"]
    out["volume_med"] = out["quote_volume"].rolling(24, min_periods=12).median()
    out["volume_ratio"] = out["quote_volume"] / out["volume_med"].replace(0, np.nan)
    out["ret_6h"] = out["close"].pct_change(6)
    out["recent_low"] = out["low"].rolling(candidate.pullback_hours, min_periods=candidate.pullback_hours).min()
    out["recent_high"] = out["high"].rolling(candidate.pullback_hours, min_periods=candidate.pullback_hours).max()
    out["btc_ema72"] = ema(btc_aligned["close"], 72)
    out["btc_close"] = btc_aligned["close"]
    out["btc_ret24"] = btc_aligned["close"].pct_change(24)
    out["bar_up"] = out["close"] > out["open"]
    out["bar_down"] = out["close"] < out["open"]
    return out


def signal_at(row: pd.Series, candidate: Candidate) -> int:
    common = (
        np.isfinite(row["atr_pct"])
        and row["atr_pct"] >= candidate.atr_min
        and row["volume_ratio"] >= candidate.volume_ratio
    )
    if not common:
        return 0

    long_ok = (
        row["close"] > row["ema_slow"]
        and row["ema_fast"] > row["ema_slow"]
        and row["recent_low"] <= row["ema_fast"] * 1.01
        and row["close"] > row["ema_trigger"]
        and row["ret_6h"] < 0.01
        and 42 <= row["rsi"] <= candidate.rsi_long_max
        and row["bar_up"]
        and row["btc_close"] > row["btc_ema72"]
        and row["btc_ret24"] > -0.03
    )
    if long_ok:
        return 1

    if candidate.direction_mode == "long_short":
        short_ok = (
            row["close"] < row["ema_slow"]
            and row["ema_fast"] < row["ema_slow"]
            and row["recent_high"] >= row["ema_fast"] * 0.99
            and row["close"] < row["ema_trigger"]
            and row["ret_6h"] > -0.01
            and candidate.rsi_short_min <= row["rsi"] <= 58
            and row["bar_down"]
            and (row["btc_close"] < row["btc_ema72"] or row["btc_ret24"] < -0.01)
        )
        if short_ok:
            return -1
    return 0


def backtest(
    pengu: pd.DataFrame,
    btc: pd.DataFrame,
    candidate: Candidate,
    start: str,
    end: str,
    cost_per_side: float = 0.0006,
    funding_per_day: float = 0.0002,
) -> list[Trade]:
    features = build_features(pengu, btc, candidate)
    test = features.loc[start:end].copy()
    trades: list[Trade] = []
    i = 0
    while i < len(test) - 1:
        side = signal_at(test.iloc[i], candidate)
        if side == 0:
            i += 1
            continue

        entry_i = i + 1
        entry_time = test.index[entry_i]
        entry_price = float(test.iloc[entry_i]["open"])
        if not np.isfinite(entry_price) or entry_price <= 0:
            i += 1
            continue

        stop_price = entry_price * (1 - candidate.sl if side == 1 else 1 + candidate.sl)
        target_price = entry_price * (1 + candidate.tp if side == 1 else 1 - candidate.tp)
        exit_i = min(entry_i + candidate.max_hold_hours, len(test) - 1)
        exit_price = float(test.iloc[exit_i]["close"])
        exit_reason = "time"

        for j in range(entry_i, min(entry_i + candidate.max_hold_hours + 1, len(test))):
            bar = test.iloc[j]
            if side == 1:
                stop_hit = bar["low"] <= stop_price
                target_hit = bar["high"] >= target_price
            else:
                stop_hit = bar["high"] >= stop_price
                target_hit = bar["low"] <= target_price

            if stop_hit and target_hit:
                exit_i, exit_price, exit_reason = j, stop_price, "stop_adverse_same_bar"
                break
            if stop_hit:
                exit_i, exit_price, exit_reason = j, stop_price, "stop"
                break
            if target_hit:
                exit_i, exit_price, exit_reason = j, target_price, "target"
                break

            held = j - entry_i + 1
            if candidate.early_exit and held >= 24:
                if side == 1 and bar["close"] < bar["ema_fast"]:
                    exit_i, exit_price, exit_reason = j, float(bar["close"]), "trend_fail"
                    break
                if side == -1 and bar["close"] > bar["ema_fast"]:
                    exit_i, exit_price, exit_reason = j, float(bar["close"]), "trend_fail"
                    break

        hold_hours = max(1, exit_i - entry_i + 1)
        gross = side * (exit_price / entry_price - 1.0)
        net = gross - 2 * cost_per_side - funding_per_day * (hold_hours / 24)
        trades.append(
            Trade(
                side=side,
                signal_time=str(test.index[i]),
                entry_time=str(entry_time),
                exit_time=str(test.index[exit_i]),
                entry_price=entry_price,
                exit_price=float(exit_price),
                gross_return=float(gross),
                net_return=float(net),
                hold_hours=int(hold_hours),
                exit_reason=exit_reason,
            )
        )
        i = exit_i + 1
    return trades


def metrics(trades: list[Trade], start: str, end: str) -> dict[str, float]:
    if not trades:
        return {
            "trades": 0, "total_return": 0.0, "annualized_return": 0.0,
            "win_rate": 0.0, "profit_factor": 0.0, "expectancy": 0.0,
            "max_drawdown": 0.0, "avg_hold_hours": 0.0, "trades_per_month": 0.0,
            "avg_win": 0.0, "avg_loss": 0.0,
        }
    rets = np.array([t.net_return for t in trades], dtype=float)
    equity = np.cumprod(1.0 + rets)
    peaks = np.maximum.accumulate(equity)
    dd = equity / peaks - 1.0
    positive = rets[rets > 0]
    negative = rets[rets <= 0]
    start_ts = pd.Timestamp(start, tz="UTC")
    end_ts = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
    years = max((end_ts - start_ts).total_seconds() / (365.25 * 86400), 1 / 12)
    months = max((end_ts - start_ts).total_seconds() / (30.4375 * 86400), 1.0)
    total = float(equity[-1] - 1.0)
    pf = float(positive.sum() / -negative.sum()) if negative.sum() < 0 else float("inf")
    return {
        "trades": int(len(trades)),
        "total_return": total,
        "annualized_return": float((1.0 + total) ** (1.0 / years) - 1.0) if total > -1 else -1.0,
        "win_rate": float((rets > 0).mean()),
        "profit_factor": pf,
        "expectancy": float(rets.mean()),
        "max_drawdown": float(dd.min()),
        "avg_hold_hours": float(np.mean([t.hold_hours for t in trades])),
        "median_hold_hours": float(np.median([t.hold_hours for t in trades])),
        "trades_per_month": float(len(trades) / months),
        "avg_win": float(positive.mean()) if len(positive) else 0.0,
        "avg_loss": float(negative.mean()) if len(negative) else 0.0,
        "best_trade": float(rets.max()),
        "worst_trade": float(rets.min()),
    }


def candidate_grid() -> Iterable[Candidate]:
    for slow_ema in [72, 120]:
        for fast_ema in [24, 36]:
            if fast_ema >= slow_ema:
                continue
            for pullback_hours in [6, 12]:
                # Deliberately compact, predeclared grid to limit overfitting.
                # Holding periods are fixed to the user's 2-3 day objective.
                for atr_min in [0.015, 0.020]:
                    for volume_ratio in [0.8, 1.0]:
                        for tp in [0.04, 0.05, 0.06]:
                            for sl in [0.02, 0.025]:
                                for max_hold in [48, 72]:
                                    for mode in ["long_only", "long_short"]:
                                        yield Candidate(
                                            slow_ema=slow_ema,
                                            fast_ema=fast_ema,
                                            pullback_hours=pullback_hours,
                                            atr_min=atr_min,
                                            volume_ratio=volume_ratio,
                                            rsi_long_max=62,
                                            rsi_short_min=38,
                                            tp=tp,
                                            sl=sl,
                                            max_hold_hours=max_hold,
                                            direction_mode=mode,
                                            early_exit=True,
                                        )


def select_candidate(pengu: pd.DataFrame, btc: pd.DataFrame, cost: float, funding: float) -> tuple[Candidate, pd.DataFrame]:
    rows: list[dict[str, object]] = []
    for idx, candidate in enumerate(candidate_grid()):
        train_trades = backtest(pengu, btc, candidate, "2025-01-01", "2025-04-30", cost, funding)
        select_trades = backtest(pengu, btc, candidate, "2025-05-01", "2025-06-30", cost, funding)
        train = metrics(train_trades, "2025-01-01", "2025-04-30")
        selection = metrics(select_trades, "2025-05-01", "2025-06-30")
        passes = (
            train["trades"] >= 8
            and selection["trades"] >= 4
            and train["total_return"] > 0
            and selection["total_return"] > 0
            and train["win_rate"] >= 0.55
            and selection["win_rate"] >= 0.50
            and train["profit_factor"] >= 1.20
            and selection["profit_factor"] >= 1.10
            and 24 <= train["avg_hold_hours"] <= 72
            and 24 <= selection["avg_hold_hours"] <= 72
        )
        robustness = min(train["expectancy"], selection["expectancy"])
        win_floor = min(train["win_rate"], selection["win_rate"])
        pf_floor = min(train["profit_factor"], selection["profit_factor"])
        score = robustness * 100 + win_floor + min(pf_floor, 3.0) * 0.05
        rows.append({
            "candidate_id": idx,
            **asdict(candidate),
            "passes": passes,
            "score": score,
            **{f"train_{k}": v for k, v in train.items()},
            **{f"select_{k}": v for k, v in selection.items()},
        })
    frame = pd.DataFrame(rows).sort_values(["passes", "score"], ascending=[False, False])
    passing = frame[frame["passes"]]
    chosen_row = passing.iloc[0] if not passing.empty else frame.iloc[0]
    candidate_fields = Candidate.__dataclass_fields__.keys()
    chosen = Candidate(**{key: chosen_row[key] for key in candidate_fields})
    return chosen, frame


def bootstrap_probability(trades: list[Trade], samples: int = 20000, seed: int = 56) -> dict[str, float]:
    if not trades:
        return {"prob_total_positive": 0.0, "ci_025": 0.0, "ci_975": 0.0}
    rng = np.random.default_rng(seed)
    rets = np.array([t.net_return for t in trades], dtype=float)
    picks = rng.choice(rets, size=(samples, len(rets)), replace=True)
    totals = np.prod(1.0 + picks, axis=1) - 1.0
    return {
        "prob_total_positive": float((totals > 0).mean()),
        "ci_025": float(np.quantile(totals, 0.025)),
        "ci_975": float(np.quantile(totals, 0.975)),
    }


def evaluate_periods(pengu: pd.DataFrame, btc: pd.DataFrame, candidate: Candidate, cost: float, funding: float):
    periods = {
        "train": ("2025-01-01", "2025-04-30"),
        "selection": ("2025-05-01", "2025-06-30"),
        "validation": ("2025-07-01", "2025-12-31"),
        "holdout": ("2026-01-01", "2026-06-30"),
    }
    results: dict[str, dict[str, float]] = {}
    all_trades: dict[str, list[Trade]] = {}
    for label, (start, end) in periods.items():
        trades = backtest(pengu, btc, candidate, start, end, cost, funding)
        all_trades[label] = trades
        results[label] = metrics(trades, start, end)
    results["holdout"].update(bootstrap_probability(all_trades["holdout"]))
    return results, all_trades


def acceptance(results: dict[str, dict[str, float]], stressed: dict[str, dict[str, float]]) -> dict[str, object]:
    hold = results["holdout"]
    val = results["validation"]
    stress_hold = stressed["holdout"]
    checks = {
        "validation_positive": val["total_return"] > 0,
        "holdout_positive": hold["total_return"] > 0,
        "holdout_trades_ge_12": hold["trades"] >= 12,
        "holdout_win_rate_ge_58pct": hold["win_rate"] >= 0.58,
        "holdout_pf_ge_1_30": hold["profit_factor"] >= 1.30,
        "holdout_avg_hold_24_72h": 24 <= hold["avg_hold_hours"] <= 72,
        "holdout_maxdd_ge_minus15pct": hold["max_drawdown"] >= -0.15,
        "stress_10bps_positive": stress_hold["total_return"] > 0,
        "bootstrap_positive_ge_90pct": hold.get("prob_total_positive", 0.0) >= 0.90,
    }
    return {"approved_for_forward_paper": all(checks.values()), "checks": checks}


def write_report(output_dir: Path, candidate: Candidate, base, stressed, decision) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    report = [
        "# PENGU 2–3 Day Swing Robot v1",
        "",
        "Status: research only. Real trading remains disabled.",
        "",
        "## Selected parameters (selected before validation/holdout)",
        "",
        "```json",
        json.dumps(asdict(candidate), indent=2),
        "```",
        "",
        "## Chronological results — 6 bps/side + 2 bps/day reserve",
        "",
        "| Period | Trades | Win rate | PF | Total | Max DD | Avg hold | Trades/month |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for label in ["train", "selection", "validation", "holdout"]:
        m = base[label]
        report.append(
            f"| {label} | {m['trades']} | {m['win_rate']:.1%} | {m['profit_factor']:.2f} | "
            f"{m['total_return']:.2%} | {m['max_drawdown']:.2%} | {m['avg_hold_hours']:.1f}h | {m['trades_per_month']:.2f} |"
        )
    report.extend([
        "",
        "## Holdout uncertainty",
        "",
        f"- Bootstrap P(total > 0): {base['holdout'].get('prob_total_positive', 0):.1%}",
        f"- 95% bootstrap total-return interval: [{base['holdout'].get('ci_025', 0):.2%}, {base['holdout'].get('ci_975', 0):.2%}]",
        "",
        "## 10 bps/side stress",
        "",
        f"- Holdout trades: {stressed['holdout']['trades']}",
        f"- Holdout win rate: {stressed['holdout']['win_rate']:.1%}",
        f"- Holdout PF: {stressed['holdout']['profit_factor']:.2f}",
        f"- Holdout total return: {stressed['holdout']['total_return']:.2%}",
        f"- Holdout max DD: {stressed['holdout']['max_drawdown']:.2%}",
        "",
        "## Approval gate",
        "",
        f"**Approved for forward paper: {decision['approved_for_forward_paper']}**",
        "",
    ])
    for key, value in decision["checks"].items():
        report.append(f"- {'PASS' if value else 'FAIL'} — {key}")
    report.extend([
        "",
        "## Portfolio integration if all gates pass",
        "",
        "- Independent sleeve only; do not replace Monthly Boost v4.",
        "- Account risk per trade: 0.60%.",
        "- Maximum PENGU notional: 30% of equity.",
        "- One PENGU position at a time.",
        "- Three consecutive losses: 72-hour cooldown.",
        "- Sleeve monthly loss -4%: no new entries until next month.",
        "- Existing portfolio gross and correlation limits still apply.",
        "",
        "## Important distinction",
        "",
        "This directional swing robot is unrelated to the rejected Aster–Binance PENGU stale-price/basis arbitrage. "
        "It uses OHLCV trend-pullback logic and next-bar execution.",
    ])
    (output_dir / "REPORT.md").write_text("\n".join(report), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("research_outputs/pengu_swing_v1"))
    parser.add_argument("--cache", type=Path, default=Path(".cache/pengu_swing_v1"))
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    pengu = download_klines("PENGUUSDT", "2024-12", "2026-06", args.cache)
    btc = download_klines("BTCUSDT", "2024-12", "2026-06", args.cache)

    candidate, grid = select_candidate(pengu, btc, cost=0.0006, funding=0.0002)
    base, trades = evaluate_periods(pengu, btc, candidate, cost=0.0006, funding=0.0002)
    stressed, _ = evaluate_periods(pengu, btc, candidate, cost=0.0010, funding=0.0005)
    decision = acceptance(base, stressed)

    grid.head(250).to_csv(args.output / "candidate_ranking.csv", index=False)
    for label, rows in trades.items():
        pd.DataFrame([asdict(t) for t in rows]).to_csv(args.output / f"trades_{label}.csv", index=False)
    payload = {
        "candidate": asdict(candidate),
        "base": base,
        "stress": stressed,
        "decision": decision,
        "data": {
            "pengu_start": str(pengu.index.min()),
            "pengu_end": str(pengu.index.max()),
            "pengu_rows": int(len(pengu)),
            "btc_rows": int(len(btc)),
        },
    }
    (args.output / "summary.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_report(args.output, candidate, base, stressed, decision)

    print("PENGU_SWING_RESULT=" + json.dumps(payload, separators=(",", ":")))
    print((args.output / "REPORT.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
