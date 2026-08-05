#!/usr/bin/env python3
"""Research-only one-year binary-options backtest.

No broker integration, no order placement, no secrets, no live/VPS changes.
Data: Binance official public spot monthly 5m klines.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys
import time
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]
BREAK_EVEN = 1.0 / 1.8


@dataclass(frozen=True)
class Config:
    symbols: tuple[str, ...] = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT")
    interval: str = "5m"
    start_month: str = "2025-08"
    end_month: str = "2026-07"
    train_end: str = "2026-02-01T00:00:00Z"
    val_end: str = "2026-05-01T00:00:00Z"
    test_end: str = "2026-08-01T00:00:00Z"
    payout: float = 0.80
    risk_fraction: float = 0.01
    max_signals_per_timestamp: int = 2
    min_train_trades: int = 800
    min_val_trades: int = 300
    seed: int = 42


def month_range(start: str, end: str) -> list[str]:
    return [p.strftime("%Y-%m") for p in pd.period_range(start, end, freq="M")]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download_bytes(url: str, timeout: int = 90, retries: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.content
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed: {url}: {last}")


def parse_checksum(text: str) -> str | None:
    token = text.strip().split()[0] if text.strip() else ""
    return token.lower() if len(token) == 64 else None


def load_symbol(symbol: str, cfg: Config, cache_dir: Path) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    frames: list[pd.DataFrame] = []
    manifest: list[dict[str, Any]] = []
    cache_dir.mkdir(parents=True, exist_ok=True)
    for month in month_range(cfg.start_month, cfg.end_month):
        name = f"{symbol}-{cfg.interval}-{month}.zip"
        base = f"https://data.binance.vision/data/spot/monthly/klines/{symbol}/{cfg.interval}"
        url = f"{base}/{name}"
        zip_path = cache_dir / name
        if zip_path.exists():
            payload = zip_path.read_bytes()
        else:
            payload = download_bytes(url)
            zip_path.write_bytes(payload)
        actual = sha256_bytes(payload)
        checksum_status = "unavailable"
        expected = None
        try:
            csum = download_bytes(url + ".CHECKSUM").decode("utf-8", errors="replace")
            expected = parse_checksum(csum)
            if expected:
                checksum_status = "pass" if expected == actual else "fail"
        except Exception:
            pass
        if checksum_status == "fail":
            raise RuntimeError(f"checksum mismatch: {name}")
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if len(csv_names) != 1:
                raise RuntimeError(f"unexpected archive contents: {name}: {zf.namelist()}")
            with zf.open(csv_names[0]) as fp:
                df = pd.read_csv(fp, header=None, names=COLS)
        for c in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base", "taker_buy_quote"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        ts = pd.to_numeric(df["open_time"], errors="coerce")
        unit = "us" if ts.dropna().median() > 1e14 else "ms"
        df["time"] = pd.to_datetime(ts, unit=unit, utc=True)
        df["symbol"] = symbol
        frames.append(df[["time", "symbol", "open", "high", "low", "close", "volume", "quote_volume", "trades"]])
        manifest.append({
            "symbol": symbol, "month": month, "url": url, "rows": int(len(df)),
            "sha256": actual, "checksum_expected": expected, "checksum_status": checksum_status,
            "first_time": str(df["time"].min()), "last_time": str(df["time"].max()),
        })
    out = pd.concat(frames, ignore_index=True).sort_values("time")
    out = out.drop_duplicates(["symbol", "time"], keep="last").reset_index(drop=True)
    return out, manifest


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def adx(df: pd.DataFrame, n: int = 14) -> tuple[pd.Series, pd.Series]:
    high, low, close = df["high"], df["low"], df["close"]
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)
    tr = pd.concat([(high - low), (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean(), atr


def add_features_one(df: pd.DataFrame) -> pd.DataFrame:
    x = df.sort_values("time").copy()
    c, o, h, l, v = x["close"], x["open"], x["high"], x["low"], x["volume"]
    for n in (1, 2, 3, 6, 12):
        x[f"ret{n}"] = c.pct_change(n)
    for n in (8, 20, 30, 50):
        x[f"ema{n}"] = c.ewm(span=n, adjust=False, min_periods=n).mean()
    x["ema_spread_8_30"] = x["ema8"] / x["ema30"] - 1
    x["ema_spread_20_50"] = x["ema20"] / x["ema50"] - 1
    x["rsi14"] = rsi(c, 14)
    mid = c.rolling(20).mean()
    std = c.rolling(20).std(ddof=0)
    x["bb_z20"] = (c - mid) / std.replace(0, np.nan)
    x["vol_z20"] = (v - v.rolling(20).mean()) / v.rolling(20).std(ddof=0).replace(0, np.nan)
    x["vol_ratio20"] = v / v.rolling(20).mean().replace(0, np.nan)
    x["adx14"], atr = adx(x, 14)
    x["atr_pct"] = atr / c
    rng = (h - l).replace(0, np.nan)
    x["body_frac"] = (c - o).abs() / rng
    x["signed_body"] = (c - o) / rng
    x["upper_wick"] = (h - np.maximum(o, c)) / rng
    x["lower_wick"] = (np.minimum(o, c) - l) / rng
    x["prior_high20"] = h.shift(1).rolling(20).max()
    x["prior_low20"] = l.shift(1).rolling(20).min()
    x["prior_high40"] = h.shift(1).rolling(40).max()
    x["prior_low40"] = l.shift(1).rolling(40).min()
    x["hour_sin"] = np.sin(2 * np.pi * x["time"].dt.hour / 24)
    x["hour_cos"] = np.cos(2 * np.pi * x["time"].dt.hour / 24)
    x["dow_sin"] = np.sin(2 * np.pi * x["time"].dt.dayofweek / 7)
    x["dow_cos"] = np.cos(2 * np.pi * x["time"].dt.dayofweek / 7)
    x["future_close"] = c.shift(-1)
    x["future_move"] = x["future_close"] - c
    x["month"] = x["time"].dt.to_period("M").astype(str)
    return x


def signal_for_candidate(df: pd.DataFrame, cand: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    fam = cand["family"]
    p = cand["params"]
    n = len(df)
    direction = np.zeros(n, dtype=np.int8)
    confidence = np.zeros(n, dtype=np.float32)
    if fam == "trend":
        common = (df["adx14"] >= p["adx_min"]) & (df["atr_pct"] >= p["atr_min"])
        call = common & (df["ema_spread_8_30"] > 0) & (df["rsi14"] >= p["rsi_hi"]) & (df["ret3"] >= p["ret3_min"])
        put = common & (df["ema_spread_8_30"] < 0) & (df["rsi14"] <= 100 - p["rsi_hi"]) & (df["ret3"] <= -p["ret3_min"])
        direction[call.to_numpy()] = 1
        direction[put.to_numpy()] = -1
        confidence = (np.abs(df["ema_spread_8_30"].fillna(0).to_numpy()) * 1e4 + df["adx14"].fillna(0).to_numpy() / 100).astype(np.float32)
    elif fam == "mean_reversion":
        common = (df["adx14"] <= p["adx_max"]) & (df["atr_pct"] >= p["atr_min"])
        call = common & (df["bb_z20"] <= -p["z"]) & (df["rsi14"] <= p["rsi_low"]) & (df["lower_wick"] >= p["wick_min"])
        put = common & (df["bb_z20"] >= p["z"]) & (df["rsi14"] >= 100 - p["rsi_low"]) & (df["upper_wick"] >= p["wick_min"])
        direction[call.to_numpy()] = 1
        direction[put.to_numpy()] = -1
        confidence = (np.abs(df["bb_z20"].fillna(0).to_numpy()) + np.abs(df["rsi14"].fillna(50).to_numpy() - 50) / 50).astype(np.float32)
    elif fam == "breakout":
        common = (df["vol_z20"] >= p["vol_z_min"]) & (df["adx14"] >= p["adx_min"])
        if p["lookback"] == 20:
            hi, lo = df["prior_high20"], df["prior_low20"]
        else:
            hi, lo = df["prior_high40"], df["prior_low40"]
        call = common & (df["close"] > hi) & (df["signed_body"] >= p["body_min"])
        put = common & (df["close"] < lo) & (df["signed_body"] <= -p["body_min"])
        direction[call.to_numpy()] = 1
        direction[put.to_numpy()] = -1
        confidence = (df["vol_z20"].fillna(0).clip(lower=0).to_numpy() + df["adx14"].fillna(0).to_numpy() / 50).astype(np.float32)
    elif fam == "momentum":
        common = (df["body_frac"] >= p["body_min"]) & (df["vol_z20"] >= p["vol_z_min"]) & (df["atr_pct"] >= p["atr_min"])
        call = common & (df["ret3"] >= p["ret3_min"]) & (df["signed_body"] > 0)
        put = common & (df["ret3"] <= -p["ret3_min"]) & (df["signed_body"] < 0)
        direction[call.to_numpy()] = 1
        direction[put.to_numpy()] = -1
        confidence = (np.abs(df["ret3"].fillna(0).to_numpy()) * 1e4 + df["body_frac"].fillna(0).to_numpy()).astype(np.float32)
    elif fam == "hybrid":
        trend_regime = df["adx14"] >= p["adx_switch"]
        trend_call = trend_regime & (df["ema_spread_8_30"] > 0) & (df["rsi14"] >= p["trend_rsi"]) & (df["ret3"] > 0)
        trend_put = trend_regime & (df["ema_spread_8_30"] < 0) & (df["rsi14"] <= 100 - p["trend_rsi"]) & (df["ret3"] < 0)
        mr_regime = ~trend_regime
        mr_call = mr_regime & (df["bb_z20"] <= -p["mr_z"]) & (df["rsi14"] <= p["mr_rsi"])
        mr_put = mr_regime & (df["bb_z20"] >= p["mr_z"]) & (df["rsi14"] >= 100 - p["mr_rsi"])
        direction[(trend_call | mr_call).to_numpy()] = 1
        direction[(trend_put | mr_put).to_numpy()] = -1
        confidence = (np.where(trend_regime.fillna(False).to_numpy(), np.abs(df["ema_spread_8_30"].fillna(0).to_numpy()) * 1e4, np.abs(df["bb_z20"].fillna(0).to_numpy()))).astype(np.float32)
    else:
        raise ValueError(f"unknown family: {fam}")
    valid = np.isfinite(df["future_move"].to_numpy())
    direction[~valid] = 0
    return direction, confidence


def candidate_grid() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    idx = 0
    def add(family: str, params: dict[str, Any]) -> None:
        nonlocal idx
        idx += 1
        out.append({"id": f"R{idx:03d}", "family": family, "params": params})
    for adx_min in (15, 20, 25):
        for rsi_hi in (52, 55, 58):
            for ret3_min in (0.0, 0.0005, 0.001):
                for atr_min in (0.0, 0.0006, 0.0010):
                    add("trend", dict(adx_min=adx_min, rsi_hi=rsi_hi, ret3_min=ret3_min, atr_min=atr_min))
    for z in (1.2, 1.5, 1.8, 2.1):
        for rsi_low in (25, 30, 35):
            for adx_max in (15, 20, 25):
                for wick_min in (0.0, 0.20):
                    add("mean_reversion", dict(z=z, rsi_low=rsi_low, adx_max=adx_max, atr_min=0.0004, wick_min=wick_min))
    for lookback in (20, 40):
        for vol_z_min in (0.5, 1.0, 1.5):
            for adx_min in (15, 20, 25):
                for body_min in (0.2, 0.5):
                    add("breakout", dict(lookback=lookback, vol_z_min=vol_z_min, adx_min=adx_min, body_min=body_min))
    for ret3_min in (0.0005, 0.0010, 0.0015):
        for body_min in (0.4, 0.6, 0.8):
            for vol_z_min in (0.0, 0.5, 1.0):
                for atr_min in (0.0004, 0.0008):
                    add("momentum", dict(ret3_min=ret3_min, body_min=body_min, vol_z_min=vol_z_min, atr_min=atr_min))
    for adx_switch in (18, 22, 26):
        for trend_rsi in (52, 55, 58):
            for mr_z in (1.3, 1.6, 1.9):
                for mr_rsi in (28, 32, 36):
                    add("hybrid", dict(adx_switch=adx_switch, trend_rsi=trend_rsi, mr_z=mr_z, mr_rsi=mr_rsi))
    return out


def max_loss_streak(results: np.ndarray) -> int:
    best = cur = 0
    for r in results:
        if r < 0:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return int(best)


def max_drawdown(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    dd = equity - peak
    return float(dd.min())


def max_drawdown_pct(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    dd = equity / np.where(peak == 0, np.nan, peak) - 1
    return float(np.nanmin(dd))


def trade_frame(df: pd.DataFrame, direction: np.ndarray, confidence: np.ndarray, payout: float, cap: int | None = None) -> pd.DataFrame:
    mask = direction != 0
    t = df.loc[mask, ["time", "month", "symbol", "close", "future_close", "future_move"]].copy()
    if t.empty:
        t["direction"] = []
        t["confidence"] = []
        t["result"] = []
        return t
    t["direction"] = direction[mask]
    t["confidence"] = confidence[mask]
    if cap is not None:
        t = t.sort_values(["time", "confidence", "symbol"], ascending=[True, False, True]).groupby("time", sort=False).head(cap)
    signed = t["direction"].to_numpy() * t["future_move"].to_numpy()
    t["result"] = np.where(signed > 0, payout, np.where(signed < 0, -1.0, 0.0))
    return t.sort_values(["time", "symbol"]).reset_index(drop=True)


def summarize_trades(t: pd.DataFrame, risk_fraction: float = 0.01) -> dict[str, Any]:
    if t.empty:
        return {"trades": 0, "wins": 0, "losses": 0, "ties": 0, "win_rate": np.nan, "expectancy": np.nan,
                "profit_units": 0.0, "max_dd_units": 0.0, "max_loss_streak": 0, "positive_month_ratio": 0.0,
                "compound_end": 1.0, "compound_return": 0.0, "compound_max_dd": 0.0}
    r = t["result"].to_numpy(float)
    decisive = r != 0
    wins = int((r > 0).sum())
    losses = int((r < 0).sum())
    ties = int((r == 0).sum())
    wr = wins / (wins + losses) if wins + losses else np.nan
    eq = np.r_[0.0, np.cumsum(r)]
    balance = 1.0
    comp = [balance]
    for rr in r:
        balance *= 1 + risk_fraction * rr
        comp.append(balance)
    monthly = t.groupby("month")["result"].sum()
    return {
        "trades": int(len(t)), "wins": wins, "losses": losses, "ties": ties,
        "win_rate": float(wr), "expectancy": float(r[decisive].mean()) if decisive.any() else np.nan,
        "profit_units": float(r.sum()), "max_dd_units": max_drawdown(eq), "max_loss_streak": max_loss_streak(r),
        "positive_month_ratio": float((monthly > 0).mean()) if len(monthly) else 0.0,
        "compound_end": float(balance), "compound_return": float(balance - 1),
        "compound_max_dd": max_drawdown_pct(np.asarray(comp)),
    }


def split_mask(df: pd.DataFrame, cfg: Config) -> dict[str, np.ndarray]:
    t = df["time"]
    tr_end = pd.Timestamp(cfg.train_end)
    va_end = pd.Timestamp(cfg.val_end)
    te_end = pd.Timestamp(cfg.test_end)
    return {
        "train": (t < tr_end).to_numpy(),
        "validation": ((t >= tr_end) & (t < va_end)).to_numpy(),
        "test": ((t >= va_end) & (t < te_end)).to_numpy(),
        "all": (t < te_end).to_numpy(),
    }


def add_prefix(prefix: str, stats: dict[str, Any]) -> dict[str, Any]:
    return {f"{prefix}_{k}": v for k, v in stats.items()}


def evaluate_rule_candidates(df: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    masks = split_mask(df, cfg)
    rows: list[dict[str, Any]] = []
    for i, cand in enumerate(candidate_grid(), 1):
        direction, conf = signal_for_candidate(df, cand)
        row: dict[str, Any] = {"id": cand["id"], "family": cand["family"], "params": json.dumps(cand["params"], sort_keys=True)}
        for split in ("train", "validation"):
            sm = masks[split]
            t = trade_frame(df.loc[sm].reset_index(drop=True), direction[sm], conf[sm], cfg.payout, cap=None)
            row.update(add_prefix(split, summarize_trades(t, cfg.risk_fraction)))
        rows.append(row)
        if i % 50 == 0:
            print(f"evaluated {i} rule candidates", flush=True)
    res = pd.DataFrame(rows)
    return res


def rule_neighbor_stability(results: pd.DataFrame) -> pd.Series:
    # Same family and at least all-but-one parameters identical; measure positive validation expectancy ratio.
    parsed = [json.loads(s) for s in results["params"]]
    out = []
    for i, row in results.iterrows():
        pi = parsed[i]
        vals = []
        for j, rj in results.iterrows():
            if row["family"] != rj["family"] or i == j:
                continue
            pj = parsed[j]
            keys = sorted(set(pi) | set(pj))
            diffs = sum(pi.get(k) != pj.get(k) for k in keys)
            if diffs == 1:
                vals.append(bool(rj["train_expectancy"] > 0 and rj["validation_expectancy"] > 0))
        out.append(float(np.mean(vals)) if vals else 0.0)
    return pd.Series(out, index=results.index)


def ml_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    cols = [
        "ret1", "ret2", "ret3", "ret6", "ret12", "ema_spread_8_30", "ema_spread_20_50",
        "rsi14", "bb_z20", "vol_z20", "vol_ratio20", "adx14", "atr_pct", "body_frac",
        "signed_body", "upper_wick", "lower_wick", "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    ]
    x = df[cols].replace([np.inf, -np.inf], np.nan).copy()
    for sym in sorted(df["symbol"].unique()):
        x[f"sym_{sym}"] = (df["symbol"] == sym).astype(float)
    return x, list(x.columns)


def evaluate_ml(df: pd.DataFrame, cfg: Config) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    masks = split_mask(df, cfg)
    X, feat_cols = ml_features(df)
    valid = X.notna().all(axis=1).to_numpy() & np.isfinite(df["future_move"].to_numpy()) & (df["future_move"].to_numpy() != 0)
    train_idx = masks["train"] & valid
    y = (df["future_move"].to_numpy() > 0).astype(int)
    models = {
        "ML_LOGIT": make_pipeline(StandardScaler(), LogisticRegression(C=0.2, max_iter=500, class_weight="balanced", random_state=cfg.seed)),
        "ML_HGB": HistGradientBoostingClassifier(max_iter=140, learning_rate=0.06, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=1.0, random_state=cfg.seed),
    }
    rows: list[dict[str, Any]] = []
    model_probs: dict[str, np.ndarray] = {}
    for mid, model in models.items():
        model.fit(X.loc[train_idx, feat_cols], y[train_idx])
        prob = np.full(len(df), np.nan, dtype=float)
        pred_idx = valid
        prob[pred_idx] = model.predict_proba(X.loc[pred_idx, feat_cols])[:, 1]
        best = None
        for threshold in np.arange(0.55, 0.651, 0.01):
            direction = np.zeros(len(df), dtype=np.int8)
            direction[prob >= threshold] = 1
            direction[prob <= 1 - threshold] = -1
            conf = np.abs(prob - 0.5).astype(np.float32)
            row: dict[str, Any] = {"id": f"{mid}_T{threshold:.2f}", "family": "ml", "params": json.dumps({"model": mid, "threshold": round(float(threshold), 2), "features": feat_cols})}
            for split in ("train", "validation"):
                sm = masks[split]
                t = trade_frame(df.loc[sm].reset_index(drop=True), direction[sm], conf[sm], cfg.payout, cap=None)
                row.update(add_prefix(split, summarize_trades(t, cfg.risk_fraction)))
            rows.append(row)
            if best is None or row["validation_profit_units"] > best[0]:
                best = (row["validation_profit_units"], row["id"], direction, conf)
        assert best is not None
        model_probs[mid] = prob
    return pd.DataFrame(rows), model_probs


def robust_filter(res: pd.DataFrame, cfg: Config) -> pd.Series:
    return (
        (res["train_trades"] >= cfg.min_train_trades)
        & (res["validation_trades"] >= cfg.min_val_trades)
        & (res["train_expectancy"] > 0)
        & (res["validation_expectancy"] > 0)
        & (res["validation_win_rate"] > BREAK_EVEN)
    )


def choose_candidates(res: pd.DataFrame, cfg: Config) -> tuple[str, str, bool]:
    robust = robust_filter(res, cfg)
    pool = res[robust].copy()
    robust_found = not pool.empty
    if pool.empty:
        pool = res[(res["train_trades"] >= 100) & (res["validation_trades"] >= 100)].copy()
    if pool.empty:
        pool = res.copy()
    pool["profit_score"] = pool["validation_profit_units"] + 0.15 * pool["train_profit_units"] + 5 * pool.get("neighbor_stability", 0)
    a = pool.sort_values(["profit_score", "validation_expectancy"], ascending=False).iloc[0]["id"]
    pool["stable_score"] = (
        pool["validation_expectancy"].fillna(-9) * np.sqrt(pool["validation_trades"].clip(lower=1))
        + 0.05 * pool["validation_profit_units"]
        + 2.0 * pool["validation_positive_month_ratio"]
        + 2.0 * pool.get("neighbor_stability", 0)
        + 0.02 * pool["validation_max_dd_units"]
        - 0.05 * pool["validation_max_loss_streak"]
    )
    b = pool.sort_values(["stable_score", "validation_expectancy"], ascending=False).iloc[0]["id"]
    if b == a and len(pool) > 1:
        b = pool.sort_values(["stable_score", "validation_expectancy"], ascending=False).iloc[1]["id"]
    return str(a), str(b), robust_found



def build_selected_cache(df: pd.DataFrame, candidate_res: pd.DataFrame, selected: list[str], model_probs: dict[str, np.ndarray]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for sid in selected:
        row = candidate_res[candidate_res["id"] == sid].iloc[0]
        params = json.loads(row["params"])
        if row["family"] == "ml":
            prob = model_probs[params["model"]]
            th = float(params["threshold"])
            direction = np.zeros(len(df), dtype=np.int8)
            direction[prob >= th] = 1
            direction[prob <= 1 - th] = -1
            conf = np.abs(prob - 0.5).astype(np.float32)
        else:
            direction, conf = signal_for_candidate(df, {"family": row["family"], "params": params})
        cache[sid] = (direction, conf)
    return cache

def evaluate_selected(df: pd.DataFrame, cfg: Config, selected: list[str], cache: dict[str, tuple[np.ndarray, np.ndarray]]) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    masks = split_mask(df, cfg)
    rows = []
    monthly_rows = []
    details: dict[str, Any] = {}
    for sid in selected:
        direction, conf = cache[sid]
        details[sid] = {}
        for split in ("train", "validation", "test", "all"):
            sm = masks[split]
            t = trade_frame(df.loc[sm].reset_index(drop=True), direction[sm], conf[sm], cfg.payout, cap=cfg.max_signals_per_timestamp)
            stats = summarize_trades(t, cfg.risk_fraction)
            rows.append({"id": sid, "split": split, **stats})
            details[sid][split] = stats
            if split == "all":
                m = t.groupby("month")["result"].agg(["count", "sum"]).reset_index()
                win = t.assign(win=t["result"] > 0, loss=t["result"] < 0).groupby("month")[["win", "loss"]].sum().reset_index()
                m = m.merge(win, on="month", how="left")
                m["win_rate"] = m["win"] / (m["win"] + m["loss"]).replace(0, np.nan)
                m["id"] = sid
                monthly_rows.append(m.rename(columns={"count": "trades", "sum": "profit_units", "win": "wins", "loss": "losses"}))
    return pd.DataFrame(rows), pd.concat(monthly_rows, ignore_index=True), details


def data_quality(all_df: pd.DataFrame, cfg: Config) -> dict[str, Any]:
    expected_step = pd.Timedelta(minutes=5)
    out = {"symbols": {}}
    for sym, d in all_df.groupby("symbol"):
        d = d.sort_values("time")
        diffs = d["time"].diff().dropna()
        out["symbols"][sym] = {
            "rows": int(len(d)), "first_time": str(d["time"].min()), "last_time": str(d["time"].max()),
            "duplicate_timestamps": int(d["time"].duplicated().sum()),
            "non_5m_gaps": int((diffs != expected_step).sum()),
            "missing_ohlcv_rows": int(d[["open", "high", "low", "close", "volume"]].isna().any(axis=1).sum()),
        }
    return out


def fmt_pct(x: Any) -> str:
    try:
        return f"{float(x) * 100:.2f}%"
    except Exception:
        return "n/a"


def build_report(cfg: Config, candidate_res: pd.DataFrame, selected_stats: pd.DataFrame, selected_monthly: pd.DataFrame,
                 selected_ids: tuple[str, str], robust_found: bool, manifest: list[dict[str, Any]], quality: dict[str, Any]) -> str:
    lines = [
        "# バイナリーオプション 1年BTレポート（研究専用）", "",
        "## 結論", "",
    ]
    a, b = selected_ids
    for label, sid in (("A 利益最大型", a), ("B 安定型", b)):
        test = selected_stats[(selected_stats.id == sid) & (selected_stats.split == "test")].iloc[0]
        allr = selected_stats[(selected_stats.id == sid) & (selected_stats.split == "all")].iloc[0]
        status = "採用候補" if test["expectancy"] > 0 and test["win_rate"] > BREAK_EVEN else "不採用（未使用Testで優位性不足）"
        lines += [
            f"### {label}: `{sid}` — {status}",
            f"- 未使用Test: {int(test['trades'])}件、勝率 {fmt_pct(test['win_rate'])}、固定損益 {test['profit_units']:.2f} units、期待値 {test['expectancy']:.4f}/trade、最大DD {test['max_dd_units']:.2f} units、最大連敗 {int(test['max_loss_streak'])}",
            f"- 12か月通算: {int(allr['trades'])}件、勝率 {fmt_pct(allr['win_rate'])}、固定損益 {allr['profit_units']:.2f} units、1%複利リターン {fmt_pct(allr['compound_return'])}、複利最大DD {fmt_pct(allr['compound_max_dd'])}",
            "",
        ]
    lines += [
        f"Train/Validationで厳格条件を満たす候補: {'あり' if robust_found else 'なし'}。Testは選定後に評価し、Test期待値が正でない候補は実運用不採用とした。",
        "",
        "## 前提", "",
        f"- データ: Binance公式 Spot 5分足、{', '.join(cfg.symbols)}、{cfg.start_month}〜{cfg.end_month}",
        f"- 判定: シグナル確定足の終値から次の5分足終値。勝ち +{cfg.payout:.2f}、負け -1、同値 0（返金）",
        f"- 損益分岐勝率: {BREAK_EVEN*100:.2f}%（ペイアウト80%）",
        "- 時系列分割: Train 6か月 / Validation 3か月 / Test 3か月。未来参照禁止、Testは候補選定に未使用。",
        f"- 同一時刻の採用上限: 全銘柄合計 {cfg.max_signals_per_timestamp}件。Martingale・追い上げは禁止。",
        "",
        "## 比較したロジック", "",
        "EMA/ADX/RSI順張り、Bollinger/RSI/ATR平均回帰、出来高ブレイクアウト、ローソク足モメンタム、レジーム切替ハイブリッド、Logistic回帰、Histogram Gradient Boosting。",
        "",
        "## 最終候補パラメータ", "",
    ]
    for sid in (a, b):
        row = candidate_res[candidate_res.id == sid].iloc[0]
        lines += [f"- `{sid}` / {row['family']}: `{row['params']}`"]
    lines += ["", "## 月別損益", ""]
    for sid in (a, b):
        lines.append(f"### `{sid}`")
        lines.append("")
        lines.append("|月|取引数|勝率|損益units|")
        lines.append("|---|---:|---:|---:|")
        for _, r in selected_monthly[selected_monthly.id == sid].iterrows():
            lines.append(f"|{r['month']}|{int(r['trades'])}|{fmt_pct(r['win_rate'])}|{r['profit_units']:.2f}|")
        lines.append("")
    lines += [
        "## 自動実行ルール案", "",
        "1. 実取引前に、対象業者の実ペイアウト・約定価格・判定レートと同じ仕様で再BTする。ペイアウトが80%未満なら停止。",
        "2. 1取引リスクは残高1%以下、同時最大2件、同一銘柄の重複禁止。Martingale禁止。",
        "3. 日次 -5R または4連敗で当日停止。月次最大DD -15%で停止し再検証。",
        "4. 重要指標発表の前後はイベントデータを別途導入してブラックアウトする。本BTではニュース時刻を使っていないため、この効果は未検証。",
        "5. 30日または500取引ごとに直近データでウォークフォワード再評価し、未使用期間の期待値が0以下なら停止。",
        "",
        "## データ整合性", "",
        f"- 取得アーカイブ数: {len(manifest)}。各ZIPのSHA-256を記録し、提供されたCHECKSUMは照合。",
        f"- 品質詳細: `{json.dumps(quality, ensure_ascii=False)}`",
        "",
        "## 重要な限界", "",
        "- バイナリーオプションの実際の価格形成は単純な固定倍率型と異なる場合があり、スプレッド、購入価格、判定レート、取引停止時間を再現していない。",
        "- 1%複利は理論シミュレーションであり、取引上限・流動性・口座制限により再現できない可能性がある。",
        "- 全期間で高利益でもHoldoutで崩れるため、Test成績を最優先し、Test不合格ならLIVE化しない。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="research/binary-options/results")
    ap.add_argument("--cache", default=".cache/binance-binary-options")
    args = ap.parse_args()
    cfg = Config()
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache)

    frames = []
    manifest: list[dict[str, Any]] = []
    for symbol in cfg.symbols:
        print(f"loading {symbol}", flush=True)
        d, m = load_symbol(symbol, cfg, cache_dir)
        frames.append(d)
        manifest.extend(m)
    raw = pd.concat(frames, ignore_index=True)
    quality = data_quality(raw, cfg)
    feats = pd.concat([add_features_one(d) for _, d in raw.groupby("symbol", sort=True)], ignore_index=True)
    feats = feats.sort_values(["time", "symbol"]).reset_index(drop=True)
    end = pd.Timestamp(cfg.test_end)
    feats = feats[feats["time"] < end].reset_index(drop=True)

    rule_res = evaluate_rule_candidates(feats, cfg)
    rule_res["neighbor_stability"] = rule_neighbor_stability(rule_res)
    ml_res, model_probs = evaluate_ml(feats, cfg)
    ml_res["neighbor_stability"] = 0.0
    candidate_res = pd.concat([rule_res, ml_res], ignore_index=True)
    a, b, robust_found = choose_candidates(candidate_res, cfg)
    selected_cache = build_selected_cache(feats, candidate_res, [a, b], model_probs)
    selected_stats, selected_monthly, details = evaluate_selected(feats, cfg, [a, b], selected_cache)

    # Test pass/fail is reported after selection; never use Test to replace candidates.
    selected_test = selected_stats[selected_stats.split == "test"].copy()
    selected_test["test_pass"] = (selected_test["expectancy"] > 0) & (selected_test["win_rate"] > BREAK_EVEN)

    candidate_res.to_csv(out_dir / "candidate_summary.csv", index=False)
    selected_stats.to_csv(out_dir / "selected_split_summary.csv", index=False)
    selected_monthly.to_csv(out_dir / "selected_monthly.csv", index=False)
    (out_dir / "data_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {
        "config": asdict(cfg), "break_even_win_rate": BREAK_EVEN,
        "selected": {"profit_max": a, "stable": b}, "robust_train_validation_candidate_found": robust_found,
        "selected_details": details, "data_quality": quality,
        "test_pass": {r["id"]: bool(r["test_pass"]) for _, r in selected_test.iterrows()},
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    report = build_report(cfg, candidate_res, selected_stats, selected_monthly, (a, b), robust_found, manifest, quality)
    (out_dir / "REPORT_JA.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary["selected"], ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
