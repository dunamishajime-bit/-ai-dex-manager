from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

import run_early_wave_proxy as base
import run_wave_state_proxy as ws

OUT_DIR = Path("research/aifx_early_wave")
FAMILIES = ("M30_SLOPE_SEED", "M30_BREAKOUT_CONTINUATION", "M30_REVERSAL_FLIP")
DIRECTIONS = ("LONG", "SHORT")
STOP_ATR = 1.50
TRAIL_ACTIVATE_R = 1.25
TRAIL_ATR = 2.75
MAX_HOLD_BARS = 288


def efficiency(close: pd.Series, n: int) -> pd.Series:
    return (close - close.shift(n)).abs() / close.diff().abs().rolling(n).sum().replace(0, np.nan)


def add_mtf(x: pd.DataFrame) -> pd.DataFrame:
    x = ws.enriched(x)
    m30 = x.resample("30min", label="left", closed="left").agg({
        "mid_open": "first", "mid_high": "max", "mid_low": "min", "mid_close": "last"
    }).dropna()
    tr30 = base.true_range(m30.mid_high, m30.mid_low, m30.mid_close)
    m30["atr"] = tr30.ewm(alpha=1 / 7, adjust=False).mean()
    m30["disp4"] = (m30.mid_close - m30.mid_close.shift(4)) / m30.atr
    m30["disp12"] = (m30.mid_close - m30.mid_close.shift(12)) / m30.atr
    m30["eff12"] = efficiency(m30.mid_close, 12)
    m30["prior_high8"] = m30.mid_high.shift(1).rolling(8).max()
    m30["prior_low8"] = m30.mid_low.shift(1).rolling(8).min()
    m30["break_long"] = m30.mid_close > m30.prior_high8
    m30["break_short"] = m30.mid_close < m30.prior_low8
    m30["recent_break_long"] = m30.break_long.shift(1).rolling(4, min_periods=1).max().fillna(0).astype(bool)
    m30["recent_break_short"] = m30.break_short.shift(1).rolling(4, min_periods=1).max().fillna(0).astype(bool)
    m30 = m30.shift(1)  # only the last completed M30 bar is visible to M15.
    aligned30 = m30.reindex(x.index, method="ffill")
    for c in ("disp4", "disp12", "eff12", "recent_break_long", "recent_break_short"):
        x[f"m30_{c}"] = aligned30[c]

    h1 = x.resample("1h", label="left", closed="left").agg({
        "mid_open": "first", "mid_high": "max", "mid_low": "min", "mid_close": "last"
    }).dropna()
    tr1 = base.true_range(h1.mid_high, h1.mid_low, h1.mid_close)
    h1["atr"] = tr1.ewm(alpha=1 / 14, adjust=False).mean()
    h1["disp8"] = (h1.mid_close - h1.mid_close.shift(8)) / h1.atr
    h1 = h1.shift(1)
    x["h1_disp8"] = h1.disp8.reindex(x.index, method="ffill")
    return x


def episode_signal(raw: pd.Series, reset: pd.Series) -> np.ndarray:
    r = raw.fillna(False).to_numpy(dtype=bool)
    z = reset.fillna(False).to_numpy(dtype=bool)
    out = np.zeros(len(r), dtype=bool)
    latched = False
    for i in range(len(r)):
        if latched and z[i]:
            latched = False
        if (not latched) and r[i]:
            out[i] = True
            latched = True
    return out


def build_family(x: pd.DataFrame, family: str):
    pos = x.body > 0; neg = x.body < 0
    if family == "M30_SLOPE_SEED":
        long_raw = (
            (x.ret2_atr >= 0.45) & pos & (x.body_frac >= 0.50) & (x.close_loc >= 0.70)
            & (x.m30_disp12 >= 0.35) & (x.m30_disp4 >= 0.15) & (x.m30_eff12 >= 0.30)
            & (x.h1_disp8 > -1.20)
        )
        short_raw = (
            (x.ret2_atr <= -0.45) & neg & (x.body_frac >= 0.50) & (x.close_loc <= 0.30)
            & (x.m30_disp12 <= -0.35) & (x.m30_disp4 <= -0.15) & (x.m30_eff12 >= 0.30)
            & (x.h1_disp8 < 1.20)
        )
        reset_l = (x.m30_disp12 <= 0.05) | (x.ret8_atr <= -0.40)
        reset_s = (x.m30_disp12 >= -0.05) | (x.ret8_atr >= 0.40)
        exit_l = (x.m30_disp12 < -0.10) | (x.ret8_atr < -0.80)
        exit_s = (x.m30_disp12 > 0.10) | (x.ret8_atr > 0.80)
    elif family == "M30_BREAKOUT_CONTINUATION":
        long_raw = (
            x.m30_recent_break_long.fillna(False)
            & (x.mid_close > x.prior_high4) & (x.ret4_atr >= 0.35)
            & pos & (x.close_loc >= 0.60) & (x.h1_disp8 > -1.50)
        )
        short_raw = (
            x.m30_recent_break_short.fillna(False)
            & (x.mid_close < x.prior_low4) & (x.ret4_atr <= -0.35)
            & neg & (x.close_loc <= 0.40) & (x.h1_disp8 < 1.50)
        )
        reset_l = (~x.m30_recent_break_long.fillna(False)) | (x.m30_disp4 < 0)
        reset_s = (~x.m30_recent_break_short.fillna(False)) | (x.m30_disp4 > 0)
        exit_l = (x.m30_disp4 < -0.20) | (x.ret8_atr < -0.90)
        exit_s = (x.m30_disp4 > 0.20) | (x.ret8_atr > 0.90)
    elif family == "M30_REVERSAL_FLIP":
        prev_down = (x.m30_disp12.shift(8).rolling(16, min_periods=4).min() <= -0.80)
        prev_up = (x.m30_disp12.shift(8).rolling(16, min_periods=4).max() >= 0.80)
        long_raw = (
            prev_down & (x.m30_disp4 >= 0.20)
            & (x.mid_low <= x.prior_low16 + 0.20 * x.atr) & (x.mid_close > x.prior_low16)
            & pos & (x.body_frac >= 0.50) & (x.close_loc >= 0.65)
        )
        short_raw = (
            prev_up & (x.m30_disp4 <= -0.20)
            & (x.mid_high >= x.prior_high16 - 0.20 * x.atr) & (x.mid_close < x.prior_high16)
            & neg & (x.body_frac >= 0.50) & (x.close_loc <= 0.35)
        )
        reset_l = (x.m30_disp4 < -0.10) | (~prev_down)
        reset_s = (x.m30_disp4 > 0.10) | (~prev_up)
        exit_l = x.m30_disp4 < -0.35
        exit_s = x.m30_disp4 > 0.35
    else:
        raise ValueError(family)
    return (
        {"LONG": episode_signal(long_raw, reset_l), "SHORT": episode_signal(short_raw, reset_s)},
        {"LONG": exit_l.fillna(False).to_numpy(dtype=bool), "SHORT": exit_s.fillna(False).to_numpy(dtype=bool)},
    )


def simulate(x, entry_sig, exit_sig, pair, family, direction, start, end):
    # Reuse the robust next-bar/gap-aware engine with this experiment's wider wave exits.
    old = (ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS)
    ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS = STOP_ATR, TRAIL_ACTIVATE_R, TRAIL_ATR, MAX_HOLD_BARS
    try:
        return ws.simulate(x, entry_sig, exit_sig, pair, family, direction, start, end)
    finally:
        ws.STOP_ATR, ws.TRAIL_ACTIVATE_R, ws.TRAIL_ATR, ws.MAX_HOLD_BARS = old


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = {p: add_mtf(base.load_pair(p)) for p in base.PAIRS}
    common = set(base.complete_years(frames[base.PAIRS[0]]))
    for p in base.PAIRS[1:]: common &= set(base.complete_years(frames[p]))
    years = sorted(common); oos = years[-2:]; val = years[-4:-2]; dev = years[:-4]
    req = max(2, math.ceil(len(dev) * 0.67))
    result = {
        "status": "MTF_WAVE_PROXY", "source_timezone_verified": False,
        "formal_production_evidence": False, "session_rules_used": False,
        "cost_stress": "2x configured proxy spread floor + execution buffer",
        "selection_uses_oos": False, "families": list(FAMILIES),
        "development_years": dev, "validation_years": val, "oos_years": oos,
        "execution": {"stop_atr": STOP_ATR, "trail_activate_r": TRAIL_ACTIVATE_R,
                      "trail_atr": TRAIL_ATR, "max_hold_bars": MAX_HOLD_BARS},
        "hypotheses": {}
    }
    passed_rows = []; passed = []
    for pair in base.PAIRS:
        x = frames[pair]
        for family in FAMILIES:
            entries, exits = build_family(x, family)
            for direction in DIRECTIONS:
                key = f"{pair}:{direction}:{family}"
                dev_rows=[]; dev_by={}
                for y in dev:
                    s,e=base.year_range(y); rows=simulate(x,entries[direction],exits[direction],pair,family,direction,s,e)
                    dev_by[str(y)]=base.metrics(rows); dev_rows.extend(rows)
                dm=base.metrics(dev_rows); pos=sum(dev_by[str(y)]["net_r"]>0 for y in dev)
                dg=pos>=req and dm["net_r"]>0 and dm["trades"]>=80 and dm["pf"]>=1.02
                val_rows=[]; val_by={}
                if dg:
                    for y in val:
                        s,e=base.year_range(y); rows=simulate(x,entries[direction],exits[direction],pair,family,direction,s,e)
                        val_by[str(y)]=base.metrics(rows); val_rows.extend(rows)
                vm=base.metrics(val_rows); vg=dg and all(val_by[str(y)]["net_r"]>0 for y in val) and vm["trades"]>=40 and vm["pf"]>=1.05
                oos_rows=[]; oos_by={}; diag={}
                if vg:
                    for y in oos:
                        s,e=base.year_range(y); rows=simulate(x,entries[direction],exits[direction],pair,family,direction,s,e)
                        oos_by[str(y)]=base.metrics(rows); diag[str(y)]=base.wave_diagnostics(x,entries[direction],direction,y,pair,rows); oos_rows.extend(rows)
                om=base.metrics(oos_rows); op=vg and all(oos_by[str(y)]["net_r"]>0 for y in oos) and om["pf"]>=1.05
                if op: passed.append(key); passed_rows.extend(oos_rows)
                result["hypotheses"][key]={"pair":pair,"direction":direction,"family":family,
                    "development":dm,"development_by_year":dev_by,"positive_dev_years":pos,"development_gate":dg,
                    "validation":vm,"validation_by_year":val_by,"validation_gate":vg,
                    "oos":om,"oos_by_year":oos_by,"oos_wave_diagnostics":diag,"oos_pass":op}
    result["development_passed"]=[k for k,v in result["hypotheses"].items() if v["development_gate"]]
    result["validation_passed"]=[k for k,v in result["hypotheses"].items() if v["validation_gate"]]
    result["oos_passed"]=passed; result["oos_passed_portfolio_unconstrained_sum"]=base.metrics(passed_rows)
    result["status"]="PROXY_PROMISING" if passed else "PROXY_REJECT"
    (OUT_DIR/"mtf_wave_proxy_results.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    lines=["# AIFX M15/M30 Wave Proxy Results","",f"Status: **{result['status']}**","",
           f"Development: {dev}",f"Validation: {val}",f"OOS: {oos}","","## Development-pass"]
    if result["development_passed"]:
        for k in result["development_passed"]:
            v=result["hypotheses"][k]; lines.append(f"- {k}: Dev {v['development']['net_r']:.2f}R PF {v['development']['pf']:.3f}; Val {v['validation']['net_r']:.2f}R PF {v['validation']['pf']:.3f}; ValPass={v['validation_gate']}")
    else: lines.append("- none")
    lines += ["", "## Validation-pass"]
    if result["validation_passed"]:
        for k in result["validation_passed"]:
            v=result["hypotheses"][k]; lines.append(f"- {k}: OOS {v['oos']['net_r']:.2f}R PF {v['oos']['pf']:.3f} DD {v['oos']['max_dd_r']:.2f} Trades {v['oos']['trades']} Pass={v['oos_pass']}")
    else: lines.append("- none")
    lines += ["", "## OOS-pass", "- "+(", ".join(passed) if passed else "none")]
    (OUT_DIR/"mtf_wave_proxy_summary.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(json.dumps({"status":result["status"],"dev_pass":result["development_passed"],"val_pass":result["validation_passed"],"oos_pass":passed},indent=2))

if __name__ == "__main__": main()
