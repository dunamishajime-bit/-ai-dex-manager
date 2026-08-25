from __future__ import annotations

import argparse
import json
from pathlib import Path

import research_v55_risk_adjusted_alpha_bt as v55

LONG_GRID = tuple(round(1.00 + 0.05 * i, 2) for i in range(11))  # 1.00 .. 1.50
SHORT_FIXED = 1.00
DD_LIMITS = (-12.0, -12.5, -13.0, -13.5, -15.0)


def _pick_best_under(cases: list[dict], dd_limit: float) -> dict | None:
    eligible = [
        c for c in cases
        if c["penguShortMultiplier"] == SHORT_FIXED
        and c["foldDiagnostics"]["wins"] >= 3
        and c["full"]["normalWorstDdPct"] >= dd_limit
        and c["reusedHoldout"]["normalWorstReturnPct"] > 0
        and c["reusedHoldout"]["severeWorstReturnPct"] >= 0
        and c["full"]["maxTotalGross"] <= 2.5 + 1e-9
        and c["full"]["maxCryptoGross"] <= 1.5 + 1e-9
        and c["full"]["maxStockGross"] <= 1.5 + 1e-9
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda c: (c["full"]["normalWorstReturnPct"], c["full"]["normalWorstPf"], -abs(c["full"]["normalWorstDdPct"])))


def evaluate(stock_cache: Path, v12_path: Path, pengu_path: Path, output_dir: Path) -> dict:
    old_long = v55.LONG_MULTIPLIERS
    old_short = v55.SHORT_MULTIPLIERS
    try:
        v55.LONG_MULTIPLIERS = LONG_GRID
        v55.SHORT_MULTIPLIERS = (SHORT_FIXED,)
        raw = v55.evaluate(stock_cache, v12_path, pengu_path, output_dir)
    finally:
        v55.LONG_MULTIPLIERS = old_long
        v55.SHORT_MULTIPLIERS = old_short

    cases = sorted(raw["topCases"], key=lambda c: c["penguLongMultiplier"])
    assert len(cases) == len(LONG_GRID), (len(cases), len(LONG_GRID))

    boundary = []
    for c in cases:
        boundary.append({
            "penguLongMultiplier": c["penguLongMultiplier"],
            "selectionReturnPct": c["selection"]["normalWorstReturnPct"],
            "selectionPf": c["selection"]["normalWorstPf"],
            "selectionDdPct": c["selection"]["normalWorstDdPct"],
            "foldWins": c["foldDiagnostics"]["wins"],
            "fullReturnPct": c["full"]["normalWorstReturnPct"],
            "fullPf": c["full"]["normalWorstPf"],
            "fullDdPct": c["full"]["normalWorstDdPct"],
            "fullSevereReturnPct": c["full"]["severeWorstReturnPct"],
            "holdoutReturnPct": c["reusedHoldout"]["normalWorstReturnPct"],
            "holdoutPf": c["reusedHoldout"]["normalWorstPf"],
            "holdoutDdPct": c["reusedHoldout"]["normalWorstDdPct"],
            "holdoutSevereReturnPct": c["reusedHoldout"]["severeWorstReturnPct"],
            "maxTotalGross": c["full"]["maxTotalGross"],
            "maxCryptoGross": c["full"]["maxCryptoGross"],
        })

    best_by_dd = {}
    for limit in DD_LIMITS:
        pick = _pick_best_under(cases, limit)
        best_by_dd[str(abs(limit))] = None if pick is None else {
            "penguLongMultiplier": pick["penguLongMultiplier"],
            "fullReturnPct": pick["full"]["normalWorstReturnPct"],
            "fullPf": pick["full"]["normalWorstPf"],
            "fullDdPct": pick["full"]["normalWorstDdPct"],
            "selectionFoldWins": pick["foldDiagnostics"]["wins"],
            "holdoutReturnPct": pick["reusedHoldout"]["normalWorstReturnPct"],
            "holdoutPf": pick["reusedHoldout"]["normalWorstPf"],
            "holdoutSevereReturnPct": pick["reusedHoldout"]["severeWorstReturnPct"],
        }

    # Prefer the highest return with <=13% DD, then <=13.5%, while keeping
    # confirmation Severe non-negative and at least 3/4 fold wins.
    preferred = _pick_best_under(cases, -13.0) or _pick_best_under(cases, -13.5) or _pick_best_under(cases, -15.0)

    payload = {
        "schema": "v56-pengu-long-boundary/v1",
        "status": "V56_PENGU_LONG_BOUNDARY_PASS_RESEARCH_ONLY" if preferred else "V56_PENGU_LONG_BOUNDARY_NO_CANDIDATE",
        "grid": list(LONG_GRID),
        "shortMultiplierFixed": SHORT_FIXED,
        "fixedStructure": raw["fixedStructure"],
        "fixedStockPolicy": raw["fixedStockPolicy"],
        "baseline": raw["baseline"],
        "boundary": boundary,
        "bestByDrawdownLimitPct": best_by_dd,
        "preferred": None if preferred is None else {
            "penguLongMultiplier": preferred["penguLongMultiplier"],
            "selection": preferred["selection"],
            "full": preferred["full"],
            "reusedHoldout": preferred["reusedHoldout"],
            "foldDiagnostics": preferred["foldDiagnostics"],
            "fullGainVsV53PctPoint": preferred["fullGainVsV53PctPoint"],
        },
        "selectionDiscipline": {
            "preHoldoutFoldCount": 4,
            "reusedHoldoutIndependentClaim": False,
            "note": "Final segment has been viewed before; it is confirmation-only. This study maps the sizing boundary and does not claim a new untouched holdout.",
        },
        "sourceLineage": {
            "v55ResearchSha": "adef3aecf37e848583e585a21e29069bdc4d7ae1",
            "freshLedgerRunId": 32783392588,
            "freshLedgerArtifactId": 9540872862,
        },
        "safety": raw["safety"],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v56-result.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("V56_SUMMARY_JSON=" + json.dumps({
        "status": payload["status"],
        "preferred": payload["preferred"],
        "bestByDrawdownLimitPct": best_by_dd,
        "boundary": boundary,
    }, separators=(",", ":"), ensure_ascii=False))
    return payload


def self_test() -> None:
    assert LONG_GRID[0] == 1.0
    assert LONG_GRID[-1] == 1.5
    assert 1.25 in LONG_GRID and 1.30 in LONG_GRID and 1.35 in LONG_GRID
    assert SHORT_FIXED == 1.0
    assert -13.0 in DD_LIMITS
    print("V56 PENGU long boundary self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--v12-ledger", default=".research-state/v12-pengu-v52-top2/v12-ledgers.json")
    parser.add_argument("--pengu-ledger", default=".research-state/v12-pengu-v52-top2/pengu-v2-ledgers.json")
    parser.add_argument("--output-dir", default=".research-state/v56-pengu-long-boundary")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    evaluate(Path(args.stock_cache_dir), Path(args.v12_ledger), Path(args.pengu_ledger), Path(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
