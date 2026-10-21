from __future__ import annotations

import json
import os
from pathlib import Path

import research_lab_v35_core_pengu_v46_gross2 as base
import research_lab_v35_core_pengu_v46_gross2_v2 as v2


OUTPUT_STEM = "v35-core-pengu-v46-gross015-bt"


def main() -> None:
    base.PENGU_GROSS = 0.15
    v2.main()

    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    old_json = state_dir / "v35-core-pengu-v46-gross2-bt.json"
    old_md = state_dir / "v35-core-pengu-v46-gross2-bt.md"
    payload = json.loads(old_json.read_text(encoding="utf-8"))
    payload["version"] = "gross015-v1"
    payload["strategyId"] = "DISDEX_V35_CORE_PLUS_PENGU_V46_GROSS015_BT"
    payload["assumptions"]["penguGross"] = 0.15
    payload["assumptions"]["reason"] = "User requested exact PENGU Gross 0.15 comparison using the same reproducible V46 trades."
    payload["status"] = "RESEARCH_ONLY_GROSS015"
    new_json = state_dir / f"{OUTPUT_STEM}.json"
    new_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    conservative = payload["combined"]["conservativeNoLargeWaveProfit"]
    conservative_severe = payload["combined"]["conservativeNoLargeWaveProfitSevere"]
    mechanical = payload["combined"]["fullCorePeriod"]
    mechanical_severe = payload["combined"]["severeFullCorePeriod"]
    p = payload["pengu"]["gross2Full"]
    core = payload["core"]["full"]
    report = [
        "# V35 Core + PENGU V46 Gross 0.15 Backtest",
        "",
        "- Fixed historical PENGU 17 trades: **NOT USED**",
        "- PENGU Gross: **0.15**",
        "- Core sizing: unchanged",
        "- Total Gross cap: not additionally applied",
        "",
        "## Conservative result — large-wave PENGU profits excluded",
        "",
        f"- Return: {conservative['compoundedReturnPct']}%",
        f"- CAGR: {conservative['cagrPct']}%",
        f"- Max DD: {conservative['maxDrawdownPct']}%",
        f"- Severe return: {conservative_severe['compoundedReturnPct']}%",
        f"- Severe Max DD: {conservative_severe['maxDrawdownPct']}%",
        "",
        "## Mechanical reference — all generated V46 trades included",
        "",
        f"- Core only: {core['compoundedReturnPct']}% / CAGR {core['cagrPct']}% / DD {core['maxDrawdownPct']}%",
        f"- PENGU Gross 0.15: {p['compoundedReturnPct']}% / PF {p['profitFactor']} / DD {p['maxDrawdownPct']}% / N {p['trades']}",
        f"- Combined: {mechanical['compoundedReturnPct']}% / CAGR {mechanical['cagrPct']}% / DD {mechanical['maxDrawdownPct']}%",
        f"- Combined Severe: {mechanical_severe['compoundedReturnPct']}% / DD {mechanical_severe['maxDrawdownPct']}%",
        f"- Observed max concurrent Gross: {mechanical['observedMaxConcurrentGross']}",
        "",
        "- Production changed: NO",
        "- Real trading changed: NO",
    ]
    new_md = state_dir / f"{OUTPUT_STEM}.md"
    new_md.write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
