from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_feature_overlay_v27 as v27
import research_lab_asymmetric_return_stack_v32 as v32

START = v4.START_2023
DEV_END = v4.START_2026
END = v4.END


@dataclass(frozen=True)
class Config:
    strong_mult: float
    normal_mult: float
    brake_mult: float
    mom20_min: float
    shock_floor: float
    skew_limit: float
    pengu15: float
    gross_cap: float = 2.0


def configs() -> Dict[str, Config]:
    result: Dict[str, Config] = {}
    for strong in [1.40, 1.45, 1.50, 1.55]:
        for normal in [1.15, 1.25]:
            for brake in [0.65, 0.80, 1.00]:
                for mom20 in [5.0, 10.0]:
                    for shock in [-2.0, -4.0]:
                        for skew in [1.35, 1.50]:
                            for pengu in [1.0, 2.0]:
                                name = (
                                    f"S{int(strong*100)}_N{int(normal*100)}_B{int(brake*100)}"
                                    f"_M{int(mom20)}_X{abs(int(shock))}_K{int(skew*100)}_P{int(pengu*15)}"
                                )
                                result[name] = Config(strong, normal, brake, mom20, shock, skew, pengu)
    return result


def feature_map(times, targets, bars, indexes, funding):
    result = {}
    btc_rows = bars["BTC"]
    for position, ts in enumerate(times):
        source = position - 1
        if source < 0:
            result[ts] = {"strong": False, "shock": 0.0, "skew": 1.0, "bull": False}
            continue
        feature_ts = times[source]
        target = targets.get(feature_ts, {})
        bull = any(weight > 0 for symbol, weight in target.items() if symbol != "BTC")
        btc_index = indexes["BTC"].get(feature_ts)
        if btc_index is None:
            result[ts] = {"strong": False, "shock": 0.0, "skew": 1.0, "bull": bull}
            continue
        close = float(btc_rows[btc_index]["close"])
        sma20 = v4.sma(btc_rows, btc_index, 40)
        mom20 = v4.momentum(btc_rows, btc_index, 40)
        mom3 = v4.momentum(btc_rows, btc_index, 6)
        shock = v4.momentum(btc_rows, btc_index, 2)
        skews = []
        for symbol, weight in target.items():
            if weight <= 0 or symbol not in {"ETH", "BNB", "SOL"}:
                continue
            index = indexes[symbol].get(feature_ts)
            if index is None:
                continue
            value = v27.downside_skew(bars[symbol], index)
            if value is not None:
                skews.append(float(value))
        result[ts] = {
            "bull": bull,
            "closeAboveSma20": bool(sma20 is not None and close > sma20),
            "mom20": float(mom20 or 0.0),
            "mom3": float(mom3 or 0.0),
            "shock": float(shock or 0.0),
            "skew": max(skews) if skews else 1.0,
        }
    return result


def combine(config: Config, times, core, pengu, features, stress: bool):
    rows = []
    for ts in times:
        c = core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        p = pengu.get(ts, {"base": 0.0, "stress": 0.0, "exposure": 0.0})
        f = features.get(ts, {})
        if c["regime"] > 0:
            strong = (
                f.get("closeAboveSma20", False)
                and float(f.get("mom20", 0.0)) >= config.mom20_min
                and float(f.get("mom3", 0.0)) > 0.0
            )
            brake = (
                float(f.get("shock", 0.0)) <= config.shock_floor
                or float(f.get("skew", 1.0)) > config.skew_limit
                or not f.get("closeAboveSma20", False)
            )
            core_weight = config.brake_mult if brake else config.strong_mult if strong else config.normal_mult
        else:
            core_weight = 1.0
        # Preserve PENGU independence, but avoid taking its full sleeve during a core crash brake.
        pengu_weight = config.pengu15
        if c["regime"] > 0 and core_weight <= 0.80:
            pengu_weight *= 0.5
        raw_gross = c["exposure"] * core_weight + p["exposure"] * pengu_weight
        cap_scale = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
        value = (c["return"] * core_weight + p["stress" if stress else "base"] * pengu_weight) * cap_scale
        rows.append({"ts": ts, "return": value, "gross": raw_gross * cap_scale})
    return rows


def is_neighbor(left: Config, right: Config) -> bool:
    return (
        left.pengu15 == right.pengu15
        and abs(left.strong_mult - right.strong_mult) <= 0.051
        and abs(left.normal_mult - right.normal_mult) <= 0.101
        and abs(left.brake_mult - right.brake_mult) <= 0.151
        and abs(left.mom20_min - right.mom20_min) <= 5.01
        and abs(left.shock_floor - right.shock_floor) <= 2.01
        and abs(left.skew_limit - right.skew_limit) <= 0.151
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main():
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if START <= int(row["ts"]) < END]
    projected = v6.precompute_projected_members(v20.COMPONENTS, times, bars, indexes)
    base_map = {ts: v4.overlay_target(v20.OVERLAY, ts, projected[ts], bars, indexes) for ts in times}
    bear_map = v6.precompute_bear_targets([v20.HEDGE], times, bars, indexes)[v20.HEDGE.hedge_id]
    targets = v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, funding)
    base_core = v32.core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe_core = v32.core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    pengu = v32.pengu_series()
    features = feature_map(times, targets, bars, indexes, funding)

    cfgs = configs()
    results = {}
    for name, config in cfgs.items():
        base_rows = combine(config, times, base_core, pengu, features, False)
        severe_rows = combine(config, times, severe_core, pengu, features, True)
        results[name] = {
            "config": asdict(config),
            "development": v32.metrics(base_rows, START, DEV_END),
            "developmentSevere": v32.metrics(severe_rows, START, DEV_END),
            "reused2026H1": v32.metrics(base_rows, DEV_END, END),
            "reused2026H1Severe": v32.metrics(severe_rows, DEV_END, END),
            "full": v32.metrics(base_rows, START, END),
        }

    passed = []
    for name, item in results.items():
        dev = item["development"]
        severe = item["developmentSevere"]
        if (
            dev["cagrPct"] >= 100
            and dev["maxDrawdownPct"] >= -35
            and (dev["monthlyProfitFactor"] or 0) >= 1.20
            and severe["compoundedReturnPct"] > 0
            and severe["maxDrawdownPct"] >= -55
            and min(severe["annualReturnsPct"].values()) >= -35
            and all(dev["annualReturnsPct"].get(str(year), -100) > 0 for year in [2023, 2024, 2025])
        ):
            passed.append(name)

    robust = []
    for name in passed:
        neighbors = [other for other in passed if other != name and is_neighbor(cfgs[name], cfgs[other])]
        if len(neighbors) >= 3:
            robust.append(name)
    robust.sort(key=lambda name: (
        results[name]["development"]["cagrPct"],
        results[name]["developmentSevere"]["compoundedReturnPct"],
        results[name]["development"]["maxDrawdownPct"],
    ), reverse=True)
    selected = robust[0] if robust else None
    final_pass = False
    if selected:
        normal = results[selected]["reused2026H1"]
        severe = results[selected]["reused2026H1Severe"]
        final_pass = bool(
            normal["compoundedReturnPct"] > 0
            and normal["maxDrawdownPct"] >= -20
            and severe["compoundedReturnPct"] > 0
            and severe["maxDrawdownPct"] >= -25
        )
    status = "ADAPTIVE_HIGH_RETURN_FORWARD_SHADOW" if selected and final_pass else "ADAPTIVE_DEVELOPMENT_ONLY" if selected else "NO_ROBUST_ADAPTIVE_100CAGR"
    ranked = sorted(results, key=lambda name: results[name]["development"]["cagrPct"], reverse=True)
    result = rounded({
        "version": 33,
        "strategyId": "DISDEX_ADAPTIVE_PROFIT_STACK_V33",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected,
        "developmentPassed": passed,
        "robustDevelopment": robust,
        "reused2026Passed": final_pass,
        "results": results,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "2026H1 is reused confirmation, not a pristine holdout.",
            "All adaptive decisions use the prior completed 12h bar; no same-bar lookahead is used.",
            "PENGU uses the frozen 17-trade schedule reconstructed on Aster hourly candles.",
            "No production, VPS, account, order, env, or live-runner changes.",
        ],
    })
    report = [
        "# Dis-Dex Manager Adaptive Profit Stack V33", "",
        f"- Status: **{status}**", f"- Selected: **{selected or 'NONE'}**",
        f"- Development passed: {len(passed)}", f"- Robust development: {len(robust)}",
        f"- Reused 2026 H1 pass: **{'YES' if final_pass else 'NO'}**",
        "- Production changed: NO", "- Real trading: DISABLED", "",
        "| Stack | Dev CAGR | Dev return | Dev DD | Dev severe | Severe DD | 2026H1 | 2026 severe | Full CAGR | Full return | Full DD | Max gross |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    shown = list(dict.fromkeys([*(robust[:12]), *(passed[:12]), *ranked[:15]]))
    for name in shown:
        item = result["results"][name]
        dev, sev = item["development"], item["developmentSevere"]
        hold, hold_sev, full = item["reused2026H1"], item["reused2026H1Severe"], item["full"]
        report.append(
            f"| {name} | {dev['cagrPct']}% | {dev['compoundedReturnPct']}% | {dev['maxDrawdownPct']}% | "
            f"{sev['compoundedReturnPct']}% | {sev['maxDrawdownPct']}% | {hold['compoundedReturnPct']}% | "
            f"{hold_sev['compoundedReturnPct']}% | {full['cagrPct']}% | {full['compoundedReturnPct']}% | "
            f"{full['maxDrawdownPct']}% | {full['maxGross']} |"
        )
    report.extend(["", "## Limitations", "", *[f"- {item}" for item in result["limitations"]]])
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-adaptive-profit-stack-v33.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-adaptive-profit-stack-v33.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
