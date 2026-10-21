from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_asymmetric_return_stack_v32 as v32
import research_lab_adaptive_profit_stack_v33 as v33

START = v4.START_2023
DEV_END = v4.START_2026
END = v4.END


@dataclass(frozen=True)
class Config:
    strong_mult: float
    normal_mult: float
    brake_mult: float
    negative_mom_brake: bool
    vol_limit: Optional[float]
    dd_start: Optional[float]
    gross_cap: float = 2.0
    pengu15: float = 2.0


def configs() -> Dict[str, Config]:
    result: Dict[str, Config] = {}
    for strong in [1.40, 1.45, 1.50]:
        for normal in [1.20, 1.25]:
            for brake in [0.35, 0.50, 0.65]:
                for neg in [False, True]:
                    for vol_limit in [None, 80.0, 100.0]:
                        for dd_start in [None, 0.10, 0.15]:
                            name = (
                                f"S{int(strong*100)}_N{int(normal*100)}_B{int(brake*100)}"
                                f"_NEG{1 if neg else 0}_V{int(vol_limit) if vol_limit else 0}"
                                f"_D{int(dd_start*100) if dd_start else 0}_P30"
                            )
                            result[name] = Config(strong, normal, brake, neg, vol_limit, dd_start)
    return result


def features_with_vol(times, targets, bars, indexes, funding):
    result = v33.feature_map(times, targets, bars, indexes, funding)
    for position, ts in enumerate(times):
        source = position - 1
        if source < 0:
            result[ts]["btcVol"] = 0.0
            continue
        feature_ts = times[source]
        index = indexes["BTC"].get(feature_ts)
        vol = v4.realized_annual_vol(bars["BTC"], index, 40) if index is not None else None
        result[ts]["btcVol"] = float(vol or 0.0)
    return result


def combine(config: Config, times, core, pengu, features, stress: bool):
    rows = []
    equity = peak = 1.0
    for ts in times:
        c = core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        p = pengu.get(ts, {"base": 0.0, "stress": 0.0, "exposure": 0.0})
        f = features.get(ts, {})
        core_weight = 1.0
        brake_active = False
        if c["regime"] > 0:
            strong = (
                f.get("closeAboveSma20", False)
                and float(f.get("mom20", 0.0)) >= 10.0
                and float(f.get("mom3", 0.0)) > 0.0
            )
            brake_active = (
                float(f.get("shock", 0.0)) <= -4.0
                or float(f.get("skew", 1.0)) > 1.35
                or not f.get("closeAboveSma20", False)
                or (config.negative_mom_brake and float(f.get("mom3", 0.0)) <= 0.0)
            )
            core_weight = config.brake_mult if brake_active else config.strong_mult if strong else config.normal_mult
            if config.vol_limit is not None and float(f.get("btcVol", 0.0)) > config.vol_limit:
                core_weight *= 0.85
        drawdown = equity / peak - 1.0
        if config.dd_start is not None and drawdown <= -config.dd_start:
            core_weight *= 0.80
        pengu_weight = config.pengu15
        if c["regime"] > 0 and (brake_active or core_weight <= 0.65):
            pengu_weight *= 0.5
        raw_gross = c["exposure"] * core_weight + p["exposure"] * pengu_weight
        cap_scale = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
        value = (c["return"] * core_weight + p["stress" if stress else "base"] * pengu_weight) * cap_scale
        rows.append({"ts": ts, "return": value, "gross": raw_gross * cap_scale})
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    return rows


def neighbor(a: Config, b: Config) -> bool:
    return (
        a.negative_mom_brake == b.negative_mom_brake
        and a.vol_limit == b.vol_limit
        and a.dd_start == b.dd_start
        and abs(a.strong_mult - b.strong_mult) <= 0.051
        and abs(a.normal_mult - b.normal_mult) <= 0.051
        and abs(a.brake_mult - b.brake_mult) <= 0.151
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
    features = features_with_vol(times, targets, bars, indexes, funding)

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
        dev, sev = item["development"], item["developmentSevere"]
        if (
            dev["cagrPct"] >= 100
            and dev["maxDrawdownPct"] >= -35
            and (dev["monthlyProfitFactor"] or 0) >= 1.20
            and sev["compoundedReturnPct"] > 0
            and sev["maxDrawdownPct"] >= -55
            and min(sev["annualReturnsPct"].values()) >= -35
            and all(dev["annualReturnsPct"].get(str(year), -100) > 0 for year in [2023, 2024, 2025])
        ):
            passed.append(name)

    robust = []
    for name in passed:
        peers = [other for other in passed if other != name and neighbor(cfgs[name], cfgs[other])]
        if len(peers) >= 2:
            robust.append(name)
    robust.sort(key=lambda name: (
        results[name]["development"]["cagrPct"],
        results[name]["developmentSevere"]["compoundedReturnPct"],
        results[name]["development"]["maxDrawdownPct"],
    ), reverse=True)
    selected = robust[0] if robust else None
    final_pass = False
    if selected:
        hold, severe = results[selected]["reused2026H1"], results[selected]["reused2026H1Severe"]
        final_pass = bool(
            hold["compoundedReturnPct"] > 0
            and hold["maxDrawdownPct"] >= -20
            and severe["compoundedReturnPct"] > 0
            and severe["maxDrawdownPct"] >= -25
        )
    status = "RESILIENT_HIGH_RETURN_FORWARD_SHADOW" if selected and final_pass else "RESILIENT_DEVELOPMENT_ONLY" if selected else "NO_ROBUST_RESILIENT_100CAGR"
    ranked = sorted(results, key=lambda name: results[name]["development"]["cagrPct"], reverse=True)
    result = rounded({
        "version": 34,
        "strategyId": "DISDEX_RESILIENT_PROFIT_STACK_V34",
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
            "Risk controls use only prior equity and the prior completed 12h bar.",
            "PENGU uses the frozen 17-trade schedule reconstructed on Aster hourly candles.",
            "No production, VPS, account, order, env, or live-runner changes.",
        ],
    })
    report = [
        "# Dis-Dex Manager Resilient Profit Stack V34", "",
        f"- Status: **{status}**", f"- Selected: **{selected or 'NONE'}**",
        f"- Development passed: {len(passed)}", f"- Robust development: {len(robust)}",
        f"- Reused 2026 H1 pass: **{'YES' if final_pass else 'NO'}**",
        "- Production changed: NO", "- Real trading: DISABLED", "",
        "| Stack | Dev CAGR | Dev return | Dev DD | Dev severe | Severe DD | 2026H1 | 2026 severe | Full CAGR | Full return | Full DD | Max gross |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    shown = list(dict.fromkeys([*(robust[:15]), *(passed[:15]), *ranked[:15]]))
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
    (state_dir / "disdex-resilient-profit-stack-v34.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-resilient-profit-stack-v34.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
