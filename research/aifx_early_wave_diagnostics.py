from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ew", ROOT / "research/aifx_early_wave_bt.py")
ew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ew)


def combine_lag(legs, signal, x, direction):
    return ew.lag_stats(legs, signal, x, direction)


def main():
    cache = ROOT / "research/.aifx_proxy_cache"
    raw = {p: ew.download(p, cache) for p in ew.PAIRS}
    common = None
    complete = {p: ew.complete_years(df) for p, df in raw.items()}
    for p in ew.PAIRS:
        common = set(complete[p]) if common is None else common & set(complete[p])
    years = sorted(common or [])
    oos = years[-2:]
    val = years[-4:-2]
    dev = years[:-4]
    m15 = {p: ew.add_execution(df, p) for p, df in raw.items()}
    m30 = {p: ew.add_execution(ew.to_m30(df), p) for p, df in raw.items()}

    out = {
        "status": "DIAGNOSTIC_ONLY_FROZEN_LOGIC",
        "note": "OOS diagnostic metrics below do not resurrect directions that failed Development/Validation. No thresholds/families were changed after the first run.",
        "development_years": dev,
        "validation_years": val,
        "oos_years": oos,
        "rows": [],
    }

    for pair in ew.PAIRS:
        prior = ew.h1_prior(m15[pair])
        full = ew.h1_full_regime(m15[pair])
        bfeat = ew.baseline_features(m15[pair], full)
        year_legs = []
        for y in oos:
            s, e = ew.yrange(y)
            year_legs += ew.zigzag_legs(m15[pair], s, e, pair)

        for direction in ew.DIRECTIONS:
            bp = ew.select_baseline(bfeat, pair, direction, dev)
            bfam, bsig = bp[4], bp[5]
            brows = []
            for y in oos:
                s, e = ew.yrange(y)
                brows += ew.simulate_baseline(bfeat, bsig, pair, bfam, direction, s, e)
            bm = ew.metrics(brows)
            blag = combine_lag(year_legs, bsig, bfeat, direction)

            for tf, frame in [("M15", m15[pair]), ("M30", m30[pair])]:
                x = ew.features(frame, tf, prior)
                ch, dg, vb, vm, vg = ew.select_early_for_tf(x, pair, direction, dev, val)
                rows = []
                by_year = {}
                for y in oos:
                    s, e = ew.yrange(y)
                    rr = ew.simulate_early(x, ch["signal"], ch["opp"], ch["sb"], pair, ch["family"], direction, s, e)
                    by_year[str(y)] = ew.metrics(rr)
                    rows += rr
                dm = ew.metrics(rows)
                lag = combine_lag(year_legs, ch["signal"], x, direction)
                dir_swing = sum(q["pips"] for q in year_legs if q["direction"] == direction)
                capture = dm["net_pips"] / dir_swing if dir_swing else 0.0
                lag_improve = None
                if lag["median_price_lag"] is not None and blag["median_price_lag"] is not None:
                    lag_improve = blag["median_price_lag"] - lag["median_price_lag"]
                out["rows"].append({
                    "pair": pair,
                    "direction": direction,
                    "timeframe": tf,
                    "family_dev_selected": ch["family"],
                    "development": ch["development"],
                    "positive_dev_years": ch["positive_dev_years"],
                    "development_gate": dg,
                    "validation": vm,
                    "validation_gate": vg,
                    "diagnostic_oos": dm,
                    "diagnostic_oos_by_year": by_year,
                    "early_lag": lag,
                    "baseline_family": bfam,
                    "baseline_oos": bm,
                    "baseline_lag": blag,
                    "price_lag_improvement_fraction": lag_improve,
                    "direction_swing_pips": dir_swing,
                    "diagnostic_capture_ratio_directional": capture,
                })

    p = ROOT / "research/aifx_early_wave_diagnostics.json"
    p.write_text(json.dumps(out, indent=2, ensure_ascii=False, allow_nan=False))

    md = [
        "# AIFX Early Wave Frozen Diagnostic",
        "",
        "OOS is diagnostic only because every direction failed the formal pre-OOS gate in the first run. No post-OOS threshold/family change was made.",
        "",
        "|Pair|Dir|TF|Family|Dev R|Dev PF|Pos yrs|Dev gate|Diag OOS R|OOS PF|Lag early|Lag old|Lag gain|Coverage early|Capture dir|",
        "|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in out["rows"]:
        el = r["early_lag"]["median_price_lag"]
        bl = r["baseline_lag"]["median_price_lag"]
        gain = r["price_lag_improvement_fraction"]
        md.append(
            f"|{r['pair']}|{r['direction']}|{r['timeframe']}|{r['family_dev_selected']}|"
            f"{r['development']['net_r']:.2f}|{r['development']['pf']:.3f}|{r['positive_dev_years']}|{'PASS' if r['development_gate'] else 'FAIL'}|"
            f"{r['diagnostic_oos']['net_r']:.2f}|{r['diagnostic_oos']['pf']:.3f}|"
            f"{('-' if el is None else f'{el:.1%}')}|{('-' if bl is None else f'{bl:.1%}')}|{('-' if gain is None else f'{gain:.1%}')}|"
            f"{r['early_lag']['coverage']:.1%}|{r['diagnostic_capture_ratio_directional']:.2%}|"
        )
    (ROOT / "research/aifx_early_wave_diagnostics.md").write_text("\n".join(md))

    # Compact console: best (least bad / most positive) development row per pair-direction.
    compact = []
    for pair in ew.PAIRS:
        for direction in ew.DIRECTIONS:
            cand = [r for r in out["rows"] if r["pair"] == pair and r["direction"] == direction]
            best = max(cand, key=lambda r: (r["positive_dev_years"], r["development"]["net_r"], r["development"]["pf"]))
            compact.append({
                "pair": pair, "direction": direction, "tf": best["timeframe"], "family": best["family_dev_selected"],
                "dev_r": round(best["development"]["net_r"], 2), "dev_pf": round(best["development"]["pf"], 3),
                "diag_oos_r": round(best["diagnostic_oos"]["net_r"], 2), "diag_oos_pf": round(best["diagnostic_oos"]["pf"], 3),
                "early_lag": best["early_lag"]["median_price_lag"], "old_lag": best["baseline_lag"]["median_price_lag"],
                "coverage": best["early_lag"]["coverage"], "capture": best["diagnostic_capture_ratio_directional"],
            })
    print(json.dumps(compact, indent=2))


if __name__ == "__main__":
    main()
