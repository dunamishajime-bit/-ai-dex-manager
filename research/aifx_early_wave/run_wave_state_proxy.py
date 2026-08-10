from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

import run_early_wave_proxy as base

OUT_DIR = Path("research/aifx_early_wave")
FAMILIES = ("STATE_TRANSITION", "COMPRESSION_RELEASE", "DIRECTIONAL_EFFICIENCY")
DIRECTIONS = ("LONG", "SHORT")
STOP_ATR = 1.50
TRAIL_ACTIVATE_R = 1.00
TRAIL_ATR = 2.50
MAX_HOLD_BARS = 192


def enriched(x: pd.DataFrame) -> pd.DataFrame:
    x = x.copy()
    c, h, l = x.mid_close, x.mid_high, x.mid_low
    absdiff = c.diff().abs()
    x["eff12"] = (c - c.shift(12)).abs() / absdiff.rolling(12).sum().replace(0, np.nan)
    x["eff16"] = (c - c.shift(16)).abs() / absdiff.rolling(16).sum().replace(0, np.nan)
    x["disp4"] = (c - c.shift(4)) / x.atr
    x["disp12"] = (c - c.shift(12)) / x.atr
    x["disp16"] = (c - c.shift(16)) / x.atr
    signs = np.sign(c.diff())
    x["posfrac8"] = (signs > 0).rolling(8).mean()
    x["negfrac8"] = (signs < 0).rolling(8).mean()
    ch_hi = h.shift(1).rolling(16).max()
    ch_lo = l.shift(1).rolling(16).min()
    width = (ch_hi - ch_lo).replace(0, np.nan)
    x["channel_pos16"] = (c - ch_lo) / width
    x["atr48_ratio"] = x.atr / x.atr.rolling(48).median()
    tr = base.true_range(h, l, c)
    x["range_compression"] = tr.rolling(16).median() / tr.rolling(96).median().replace(0, np.nan)
    return x


def state_transition(x: pd.DataFrame) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    long_score = (
        (x.disp4 >= 0.45).astype(int)
        + (x.disp12 >= 0.90).astype(int)
        + (x.eff12 >= 0.42).astype(int)
        + (x.posfrac8 >= 0.625).astype(int)
        + (x.channel_pos16 >= 0.72).astype(int)
        + (x.atr48_ratio >= 0.90).astype(int)
    )
    short_score = (
        (x.disp4 <= -0.45).astype(int)
        + (x.disp12 <= -0.90).astype(int)
        + (x.eff12 >= 0.42).astype(int)
        + (x.negfrac8 >= 0.625).astype(int)
        + (x.channel_pos16 <= 0.28).astype(int)
        + (x.atr48_ratio >= 0.90).astype(int)
    )
    n = len(x)
    ent_l = np.zeros(n, dtype=bool); ent_s = np.zeros(n, dtype=bool)
    ext_l = np.zeros(n, dtype=bool); ext_s = np.zeros(n, dtype=bool)
    state = 0
    for i in range(n):
        ls, ss = int(long_score.iat[i]), int(short_score.iat[i])
        prev = state
        if state == 0:
            if ls >= 4 and ss <= 2:
                state = 1
            elif ss >= 4 and ls <= 2:
                state = -1
        elif state == 1:
            if ss >= 4 and ls <= 2:
                state = -1
            elif ls <= 2:
                state = 0
        else:
            if ls >= 4 and ss <= 2:
                state = 1
            elif ss <= 2:
                state = 0
        if state == 1 and prev != 1:
            ent_l[i] = True
        if state == -1 and prev != -1:
            ent_s[i] = True
        if prev == 1 and state != 1:
            ext_l[i] = True
        if prev == -1 and state != -1:
            ext_s[i] = True
    return {"LONG": ent_l, "SHORT": ent_s}, {"LONG": ext_l, "SHORT": ext_s}


def compression_release(x: pd.DataFrame) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    recent_compress = (x.range_compression <= 0.75).shift(1).rolling(8, min_periods=1).max().fillna(0).astype(bool)
    rng = x.mid_high - x.mid_low
    long_raw = (
        recent_compress
        & (x.mid_close > x.prior_high16)
        & (rng >= 1.25 * x.atr)
        & (x.body > 0)
        & (x.body_frac >= 0.55)
        & (x.close_loc >= 0.75)
    )
    short_raw = (
        recent_compress
        & (x.mid_close < x.prior_low16)
        & (rng >= 1.25 * x.atr)
        & (x.body < 0)
        & (x.body_frac >= 0.55)
        & (x.close_loc <= 0.25)
    )
    # Event pulse only on false->true; do not repeatedly enter an established release.
    ent_l = (long_raw & ~long_raw.shift(1).fillna(False)).to_numpy(dtype=bool)
    ent_s = (short_raw & ~short_raw.shift(1).fillna(False)).to_numpy(dtype=bool)
    ext_l = ((x.disp4 <= -0.65) | (x.mid_close < x.prior_low8)).fillna(False).to_numpy(dtype=bool)
    ext_s = ((x.disp4 >= 0.65) | (x.mid_close > x.prior_high8)).fillna(False).to_numpy(dtype=bool)
    return {"LONG": ent_l, "SHORT": ent_s}, {"LONG": ext_l, "SHORT": ext_s}


def directional_efficiency(x: pd.DataFrame) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    long_cond = (
        (x.eff16 >= 0.48) & (x.disp16 >= 1.50) & (x.disp4 >= 0.40)
        & (x.channel_pos16 >= 0.70)
    ).fillna(False).to_numpy()
    short_cond = (
        (x.eff16 >= 0.48) & (x.disp16 <= -1.50) & (x.disp4 <= -0.40)
        & (x.channel_pos16 <= 0.30)
    ).fillna(False).to_numpy()
    n = len(x)
    ent_l = np.zeros(n, dtype=bool); ent_s = np.zeros(n, dtype=bool)
    ext_l = np.zeros(n, dtype=bool); ext_s = np.zeros(n, dtype=bool)
    latch_l = latch_s = False
    for i in range(n):
        if latch_l:
            reset = (not np.isfinite(x.eff16.iat[i])) or x.eff16.iat[i] < 0.25 or x.disp16.iat[i] < 0.20
            if reset:
                latch_l = False; ext_l[i] = True
        elif long_cond[i]:
            latch_l = True; ent_l[i] = True
        if latch_s:
            reset = (not np.isfinite(x.eff16.iat[i])) or x.eff16.iat[i] < 0.25 or x.disp16.iat[i] > -0.20
            if reset:
                latch_s = False; ext_s[i] = True
        elif short_cond[i]:
            latch_s = True; ent_s[i] = True
    return {"LONG": ent_l, "SHORT": ent_s}, {"LONG": ext_l, "SHORT": ext_s}


def build_all(x: pd.DataFrame):
    return {
        "STATE_TRANSITION": state_transition(x),
        "COMPRESSION_RELEASE": compression_release(x),
        "DIRECTIONAL_EFFICIENCY": directional_efficiency(x),
    }


def simulate(x: pd.DataFrame, entry_sig: np.ndarray, exit_sig: np.ndarray, pair: str,
             family: str, direction: str, start: str, end: str) -> list[dict]:
    side = 1 if direction == "LONG" else -1
    mask = (x.index >= pd.Timestamp(start, tz="UTC")) & (x.index < pd.Timestamp(end, tz="UTC"))
    candidates = np.flatnonzero(mask & entry_sig)
    atr = x.atr.to_numpy()
    bo, ao = x.exec_bid_open.to_numpy(), x.exec_ask_open.to_numpy()
    bh, bl = x.exec_bid_high.to_numpy(), x.exec_bid_low.to_numpy()
    ah, al = x.exec_ask_high.to_numpy(), x.exec_ask_low.to_numpy()
    bc, ac = x.exec_bid_close.to_numpy(), x.exec_ask_close.to_numpy()
    pip = base.pip_size(pair)
    rows = []; last_exit = -1
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
        exit_i = hard_end; exit_price = None; reason = "TIME"
        pending_rule_exit = False
        for j in range(entry_i, hard_end + 1):
            executable_open = float(bo[j] if side == 1 else ao[j])
            if pending_rule_exit and j > entry_i:
                exit_i = j; exit_price = executable_open; reason = "STATE_EXIT"; break
            if j > entry_i:
                gap_hit = executable_open <= active_stop if side == 1 else executable_open >= active_stop
                if gap_hit:
                    exit_i = j; exit_price = executable_open
                    reason = "STOP_GAP" if active_stop == initial_stop else "TRAIL_GAP"; break
            stop_hit = float(bl[j]) <= active_stop if side == 1 else float(ah[j]) >= active_stop
            if stop_hit:
                exit_i = j; exit_price = active_stop
                reason = "STOP" if active_stop == initial_stop else "TRAIL"; break
            if side == 1:
                best = max(best, float(bh[j]))
                if best - entry >= TRAIL_ACTIVATE_R * risk:
                    active_stop = max(active_stop, best - TRAIL_ATR * float(atr[j]))
            else:
                best = min(best, float(al[j]))
                if entry - best >= TRAIL_ACTIVATE_R * risk:
                    active_stop = min(active_stop, best + TRAIL_ATR * float(atr[j]))
            if exit_sig[j] and j < hard_end:
                pending_rule_exit = True
            if j == hard_end:
                exit_i = j; exit_price = float(bc[j] if side == 1 else ac[j]); reason = "TIME"
        if exit_price is None:
            exit_price = float(bc[exit_i] if side == 1 else ac[exit_i])
        rows.append({
            "pair": pair, "family": family, "direction": direction,
            "signal_time": x.index[signal_i].isoformat(), "entry_time": x.index[entry_i].isoformat(),
            "exit_time": x.index[exit_i].isoformat(), "entry_price": entry, "exit_price": float(exit_price),
            "risk_distance": risk, "net_r": float(side * (exit_price - entry) / risk),
            "net_pips": float(side * (exit_price - entry) / pip), "reason": reason,
        })
        last_exit = exit_i
    return rows


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = {p: enriched(base.load_pair(p)) for p in base.PAIRS}
    common = set(base.complete_years(frames[base.PAIRS[0]]))
    for p in base.PAIRS[1:]:
        common &= set(base.complete_years(frames[p]))
    years = sorted(common)
    if len(years) < 7:
        raise RuntimeError(years)
    oos = years[-2:]; val = years[-4:-2]; dev = years[:-4]
    required_positive = max(2, math.ceil(len(dev) * 0.67))
    result = {
        "status": "WAVE_STATE_PROXY", "source_timezone_verified": False,
        "formal_production_evidence": False, "session_rules_used": False,
        "cost_stress": "2x configured proxy spread floor + execution buffer",
        "selection_uses_oos": False, "families": list(FAMILIES),
        "development_years": dev, "validation_years": val, "oos_years": oos,
        "execution": {"stop_atr": STOP_ATR, "trail_activate_r": TRAIL_ACTIVATE_R,
                      "trail_atr": TRAIL_ATR, "max_hold_bars": MAX_HOLD_BARS},
        "hypotheses": {},
    }
    passed = []; all_pass_rows = []
    for pair in base.PAIRS:
        x = frames[pair]; family_signals = build_all(x)
        for family in FAMILIES:
            entries, exits = family_signals[family]
            for direction in DIRECTIONS:
                key = f"{pair}:{direction}:{family}"
                dev_rows = []; dev_by = {}
                for y in dev:
                    s, e = base.year_range(y)
                    rows = simulate(x, entries[direction], exits[direction], pair, family, direction, s, e)
                    dev_by[str(y)] = base.metrics(rows); dev_rows.extend(rows)
                dm = base.metrics(dev_rows)
                positive = sum(dev_by[str(y)]["net_r"] > 0 for y in dev)
                dev_gate = positive >= required_positive and dm["net_r"] > 0 and dm["trades"] >= 80 and dm["pf"] >= 1.02
                val_rows = []; val_by = {}
                if dev_gate:
                    for y in val:
                        s, e = base.year_range(y)
                        rows = simulate(x, entries[direction], exits[direction], pair, family, direction, s, e)
                        val_by[str(y)] = base.metrics(rows); val_rows.extend(rows)
                vm = base.metrics(val_rows)
                val_gate = dev_gate and all(val_by[str(y)]["net_r"] > 0 for y in val) and vm["trades"] >= 40 and vm["pf"] >= 1.05
                oos_rows = []; oos_by = {}; diag = {}
                if val_gate:
                    for y in oos:
                        s, e = base.year_range(y)
                        rows = simulate(x, entries[direction], exits[direction], pair, family, direction, s, e)
                        oos_by[str(y)] = base.metrics(rows)
                        diag[str(y)] = base.wave_diagnostics(x, entries[direction], direction, y, pair, rows)
                        oos_rows.extend(rows)
                om = base.metrics(oos_rows)
                oos_pass = val_gate and all(oos_by[str(y)]["net_r"] > 0 for y in oos) and om["pf"] >= 1.05
                if oos_pass:
                    passed.append(key); all_pass_rows.extend(oos_rows)
                result["hypotheses"][key] = {
                    "pair": pair, "direction": direction, "family": family,
                    "development": dm, "development_by_year": dev_by,
                    "positive_dev_years": positive, "development_gate": dev_gate,
                    "validation": vm, "validation_by_year": val_by, "validation_gate": val_gate,
                    "oos": om, "oos_by_year": oos_by, "oos_wave_diagnostics": diag,
                    "oos_pass": oos_pass,
                }
    result["development_passed"] = [k for k, v in result["hypotheses"].items() if v["development_gate"]]
    result["validation_passed"] = [k for k, v in result["hypotheses"].items() if v["validation_gate"]]
    result["oos_passed"] = passed
    result["oos_passed_portfolio_unconstrained_sum"] = base.metrics(all_pass_rows)
    result["status"] = "PROXY_PROMISING" if passed else "PROXY_REJECT"
    (OUT_DIR / "wave_state_proxy_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    lines = ["# AIFX Wave State Proxy Results", "", f"Status: **{result['status']}**", "",
             f"Development: {dev}", f"Validation: {val}", f"OOS: {oos}", "",
             "## Development-pass hypotheses", ""]
    if result["development_passed"]:
        for k in result["development_passed"]:
            v = result["hypotheses"][k]
            lines.append(f"- {k}: Dev {v['development']['net_r']:.2f}R PF {v['development']['pf']:.3f}, Val {v['validation']['net_r']:.2f}R PF {v['validation']['pf']:.3f}, ValPass={v['validation_gate']}")
    else:
        lines.append("- none")
    lines += ["", "## Validation-pass hypotheses", ""]
    if result["validation_passed"]:
        for k in result["validation_passed"]:
            v = result["hypotheses"][k]
            lines.append(f"- {k}: OOS {v['oos']['net_r']:.2f}R PF {v['oos']['pf']:.3f} DD {v['oos']['max_dd_r']:.2f} Trades {v['oos']['trades']} Pass={v['oos_pass']}")
    else:
        lines.append("- none")
    lines += ["", "## OOS-pass hypotheses", "", "- " + (", ".join(passed) if passed else "none")]
    (OUT_DIR / "wave_state_proxy_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "dev_pass": result["development_passed"],
                      "val_pass": result["validation_passed"], "oos_pass": passed}, indent=2))


if __name__ == "__main__":
    main()
