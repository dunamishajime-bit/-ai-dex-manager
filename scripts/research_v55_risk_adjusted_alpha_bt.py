from __future__ import annotations

import argparse
import json
from pathlib import Path

import research_v54_structural_alpha_bt as v54

LONG_MULTIPLIERS = (1.00, 1.25, 1.50, 1.75, 2.00)
SHORT_MULTIPLIERS = (1.00, 1.10, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 1.55, 1.60)
MAX_ACCEPTABLE_DD_PCT = -15.0
MIN_FULL_GAIN_VS_V53_PCT_POINT = 100.0
MIN_REUSED_HOLDOUT_RETURN_RATIO = 0.90

FIXED_STRUCTURE = v54.StructureSpec(
    window_set="POST_EARLY3",
    hold_hours=4,
    direction="BOTH",
    selection_depth=2,
    rank_mode="ENTRY_ABS",
    convergence_ratio=None,
    stop_multiple=1.75,
    maximum_adverse_bps=10.0,
    minimum_basis_bps=50.0,
)


def fixed_stock_policy() -> dict:
    return next(policy for policy in v54.stock_policies() if policy["name"] == "V11_TIERED")


def evaluate(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    v12, pengu = v54.load_ledgers(v12_path, pengu_path)
    v11, target_days, aligned, stock_diag = v54.load_stock_state(stock_cache)
    fixed_v50 = v54.build_v50_rows(FIXED_STRUCTURE, target_days, aligned)
    policy = fixed_stock_policy()

    selection_start = v54.base.START_MS
    selection_end = v54.base.HOLDOUT_START_MS
    holdout_start = v54.base.HOLDOUT_START_MS
    holdout_end = v54.base.END_MS
    folds = v54.fold_bounds(selection_start, selection_end, 4)

    baseline_v50 = v54.build_v50_rows(v54.BASELINE_STRUCTURE, target_days, aligned)
    baseline_selection = v54.eval_case(
        v12, pengu, v11, baseline_v50, v54.V53_STOCK_POLICY, 1.0, 1.0,
        selection_start, selection_end,
    )
    baseline_full = v54.eval_case(
        v12, pengu, v11, baseline_v50, v54.V53_STOCK_POLICY, 1.0, 1.0,
        v54.base.START_MS, v54.base.END_MS,
    )
    baseline_holdout = v54.eval_case(
        v12, pengu, v11, baseline_v50, v54.V53_STOCK_POLICY, 1.0, 1.0,
        holdout_start, holdout_end,
    )
    baseline_fold_blocks = [
        v54.eval_case(v12, pengu, v11, baseline_v50, v54.V53_STOCK_POLICY, 1.0, 1.0, left, right)
        for left, right in folds
    ]
    bsel = v54.summarize("V53_SELECTION", baseline_selection)
    bfull = v54.summarize("V53_FULL", baseline_full)
    bhold = v54.summarize("V53_REUSED_HOLDOUT", baseline_holdout)

    cases = []
    for long_mult in LONG_MULTIPLIERS:
        for short_mult in SHORT_MULTIPLIERS:
            selection = v54.eval_case(
                v12, pengu, v11, fixed_v50, policy, long_mult, short_mult,
                selection_start, selection_end,
            )
            full = v54.eval_case(
                v12, pengu, v11, fixed_v50, policy, long_mult, short_mult,
                v54.base.START_MS, v54.base.END_MS,
            )
            holdout = v54.eval_case(
                v12, pengu, v11, fixed_v50, policy, long_mult, short_mult,
                holdout_start, holdout_end,
            )
            fold_diag = v54.fold_diagnostics(
                v12, pengu, v11, fixed_v50, policy, long_mult, short_mult,
                baseline_fold_blocks, folds,
            )
            s = v54.summarize(f"PL{long_mult:g}_PS{short_mult:g}_SELECTION", selection)
            f = v54.summarize(f"PL{long_mult:g}_PS{short_mult:g}_FULL", full)
            h = v54.summarize(f"PL{long_mult:g}_PS{short_mult:g}_HOLDOUT", holdout)
            gain = f["normalWorstReturnPct"] - bfull["normalWorstReturnPct"]
            holdout_floor = MIN_REUSED_HOLDOUT_RETURN_RATIO * bhold["normalWorstReturnPct"]
            checks = {
                "selectionFoldWinsAtLeast3of4": fold_diag["wins"] >= 3,
                "fullGainAtLeast100pp": gain >= MIN_FULL_GAIN_VS_V53_PCT_POINT,
                "fullPfNotWorseThanV53": f["normalWorstPf"] >= bfull["normalWorstPf"],
                "fullDdAtMost15Pct": f["normalWorstDdPct"] >= MAX_ACCEPTABLE_DD_PCT,
                "fullSevereNotWorseThanV53": f["severeWorstReturnPct"] >= bfull["severeWorstReturnPct"],
                "reusedHoldoutAtLeast90PctOfV53": h["normalWorstReturnPct"] >= holdout_floor,
                "reusedHoldoutPfAtLeast1_5": h["normalWorstPf"] >= 1.50,
                "reusedHoldoutSevereNonnegative": h["severeWorstReturnPct"] >= 0,
                "globalGrossAtMost2_5": f["maxTotalGross"] <= 2.5 + 1e-9,
                "stockGrossAtMost1_5": f["maxStockGross"] <= 1.5 + 1e-9,
                "cryptoGrossAtMost1_5": f["maxCryptoGross"] <= 1.5 + 1e-9,
                "v50ConcurrentAtMost2": f["maxV50Concurrent"] <= 2,
            }
            risk_penalty = max(0.0, abs(f["normalWorstDdPct"]) - abs(bfull["normalWorstDdPct"]))
            holdout_delta = h["normalWorstReturnPct"] - bhold["normalWorstReturnPct"]
            score = gain + 0.20 * f["severeWorstReturnPct"] + 2.0 * f["normalWorstPf"] + 0.5 * holdout_delta - 20.0 * risk_penalty
            cases.append({
                "caseId": f"PL{long_mult:g}_PS{short_mult:g}",
                "penguLongMultiplier": long_mult,
                "penguShortMultiplier": short_mult,
                "selection": s,
                "full": f,
                "reusedHoldout": h,
                "foldDiagnostics": fold_diag,
                "fullGainVsV53PctPoint": gain,
                "checks": checks,
                "pass": all(checks.values()),
                "score": score,
            })

    cases.sort(key=lambda row: (not row["pass"], -float(row["score"]), row["caseId"]))
    eligible = [row for row in cases if row["pass"]]
    winner = eligible[0] if eligible else None

    # Separately report Phase-C-only economics because it is the large structural gain
    # that does not depend on increasing PENGU gross.
    phase_c_only = next(row for row in cases if row["penguLongMultiplier"] == 1.0 and row["penguShortMultiplier"] == 1.0)

    payload = {
        "schema": "v55-risk-adjusted-alpha/v1",
        "status": "V55_RISK_ADJUSTED_SIGNIFICANT_PASS_RESEARCH_ONLY" if winner else "V55_RISK_ADJUSTED_NO_SIGNIFICANT_PROMOTION",
        "fixedStructure": v54.asdict(FIXED_STRUCTURE),
        "fixedStockPolicy": policy,
        "search": {
            "longMultipliers": list(LONG_MULTIPLIERS),
            "shortMultipliers": list(SHORT_MULTIPLIERS),
            "cases": len(cases),
            "maxAcceptableDrawdownPct": MAX_ACCEPTABLE_DD_PCT,
            "minimumFullGainVsV53PctPoint": MIN_FULL_GAIN_VS_V53_PCT_POINT,
            "minimumReusedHoldoutReturnRatio": MIN_REUSED_HOLDOUT_RETURN_RATIO,
        },
        "baseline": {
            "selection": bsel,
            "full": bfull,
            "reusedHoldout": bhold,
        },
        "phaseCOnly": phase_c_only,
        "topCases": cases[:20],
        "winner": winner,
        "sourceLineage": {
            "liveBaseSha": "ef91f81e86f819ba1e37ff9325e8972489e1544f",
            "v54ResearchSha": "8391bb5634f104d630bed3e2b51ff6fd3d1e28c9",
            "freshLedgerRunId": 32783392588,
            "freshLedgerArtifactId": 9540872862,
        },
        "selectionDiscipline": {
            "preHoldoutFoldCount": 4,
            "reusedHoldoutIndependentClaim": False,
            "note": "The final segment was already viewed in prior research, so it is confirmation-only. Promotion still requires future untouched evidence.",
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
            "globalGrossCap": 2.5,
            "stockGrossCap": 1.5,
            "cryptoGrossCap": 1.5,
            "maxV50Concurrent": 2,
        },
        "stockDiagnostics": stock_diag,
        "limitations": [
            "PENGU multipliers above 1.0 are research-only sizing changes and exceed the current production maximumGross=0.75 contract.",
            "Reused holdout results are confirmation only, not untouched holdout evidence.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(v54.rounded(payload), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("FINAL_SUMMARY_JSON=" + json.dumps(v54.rounded({
        "status": payload["status"],
        "baselineFull": bfull,
        "baselineHoldout": bhold,
        "phaseCOnly": phase_c_only,
        "winner": winner,
        "topCases": cases[:10],
    }), separators=(",", ":"), ensure_ascii=False))
    return payload


def self_test() -> None:
    assert FIXED_STRUCTURE.stop_multiple == 1.75
    assert FIXED_STRUCTURE.minimum_basis_bps == 50.0
    assert fixed_stock_policy()["name"] == "V11_TIERED"
    assert SHORT_MULTIPLIERS[0] == 1.0 and SHORT_MULTIPLIERS[-1] == 1.6
    assert MAX_ACCEPTABLE_DD_PCT == -15.0
    assert MIN_FULL_GAIN_VS_V53_PCT_POINT == 100.0
    print("V55 risk-adjusted alpha self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v55-risk-adjusted-alpha")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    evaluate(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
