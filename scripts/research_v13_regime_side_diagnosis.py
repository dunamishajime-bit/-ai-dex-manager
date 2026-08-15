"""Instrumentation-only regime/side diagnosis for frozen V13.

No V13 strategy rule is changed. Replays the exact V13 ownership state machine and
attributes interval PnL to pair-side, portfolio sign mode, broad 72h breadth regime,
and BTC-aligned/counter ownership. Historical boundary remains 2026-07-01.
No Fresh OOS, threshold retune, VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path

import research_independent_ownership_episodes_v13 as v13
import research_independent_relative_ownership_v12 as v12
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist


def _bucket():
    return {"count": 0, "grossPctPoints": 0.0, "net10bpsPctPoints": 0.0, "net30bpsDelay1PctPoints": 0.0, "turnoverGrossUnits": 0.0}


def _breadth_regime(candles, idx, ts):
    signs = []
    for s in v13.TRADE:
        i = idx[s].get(ts)
        if i is None:
            continue
        r = v12.ret(candles[s], i, 72)
        if r is None:
            continue
        signs.append(1 if r > 0 else -1 if r < 0 else 0)
    up = sum(x > 0 for x in signs)
    dn = sum(x < 0 for x in signs)
    if up >= 4:
        return "BROAD_UP"
    if dn >= 4:
        return "BROAD_DOWN"
    return "DISPERSED"


def trace(candles, idx, start, end):
    times = [int(r["ts"]) for r in candles["BTC"] if start <= int(r["ts"]) < end][::v13.OBS_HOURS]
    prev_state = {}
    active = {}
    loss = {}
    by_pair_side = defaultdict(_bucket)
    by_portfolio_mode = defaultdict(_bucket)
    by_breadth = defaultdict(_bucket)
    by_breadth_mode = defaultdict(_bucket)
    by_btc_alignment = defaultdict(_bucket)
    by_transition = defaultdict(_bucket)

    for ts in times:
        cur = v13.states(candles, idx, ts)
        target = dict(active)
        removed = []
        added = []

        for s, side in list(active.items()):
            st = cur.get(s)
            alive = bool(st and (st["holdAliveLong"] if side > 0 else st["holdAliveShort"]))
            loss[s] = 0 if alive else loss.get(s, 0) + 1
            if loss[s] >= v13.LOSS_CONFIRMATIONS:
                target.pop(s, None)
                loss.pop(s, None)
                removed.append(s)

        vacancies = v13.MAX_POSITIONS - len(target)
        if vacancies > 0:
            candidates = []
            for s, st in cur.items():
                if s in target or not st["entryEligible"] or st["side"] == 0:
                    continue
                prev = prev_state.get(s)
                if not prev or not prev.get("entryEligible") or prev.get("side") != st["side"]:
                    continue
                candidates.append((st["strength"], s, int(st["side"])))
            candidates.sort(reverse=True)
            for _, s, side in candidates[:vacancies]:
                target[s] = side
                loss[s] = 0
                added.append(s)

        tw = {s: side * v13.SLOT_GROSS for s, side in target.items()}
        aw = {s: side * v13.SLOT_GROSS for s, side in active.items()}
        gross0 = 0.0
        gross1 = 0.0
        leg0 = {}
        leg1 = {}
        valid = True
        for s, w in tw.items():
            i = idx[s].get(ts)
            if i is None:
                valid = False
                break
            for delay, dest in ((0, leg0), (1, leg1)):
                ei = i + 1 + delay
                xi = ei + v13.OBS_HOURS
                if xi >= len(candles[s]) or int(candles[s][xi]["ts"]) >= end:
                    valid = False
                    break
                ep = float(candles[s][ei]["open"])
                xp = float(candles[s][xi]["open"])
                if ep <= 0:
                    valid = False
                    break
                pnl = w * (xp / ep - 1) * 100.0
                dest[s] = pnl
            if not valid:
                break
            gross0 += leg0[s]
            gross1 += leg1[s]
        if not valid:
            prev_state = cur
            continue

        universe = set(aw) | set(tw)
        leg_turn = {s: abs(tw.get(s, 0.0) - aw.get(s, 0.0)) for s in universe}
        turnover = sum(leg_turn.values())
        net0 = gross0 - turnover * 10.0 / 100.0
        net_stress = gross1 - turnover * 30.0 / 100.0

        if removed and added:
            transition = "REPLACE"
        elif removed:
            transition = "EXIT_LEG"
        elif added:
            transition = "ADD_LEG"
        elif tw:
            transition = "HOLD"
        else:
            transition = "CASH"

        signs = {1 if w > 0 else -1 for w in tw.values()}
        mode = "CASH" if not signs else "MIXED" if len(signs) > 1 else "LONG" if 1 in signs else "SHORT"
        breadth = _breadth_regime(candles, idx, ts)
        btc_dir = int(v12.btc_context(candles, idx, ts)["direction"])

        def add(bucket, g0, g1, tu):
            bucket["count"] += 1
            bucket["grossPctPoints"] += g0
            bucket["turnoverGrossUnits"] += tu
            bucket["net10bpsPctPoints"] += g0 - tu * 10.0 / 100.0
            bucket["net30bpsDelay1PctPoints"] += g1 - tu * 30.0 / 100.0

        add(by_transition[transition], gross0, gross1, turnover)
        add(by_portfolio_mode[mode], gross0, gross1, turnover)
        add(by_breadth[breadth], gross0, gross1, turnover)
        add(by_breadth_mode[f"{breadth}__{mode}"], gross0, gross1, turnover)

        for s, w in tw.items():
            side = 1 if w > 0 else -1
            tu = leg_turn.get(s, 0.0)
            add(by_pair_side[f"{s}_{'LONG' if side > 0 else 'SHORT'}"], leg0[s], leg1[s], tu)
            align = "BTC_NEUTRAL" if btc_dir == 0 else "BTC_ALIGNED" if side == btc_dir else "BTC_COUNTER"
            add(by_btc_alignment[align], leg0[s], leg1[s], tu)

        active = target
        prev_state = cur

    return {
        "pairSide": dict(sorted(by_pair_side.items())),
        "portfolioMode": dict(sorted(by_portfolio_mode.items())),
        "breadthRegime": dict(sorted(by_breadth.items())),
        "breadthMode": dict(sorted(by_breadth_mode.items())),
        "btcAlignment": dict(sorted(by_btc_alignment.items())),
        "transition": dict(sorted(by_transition.items())),
    }


def main():
    candles, idx, _ = v109.b.base.load()
    if v13.END_2026 > hist.DATA_END:
        raise RuntimeError("HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA")
    periods = {label: trace(candles, idx, a, b) for label, (a, b) in v13.PERIODS.items()}
    out = {
        "researchLine": "V13_REGIME_SIDE_DIAGNOSIS",
        "researchOnly": True,
        "instrumentationOnly": True,
        "v13Changed": False,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "periods": periods,
        "nextAction": "STRUCTURAL_REGIME_DIAGNOSIS_NO_THRESHOLD_RETUNE",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    path = root / "v13-regime-side-diagnosis.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
