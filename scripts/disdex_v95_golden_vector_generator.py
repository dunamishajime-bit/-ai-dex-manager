from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Dict, List

WEIGHT_TOLERANCE = 0.05
PORTFOLIO_TURNOVER_THRESHOLD = 0.20
MAXIMUM_STALE_BARS = 12
STRONG_BOOST = 0.30
CORE_GROSS_CAP = 2.0

DD_START = 0.12
DD_SECOND_GAP = 0.08
DD_WINDOW_BUCKETS = 20
DD_TRIGGER_RETURN = -0.04
DD_SCALE_1 = 0.85
DD_SCALE_2 = 0.40

WHIPSAW_WINDOW_BUCKETS = 10
WHIPSAW_TURNOVER_THRESHOLD = 1.5
WHIPSAW_FLIP_THRESHOLD = 3
WHIPSAW_CORE_SCALE = 0.60
WHIPSAW_CONFIRMATION_BUCKETS = 1
WHIPSAW_RECOVERY_BUCKETS = 2


def signature(weights: Dict[str, float]):
    return tuple(sorted(
        (symbol, 1 if float(weight) > 0 else -1)
        for symbol, weight in weights.items()
        if abs(float(weight)) > 1e-12
    ))


def turnover(left: Dict[str, float], right: Dict[str, float]) -> float:
    return sum(abs(float(right.get(symbol, 0.0)) - float(left.get(symbol, 0.0))) for symbol in set(left) | set(right))


def gross(weights: Dict[str, float]) -> float:
    return sum(abs(float(value)) for value in weights.values())


def scale_weights(weights: Dict[str, float], scale: float) -> Dict[str, float]:
    return {
        symbol: float(weight) * scale
        for symbol, weight in weights.items()
        if abs(float(weight) * scale) > 1e-12
    }


def compounded(values: List[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def count_flips(regimes: List[int]) -> int:
    return sum(
        regimes[index] != 0
        and regimes[index - 1] != 0
        and regimes[index] != regimes[index - 1]
        for index in range(1, len(regimes))
    )


def strong_signal(frame: dict, breadth: int) -> bool:
    feature = frame["features"]
    return bool(
        int(frame["regime"]) > 0
        and bool(feature["closeAboveSma20"])
        and float(feature["mom20"]) >= 15.0
        and float(feature["mom3"]) >= 0.0
        and float(feature["shock"]) >= -4.0
        and float(feature["skew"]) <= 1.35
        and breadth >= 2
    )


def run(frames: List[dict]) -> dict:
    active: Dict[str, float] = {}
    previous_stable: Dict[str, float] = {}
    last_weight_rebalance = 0
    equity = peak = 1.0
    reference_returns: List[float] = []
    turnover_history: List[float] = []
    regime_history: List[int] = []
    signal_count = calm_count = 0
    whipsaw_active = False

    ignored_weight_changes = 0
    accepted_weight_rebalances = 0
    signature_changes_immediate = 0
    growth_buckets = 0
    whipsaw_buckets = 0
    capped_buckets = 0
    dd_stage_counts = {0: 0, 1: 0, 2: 0}
    rows: List[dict] = []

    for index, frame in enumerate(frames):
        desired = {key: float(value) for key, value in frame["rawTarget"].items() if abs(float(value)) > 1e-12}
        action = "HOLD"
        if signature(desired) != signature(active):
            active = dict(desired)
            last_weight_rebalance = index
            signature_changes_immediate += 1
            action = "SIGNATURE"
        else:
            proposed = dict(active)
            changed = False
            for symbol in set(active) | set(desired):
                old = float(active.get(symbol, 0.0))
                new = float(desired.get(symbol, 0.0))
                if abs(new - old) >= WEIGHT_TOLERANCE:
                    if abs(new) <= 1e-12:
                        proposed.pop(symbol, None)
                    else:
                        proposed[symbol] = new
                    changed = True
                elif abs(new - old) > 1e-12:
                    ignored_weight_changes += 1
            proposed_turnover = turnover(active, proposed) if proposed != active else 0.0
            forced = index - last_weight_rebalance >= MAXIMUM_STALE_BARS
            if changed and (proposed_turnover >= PORTFOLIO_TURNOVER_THRESHOLD or forced):
                active = dict(proposed)
                last_weight_rebalance = index
                accepted_weight_rebalances += 1
                action = "REBALANCE"

        stable_target = dict(active)
        current_turnover = turnover(previous_stable, stable_target)
        breadth = sum(1 for symbol, weight in previous_stable.items() if symbol != "BTCUSDT" and float(weight) > 0)
        base_target = scale_weights(stable_target, max(0.0, float(frame.get("v35Scale", 1.0))))
        base_gross = gross(base_target)
        base_return = sum(
            float(weight) * float(frame.get("symbolReturns", {}).get(symbol, 0.0))
            for symbol, weight in base_target.items()
        )

        portfolio_dd = equity / peak - 1.0
        recent_core = compounded(reference_returns[-DD_WINDOW_BUCKETS:]) if reference_returns else 0.0
        if portfolio_dd <= -(DD_START + DD_SECOND_GAP) and recent_core <= DD_TRIGGER_RETURN:
            dd_stage = 2
            dd_scale = DD_SCALE_2
        elif portfolio_dd <= -DD_START and recent_core <= DD_TRIGGER_RETURN:
            dd_stage = 1
            dd_scale = DD_SCALE_1
        else:
            dd_stage = 0
            dd_scale = 1.0
        dd_stage_counts[dd_stage] += 1

        recent_turnover = sum(turnover_history[-WHIPSAW_WINDOW_BUCKETS:])
        recent_flips = count_flips(regime_history[-WHIPSAW_WINDOW_BUCKETS:])
        whipsaw_signal = recent_turnover >= WHIPSAW_TURNOVER_THRESHOLD or recent_flips >= WHIPSAW_FLIP_THRESHOLD
        if whipsaw_signal:
            signal_count += 1
            calm_count = 0
        else:
            calm_count += 1
            signal_count = 0
        if not whipsaw_active and signal_count >= WHIPSAW_CONFIRMATION_BUCKETS:
            whipsaw_active = True
        elif whipsaw_active and calm_count >= WHIPSAW_RECOVERY_BUCKETS:
            whipsaw_active = False
        if whipsaw_active:
            whipsaw_buckets += 1

        boost = 0.0
        if dd_stage == 0 and not whipsaw_active and portfolio_dd > -0.05 and strong_signal(frame, breadth):
            boost = STRONG_BOOST
            growth_buckets += 1
        raw_scale = dd_scale * (WHIPSAW_CORE_SCALE if whipsaw_active else 1.0) * (1.0 + boost)
        raw_gross = base_gross * raw_scale
        cap_ratio = min(1.0, CORE_GROSS_CAP / raw_gross) if raw_gross > 0 else 1.0
        if cap_ratio < 1.0 - 1e-12:
            capped_buckets += 1
        core_scale = raw_scale * cap_ratio
        controlled_target = scale_weights(base_target, core_scale)
        controlled_return = base_return * core_scale

        rows.append({
            "referenceTs": int(frame["referenceTs"]),
            "rawTarget": desired,
            "stableTarget": stable_target,
            "controlledTarget": controlled_target,
            "weightBandAction": action,
            "turnover": current_turnover,
            "breadth": breadth,
            "baseReturn": base_return,
            "controlledReturn": controlled_return,
            "baseGross": base_gross,
            "finalGross": gross(controlled_target),
            "coreScale": core_scale,
            "boost": boost,
            "whipsawActive": whipsaw_active,
            "drawdownStage": dd_stage,
            "portfolioDrawdown": portfolio_dd,
        })

        equity *= max(0.001, 1.0 + controlled_return)
        peak = max(peak, equity)
        reference_returns.append(base_return)
        turnover_history.append(current_turnover)
        regime_history.append(int(frame["regime"]))
        previous_stable = stable_target

    return {
        "rows": rows,
        "finalTarget": rows[-1]["controlledTarget"] if rows else {},
        "finalGross": rows[-1]["finalGross"] if rows else 0.0,
        "diagnostics": {
            "ignoredWeightChanges": ignored_weight_changes,
            "acceptedWeightRebalances": accepted_weight_rebalances,
            "signatureChangesImmediate": signature_changes_immediate,
            "growthBuckets": growth_buckets,
            "whipsawBuckets": whipsaw_buckets,
            "drawdownStageBuckets": dd_stage_counts,
            "cappedBuckets": capped_buckets,
            "finalEquity": equity,
            "finalPeak": peak,
        },
    }


def build_frames() -> List[dict]:
    frames: List[dict] = []
    start = 1_700_000_000_000
    bucket = 12 * 60 * 60 * 1000
    for index in range(48):
        if index == 0:
            target = {"ETHUSDT": 0.90}
        elif index < 13:
            target = {"ETHUSDT": 0.84}
        elif index < 17:
            target = {"ETHUSDT": 0.45, "BNBUSDT": 0.45}
        elif index < 21:
            target = {"ETHUSDT": 0.48, "BNBUSDT": 0.42}
        elif index < 29:
            target = {"SOLUSDT": 0.90} if index % 2 else {"BTCUSDT": -0.40}
        elif index < 42:
            target = {"ETHUSDT": 0.45, "BNBUSDT": 0.45}
        else:
            target = {"ETHUSDT": 0.50, "BNBUSDT": 0.40}

        if 21 <= index < 32:
            base_move = -0.075
        elif index in (9, 18, 33):
            base_move = -0.025
        else:
            base_move = 0.012
        returns = {
            "BTCUSDT": base_move,
            "ETHUSDT": base_move + 0.002,
            "BNBUSDT": base_move + 0.004,
            "SOLUSDT": base_move + 0.006,
        }
        regime = -1 if 21 <= index < 29 and index % 2 == 0 else 1
        frames.append({
            "referenceTs": start + index * bucket,
            "rawTarget": target,
            "v35Scale": 1.2 if regime > 0 else 1.0,
            "symbolReturns": returns,
            "regime": regime,
            "features": {
                "closeAboveSma20": not (21 <= index < 25),
                "mom20": 18.0 if index >= 13 else 12.0,
                "mom3": -0.5 if index % 7 == 0 else 1.5,
                "shock": -2.0,
                "skew": 1.50 if index % 11 == 0 else 1.20,
                "btcVol": 70.0,
            },
        })
    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    frames = build_frames()
    expected = run(frames)
    canonical = json.dumps({"frames": frames, "expected": expected}, sort_keys=True, separators=(",", ":"))
    payload = {
        "schemaVersion": 1,
        "strategyId": "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95",
        "source": "Python port of V90 stabilize plus V86 controlled_core",
        "frames": frames,
        "expected": expected,
        "artifactSha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": "V95_GOLDEN_VECTOR_GENERATED",
        "frames": len(frames),
        "artifactSha256": payload["artifactSha256"],
        "growthBuckets": expected["diagnostics"]["growthBuckets"],
        "whipsawBuckets": expected["diagnostics"]["whipsawBuckets"],
        "drawdownStageBuckets": expected["diagnostics"]["drawdownStageBuckets"],
    }))


if __name__ == "__main__":
    main()
