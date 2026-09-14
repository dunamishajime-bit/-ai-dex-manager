from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_pengu_main_currency_v20 as v20
import research_lab_feature_combo_v28 as v28
import research_lab_btc_variable_leverage_v21 as v21

START = v4.START_2023
DEV_END = v4.START_2026
END = v4.END
HOURS_12 = 12 * v4.HOUR

PENGU_TRADES = [('2025-07-07 18:00:00+00:00', '2025-07-10 17:00:00+00:00', 1), ('2025-07-25 02:00:00+00:00', '2025-07-28 01:00:00+00:00', 1), ('2025-07-28 19:00:00+00:00', '2025-07-29 20:00:00+00:00', 1), ('2025-08-01 05:00:00+00:00', '2025-08-04 04:00:00+00:00', 1), ('2025-08-07 13:00:00+00:00', '2025-08-10 04:00:00+00:00', -1), ('2025-08-23 01:00:00+00:00', '2025-08-26 00:00:00+00:00', -1), ('2025-09-22 04:00:00+00:00', '2025-09-24 04:00:00+00:00', 1), ('2025-10-01 17:00:00+00:00', '2025-10-04 16:00:00+00:00', -1), ('2025-10-07 20:00:00+00:00', '2025-10-10 19:00:00+00:00', 1), ('2025-10-12 22:00:00+00:00', '2025-10-15 21:00:00+00:00', -1), ('2025-11-10 06:00:00+00:00', '2025-11-13 05:00:00+00:00', -1), ('2025-12-02 19:00:00+00:00', '2025-12-05 18:00:00+00:00', -1), ('2025-12-05 20:00:00+00:00', '2025-12-08 19:00:00+00:00', 1), ('2026-02-07 00:00:00+00:00', '2026-02-09 23:00:00+00:00', -1), ('2026-02-15 01:00:00+00:00', '2026-02-18 00:00:00+00:00', -1), ('2026-06-07 07:00:00+00:00', '2026-06-10 06:00:00+00:00', -1), ('2026-06-15 19:00:00+00:00', '2026-06-18 18:00:00+00:00', -1)]


@dataclass(frozen=True)
class Config:
    bull_core: float
    bear_core: float
    pengu15: float
    governor: str
    gross_cap: float = 2.0


def configs() -> Dict[str, Config]:
    result: Dict[str, Config] = {
        "V28_BASELINE": Config(1.0, 1.0, 0.0, "NONE", 1.20),
        "V28_PENGU15_BASELINE": Config(1.0, 1.0, 1.0, "NONE", 1.40),
    }
    for bull in [1.35, 1.40, 1.45, 1.50, 1.55, 1.60]:
        for pengu in [0.0, 1.0, 2.0]:
            for governor in ["NONE", "ALL", "CORE"]:
                name = f"B{int(round(bull*100))}_P{int(pengu*15)}_{governor}"
                result[name] = Config(bull, 1.0, pengu, governor, 2.0)
    return result


def pengu_series() -> Dict[int, dict]:
    raw = v21.fetch_aster_symbol("PENGUUSDT")
    schedules = [
        (int(dt.datetime.fromisoformat(entry).timestamp() * 1000), int(dt.datetime.fromisoformat(exit_time).timestamp() * 1000), side)
        for entry, exit_time, side in PENGU_TRADES
    ]
    grouped: Dict[int, List[dict]] = {}
    for candle in sorted(raw["candles"], key=lambda row: int(row["ts"])):
        ts = int(candle["ts"])
        active = next((item for item in schedules if item[0] <= ts <= item[1]), None)
        base = stress = exposure = 0.0
        if active:
            entry_ts, exit_ts, side = active
            gross = side * (float(candle["close"]) / float(candle["open"]) - 1.0)
            base_full = gross - 0.0002 / 24.0
            stress_full = gross - 0.0005 / 24.0
            if ts == entry_ts:
                base_full -= 0.0006
                stress_full -= 0.0010
            if ts == exit_ts:
                base_full -= 0.0006
                stress_full -= 0.0010
            base = base_full * 0.15
            stress = stress_full * 0.15
            exposure = 0.15
        grouped.setdefault(ts // HOURS_12 * HOURS_12, []).append({"base": base, "stress": stress, "exposure": exposure})
    result: Dict[int, dict] = {}
    for ts, items in grouped.items():
        base_eq = stress_eq = 1.0
        for item in items:
            base_eq *= max(0.001, 1.0 + item["base"])
            stress_eq *= max(0.001, 1.0 + item["stress"])
        result[ts] = {
            "base": base_eq - 1.0,
            "stress": stress_eq - 1.0,
            "exposure": statistics.fmean(item["exposure"] for item in items),
        }
    return result


def core_series(targets, times, bars, indexes, funding, cost_bps, delay_bars, adverse_bps):
    result = {}
    portfolio = {}
    for position, ts in enumerate(times):
        source = position - 1 - delay_bars
        desired = targets.get(times[source], {}) if source >= 0 else {}
        turnover = v4.turnover(portfolio, desired) if desired != portfolio else 0.0
        portfolio = dict(desired)
        gross_return = actual_funding = 0.0
        for symbol, weight in portfolio.items():
            idx = indexes[symbol].get(ts)
            if idx is None:
                continue
            bar = bars[symbol][idx]
            gross_return += weight * (float(bar["close"]) / float(bar["open"]) - 1.0)
            actual_funding += weight * funding.get(symbol, {}).get(ts, 0.0) / 100.0
        exposure = v4.gross_exposure(portfolio)
        regime = 1 if any(weight > 0 for symbol, weight in portfolio.items() if symbol != "BTC") else -1 if any(weight < 0 for weight in portfolio.values()) else 0
        result[ts] = {
            "return": gross_return - actual_funding - turnover * cost_bps / 10_000.0 - exposure * adverse_bps / 10_000.0,
            "exposure": exposure,
            "regime": regime,
        }
    return result


def governor_scale(mode: str, drawdown: float) -> Tuple[float, float]:
    if mode == "NONE":
        return 1.0, 1.0
    if drawdown <= -0.20:
        core_scale = 0.45
    elif drawdown <= -0.15:
        core_scale = 0.65
    elif drawdown <= -0.10:
        core_scale = 0.82
    else:
        core_scale = 1.0
    return (core_scale, core_scale) if mode == "ALL" else (core_scale, 1.0)


def combine(config: Config, times, core, pengu, stress: bool):
    rows = []
    equity = peak = 1.0
    for ts in times:
        c = core.get(ts, {"return": 0.0, "exposure": 0.0, "regime": 0})
        p = pengu.get(ts, {"base": 0.0, "stress": 0.0, "exposure": 0.0})
        core_weight = config.bull_core if c["regime"] > 0 else config.bear_core
        drawdown = equity / peak - 1.0
        core_governor, pengu_governor = governor_scale(config.governor, drawdown)
        raw_gross = c["exposure"] * core_weight * core_governor + p["exposure"] * config.pengu15 * pengu_governor
        cap_scale = min(1.0, config.gross_cap / raw_gross) if raw_gross > 0 else 1.0
        value = (
            c["return"] * core_weight * core_governor
            + p["stress" if stress else "base"] * config.pengu15 * pengu_governor
        ) * cap_scale
        gross = raw_gross * cap_scale
        rows.append({"ts": ts, "return": value, "gross": gross})
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
    return rows


def monthly_pf(rows):
    groups: Dict[str, List[float]] = {}
    for row in rows:
        key = dt.datetime.fromtimestamp(row["ts"] / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        groups.setdefault(key, []).append(row["return"])
    values = []
    for items in groups.values():
        equity = 1.0
        for value in items:
            equity *= max(0.001, 1.0 + value)
        values.append(equity - 1.0)
    gains = sum(max(value, 0.0) for value in values)
    losses = sum(max(-value, 0.0) for value in values)
    return gains / losses if losses > 0 else 999.0 if gains > 0 else None


def metrics(rows, start, end):
    active = [row for row in rows if start <= row["ts"] < end]
    equity = peak = 1.0
    max_dd = 0.0
    for row in active:
        equity *= max(0.001, 1.0 + row["return"])
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
    years = max(0.25, (end - start) / (365.25 * v4.DAY))
    annual = {}
    for year in [2023, 2024, 2025, 2026]:
        year_rows = [row for row in active if dt.datetime.fromtimestamp(row["ts"] / 1000, tz=dt.timezone.utc).year == year]
        if year_rows:
            year_eq = 1.0
            for row in year_rows:
                year_eq *= max(0.001, 1.0 + row["return"])
            annual[str(year)] = (year_eq - 1.0) * 100.0
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "monthlyProfitFactor": monthly_pf(active),
        "averageGross": statistics.fmean(row["gross"] for row in active) if active else 0.0,
        "maxGross": max((row["gross"] for row in active), default=0.0),
        "annualReturnsPct": annual,
    }


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
    base_core = core_series(targets, times, bars, indexes, funding, 10, 0, 0)
    severe_core = core_series(targets, times, bars, indexes, funding, 50, 1, 3)
    pengu = pengu_series()

    results = {}
    for name, config in configs().items():
        base_rows = combine(config, times, base_core, pengu, False)
        severe_rows = combine(config, times, severe_core, pengu, True)
        results[name] = {
            "config": asdict(config),
            "development": metrics(base_rows, START, DEV_END),
            "developmentSevere": metrics(severe_rows, START, DEV_END),
            "reused2026H1": metrics(base_rows, DEV_END, END),
            "reused2026H1Severe": metrics(severe_rows, DEV_END, END),
            "full": metrics(base_rows, START, END),
        }

    development_passed = []
    for name, item in results.items():
        if name.startswith("V28_"):
            continue
        dev = item["development"]
        severe = item["developmentSevere"]
        if (
            dev["cagrPct"] >= 100
            and dev["maxDrawdownPct"] >= -35
            and (dev["monthlyProfitFactor"] or 0) >= 1.20
            and severe["compoundedReturnPct"] > 0
            and all(dev["annualReturnsPct"].get(str(year), -100) > 0 for year in [2023, 2024, 2025])
        ):
            development_passed.append(name)

    stable = []
    cfgs = configs()
    for name in development_passed:
        current = cfgs[name]
        neighbors = [
            other for other in development_passed
            if other != name
            and cfgs[other].pengu15 == current.pengu15
            and cfgs[other].governor == current.governor
            and abs(cfgs[other].bull_core - current.bull_core) <= 0.051
        ]
        if neighbors:
            stable.append(name)
    stable.sort(key=lambda name: (results[name]["development"]["cagrPct"], results[name]["development"]["maxDrawdownPct"]), reverse=True)
    selected = stable[0] if stable else None
    final_pass = False
    if selected:
        final = results[selected]["reused2026H1"]
        severe = results[selected]["reused2026H1Severe"]
        final_pass = bool(final["compoundedReturnPct"] > 0 and final["maxDrawdownPct"] >= -20 and severe["compoundedReturnPct"] > 0 and severe["maxDrawdownPct"] >= -25)
    status = "ASYMMETRIC_HIGH_RETURN_FORWARD_SHADOW" if selected and final_pass else "DEVELOPMENT_ONLY_NEAR_TARGET" if selected else "NO_STABLE_100CAGR_DD35"

    ranked = sorted(results, key=lambda name: results[name]["development"]["cagrPct"], reverse=True)
    result = rounded({
        "version": 32,
        "strategyId": "DISDEX_ASYMMETRIC_RETURN_STACK_V32",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selected": selected,
        "developmentPassed": development_passed,
        "stableDevelopment": stable,
        "reused2026Passed": final_pass,
        "results": results,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "limitations": [
            "2026H1 is reused confirmation, not pristine holdout.",
            "PENGU uses the frozen 17-trade schedule reconstructed on Aster hourly candles.",
            "Bull exposure is boosted while the existing BTC bear hedge remains at 1.0x.",
            "No production, VPS, account, order, position, env, or live-runner changes.",
        ],
    })

    report = [
        "# Dis-Dex Manager Asymmetric Return Stack V32",
        "",
        f"- Status: **{status}**",
        f"- Selected: **{selected or 'NONE'}**",
        f"- Development passed: {', '.join(development_passed) if development_passed else 'NONE'}",
        f"- Stable development: {', '.join(stable) if stable else 'NONE'}",
        f"- Reused 2026 H1 pass: **{'YES' if final_pass else 'NO'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "| Stack | Dev CAGR | Dev return | Dev DD | Dev severe | 2026H1 | 2026 severe | Full CAGR | Full return | Full DD | Max gross |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    shown = list(dict.fromkeys(["V28_BASELINE", "V28_PENGU15_BASELINE", *development_passed, *ranked[:18]]))
    for name in shown:
        item = result["results"][name]
        dev = item["development"]
        sev = item["developmentSevere"]
        hold = item["reused2026H1"]
        hold_sev = item["reused2026H1Severe"]
        full = item["full"]
        report.append(
            f"| {name} | {dev['cagrPct']}% | {dev['compoundedReturnPct']}% | {dev['maxDrawdownPct']}% | {sev['compoundedReturnPct']}% | "
            f"{hold['compoundedReturnPct']}% | {hold_sev['compoundedReturnPct']}% | {full['cagrPct']}% | {full['compoundedReturnPct']}% | {full['maxDrawdownPct']}% | {full['maxGross']} |"
        )
    report.extend(["", "## Limitations", "", *[f"- {item}" for item in result["limitations"]]])
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "disdex-asymmetric-return-stack-v32.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "disdex-asymmetric-return-stack-v32.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
