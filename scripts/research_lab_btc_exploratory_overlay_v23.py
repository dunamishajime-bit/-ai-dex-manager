from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Dict

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_precomputed_multi_regime_v6 as v6
import research_lab_btc_variable_leverage_v21 as v21
import research_lab_btc_low_gross_independent_v22 as v22


def choose_exploratory(evaluated: list[dict]) -> v22.BtcLogic | None:
    candidates = [
        item for item in evaluated
        if item["developmentBase"]["compoundedReturnPct"] > 0
        and (item["developmentBase"]["profitFactor"] or 0) >= 1.15
        and item["developmentBase"]["maxDrawdownPct"] >= -25
        and item["developmentSevere"]["maxDrawdownPct"] >= -45
        and item["developmentBase"]["cycles"] >= 8
    ]
    candidates.sort(
        key=lambda item: (
            item["developmentBase"]["cagrPct"],
            item["developmentBase"]["profitFactor"] or 0,
        ),
        reverse=True,
    )
    return v22.BtcLogic(**candidates[0]["logic"]) if candidates else None


def risk_adjusted_score(item: dict) -> float:
    base = item["full"]["BASE_10BPS"]
    dd = abs(float(base["maxDrawdownPct"]))
    return float(base["cagrPct"]) / dd if dd > 0 else -999.0


def rounded(value):
    return v22.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {symbol: v21.fetch_aster_symbol(pair) for symbol, pair in v21.SYMBOL_PAIRS.items()}
    counts = {symbol: {"hourlyCandles": len(item["candles"]), "fundingRows": len(item["funding"])} for symbol, item in raw.items()}
    bars = {symbol: v4.resample_12h(item["candles"]) for symbol, item in raw.items()}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = v6.funding_buckets({symbol: item["funding"] for symbol, item in raw.items()})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v21.FETCH_START <= int(bar["ts"]) < v21.END]

    first_common = max(min(int(row["ts"]) for row in bars[symbol]) for symbol in v21.SYMBOL_PAIRS)
    test_start = next(ts for ts in times if ts >= first_common + 140 * 12 * v4.HOUR)
    development_end = v4.START_2026
    final_end = v21.END

    evaluated, robust_selected = v22.evaluate_logic_grid(
        times, bars, indexes, funding, test_start, development_end
    )
    selected = robust_selected or choose_exploratory(evaluated)
    selection_tier = "ROBUST" if robust_selected else "EXPLORATORY" if selected else "NONE"

    baseline_targets = v21.v6_targets(times, bars, indexes)
    baseline = {
        "full": v22.run_all_scenarios(baseline_targets, times, bars, indexes, funding, test_start, final_end),
        "final2026H1": v22.run_all_scenarios(baseline_targets, times, bars, indexes, funding, development_end, final_end),
        "exposure": v21.exposure_stats(baseline_targets, times, test_start, final_end),
    }

    independent = None
    overlays: Dict[str, dict] = {}
    if selected:
        btc_targets = v22.btc_logic_targets(selected, times, bars, indexes)
        independent = {
            "logic": selected.__dict__,
            "development": v22.run_all_scenarios(btc_targets, times, bars, indexes, funding, test_start, development_end),
            "final2026H1": v22.run_all_scenarios(btc_targets, times, bars, indexes, funding, development_end, final_end),
            "full": v22.run_all_scenarios(btc_targets, times, bars, indexes, funding, test_start, final_end),
            "exposure": v21.exposure_stats(btc_targets, times, test_start, final_end),
            "liquidationProxy": v21.liquidation_proxy(btc_targets, times, bars, indexes, test_start, final_end),
        }
        independent["holdoutPositive"] = (
            independent["final2026H1"]["BASE_10BPS"]["compoundedReturnPct"] > 0
            and (independent["final2026H1"]["BASE_10BPS"]["profitFactor"] or 0) >= 1.0
        )

        for mode in [
            "REPLACE25_SAME_GROSS",
            "REPLACE40_SAME_GROSS",
            "SHIFT_CORE0P8_BTC0P2_CAP1P0",
            "SHIFT_CORE0P75_BTC0P35_CAP1P1",
            "ADD_BTC0P25_CAP1P35",
            "ADD_BTC0P50_CAP1P60",
        ]:
            targets = v22.overlay_targets(mode, baseline_targets, btc_targets, times)
            overlays[mode] = {
                "full": v22.run_all_scenarios(targets, times, bars, indexes, funding, test_start, final_end),
                "final2026H1": v22.run_all_scenarios(targets, times, bars, indexes, funding, development_end, final_end),
                "exposure": v21.exposure_stats(targets, times, test_start, final_end),
                "liquidationProxy": v21.liquidation_proxy(targets, times, bars, indexes, test_start, final_end),
            }
            overlays[mode]["formalPassed"] = bool(
                selection_tier == "ROBUST" and v22.overlay_pass(overlays[mode], baseline)
            )
            overlays[mode]["exploratoryImproved"] = bool(
                overlays[mode]["full"]["BASE_10BPS"]["cagrPct"] > baseline["full"]["BASE_10BPS"]["cagrPct"]
                and overlays[mode]["final2026H1"]["BASE_10BPS"]["compoundedReturnPct"] > 0
            )
            overlays[mode]["riskAdjustedScore"] = risk_adjusted_score(overlays[mode])

    improved = [mode for mode, item in overlays.items() if item["exploratoryImproved"]]
    improved.sort(key=lambda mode: overlays[mode]["riskAdjustedScore"], reverse=True)
    best_overlay = improved[0] if improved else (
        max(overlays, key=lambda mode: overlays[mode]["riskAdjustedScore"]) if overlays else None
    )

    if robust_selected and best_overlay and overlays[best_overlay]["formalPassed"]:
        status = "FORMAL_LOW_GROSS_OVERLAY_FOUND"
    elif independent and independent["holdoutPositive"]:
        status = "EXPLORATORY_BTC_LOGIC_POSITIVE_HOLDOUT"
    else:
        status = "EXPLORATORY_BTC_LOGIC_HOLDOUT_REJECTED"

    result = rounded({
        "version": 23,
        "strategyId": "BTC_EXPLORATORY_LOW_GROSS_OVERLAY_V23",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "selectionTier": selection_tier,
        "selectedLogic": selected.__dict__ if selected else None,
        "bestOverlay": best_overlay,
        "source": {"venue": "ASTER_DEX_PUBLIC_FUTURES_API", "counts": counts, "authenticationUsed": False},
        "windows": {
            "full": {"startDate": v22.fmt_date(test_start), "endDate": v22.fmt_date(final_end)},
            "development": {"startDate": v22.fmt_date(test_start), "endDate": v22.fmt_date(development_end)},
            "holdout": {"startDate": v22.fmt_date(development_end), "endDate": v22.fmt_date(final_end)},
        },
        "baseline": baseline,
        "independentBtc": independent,
        "overlays": overlays,
        "productionChanged": False,
        "realTradingEnabled": False,
        "paperEligible": False,
        "liveEligible": False,
        "note": "An exploratory signal is evaluated because the strict V22 robustness gate found no candidate. It cannot be promoted even if the holdout is positive.",
    })

    report = [
        "# BTC Exploratory Low-Gross Overlay V23",
        "",
        f"- Status: **{status}**",
        f"- Selection tier: **{selection_tier}**",
        f"- Selected BTC logic: **{selected.logic_id if selected else 'NONE'}**",
        f"- Best overlay: **{best_overlay or 'NONE'}**",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## BTC-only result",
        "",
        "| Strategy | Development return | 2025 return | Holdout return | Holdout PF | Full return | Full CAGR | Full PF | Full DD | Severe DD |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    if independent:
        development = independent["development"]["BASE_10BPS"]
        holdout = independent["final2026H1"]["BASE_10BPS"]
        full = independent["full"]["BASE_10BPS"]
        severe = independent["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| BTC_INDEPENDENT | {development['compoundedReturnPct']} | {development['annualReturnsPct'].get('2025')} | "
            f"{holdout['compoundedReturnPct']} | {holdout['profitFactor']} | {full['compoundedReturnPct']} | "
            f"{full['cagrPct']} | {full['profitFactor']} | {full['maxDrawdownPct']} | {severe['maxDrawdownPct']} |"
        )

    report.extend([
        "",
        "## Low-gross overlay result",
        "",
        "| Mode | Full return | CAGR | PF | DD | Holdout return | Holdout PF | Severe DD | Mean gross | Max gross | Improved |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ])
    for mode, item in result["overlays"].items():
        full = item["full"]["BASE_10BPS"]
        holdout = item["final2026H1"]["BASE_10BPS"]
        severe = item["full"]["SEVERE_50BPS_DELAY12H_FUND3"]
        report.append(
            f"| {mode} | {full['compoundedReturnPct']} | {full['cagrPct']} | {full['profitFactor']} | {full['maxDrawdownPct']} | "
            f"{holdout['compoundedReturnPct']} | {holdout['profitFactor']} | {severe['maxDrawdownPct']} | "
            f"{item['exposure']['mean']} | {item['exposure']['max']} | {item['exploratoryImproved']} |"
        )
    report.extend([
        "",
        "## Guardrail",
        "",
        result["note"],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "btc-exploratory-overlay-v23.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "btc-exploratory-overlay-v23.md").write_text("\n".join(report), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
