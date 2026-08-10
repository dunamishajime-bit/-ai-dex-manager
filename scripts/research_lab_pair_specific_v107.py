from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from pathlib import Path

import research_lab_pair_specific_v101 as b

SYMS = b.SYMS
NORMAL_BPS = b.NORMAL_BPS
STRESS_BPS = b.STRESS_BPS
HOUR = b.HOUR
ret = b.ret
metric = b.metric
future_trade = b.future_trade

STYLE_POOLS = {
    "phase_slope": {
        "BTC": ["macro_slope_phase", "market_lead_wave"],
        "ETH": ["beta_residual_accel", "macro_slope_phase"],
        "BNB": ["macro_slope_phase", "alt_residual_trend"],
        "SOL": ["alt_residual_trend", "macro_slope_phase"],
        "LINK": ["alt_residual_trend", "macro_slope_phase"],
        "AVAX": ["macro_slope_phase", "alt_residual_trend"],
    },
    "energy_release": {
        "BTC": ["range_energy_release", "volatility_slope_release"],
        "ETH": ["volatility_slope_release", "range_energy_release"],
        "BNB": ["range_energy_release", "volatility_slope_release"],
        "SOL": ["volatility_slope_release", "range_energy_release"],
        "LINK": ["range_energy_release", "volatility_slope_release"],
        "AVAX": ["volatility_slope_release", "range_energy_release"],
    },
    "leadership_wave": {
        "BTC": ["market_lead_wave", "macro_slope_phase"],
        "ETH": ["eth_beta_lead_takeover", "beta_residual_accel"],
        "BNB": ["peer_dispersion_lead", "alt_residual_trend"],
        "SOL": ["peer_dispersion_lead", "market_lead_wave"],
        "LINK": ["alt_residual_trend", "peer_dispersion_lead"],
        "AVAX": ["peer_dispersion_lead", "alt_residual_trend"],
    },
}

CFG_BY_STYLE = {
    "phase_slope": {"risk": 0.88, "cool": 4, "maxslots": 3},
    "energy_release": {"risk": 0.84, "cool": 3, "maxslots": 3},
    "leadership_wave": {"risk": 0.86, "cool": 4, "maxslots": 3},
}


def closes(c, i, n):
    if i < n - 1:
        return []
    return [float(c[j]["close"]) for j in range(i - n + 1, i + 1)]


def log_slope(c, i, n):
    xs = closes(c, i, n)
    if len(xs) < n or min(xs) <= 0:
        return 0.0
    ys = [math.log(x) for x in xs]
    mx = (n - 1) / 2.0
    my = statistics.fmean(ys)
    den = sum((k - mx) ** 2 for k in range(n))
    if den <= 1e-12:
        return 0.0
    sl = sum((k - mx) * (y - my) for k, y in enumerate(ys)) / den
    return sl * 100.0


def corr(a, z):
    if len(a) != len(z) or len(a) < 24:
        return 0.0
    ma = statistics.fmean(a)
    mz = statistics.fmean(z)
    va = sum((x - ma) ** 2 for x in a)
    vz = sum((x - mz) ** 2 for x in z)
    if va <= 1e-12 or vz <= 1e-12:
        return 0.0
    return sum((x - ma) * (y - mz) for x, y in zip(a, z)) / math.sqrt(va * vz)


def beta_residual(candles, idx, s, ts, n=240):
    i = idx[s].get(ts)
    bi = idx["BTC"].get(ts)
    if i is None or bi is None or i < n or bi < n:
        return []
    sr = b.rseries(candles[s], i, n)
    br = b.rseries(candles["BTC"], bi, n)
    vb = sum(x * x for x in br)
    beta = sum(x * y for x, y in zip(br, sr)) / vb if vb > 1e-12 else 1.0
    return [y - beta * x for x, y in zip(br, sr)]


def factor_residual(candles, idx, s, ts, n=240):
    i = idx[s].get(ts)
    bi = idx["BTC"].get(ts)
    ei = idx["ETH"].get(ts)
    if i is None or bi is None or ei is None or min(i, bi, ei) < n:
        return []
    sr = b.rseries(candles[s], i, n)
    br = b.rseries(candles["BTC"], bi, n)
    er = b.rseries(candles["ETH"], ei, n)
    return [x - 0.55 * y - 0.45 * z for x, y, z in zip(sr, br, er)]


def range_pct(c, i, n):
    if i < n - 1:
        return 0.0
    hi = max(float(c[j]["high"]) for j in range(i - n + 1, i + 1))
    lo = min(float(c[j]["low"]) for j in range(i - n + 1, i + 1))
    px = float(c[i]["close"])
    return 100.0 * (hi - lo) / px if px > 0 else 0.0


def signal(mech, s, candles, idx, ts, cfg):
    c = candles[s]
    i = idx[s].get(ts)
    if i is None or i < 900:
        return None
    r3 = ret(c, i, 3)
    r6 = ret(c, i, 6)
    r12 = ret(c, i, 12)
    r24 = ret(c, i, 24)
    r72 = ret(c, i, 72)
    r168 = ret(c, i, 168)
    if None in (r3, r6, r12, r24, r72, r168):
        return None
    v24 = b.vol(c, i, 24)
    v96 = b.vol(c, i, 96)
    v336 = b.vol(c, i, 336)
    eff24 = b.efficiency(c, i, 24)
    eff72 = b.efficiency(c, i, 72)
    br = b.breadth(candles, idx, ts, 24)
    if v336 <= 1e-9 or v24 > 3.6 * v336:
        return None

    if mech == "macro_slope_phase":
        s12 = log_slope(c, i, 12)
        s36 = log_slope(c, i, 36)
        s120 = log_slope(c, i, 120)
        p12 = log_slope(c, i - 6, 12)
        accel = s12 - p12
        norm = max(v96, 1e-9)
        short = s12 * 12 / (norm * math.sqrt(12))
        medium = s36 * 36 / (norm * math.sqrt(36))
        long = s120 * 120 / (max(v336, 1e-9) * math.sqrt(120))
        if short > 0.78 and accel > 0 and medium > 0.12 and long > -0.30 and r6 > 0 and eff24 > 0.22:
            return (1, 60, 0.78)
        if short < -0.78 and accel < 0 and medium < -0.12 and long < 0.30 and r6 < 0 and eff24 > 0.22:
            return (-1, 54, 0.74)

    elif mech == "beta_residual_accel":
        rr = beta_residual(candles, idx, s, ts, 240)
        if len(rr) < 220:
            return None
        r6x = sum(rr[-6:])
        r24x = sum(rr[-24:])
        r72x = sum(rr[-72:])
        old6 = sum(rr[-12:-6])
        sd0 = statistics.pstdev(rr[:-24])
        z6 = r6x / (sd0 * math.sqrt(6) + 1e-9)
        z24 = r24x / (sd0 * math.sqrt(24) + 1e-9)
        accel = r6x - old6
        if z6 > 0.70 and z24 > 0.45 and accel > 0 and r72x > -1.0 * sd0 * math.sqrt(72) and r6 > 0:
            return (1, 48, 0.76)
        if z6 < -0.70 and z24 < -0.45 and accel < 0 and r72x < 1.0 * sd0 * math.sqrt(72) and r6 < 0:
            return (-1, 42, 0.72)

    elif mech == "alt_residual_trend":
        rr = factor_residual(candles, idx, s, ts, 240)
        if len(rr) < 220:
            return None
        sd0 = statistics.pstdev(rr[:-48])
        a12 = sum(rr[-12:]) / (sd0 * math.sqrt(12) + 1e-9)
        a48 = sum(rr[-48:]) / (sd0 * math.sqrt(48) + 1e-9)
        old12 = sum(rr[-24:-12]) / (sd0 * math.sqrt(12) + 1e-9)
        if a12 > 0.72 and a48 > 0.45 and a12 > old12 and r6 > 0 and eff24 > 0.18:
            return (1, 42, 0.70)
        if a12 < -0.72 and a48 < -0.45 and a12 < old12 and r6 < 0 and eff24 > 0.18:
            return (-1, 36, 0.68)

    elif mech == "range_energy_release":
        old = range_pct(c, i - 12, 72)
        longr = range_pct(c, i - 12, 240)
        now = range_pct(c, i, 12)
        prev_eff = b.efficiency(c, i - 12, 48)
        energy = abs(r6) / (max(v96, 1e-9) * math.sqrt(6))
        compressed = old < 0.46 * max(longr, 1e-9)
        if compressed and now > old * 0.32 and energy > 0.82 and eff24 > max(0.24, prev_eff + 0.06):
            if r6 > 0 and br >= 0.34:
                return (1, 54, 0.76)
            if r6 < 0 and br <= 0.66:
                return (-1, 48, 0.72)

    elif mech == "volatility_slope_release":
        oldv = b.vol(c, i - 24, 72)
        nowv = b.vol(c, i, 24)
        s8 = log_slope(c, i, 8)
        s24 = log_slope(c, i, 24)
        p8 = log_slope(c, i - 4, 8)
        vr = nowv / max(oldv, 1e-9)
        if vr > 1.18 and abs(s8) > abs(s24) * 1.18 and abs(s8) > abs(p8) * 1.08 and eff24 > 0.25:
            if s8 > 0 and r3 > 0:
                return (1, 48, 0.72)
            if s8 < 0 and r3 < 0:
                return (-1, 42, 0.70)

    elif mech == "market_lead_wave":
        m6 = b.median_move(candles, idx, ts, 6)
        m24 = b.median_move(candles, idx, ts, 24)
        m72 = b.median_move(candles, idx, ts, 72)
        x6 = r6 - m6
        x24 = r24 - m24
        x72 = r72 - m72
        old_i = i - 6
        old_rel = 0.0
        if old_i >= 24:
            old_ts = int(c[old_i]["ts"])
            old_rel = (ret(c, old_i, 6) or 0.0) - b.median_move(candles, idx, old_ts, 6)
        if x6 > 0.65 and x24 > 0.70 and x6 > old_rel and x72 > -1.0 and r6 > 0 and eff24 > 0.20:
            return (1, 54, 0.76)
        if x6 < -0.65 and x24 < -0.70 and x6 < old_rel and x72 < 1.0 and r6 < 0 and eff24 > 0.20:
            return (-1, 48, 0.72)

    elif mech == "eth_beta_lead_takeover":
        if s != "ETH":
            return None
        rr = beta_residual(candles, idx, s, ts, 336)
        if len(rr) < 300:
            return None
        sd0 = statistics.pstdev(rr[:-48])
        z8 = sum(rr[-8:]) / (sd0 * math.sqrt(8) + 1e-9)
        z32 = sum(rr[-32:]) / (sd0 * math.sqrt(32) + 1e-9)
        old8 = sum(rr[-16:-8]) / (sd0 * math.sqrt(8) + 1e-9)
        bi = idx["BTC"].get(ts)
        bc = candles["BTC"]
        btc24 = ret(bc, bi, 24) if bi is not None else 0.0
        if z8 > 0.78 and z32 > 0.35 and z8 > old8 + 0.20 and r6 > 0 and r24 >= (btc24 or 0.0) - 0.5:
            return (1, 54, 0.78)
        if z8 < -0.78 and z32 < -0.35 and z8 < old8 - 0.20 and r6 < 0 and r24 <= (btc24 or 0.0) + 0.5:
            return (-1, 42, 0.70)

    elif mech == "peer_dispersion_lead":
        moves = []
        for q in SYMS:
            qi = idx[q].get(ts)
            qv = ret(candles[q], qi, 12) if qi is not None else None
            if qv is not None:
                moves.append(qv)
        if len(moves) != len(SYMS):
            return None
        med = statistics.median(moves)
        dispersion = statistics.pstdev(moves)
        rel12 = r12 - med
        old_med = b.median_move(candles, idx, int(c[i - 6]["ts"]), 12)
        oldrel = (ret(c, i - 6, 12) or 0.0) - old_med
        if dispersion > 0.55 and rel12 > max(0.70, 0.75 * dispersion) and rel12 > oldrel and r6 > 0 and eff24 > 0.20:
            return (1, 42, 0.70)
        if dispersion > 0.55 and rel12 < -max(0.70, 0.75 * dispersion) and rel12 < oldrel and r6 < 0 and eff24 > 0.20:
            return (-1, 36, 0.68)
    return None


def event_records(mech, s, candles, idx, start, end, cost, delay, cfg):
    out = []
    last = -1
    for row in candles[s]:
        ts = int(row["ts"])
        if not (start <= ts < end) or ts <= last:
            continue
        sg = signal(mech, s, candles, idx, ts, cfg)
        if not sg:
            continue
        side, hold, w = sg
        x = future_trade(candles[s], idx[s], ts, side, hold, delay, cost)
        if x is None:
            continue
        out.append({"ts": ts, "side": side, "hold": hold, "value": x * w * cfg["risk"]})
        last = ts + (hold + cfg["cool"]) * HOUR
    return out


def events(mech, s, candles, idx, start, end, cost, delay, cfg):
    return [(x["ts"], x["value"]) for x in event_records(mech, s, candles, idx, start, end, cost, delay, cfg)]


def choose(candles, idx, period, cfg, pools):
    chosen = {}
    diag = {}
    for s in SYMS:
        best = None
        for mech in pools[s]:
            vals = [v for _, v in events(mech, s, candles, idx, *period, NORMAL_BPS, 0, cfg)]
            m = metric(vals)
            pf = m.get("pf") or 0
            tr = m.get("trades") or 0
            rp = m.get("returnPct") or 0
            dd = abs(m.get("maxDDPct") or 0)
            conc = m.get("bestSharePct") or 100
            score = 1.9 * rp + 9.5 * (min(pf, 2.5) - 1) + 0.16 * min(tr, 50) - 0.30 * dd - 0.15 * max(0, conc - 35)
            if best is None or score > best[0]:
                best = (score, mech, m)
        chosen[s] = best[1]
        diag[s] = {"mechanism": best[1], "development": best[2]}
    return chosen, diag


def portfolio(chosen, candles, idx, start, end, cost, delay, cfg):
    byts = {}
    pair = {s: [] for s in SYMS}
    for s, mech in chosen.items():
        for ts, v in events(mech, s, candles, idx, start, end, cost, delay, cfg):
            byts.setdefault(ts, []).append((s, v))
            pair[s].append(v)
    vals = []
    contrib = {s: 0.0 for s in SYMS}
    for ts in sorted(byts):
        xs = sorted(byts[ts], key=lambda z: abs(z[1]), reverse=True)[: cfg["maxslots"]]
        if not xs:
            continue
        scale = min(1.0, 1.65 / len(xs))
        vals.append(sum(v * scale for _, v in xs))
        for s, v in xs:
            contrib[s] += v * scale
    return metric(vals), {s: metric(pair[s]) for s in SYMS}, contrib


def major_wave_diag(mech, s, candles, idx, start, end, cfg):
    c = candles[s]
    recs = event_records(mech, s, candles, idx, start, end, NORMAL_BPS, 0, cfg)
    waves = []
    last_wave_end = -1
    for row in c:
        ts = int(row["ts"])
        if not (start <= ts < end) or ts <= last_wave_end:
            continue
        i = idx[s].get(ts)
        if i is None or i < 336 or i + 48 >= len(c):
            continue
        vol0 = b.vol(c, i, 168)
        if vol0 <= 1e-9:
            continue
        p0 = float(c[i]["close"])
        p1 = float(c[i + 48]["close"])
        move = 100.0 * (p1 / p0 - 1.0)
        threshold = max(3.0, 2.0 * vol0 * math.sqrt(48))
        if abs(move) < threshold:
            continue
        side = 1 if move > 0 else -1
        hit = None
        for r in recs:
            if ts <= r["ts"] <= ts + 18 * HOUR and r["side"] == side:
                hit = r
                break
        waves.append({"ts": ts, "side": side, "delayHours": None if hit is None else (hit["ts"] - ts) / HOUR})
        last_wave_end = ts + 48 * HOUR
    delays = [w["delayHours"] for w in waves if w["delayHours"] is not None]
    return {
        "majorWaves": len(waves),
        "captured": len(delays),
        "captureRatePct": 100.0 * len(delays) / len(waves) if waves else 0.0,
        "medianEntryDelayHours": statistics.median(delays) if delays else None,
        "missedWaves": len(waves) - len(delays),
    }


def run(style):
    cfg = CFG_BY_STYLE[style]
    pools = STYLE_POOLS[style]
    candles, idx, _ = b.base.load()
    ps = b.base.periods(candles)
    chosen, selection = choose(candles, idx, ps["development"], cfg, pools)

    dm, dp, dc = portfolio(chosen, candles, idx, *ps["development"], NORMAL_BPS, 0, cfg)
    vm, vp, vc = portfolio(chosen, candles, idx, *ps["validation"], NORMAL_BPS, 0, cfg)
    vs, _, _ = portfolio(chosen, candles, idx, *ps["validation"], STRESS_BPS, 1, cfg)
    diagnostics = {
        "development": {s: major_wave_diag(chosen[s], s, candles, idx, *ps["development"], cfg) for s in ("BTC", "ETH")},
        "validation": {s: major_wave_diag(chosen[s], s, candles, idx, *ps["validation"], cfg) for s in ("BTC", "ETH")},
    }
    res = {
        "strategyId": f"PAIR_SPECIFIC_V107_{style.upper()}",
        "periods": ps,
        "chosenPairEngines": chosen,
        "selection": selection,
        "development": dm,
        "developmentPair": dp,
        "developmentContribution": dc,
        "validation": vm,
        "validationPair": vp,
        "validationContribution": vc,
        "validationStress": vs,
        "moveCaptureDiagnostics": diagnostics,
        "productionChanged": False,
        "realTradingEnabled": False,
    }

    if (dm.get("pf") or 0) < 1.05 or (dm.get("returnPct") or 0) <= 0 or (vm.get("pf") or 0) < 1.05 or (vm.get("returnPct") or 0) <= 0:
        res.update(status="FAIL", reason="FAST_FUNNEL")
    else:
        cm, cp, cc = portfolio(chosen, candles, idx, *ps["confirmation"], NORMAL_BPS, 0, cfg)
        cs, _, _ = portfolio(chosen, candles, idx, *ps["confirmation"], STRESS_BPS, 1, cfg)
        res.update(confirmation=cm, confirmationPair=cp, confirmationContribution=cc, confirmationStress=cs)
        if not b.gate(cm, cs):
            res.update(status="FAIL", reason="CONFIRMATION")
        else:
            hm, hp, hc = portfolio(chosen, candles, idx, *ps["holdout"], NORMAL_BPS, 0, cfg)
            hs, _, _ = portfolio(chosen, candles, idx, *ps["holdout"], STRESS_BPS, 1, cfg)
            ym, yp, yc = portfolio(chosen, candles, idx, ps["development"][0], ps["holdout"][1], NORMAL_BPS, 0, cfg)
            ys, _, _ = portfolio(chosen, candles, idx, ps["development"][0], ps["holdout"][1], STRESS_BPS, 1, cfg)
            positive = sum((yp[s].get("returnPct") or 0) > 0 for s in SYMS)
            shares = [abs(v) for v in yc.values()]
            concentration = max(shares) / sum(shares) if sum(shares) > 1e-9 else 1.0
            ok = (
                b.gate(ym, ys)
                and (hm.get("pf") or 0) > 1
                and (hm.get("returnPct") or 0) > 0
                and (hs.get("pf") or 0) > 1
                and (ym.get("returnPct") or 0) >= 60
                and positive >= 4
                and concentration < 0.45
            )
            res.update(
                holdout=hm,
                holdoutPair=hp,
                holdoutContribution=hc,
                holdoutStress=hs,
                year=ym,
                yearStress=ys,
                yearPair=yp,
                yearContribution=yc,
                pairConcentration=concentration,
                status="PASS" if ok else "FAIL",
                reason="PASS" if ok else "FINAL_TARGET",
            )

    out = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out.mkdir(parents=True, exist_ok=True)
    stem = f"pair-specific-v107-{style}"
    txt = json.dumps(res, indent=2)
    (out / f"{stem}.json").write_text(txt, encoding="utf-8")
    (out / f"{stem}.md").write_text(f"# {res['strategyId']}\n\n```json\n{txt}\n```\n", encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", choices=STYLE_POOLS, required=True)
    args = ap.parse_args()
    run(args.style)
