from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52
import research_lab_pengu_wave_sleeve_v56 as v56

HOUR = v47.HOUR

FIXED_WASHOUT = v56.WashoutScout(
    side=1,
    family="WASHOUT",
    lookback=6,
    trigger1=1.0,
    trigger3=1.5,
    context=0.0,
    volume_threshold=0.3,
    volatility_threshold=0.4,
    distance_atr=9.0,
    confirmation_move_pct=0.2,
    confirmation_hours=1,
    exit_profile="FAST",
    current_mom3_max=-3.0,
    drawdown24_min=-8.0,
    body_min=0.30,
)


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for fixed V57")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)

    base_long, _ = v50.run_candidate(v56.BASE_LONG, pengu, btc, funding, features)
    washout_trades, washout_armed = v56.run_candidate(FIXED_WASHOUT, pengu, btc, funding, features)
    final_long = v56.combine_same_side(washout_trades, base_long)

    flash, _ = v52.run_candidate(v56.SHORT_FLASH, pengu, btc, funding, features)
    distribution, _ = v52.run_candidate(v56.SHORT_DISTRIBUTION, pengu, btc, funding, features)
    final_short = v56.combine_same_side(distribution, flash)

    long_pass, long_evidence = v56.adoption_gate(final_long, folds, major24, major72, 1)
    short_pass, short_evidence = v56.adoption_gate(final_short, folds, major24, major72, -1)
    enabled = v50.combine_sides(final_long if long_pass else [], final_short if short_pass else [])
    enabled_metrics = v56.aggregate(enabled, folds)
    washout_metrics = v56.aggregate(washout_trades, folds)
    status = (
        "BOTH_ENABLED" if long_pass and short_pass
        else "LONG_ONLY_ENABLED" if long_pass
        else "SHORT_ONLY_ENABLED" if short_pass
        else "NO_PRODUCTION_CANDIDATE"
    )
    result = rounded({
        "version": 57,
        "strategyId": "PENGU_WAVE_SLEEVE_V57_FIXED_WASHOUT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "fixedWashout": asdict(FIXED_WASHOUT),
        "washoutArmedWithoutOrder": washout_armed,
        "washoutMetrics": washout_metrics,
        "baseLong": asdict(v56.BASE_LONG),
        "fixedShortFlash": asdict(v56.SHORT_FLASH),
        "fixedShortDistribution": asdict(v56.SHORT_DISTRIBUTION),
        "longGatePassed": long_pass,
        "shortGatePassed": short_pass,
        "longEvidence": long_evidence,
        "shortEvidence": short_evidence,
        "enabledMetrics": enabled_metrics,
        "longTrades": [asdict(trade) for trade in final_long],
        "shortTrades": [asdict(trade) for trade in final_short],
        "enabledTrades": [asdict(trade) for trade in enabled],
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "parametersReoptimized": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v57.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V57 Fixed Washout",
        "",
        f"- Status: **{status}**",
        f"- Fixed Washout: **{FIXED_WASHOUT.candidate_id}**",
        f"- Long gate: **{'PASS' if long_pass else 'FAIL'}**",
        f"- Short gate: **{'PASS' if short_pass else 'FAIL'}**",
        "",
        "## Washout Scout only",
        f"- Full: {washout_metrics['full']['compoundedReturnPct']}%",
        f"- Full Severe: {washout_metrics['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout trades: {washout_metrics['holdout']['trades']}",
        "",
        "## Long",
        f"- Full: {long_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {long_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {long_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {long_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {long_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {long_evidence['profitableMajorRatePct']}%",
        "",
        "## Short",
        f"- Full: {short_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {short_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {short_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {short_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {short_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {short_evidence['profitableMajorRatePct']}%",
        "",
        "## Enabled Long + Short",
        f"- Full: {enabled_metrics['full']['compoundedReturnPct']}%",
        f"- Full Severe: {enabled_metrics['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {enabled_metrics['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {enabled_metrics['holdoutSevere']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v57.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
