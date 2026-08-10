from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY"]
BASE_URL = "https://raw.githubusercontent.com/ejtraderLabs/historical-data/main"
OUT_DIR = Path("research/aifx_early_wave")

# Proxy execution cost contract: broker floor + execution buffer, then 2x stress.
COST_PIPS = {
    "EURUSD": (0.4 + 0.1) * 2.0,
    "GBPUSD": (0.0 + 0.25) * 2.0,
    "USDJPY": (0.2 + 0.1) * 2.0,
    "EURJPY": (0.5 + 0.15) * 2.0,
    "GBPJPY": (0.0 + 0.4) * 2.0,
}

FAMILIES = ("IMPULSE_START", "CONTINUATION", "REVERSAL")
DIRECTIONS = ("LONG", "SHORT")
STOP_ATR = 1.25
TRAIL_ACTIVATE_R = 1.0
TRAIL_ATR = 2.0
MAX_HOLD_BARS = 96


def pip_size(pair: str) -> float:
    return 0.01 if pair.endswith("JPY") else 0.0001


def point_scale(pair: str) -> float:
    return 1_000.0 if pair.endswith("JPY") else 100_000.0


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev = close.shift(1)
    return pd.concat([(high - low), (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)


def load_pair(pair: str) -> pd.DataFrame:
    url = f"{BASE_URL}/{pair}/{pair}m15.csv"
    x = pd.read_csv(url)
    x["Date"] = pd.to_datetime(x["Date"], errors="coerce", utc=True)
    x = x.dropna(subset=["Date"]).set_index("Date").sort_index()
    scale = point_scale(pair)
    for c in ("open", "high", "low", "close"):
        x[c] = pd.to_numeric(x[c], errors="coerce") / scale
    x = x.dropna(subset=["open", "high", "low", "close"])
    x = x[~x.index.duplicated(keep="last")]
    spread = COST_PIPS[pair] * pip_size(pair)
    for c in ("open", "high", "low", "close"):
        x[f"mid_{c}"] = x[c]
        x[f"exec_bid_{c}"] = x[c] - spread / 2.0
        x[f"exec_ask_{c}"] = x[c] + spread / 2.0
    return add_features(x)


def add_features(x: pd.DataFrame) -> pd.DataFrame:
    x = x.copy()
    o, h, l, c = x.mid_open, x.mid_high, x.mid_low, x.mid_close
    tr = true_range(h, l, c)
    x["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    x["atr_ratio"] = x.atr / x.atr.rolling(192, min_periods=96).median()
    rng = (h - l).replace(0.0, np.nan)
    body = c - o
    x["body"] = body
    x["body_frac"] = body.abs() / rng
    x["close_loc"] = (c - l) / rng
    x["ret1_atr"] = (c - c.shift(1)) / x.atr
    x["ret2_atr"] = (c - c.shift(2)) / x.atr
    x["ret4_atr"] = (c - c.shift(4)) / x.atr
    x["ret8_atr"] = (c - c.shift(8)) / x.atr
    for n in (4, 8, 16):
        x[f"prior_high{n}"] = h.shift(1).rolling(n).max()
        x[f"prior_low{n}"] = l.shift(1).rolling(n).min()
    return x


def complete_years(x: pd.DataFrame) -> list[int]:
    out = []
    for y in sorted(set(x.index.year)):
        part = x[x.index.year == y]
        if len(part) < 20_000:
            continue
        if part.index.to_series().diff().max() <= pd.Timedelta(hours=96):
            out.append(int(y))
    return out


def build_signals(x: pd.DataFrame) -> dict[tuple[str, str], np.ndarray]:
    c, h, l = x.mid_close, x.mid_high, x.mid_low
    atr = x.atr
    rng = h - l
    pos_body = x.body > 0
    neg_body = x.body < 0

    impulse_long = (
        (c >= x.prior_high16 - 0.10 * atr)
        & pos_body
        & (x.body_frac >= 0.55)
        & (rng >= 1.10 * atr)
        & (x.close_loc >= 0.75)
        & (x.ret4_atr >= 0.80)
    )
    impulse_short = (
        (c <= x.prior_low16 + 0.10 * atr)
        & neg_body
        & (x.body_frac >= 0.55)
        & (rng >= 1.10 * atr)
        & (x.close_loc <= 0.25)
        & (x.ret4_atr <= -0.80)
    )

    recent_impulse_long = impulse_long.shift(1).rolling(8, min_periods=1).max().fillna(0).astype(bool)
    recent_impulse_short = impulse_short.shift(1).rolling(8, min_periods=1).max().fillna(0).astype(bool)
    recent_high8 = x.prior_high8
    recent_low8 = x.prior_low8

    continuation_long = (
        recent_impulse_long
        & ((recent_high8 - l) <= 0.75 * atr)
        & (c > x.prior_high4)
        & (x.ret8_atr >= 0.50)
        & pos_body
    )
    continuation_short = (
        recent_impulse_short
        & ((h - recent_low8) <= 0.75 * atr)
        & (c < x.prior_low4)
        & (x.ret8_atr <= -0.50)
        & neg_body
    )

    turn_up = (x.ret2_atr > 0) & (x.ret2_atr.shift(1) <= 0)
    turn_down = (x.ret2_atr < 0) & (x.ret2_atr.shift(1) >= 0)
    reversal_long = (
        (l <= x.prior_low16 + 0.10 * atr)
        & (c > x.prior_low16)
        & pos_body
        & (x.body_frac >= 0.55)
        & (x.close_loc >= 0.70)
        & turn_up
    )
    reversal_short = (
        (h >= x.prior_high16 - 0.10 * atr)
        & (c < x.prior_high16)
        & neg_body
        & (x.body_frac >= 0.55)
        & (x.close_loc <= 0.30)
        & turn_down
    )

    valid = x.atr.notna() & x.prior_high16.notna() & x.prior_low16.notna()
    signals = {
        ("IMPULSE_START", "LONG"): impulse_long,
        ("IMPULSE_START", "SHORT"): impulse_short,
        ("CONTINUATION", "LONG"): continuation_long,
        ("CONTINUATION", "SHORT"): continuation_short,
        ("REVERSAL", "LONG"): reversal_long,
        ("REVERSAL", "SHORT"): reversal_short,
    }
    return {k: (v & valid).fillna(False).to_numpy() for k, v in signals.items()}


def simulate(x: pd.DataFrame, sig: np.ndarray, pair: str, family: str, direction: str,
             start: str, end: str) -> list[dict]:
    side = 1 if direction == "LONG" else -1
    mask = (x.index >= pd.Timestamp(start, tz="UTC")) & (x.index < pd.Timestamp(end, tz="UTC"))
    candidates = np.flatnonzero(mask & sig)
    atr = x.atr.to_numpy()
    bo, ao = x.exec_bid_open.to_numpy(), x.exec_ask_open.to_numpy()
    bh, bl = x.exec_bid_high.to_numpy(), x.exec_bid_low.to_numpy()
    ah, al = x.exec_ask_high.to_numpy(), x.exec_ask_low.to_numpy()
    bc, ac = x.exec_bid_close.to_numpy(), x.exec_ask_close.to_numpy()
    midc = x.mid_close.to_numpy()
    ph8, pl8 = x.prior_high8.to_numpy(), x.prior_low8.to_numpy()
    pip = pip_size(pair)
    rows: list[dict] = []
    last_exit = -1

    for signal_i in candidates:
        if signal_i <= last_exit or signal_i + 1 >= len(x) or not np.isfinite(atr[signal_i]):
            continue
        entry_i = signal_i + 1
        if not mask[entry_i]:
            continue
        entry = float(ao[entry_i] if side == 1 else bo[entry_i])
        risk = float(atr[signal_i]) * STOP_ATR
        if not np.isfinite(entry) or not np.isfinite(risk) or risk <= 0:
            continue
        initial_stop = entry - side * risk
        active_stop = initial_stop
        best = entry
        hard_end = min(entry_i + MAX_HOLD_BARS, len(x) - 1)
        exit_i = hard_end
        exit_price = None
        reason = "TIME"
        pending_structural = False

        for j in range(entry_i, hard_end + 1):
            executable_open = float(bo[j] if side == 1 else ao[j])

            if pending_structural and j > entry_i:
                exit_i = j
                exit_price = executable_open
                reason = "STRUCTURE"
                break

            if j > entry_i:
                gap_hit = executable_open <= active_stop if side == 1 else executable_open >= active_stop
                if gap_hit:
                    exit_i = j
                    exit_price = executable_open
                    reason = "STOP_GAP" if active_stop == initial_stop else "TRAIL_GAP"
                    break

            stop_hit = float(bl[j]) <= active_stop if side == 1 else float(ah[j]) >= active_stop
            if stop_hit:
                exit_i = j
                exit_price = active_stop
                reason = "STOP" if active_stop == initial_stop else "TRAIL"
                break

            # Causal trailing stop: current bar updates the stop only for the NEXT bar.
            if side == 1:
                best = max(best, float(bh[j]))
                if best - entry >= TRAIL_ACTIVATE_R * risk:
                    active_stop = max(active_stop, best - TRAIL_ATR * float(atr[j]))
                if np.isfinite(pl8[j]) and midc[j] < pl8[j] and j < hard_end:
                    pending_structural = True
            else:
                best = min(best, float(al[j]))
                if entry - best >= TRAIL_ACTIVATE_R * risk:
                    active_stop = min(active_stop, best + TRAIL_ATR * float(atr[j]))
                if np.isfinite(ph8[j]) and midc[j] > ph8[j] and j < hard_end:
                    pending_structural = True

            if j == hard_end:
                exit_i = j
                exit_price = float(bc[j] if side == 1 else ac[j])
                reason = "TIME"

        if exit_price is None:
            exit_price = float(bc[exit_i] if side == 1 else ac[exit_i])
        net_r = side * (exit_price - entry) / risk
        net_pips = side * (exit_price - entry) / pip
        rows.append({
            "pair": pair,
            "family": family,
            "direction": direction,
            "signal_time": x.index[signal_i].isoformat(),
            "entry_time": x.index[entry_i].isoformat(),
            "exit_time": x.index[exit_i].isoformat(),
            "entry_price": entry,
            "exit_price": float(exit_price),
            "risk_distance": risk,
            "net_r": float(net_r),
            "net_pips": float(net_pips),
            "reason": reason,
        })
        last_exit = exit_i
    return rows


def metrics(rows: list[dict]) -> dict:
    if not rows:
        return {"trades": 0, "net_r": 0.0, "pf": 0.0, "max_dd_r": 0.0,
                "win_rate": 0.0, "net_pips": 0.0, "worst_trade_r": 0.0,
                "gap_count": 0, "worst_gap_r": 0.0}
    ordered = sorted(rows, key=lambda r: (r["exit_time"], r["entry_time"]))
    a = np.asarray([r["net_r"] for r in ordered], dtype=float)
    gains = float(a[a > 0].sum())
    losses = float(-a[a < 0].sum())
    curve = np.r_[0.0, np.cumsum(a)]
    dd = curve - np.maximum.accumulate(curve)
    gaps = [r["net_r"] for r in ordered if r["reason"] in ("STOP_GAP", "TRAIL_GAP")]
    return {
        "trades": int(len(a)),
        "net_r": float(a.sum()),
        "pf": float(gains / losses) if losses > 0 else (99.0 if gains > 0 else 0.0),
        "max_dd_r": float(dd.min()),
        "win_rate": float((a > 0).mean()),
        "net_pips": float(sum(r["net_pips"] for r in ordered)),
        "worst_trade_r": float(a.min()),
        "gap_count": int(len(gaps)),
        "worst_gap_r": float(min(gaps)) if gaps else 0.0,
    }


def year_range(y: int) -> tuple[str, str]:
    return f"{y}-01-01", f"{y + 1}-01-01"


def zigzag_legs(x: pd.DataFrame, year: int, pair: str) -> list[dict]:
    start, end = year_range(year)
    m = x[(x.index >= pd.Timestamp(start, tz="UTC")) & (x.index < pd.Timestamp(end, tz="UTC"))]
    if m.empty:
        return []
    h1 = m.resample("1h", label="left", closed="left").agg(
        {"mid_open": "first", "mid_high": "max", "mid_low": "min", "mid_close": "last"}
    ).dropna()
    atr = true_range(h1.mid_high, h1.mid_low, h1.mid_close).ewm(alpha=1 / 14, adjust=False).mean()
    threshold = float(atr.median()) * 6.0
    if not np.isfinite(threshold) or threshold <= 0 or len(h1) < 2:
        return []
    values = h1.mid_close.to_numpy()
    pivots: list[tuple[int, float]] = []
    hi_idx = lo_idx = 0
    hi = lo = float(values[0])
    direction = 0
    for i in range(1, len(values)):
        v = float(values[i])
        if direction == 0:
            if v > hi:
                hi, hi_idx = v, i
            if v < lo:
                lo, lo_idx = v, i
            if hi - lo >= threshold:
                if hi_idx > lo_idx:
                    pivots.append((lo_idx, lo)); direction = 1; hi, hi_idx = v, i
                else:
                    pivots.append((hi_idx, hi)); direction = -1; lo, lo_idx = v, i
        elif direction == 1:
            if v > hi:
                hi, hi_idx = v, i
            elif hi - v >= threshold:
                pivots.append((hi_idx, hi)); direction = -1; lo, lo_idx = v, i
        else:
            if v < lo:
                lo, lo_idx = v, i
            elif v - lo >= threshold:
                pivots.append((lo_idx, lo)); direction = 1; hi, hi_idx = v, i
    if direction == 1:
        pivots.append((hi_idx, hi))
    elif direction == -1:
        pivots.append((lo_idx, lo))
    pip = pip_size(pair)
    legs = []
    for a, b in zip(pivots[:-1], pivots[1:]):
        delta = b[1] - a[1]
        if delta == 0:
            continue
        legs.append({
            "start_time": h1.index[a[0]], "end_time": h1.index[b[0]],
            "start_price": float(a[1]), "end_price": float(b[1]),
            "direction": "LONG" if delta > 0 else "SHORT",
            "pips": float(abs(delta) / pip),
        })
    return legs


def wave_diagnostics(x: pd.DataFrame, sig: np.ndarray, direction: str, year: int,
                     pair: str, executed_rows: list[dict]) -> dict:
    legs = zigzag_legs(x, year, pair)
    same = [z for z in legs if z["direction"] == direction]
    signal_times = x.index[np.flatnonzero(sig)]
    lags = []
    for leg in same:
        after = signal_times[(signal_times >= leg["start_time"]) & (signal_times <= leg["end_time"])]
        if len(after) == 0:
            continue
        ts = after[0]
        px = float(x.at[ts, "mid_close"])
        amp = abs(leg["end_price"] - leg["start_price"])
        if amp <= 0:
            continue
        moved = (px - leg["start_price"]) if direction == "LONG" else (leg["start_price"] - px)
        lags.append(float(np.clip(moved / amp, 0.0, 1.0)))
    all_pips = float(sum(z["pips"] for z in legs))
    same_pips = float(sum(z["pips"] for z in same))
    trade_pips = float(sum(r["net_pips"] for r in executed_rows))
    return {
        "major_swing_pips_all": all_pips,
        "major_swing_pips_direction": same_pips,
        "direction_legs": len(same),
        "detected_legs": len(lags),
        "detected_leg_ratio": float(len(lags) / len(same)) if same else 0.0,
        "median_detection_lag_fraction": float(np.median(lags)) if lags else None,
        "p75_detection_lag_fraction": float(np.quantile(lags, 0.75)) if lags else None,
        "selected_net_pips": trade_pips,
        "net_capture_ratio_all": float(trade_pips / all_pips) if all_pips else 0.0,
        "net_capture_ratio_direction": float(trade_pips / same_pips) if same_pips else 0.0,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = {pair: load_pair(pair) for pair in PAIRS}
    common = set(complete_years(frames[PAIRS[0]]))
    for pair in PAIRS[1:]:
        common &= set(complete_years(frames[pair]))
    years = sorted(common)
    if len(years) < 7:
        raise RuntimeError(f"Need >=7 common complete years, got {years}")
    oos_years = years[-2:]
    validation_years = years[-4:-2]
    development_years = years[:-4]
    if len(development_years) < 3:
        raise RuntimeError("Need at least 3 development years")

    result = {
        "status": "EARLY_WAVE_PROXY",
        "source": "ejtraderLabs/historical-data M15 mid OHLC",
        "source_timezone_verified": False,
        "session_rules_used": False,
        "formal_production_evidence": False,
        "cost_stress": "2x configured proxy spread floor + execution buffer",
        "selection_uses_oos": False,
        "parameters": {
            "families": list(FAMILIES), "stop_atr": STOP_ATR,
            "trail_activate_r": TRAIL_ACTIVATE_R, "trail_atr": TRAIL_ATR,
            "max_hold_m15_bars": MAX_HOLD_BARS,
        },
        "complete_years": years,
        "development_years": development_years,
        "validation_years": validation_years,
        "oos_years": oos_years,
        "pairs": {},
    }
    all_oos_rows: list[dict] = []

    for pair in PAIRS:
        x = frames[pair]
        signals = build_signals(x)
        pair_out = {"directions": {}}
        for direction in DIRECTIONS:
            candidates = []
            for family in FAMILIES:
                sig = signals[(family, direction)]
                dev_rows = []
                by_year = {}
                for y in development_years:
                    s, e = year_range(y)
                    rows = simulate(x, sig, pair, family, direction, s, e)
                    by_year[str(y)] = metrics(rows)
                    dev_rows.extend(rows)
                met = metrics(dev_rows)
                positive = sum(by_year[str(y)]["net_r"] > 0 for y in development_years)
                worst = min(by_year[str(y)]["net_r"] for y in development_years)
                candidates.append({
                    "family": family, "sig": sig, "development": met,
                    "development_by_year": by_year, "positive_dev_years": positive,
                    "worst_dev_year_r": float(worst),
                })
            candidates.sort(key=lambda c: (
                c["positive_dev_years"], c["worst_dev_year_r"],
                c["development"]["net_r"], c["development"]["pf"],
            ), reverse=True)
            chosen = candidates[0]
            required_positive = max(2, math.ceil(len(development_years) * 0.67))
            dev_gate = (
                chosen["positive_dev_years"] >= required_positive
                and chosen["development"]["net_r"] > 0
                and chosen["development"]["trades"] >= 80
                and chosen["development"]["pf"] >= 1.02
            )

            val_rows = []
            val_by_year = {}
            if dev_gate:
                for y in validation_years:
                    s, e = year_range(y)
                    rows = simulate(x, chosen["sig"], pair, chosen["family"], direction, s, e)
                    val_by_year[str(y)] = metrics(rows)
                    val_rows.extend(rows)
            val_met = metrics(val_rows)
            val_gate = dev_gate and (
                all(val_by_year[str(y)]["net_r"] > 0 for y in validation_years)
                and val_met["trades"] >= 40
                and val_met["pf"] >= 1.05
            )

            oos_rows = []
            oos_by_year = {}
            diagnostics = {}
            if val_gate:
                for y in oos_years:
                    s, e = year_range(y)
                    rows = simulate(x, chosen["sig"], pair, chosen["family"], direction, s, e)
                    oos_by_year[str(y)] = metrics(rows)
                    diagnostics[str(y)] = wave_diagnostics(x, chosen["sig"], direction, y, pair, rows)
                    oos_rows.extend(rows)
                all_oos_rows.extend(oos_rows)
            oos_met = metrics(oos_rows)
            oos_pass = val_gate and (
                all(oos_by_year[str(y)]["net_r"] > 0 for y in oos_years)
                and oos_met["pf"] >= 1.05
            )

            pair_out["directions"][direction] = {
                "chosen_family": chosen["family"],
                "all_development_candidates": [{
                    "family": c["family"], "development": c["development"],
                    "positive_dev_years": c["positive_dev_years"],
                    "worst_dev_year_r": c["worst_dev_year_r"],
                } for c in candidates],
                "development": chosen["development"],
                "development_by_year": chosen["development_by_year"],
                "positive_dev_years": chosen["positive_dev_years"],
                "worst_dev_year_r": chosen["worst_dev_year_r"],
                "development_gate": dev_gate,
                "validation": val_met,
                "validation_by_year": val_by_year,
                "validation_gate": val_gate,
                "oos": oos_met,
                "oos_by_year": oos_by_year,
                "oos_wave_diagnostics": diagnostics,
                "oos_pass": oos_pass,
            }
        result["pairs"][pair] = pair_out

    result["oos_passed_directions"] = [
        f"{pair}:{direction}"
        for pair, p in result["pairs"].items()
        for direction, d in p["directions"].items() if d["oos_pass"]
    ]
    result["oos_portfolio_unconstrained_sum"] = metrics(all_oos_rows)
    result["status"] = "PROXY_PROMISING" if result["oos_passed_directions"] else "PROXY_REJECT"

    out = OUT_DIR / "early_wave_proxy_results.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")

    lines = [
        "# AIFX Early Wave Proxy Results", "",
        f"Status: **{result['status']}**", "",
        f"Development: {development_years}",
        f"Validation: {validation_years}",
        f"OOS: {oos_years}", "",
        "| Pair | Dir | Family | Dev R | Dev PF | Dev Gate | Val R | Val PF | Val Gate | OOS R | OOS PF | OOS DD | OOS Trades | OOS Pass |",
        "|---|---|---|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---|",
    ]
    for pair in PAIRS:
        for direction in DIRECTIONS:
            d = result["pairs"][pair]["directions"][direction]
            lines.append(
                f"| {pair} | {direction} | {d['chosen_family']} | "
                f"{d['development']['net_r']:.2f} | {d['development']['pf']:.3f} | {d['development_gate']} | "
                f"{d['validation']['net_r']:.2f} | {d['validation']['pf']:.3f} | {d['validation_gate']} | "
                f"{d['oos']['net_r']:.2f} | {d['oos']['pf']:.3f} | {d['oos']['max_dd_r']:.2f} | "
                f"{d['oos']['trades']} | {d['oos_pass']} |"
            )
    lines += ["", "Passed directions: " + ", ".join(result["oos_passed_directions"])]
    (OUT_DIR / "early_wave_proxy_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "years": {"dev": development_years, "val": validation_years, "oos": oos_years},
        "passed": result["oos_passed_directions"],
        "portfolio": result["oos_portfolio_unconstrained_sum"],
    }, indent=2))


if __name__ == "__main__":
    main()
