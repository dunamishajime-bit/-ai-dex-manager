from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import research_active4_v138_state_repair as v138

# V139: role redefinition for ETH / BNB / AVAX only.
# Derived from V138 Development/Validation diagnostics only.
# No Confirmation/Holdout access. No threshold/risk/trail retuning. No dense sweep.
# Production/live/VPS/.env/credentials/orders/accounts/positions remain untouched.
#
# New economic roles:
#   ETH  = RELATIVE_LEADERSHIP_PULSE (not persistent Core owner)
#   BNB  = TACTICAL_CONSENSUS_TRANSITION (cash-default, short transition ownership)
#   AVAX = VOLATILITY_RESET_EVENT (event-driven reset -> re-acceleration, no durable Core)

BASE_SIGNAL = v138.signal
H = v138.H

CANDS = {
    "eth_relative_leadership_pulse_v9": ("ETH", "eth_transition_owner", .30),
    "bnb_tactical_consensus_transition_v9": ("BNB", "bnb_neutral_compression_release", .28),
    "avax_volatility_reset_event_v9": ("AVAX", "avax_burst_scout_handoff", .18),
}

BASE = {
    "eth_relative_leadership_pulse_v9": "eth_transition_participation_v8",
    "bnb_tactical_consensus_transition_v9": "bnb_consensus_retest_cash_v8",
    "avax_volatility_reset_event_v9": "avax_burst_reset_reaccel_v8",
}

# Engine-facing candidate registration. Keep the existing feature families and frozen sizing inputs.
v138.v137.v136.CANDS.clear()
v138.v137.v136.CANDS.update(CANDS)
v138.v137.v136.v133.CANDS.clear()
v138.v137.v136.v133.CANDS.update(CANDS)


def _base(cid, candles, idx, ts):
    return BASE_SIGNAL(BASE[cid], candles, idx, ts)


def signal(cid, candles, idx, ts):
    z = _base(cid, candles, idx, ts)
    p6 = _base(cid, candles, idx, ts - 6 * H)
    p12 = _base(cid, candles, idx, ts - 12 * H)
    q = dict(z)

    if cid == "eth_relative_leadership_pulse_v9":
        # ETH is no longer treated as a durable Core owner.
        # Participate only in a fresh relative-leadership handoff and its immediate follow-through.
        direction = z["onset"] or z["prewave"] or z["bias"]
        q["prewave"] = z["prewave"] if z["prewave"] and p12["bias"] != z["prewave"] else 0
        q["onset"] = z["onset"] if z["onset"] and p12["bias"] != z["onset"] else 0
        q["continue"] = z["continue"] if z["continue"] and p6["onset"] == z["continue"] else 0
        q["reentry"] = 0
        if p6["onset"] and not q["continue"]:
            q["exhaust"] = p6["onset"]
        if direction and p6["bias"] == -direction:
            q["reverse"] = -direction

    elif cid == "bnb_tactical_consensus_transition_v9":
        # BNB is cash-default. It owns only a newly formed consensus transition,
        # not a medium/long-lived trend state.
        q["prewave"] = z["prewave"] if z["prewave"] and p12["bias"] != z["prewave"] else 0
        q["onset"] = z["onset"] if z["onset"] and p6["bias"] != z["onset"] else 0
        q["continue"] = z["continue"] if z["continue"] and p6["onset"] == z["continue"] else 0
        q["reentry"] = 0
        if p6["continue"] and not (q["onset"] or q["continue"]):
            q["exhaust"] = p6["continue"]
        if p6["onset"] and z["bias"] == -p6["onset"]:
            q["reverse"] = -p6["onset"]

    else:
        # AVAX is event-driven: shock/reset/re-acceleration only.
        # After the event handoff, durable Core ownership and late re-entry are forbidden.
        q["prewave"] = z["prewave"]
        q["onset"] = z["onset"] if z["onset"] and (
            p6["prewave"] == z["onset"] or p6["bias"] in (0, -z["onset"])
        ) else 0
        q["continue"] = z["continue"] if z["continue"] and p6["onset"] == z["continue"] else 0
        q["reentry"] = 0
        if (p6["onset"] or p6["continue"]) and not (q["onset"] or q["continue"]):
            q["exhaust"] = p6["onset"] or p6["continue"]
        if p6["onset"] and z["bias"] == -p6["onset"]:
            q["reverse"] = -p6["onset"]

    return q


v138.v137.v136.signal = signal
v138.v137.v136.v133.sig = signal


def run(cid):
    v136 = v138.v137.v136
    v133 = v136.v133
    v109 = v136.v109
    candles, idx, _ = v109.b.base.load()
    ps = v109.b.base.periods(candles)

    dm, _ = v133.metr(cid, candles, idx, ps["development"], v133.NORMAL_BPS, 0)
    vm, _ = v133.metr(cid, candles, idx, ps["validation"], v133.NORMAL_BPS, 0)
    vs, _ = v133.metr(cid, candles, idx, ps["validation"], v133.STRESS_BPS, 1)
    dw = v133.wave_diag(cid, candles, idx, ps["development"])
    vw = v133.wave_diag(cid, candles, idx, ps["validation"])
    df = v133.folds(cid, candles, idx, ps["development"])
    vf = v133.folds(cid, candles, idx, ps["validation"])

    adequate = dm.get("trades", 0) >= 8 and vm.get("trades", 0) >= 4
    stable = df["positivePfFolds"] >= 2 and vf["positivePfFolds"] >= 2
    broad = (
        vw["captureRatePct"] >= 20
        and (vw["medianWaveMfeCapturedPct"] or 0) >= 20
        and vw["falseStartRatePct"] <= 40
    )
    promote = (
        adequate
        and stable
        and broad
        and (dm.get("pf") or 0) >= 1.2
        and dm.get("returnPct", 0) > 0
        and (vm.get("pf") or 0) >= 1.2
        and vm.get("returnPct", 0) > 0
        and (vs.get("pf") or 0) > 1
        and vm.get("maxDDPct", -999) > -20
    )

    role = {
        "eth_relative_leadership_pulse_v9": "RELATIVE_LEADERSHIP_PULSE",
        "bnb_tactical_consensus_transition_v9": "TACTICAL_CONSENSUS_TRANSITION",
        "avax_volatility_reset_event_v9": "VOLATILITY_RESET_EVENT",
    }[cid]

    res = {
        "strategyId": "V139_" + cid.upper(),
        "pair": CANDS[cid][0],
        "role": role,
        "periods": {
            "development": ps["development"],
            "validation": ps["validation"],
            "confirmation": "UNTOUCHED",
            "holdout": "UNTOUCHED",
        },
        "development": dm,
        "validation": vm,
        "validationStress": vs,
        "waveDiagnostics": {"development": dw, "validation": vw},
        "walkForward": {"development": df, "validation": vf},
        "researchMultiplicity": {
            "family": "PAIR_ROLE_REDEFINITION",
            "generation": 139,
            "candidatesThisBatch": 3,
        },
        "status": "FROZEN_SURVIVOR" if promote else "FAIL",
        "reason": "ROLE_REDEFINITION_DEV_VALIDATION_GATE",
        "architecture": role,
        "productionChanged": False,
        "realTradingEnabled": False,
    }

    out = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out.mkdir(parents=True, exist_ok=True)
    stem = "active3-v139-" + cid
    txt = json.dumps(res, indent=2)
    (out / f"{stem}.json").write_text(txt)
    (out / f"{stem}.md").write_text("# " + res["strategyId"] + "\n\n```json\n" + txt + "\n```\n")
    print(txt)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", choices=sorted(CANDS), required=True)
    args = ap.parse_args()
    run(args.candidate)
