from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v63_robustness as v63
import research_lab_pengu_wave_sleeve_v50 as v50


_original_venue_result = v63.venue_result


def corrected_venue_result(name, pengu, btc, funding):
    result = _original_venue_result(name, pengu, btc, funding)
    aligned_pengu, _aligned_btc = common.intersect_rows(pengu, btc)
    events = [
        *v50.wave_events(aligned_pengu, 24, 20.0),
        *v50.wave_events(aligned_pengu, 72, 35.0),
    ]
    trades = [v50.Trade(**row) for row in result["trades"]]
    start = int(result["startTs"])
    end = int(result["endTs"])
    for cost, key in ((0.42, "excludedCost0p42"), (0.56, "excludedCost0p56"), (0.70, "excludedCost0p70")):
        stressed = [v63.stress_trade(trade, cost) for trade in trades]
        stressed_excluded, _ = common.exclude_large_wave_profits(stressed, events)
        result["stressCosts"][key] = v63.metrics(stressed_excluded, start, end)
    return result


v63.venue_result = corrected_venue_result


def main() -> None:
    v63.main()
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    source_json = state_dir / "pengu-v63-robustness.json"
    source_md = state_dir / "pengu-v63-robustness.md"
    payload = json.loads(source_json.read_text(encoding="utf-8"))
    payload["version"] = "63b"
    payload["strategyId"] = "PENGU_V63B_FIXED_ROBUSTNESS_CORRECTED"
    payload["correction"] = {
        "issue": "Large-wave-excluded cost stress previously recalculated zeroed profitable trades from gross PnL.",
        "fix": "Apply stressed transaction costs first, then zero positive returns overlapping same-direction major wave events.",
        "unaffected": [
            "normal and severe returns",
            "large-wave-excluded normal and severe returns",
            "remove-best-trade/month tests",
            "trade and monthly bootstrap tests",
            "Aster cross-venue normal and excluded returns",
        ],
    }
    archive = payload["archive"]
    aster = payload["aster"]
    archive_pass = bool(
        archive["includedSevere"]["compoundedReturnPct"] > 0
        and archive["excludedSevere"]["compoundedReturnPct"] > 0
        and archive["stressCosts"]["cost0p56"]["compoundedReturnPct"] > 0
        and archive["stressCosts"]["excludedCost0p56"]["compoundedReturnPct"] > 0
        and archive["removeBestTrade"]["compoundedReturnPct"] > 0
        and archive["removeBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and archive["excludedRemoveBestTrade"]["compoundedReturnPct"] > 0
        and archive["excludedRemoveBestMonth"]["metrics"]["compoundedReturnPct"] > 0
        and archive["tradeBootstrap"]["returnP05"] > 0
        and archive["excludedTradeBootstrap"]["returnP05"] > 0
    )
    aster_pass = bool(
        aster["included"]["trades"] >= 5
        and aster["includedSevere"]["compoundedReturnPct"] > 0
        and aster["excludedSevere"]["compoundedReturnPct"] > 0
        and aster["stressCosts"]["excludedCost0p56"]["compoundedReturnPct"] > 0
    )
    payload["archivePassed"] = archive_pass
    payload["asterPassed"] = aster_pass
    payload["status"] = (
        "FULL_ROBUSTNESS_PASS" if archive_pass and aster_pass
        else "ARCHIVE_ROBUST_ASTER_PENDING" if archive_pass
        else "ROBUSTNESS_FAIL"
    )
    target_json = state_dir / "pengu-v63b-robustness.json"
    target_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU V63b Corrected Robustness",
        "",
        f"- Status: **{payload['status']}**",
        f"- Archive excluded cost 0.42%: {archive['stressCosts']['excludedCost0p42']['compoundedReturnPct']}%",
        f"- Archive excluded cost 0.56%: {archive['stressCosts']['excludedCost0p56']['compoundedReturnPct']}%",
        f"- Archive excluded cost 0.70%: {archive['stressCosts']['excludedCost0p70']['compoundedReturnPct']}%",
        f"- Aster excluded cost 0.42%: {aster['stressCosts']['excludedCost0p42']['compoundedReturnPct']}%",
        f"- Aster excluded cost 0.56%: {aster['stressCosts']['excludedCost0p56']['compoundedReturnPct']}%",
        f"- Aster excluded cost 0.70%: {aster['stressCosts']['excludedCost0p70']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    target_md = state_dir / "pengu-v63b-robustness.md"
    target_md.write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
