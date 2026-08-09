from __future__ import annotations

import json, math, os, statistics
from pathlib import Path
import research_lab_parallel_event_regime_v53 as base

HOUR = base.HOUR
TRADE = base.TRADE
PERIODS = base.PERIODS
NORMAL_BPS = base.NORMAL_BPS
STRESS_BPS = base.STRESS_BPS

# Independent event logic: a volatility/price gap event is identified from prior-hour
# close to current-hour open, then direction is chosen causally from the PRE-EVENT
# volatility regime. Low-vol regimes follow the gap; high-vol regimes fade it.
# No liquidation/OI/order-book history is fabricated.

def pre_event_vol(c, i, n=168):
    if i < n + 1:
        return None
    xs = []
    for j in range(i - n + 1, i + 1):
        a = float(c[j - 1]["close"])
        b = float(c[j]["close"])
        if a > 0 and b > 0:
            xs.append(math.log(b / a))
    return statistics.pstdev(xs) * math.sqrt(24 * 365) * 100 if len(xs) > 10 else None


def historical_vol_percentile(c, i, current, lookback=24 * 90, sample_step=24):
    vals = []
    start = max(169, i - lookback)
    for j in range(start, i, sample_step):
        v = pre_event_vol(c, j)
        if v is not None:
            vals.append(v)
    if len(vals) < 20:
        return None
    return sum(v <= current for v in vals) / len(vals)


def variants():
    # Materially different representatives, not fine-grained threshold sweeps.
    return [
        (0.35, 0.35, 8),
        (0.60, 0.35, 12),
        (0.90, 0.30, 24),
        (1.20, 0.25, 12),
        (1.50, 0.25, 24),
        (2.00, 0.20, 24),
    ]


def generate(params, candles, idx, fby, start, end, costbps, delay):
    gap_min, low_vol_quantile, hold = params
    out = []
    last_exit = -1
    btc = candles["BTC"]
    times = [int(r["ts"]) for r in btc if start <= int(r["ts"]) < end]

    for ts in times:
        if ts <= last_exit:
            continue
        picks = []
        for s in TRADE:
            i = idx[s].get(ts)
            c = candles[s]
            if i is None or i < 24 * 90 + 170:
                continue
            prev_close = float(c[i - 1]["close"])
            cur_open = float(c[i]["open"])
            if prev_close <= 0:
                continue
            gap = (cur_open / prev_close - 1) * 100
            if abs(gap) < gap_min:
                continue
            rv = pre_event_vol(c, i - 1)
            if rv is None:
                continue
            pct = historical_vol_percentile(c, i - 1, rv)
            if pct is None:
                continue
            # PRE-EVENT regime only: lower-vol regime expects gap persistence;
            # elevated-vol regime expects exhaustion/fade.
            follow = pct <= low_vol_quantile
            side = (1 if gap > 0 else -1) * (1 if follow else -1)
            picks.append((s, side, hold))

        if not picks:
            continue
        vals = []
        for s, side, h in picks:
            v = base.future_trade(candles[s], idx[s], ts, side, h, delay, costbps)
            if v is not None:
                vals.append(v)
        if vals:
            out.append(sum(vals) / len(vals))
            last_exit = ts + hold * HOUR
    return out


def main():
    candles, idx, fby = base.load()
    candidates = []
    for p in variants():
        dev = base.metric(generate(p, candles, idx, fby, *PERIODS["development"], NORMAL_BPS, 0))
        if dev["trades"] >= 30 and (dev["pf"] or 0) >= 1.15 and dev["maxDDPct"] > -20 and dev["bestSharePct"] < 45:
            val = base.metric(generate(p, candles, idx, fby, *PERIODS["validation"], NORMAL_BPS, 0))
            if base.pass_gate(val, "validation"):
                candidates.append((p, dev, val))

    candidates.sort(key=lambda x: ((x[1]["pf"] or 0) + (x[2]["pf"] or 0), x[1]["trades"] + x[2]["trades"]), reverse=True)
    selected = confirmation = stress_conf = holdout = stress_holdout = None
    for p, dev, val in candidates[:3]:
        conf = base.metric(generate(p, candles, idx, fby, *PERIODS["confirmation"], NORMAL_BPS, 0))
        sconf = base.metric(generate(p, candles, idx, fby, *PERIODS["confirmation"], STRESS_BPS, 1))
        if (conf["trades"] >= 25 and (conf["pf"] or 0) >= 1.20 and conf["returnPct"] > 0
            and conf["maxDDPct"] > -20 and conf["bestSharePct"] < 45
            and (conf["pfWithoutBest"] or 0) > 1 and (sconf["pf"] or 0) > 1 and sconf["returnPct"] > 0):
            selected = (p, dev, val)
            confirmation, stress_conf = conf, sconf
            break

    robust = False
    if selected:
        p = selected[0]
        holdout = base.metric(generate(p, candles, idx, fby, *PERIODS["holdout"], NORMAL_BPS, 0))
        stress_holdout = base.metric(generate(p, candles, idx, fby, *PERIODS["holdout"], STRESS_BPS, 1))
        robust = (holdout["trades"] >= 12 and (holdout["pf"] or 0) > 1 and holdout["returnPct"] > 0
                  and holdout["maxDDPct"] > -20 and holdout["bestSharePct"] < 50 and (stress_holdout["pf"] or 0) > 1)

    result = {
        "strategyId": "EVENT_VOL_GAP_V54",
        "family": "volatility_gap_regime_follow_fade",
        "tested": len(variants()),
        "devValidationPasses": len(candidates),
        "selectedParams": selected[0] if selected else None,
        "development": selected[1] if selected else None,
        "validation": selected[2] if selected else None,
        "confirmation": confirmation,
        "stressConfirmation": stress_conf,
        "holdout": holdout,
        "stressHoldout": stress_holdout,
        "robust": robust,
        "status": "ROBUST_PASS" if robust else "NO_ROBUST_IMPROVEMENT",
        "productionChanged": False,
        "realTradingEnabled": False,
        "postLiquidationProxy": "NOT_TESTED_NO_GENUINE_HISTORICAL_LIQUIDATION_DATA_IN_RESEARCH_SOURCE",
        "limitations": [
            "Direction regime is determined entirely from pre-event realized volatility.",
            "No fabricated liquidation/order-book/OI history.",
            "Holdout opened only after fixed Confirmation pass.",
            "Research-only; V6/V9 and production untouched."
        ]
    }
    out = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out.mkdir(parents=True, exist_ok=True)
    (out / "event-vol-gap-v54.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (out / "event-vol-gap-v54.md").write_text("# Event Volatility Gap V54\n\n```json\n" + json.dumps(result, indent=2) + "\n```\n", encoding="utf-8")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
