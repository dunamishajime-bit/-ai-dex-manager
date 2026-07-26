from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v37_absolute_basis_idle_overlay as v37

STRATEGY_ID = "DISDEX_ASTER_ONLY_V38_FIRST_ELIGIBLE_ABSOLUTE_BASIS"


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    minimum_basis_bps: float
    minimum_zscore: float
    maximum_holding_hours: int
    direction_mode: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"FIRST_ELIGIBLE__B{basis:g}__Z{z:g}__H{hours}__{direction}",
        basis,
        z,
        hours,
        direction,
    )
    for basis in (50.0, 75.0, 100.0)
    for z in (0.0, 1.5, 2.0)
    for hours in (1, 2)
    for direction in ("BOTH", "PREMIUM_ONLY", "DISCOUNT_ONLY")
)


def build_trade(candidate: Candidate, day: str, day_feature: dict) -> Optional[dict]:
    for slot in (1, 2, 3):
        temporary = v37.Candidate(
            candidate_id=f"{candidate.candidate_id}__SLOT_{slot}",
            entry_slot=slot,
            minimum_basis_bps=candidate.minimum_basis_bps,
            minimum_zscore=candidate.minimum_zscore,
            maximum_holding_hours=candidate.maximum_holding_hours,
            direction_mode=candidate.direction_mode,
        )
        trade = v37.build_trade(temporary, day, day_feature)
        if trade is not None:
            return {
                **trade,
                "strategy": "V38_FIRST_ELIGIBLE_ABSOLUTE_BASIS",
                "candidateId": candidate.candidate_id,
                "selectedSlot": slot,
            }
    return None


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [
        trade
        for day in days
        if (trade := build_trade(candidate, day, features[day])) is not None
    ]


def analyze(cache_root: Path) -> dict:
    v37.v14.base.verify_source(v37.v14.base.V11_ROOT, v37.v14.base.V11_SOURCE_SHA)
    v37.v14.base.verify_source(v37.v14.base.V13_ROOT, v37.v14.base.V13_SOURCE_SHA)
    v37.v19.configure_exact_data_window()
    days, aligned, data_diag = v37.v19.v17.load_all(cache_root)
    warmup = [day for day in days if v37.v19.WARMUP_START.date().isoformat() <= day < v37.v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v37.v19.BT_START_DAY <= day < v37.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v37.HOLDOUT_START]
    holdout = [day for day in target if day >= v37.HOLDOUT_START]
    splits = v37.v14.split_days(pre_holdout)
    features = v37.v15.build_slot_features(warmup, aligned)
    v11_rows, v11_diag = v37.v22.build_v11eq(warmup, aligned)
    v19_rows = v37.v22.build_fallback(warmup, aligned)
    baseline = v37.v22.audit(
        v11_rows, v19_rows, target,
        splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True,
    )

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features)
        result = v37.audit(
            v11_rows, v19_rows, rows, target,
            splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout,
        )
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentOverlayTrades": result["developmentOverlayTrades"],
            "validationOverlayTrades": result["validationOverlayTrades"],
        })
        if v37.development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))
    development_survivors.sort(
        key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    validation_survivors = [
        item for item in development_survivors[:30]
        if v37.validation_pass(item[2], baseline)
    ]
    validation_survivors.sort(key=lambda item: v37.selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V38_NO_VALIDATED_FIRST_ELIGIBLE_OVERLAY"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V38_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V38_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "accepted": accepted,
            "audit": result,
        }

    diagnostics.sort(
        key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"],
        reverse=True,
    )
    return v37.v14.rounded({
        "version": 38,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "topDevelopmentDiagnostics": diagnostics[:12],
        "period": {
            "startInclusiveUtc": v37.v19.BT_START.isoformat(),
            "endExclusiveUtc": v37.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "baselineV11AndV19Preserved": True,
            "entryPolicy": "CAUSAL_FIRST_ELIGIBLE_1130_1230_1330",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "maximumOneOverlayPerDay": True,
            "overlayOnlyWhenBaselineIdleOrExited": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "thresholdGridReusedFromV37": True,
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopThirty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": data_diag,
        "v11Diagnostics": v11_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V38 First-Eligible Absolute Basis",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner = result["winner"]
        audit_result = winner["audit"]
        lines.extend([
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {audit_result['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {audit_result['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {audit_result['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {audit_result['fallbackFull']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation overlays: {audit_result['validationOverlayTrades']}",
            "",
        ])
    lines.extend(["Research only. No Production, LIVE, VPS or order state was changed.", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
