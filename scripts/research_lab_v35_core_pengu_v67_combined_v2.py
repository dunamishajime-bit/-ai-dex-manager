from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List

import research_lab_v35_core_pengu_v67_combined as v68

MAX_ALLOWED_BUCKET_MOVE_PCT = 35.0
_path_diagnostics = {}


def corrected_trade_bucket_path(rows: List[dict], trade: dict, target_field: str) -> Dict[int, float]:
    target = float(trade[target_field]) / 100.0
    original_field = "severe_pct" if "severe" in target_field else "base_pct"
    original = float(trade[original_field]) / 100.0
    if target == 0.0 and original > 0.0:
        return {}
    rows_by_ts = {int(row["ts"]): row for row in rows}
    increments: Dict[int, float] = {}
    gross_sum = 0.0
    for gross, artifact_entry_price, leg_start in v68.trade_legs(trade):
        if gross <= 0:
            continue
        fetched_entry = v68.price_at_open(rows_by_ts, leg_start, artifact_entry_price)
        entry_price = fetched_entry if fetched_entry > 0 else artifact_entry_price
        ts = leg_start
        current = entry_price
        while ts < int(trade["exit_ts"]):
            next_ts = min(ts + v68.HOUR, int(trade["exit_ts"]))
            if next_ts >= int(trade["exit_ts"]):
                end_price = v68.price_at_open(rows_by_ts, int(trade["exit_ts"]), current)
            else:
                end_price = v68.price_at_open(rows_by_ts, next_ts, current)
            value = gross * int(trade["side"]) * (end_price - current) / entry_price
            bucket = v68.bucket_ts(ts)
            increments[bucket] = increments.get(bucket, 0.0) + value
            gross_sum += value
            current = end_price
            ts = next_ts
    residual = target - gross_sum
    final_bucket = v68.bucket_ts(int(trade["exit_ts"]) - 1)
    increments[final_bucket] = increments.get(final_bucket, 0.0) + residual
    return increments


v68.build_trade_bucket_path = corrected_trade_bucket_path
_original_series = v68.v67_series


def audited_series(rows: List[dict], trades: List[dict]):
    result = _original_series(rows, trades)
    max_abs = max(
        (abs(float(item.get("base", 0.0))) * 100.0 for item in result.values()),
        default=0.0,
    )
    _path_diagnostics["maxAbsBaseBucketReturnPct"] = max_abs
    _path_diagnostics["sumBaseBucketReturnPct"] = sum(
        float(item.get("base", 0.0)) for item in result.values()
    ) * 100.0
    _path_diagnostics["sumSevereBucketReturnPct"] = sum(
        float(item.get("severe", 0.0)) for item in result.values()
    ) * 100.0
    _path_diagnostics["bucketCount"] = len(result)
    if max_abs > MAX_ALLOWED_BUCKET_MOVE_PCT:
        raise RuntimeError(
            f"V67 MTM path guard failed: max 12h bucket move {max_abs:.4f}% exceeds "
            f"{MAX_ALLOWED_BUCKET_MOVE_PCT:.1f}%"
        )
    return result


v68.v67_series = audited_series


def main() -> None:
    v68.main()
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    json_path = state_dir / "v35-core-pengu-v67-combined.json"
    md_path = state_dir / "v35-core-pengu-v67-combined.md"
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    payload["version"] = "68b"
    payload["strategyId"] = "V35_CORE_PLUS_PENGU_V67_SAME_TIMELINE_CORRECTED_MTM"
    payload["status"] = "COMBINED_BACKTEST_COMPLETE_CORRECTED_MTM"
    payload["mtmCorrection"] = {
        "issue": "Rounded Artifact entry prices caused false intratrade mark-to-market jumps when compared with re-fetched Aster candles.",
        "fix": "Use re-fetched candle open prices for each entry/add leg; apply only the funding/cost/exit residual in the final bucket.",
        "guardMaxAbs12hBucketPct": MAX_ALLOWED_BUCKET_MOVE_PCT,
        "diagnostics": _path_diagnostics,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    combined = payload["combined"]
    core = payload["core"]
    report = [
        "# V35 Core + PENGU V67 Same-timeline Backtest V68b",
        "",
        f"- Status: **{payload['status']}**",
        f"- MTM max absolute 12h PENGU bucket: {_path_diagnostics.get('maxAbsBaseBucketReturnPct')}%",
        f"- Core full: {core['full']['compoundedReturnPct']}% / DD {core['full']['maxDrawdownPct']}%",
        f"- Core + V67 full: {combined['fullCorePeriod']['compoundedReturnPct']}% / DD {combined['fullCorePeriod']['maxDrawdownPct']}%",
        f"- Core + V67 Severe: {combined['severeFullCorePeriod']['compoundedReturnPct']}% / DD {combined['severeFullCorePeriod']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {combined['largeWaveExcludedFull']['compoundedReturnPct']}% / DD {combined['largeWaveExcludedFull']['maxDrawdownPct']}%",
        f"- Excluded Severe: {combined['largeWaveExcludedSevereFull']['compoundedReturnPct']}%",
        f"- Increment vs Core: {combined['incrementVsCoreFullPctPoints']} percentage points",
        f"- Observed max concurrent Gross: {combined['observedMaxConcurrentGross']}",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
