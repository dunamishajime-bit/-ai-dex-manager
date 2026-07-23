from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
from collections import defaultdict
from pathlib import Path

import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as swing
import v96_stock_walkforward_ridge_tournament_v8 as v8

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_WALKFORWARD_RIDGE_TOURNAMENT_V8B"


def replay_cached(candidate, scenario, samples, predictions_by_day):
    target_lookup = {(sample.decision_day, sample.symbol): sample.target for sample in samples}
    entry_lookup = {sample.decision_day: (sample.entry_day, sample.exit_day) for sample in samples}
    previous = {}
    rows = []
    for day in sorted(predictions_by_day):
        if day not in entry_lookup:
            continue
        weights = v8.candidate_weights(candidate, predictions_by_day[day])
        turnover = sum(
            abs(weights.get(symbol, 0.0) - previous.get(symbol, 0.0))
            for symbol in set(weights) | set(previous)
        )
        gross_return = sum(weight * target_lookup[(day, symbol)] for symbol, weight in weights.items())
        cost = turnover * scenario.turnover_bps / 10_000.0
        entry_day, exit_day = entry_lookup[day]
        rows.append({
            "candidateId": candidate.candidate_id,
            "family": candidate.family,
            "decisionDay": day,
            "day": entry_day,
            "exitDay": exit_day,
            "weights": weights,
            "gross": sum(abs(value) for value in weights.values()),
            "turnover": turnover,
            "prediction": predictions_by_day[day],
            "grossReturn": gross_return,
            "executionCost": cost,
            "return": gross_return - cost,
        })
        previous = weights
    return rows


def analyze(price_cache: Path, funding_cache: Path) -> dict:
    raw = base.load_all(price_cache)
    sessions = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items() if symbol in v8.SYMBOLS}
    bars = swing.daily_bars(sessions)
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    days = v8.regular_days(bars)
    samples, features_by_day = v8.build_samples(days, bars, sessions, funding)
    prediction_days = sorted(
        day for day in features_by_day
        if sum(sample.exit_day <= day for sample in samples) >= v8.MIN_TRAIN_SAMPLES
    )
    if len(prediction_days) < 100:
        raise RuntimeError(f"insufficient walk-forward prediction days: {len(prediction_days)}")
    splits = base.chronological_splits(prediction_days)

    prediction_cache = {}
    for candidate in v8.CANDIDATES:
        key = (candidate.target_type, candidate.regularization)
        if key not in prediction_cache:
            prediction_cache[key] = v8.build_predictions(samples, features_by_day, candidate)

    all_rows = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in v8.CANDIDATES:
        predictions = prediction_cache[(candidate.target_type, candidate.regularization)]
        for scenario in base.SCENARIOS:
            all_rows[scenario.name][candidate.candidate_id] = replay_cached(
                candidate, scenario, samples, predictions
            )

    families = {}
    for family in sorted(set(candidate.family for candidate in v8.CANDIDATES)):
        candidates = [candidate for candidate in v8.CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            development = {
                scenario.name: v8.metrics(
                    v8.subset(all_rows[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])
                )
                for scenario in base.SCENARIOS
            }
            rows.append({
                "candidate": {
                    "candidate_id": candidate.candidate_id,
                    "family": candidate.family,
                    "regularization": candidate.regularization,
                    "target_type": candidate.target_type,
                },
                "development": development,
                "score": v8.score(
                    development["FORWARD_MEDIAN"], development["NORMAL"], development["SEVERE"]
                ),
            })
        winner = max(rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: v8.metrics(
                v8.subset(all_rows[scenario.name][winner_id], splits["VALIDATION"])
            )
            for scenario in base.SCENARIOS
        }
        families[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": v8.validation_pass(validation),
        }

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {
            scenario.name: v8.metrics(
                v8.subset(all_rows[scenario.name][candidate_id], splits["VALIDATION"])
            )
            for scenario in base.SCENARIOS
        }
        options.append({
            "portfolioId": candidate_id,
            "members": [candidate_id],
            "validation": validation,
            "validationScore": v8.score(
                validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]
            ),
        })
    if len(passing) >= 2:
        validation = {
            scenario.name: v8.metrics(
                v8.subset(v8.combine(all_rows[scenario.name], passing), splits["VALIDATION"])
            )
            for scenario in base.SCENARIOS
        }
        options.append({
            "portfolioId": "VALIDATION_SELECTED_RIDGE_ENSEMBLE",
            "members": sorted(passing),
            "validation": validation,
            "validationScore": v8.score(
                validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]
            ),
        })

    selected_option = max(
        options, key=lambda item: (item["validationScore"], item["portfolioId"])
    ) if options else None
    selected = None
    if selected_option:
        selected = {
            "portfolioId": selected_option["portfolioId"],
            "members": selected_option["members"],
            "validation": selected_option["validation"],
            "gross1": {},
            "normalizedGross2": {},
        }
        for scenario in base.SCENARIOS:
            rows = (
                all_rows[scenario.name][selected_option["members"][0]]
                if len(selected_option["members"]) == 1
                else v8.combine(all_rows[scenario.name], selected_option["members"])
            )
            selected["gross1"][scenario.name] = {
                "full": v8.metrics(rows),
                "development": v8.metrics(v8.subset(rows, splits["DEVELOPMENT"])),
                "validation": v8.metrics(v8.subset(rows, splits["VALIDATION"])),
                "holdout": v8.metrics(v8.subset(rows, splits["HOLDOUT"])),
                "removals": v8.removals(rows),
                "rows": rows,
            }
            selected["normalizedGross2"][scenario.name] = {
                "full": v8.metrics(rows, 2.0),
                "holdout": v8.metrics(v8.subset(rows, splits["HOLDOUT"]), 2.0),
                "removals": v8.removals(rows, 2.0),
            }
        selected["holdoutPassGross1"] = v8.holdout_pass({
            name: item["holdout"] for name, item in selected["gross1"].items()
        })
        normal2 = selected["normalizedGross2"]["NORMAL"]["full"]
        severe2 = selected["normalizedGross2"]["SEVERE"]["full"]
        selected["cryptoLikeNormalizedGross2"] = bool(
            selected["holdoutPassGross1"]
            and normal2["compoundedReturnPct"] >= 50
            and normal2["cagrPct"] >= 50
            and severe2["compoundedReturnPct"] > 0
            and normal2["maxDrawdownPct"] >= -50
        )

    if selected and selected["cryptoLikeNormalizedGross2"]:
        status = "CRYPTO_LIKE_WALKFORWARD_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPassGross1"]:
        status = "ROBUST_POSITIVE_WALKFORWARD_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "WALKFORWARD_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_WALKFORWARD_FAMILY"

    return v8.rounded({
        "version": "8B",
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "universe": list(v8.SYMBOLS),
        "features": list(v8.FEATURE_NAMES),
        "candidateCount": len(v8.CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in v8.CANDIDATES)),
        "uniqueModelFits": len(prediction_cache),
        "sampleCount": len(samples),
        "predictionDays": len(prediction_days),
        "firstPredictionDay": prediction_days[0],
        "lastPredictionDay": prediction_days[-1],
        "minimumTrainSamples": v8.MIN_TRAIN_SAMPLES,
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "selectionDiscipline": {
            "modelFit": "expanding walk-forward using only samples with exitDay <= prediction day",
            "predictionReuse": "six unique target/regularization model paths; cost scenarios do not refit",
            "regularizationSelection": "DEVELOPMENT only",
            "portfolioSelection": "VALIDATION only",
            "finalEvaluation": "reused historical HOLDOUT once",
            "holdoutRetuningAllowed": False,
        },
        "classificationLimit": "Dates and listings were inspected by earlier Stock research; positive results remain reused historical evidence.",
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
        "limitations": [
            "Five mature current listings create survivorship and concentration risk.",
            "Ridge is a linear model and does not reconstruct historical order-book or event gates.",
            "Targets include next-open price return and actual Funding between regular-session opens.",
            "Gross 2.0 is normalized sensitivity only, not an allocation approval.",
        ],
    })


def write_report(result, output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-walkforward-ridge-tournament-v8b.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Walk-forward Ridge Tournament V8B",
        "",
        f"- Status: **{result['status']}**",
        f"- Prediction window: {result['firstPredictionDay']}–{result['lastPredictionDay']} ({result['predictionDays']} days)",
        f"- Samples / unique model paths: {result['sampleCount']} / {result['uniqueModelFits']}",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for family, item in result["families"].items():
        winner = next(
            row for row in item["developmentCandidates"]
            if row["candidate"]["candidate_id"] == item["winnerId"]
        )
        lines.append(
            f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{winner['development']['SEVERE']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | "
            f"{'YES' if item['validationPass'] else 'NO'} |"
        )
    selected = result.get("selected")
    if selected:
        lines.extend([
            "",
            "## Selected reused-historical model",
            "",
            f"Portfolio: **{selected['portfolioId']}**",
            f"Gross 1 Holdout pass: **{'YES' if selected['holdoutPassGross1'] else 'NO'}**",
            f"Normalized Gross 2 crypto-like threshold: **{'YES' if selected['cryptoLikeNormalizedGross2'] else 'NO'}**",
            "",
            "| Scenario | G1 Full | G1 CAGR | G1 DD | G1 Holdout | G2 Full | G2 CAGR | G2 DD | G2 Holdout |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            g1 = selected["gross1"][name]
            g2 = selected["normalizedGross2"][name]
            lines.append(
                f"| {name} | {g1['full']['compoundedReturnPct']}% | {g1['full']['cagrPct']}% | "
                f"{g1['full']['maxDrawdownPct']}% | {g1['holdout']['compoundedReturnPct']}% | "
                f"{g2['full']['compoundedReturnPct']}% | {g2['full']['cagrPct']}% | "
                f"{g2['full']['maxDrawdownPct']}% | {g2['holdout']['compoundedReturnPct']}% |"
            )
    (output_dir / "v96-stock-walkforward-ridge-tournament-v8b.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def self_test():
    assert len(v8.CANDIDATES) == 12
    assert len({(candidate.target_type, candidate.regularization) for candidate in v8.CANDIDATES}) == 6


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--price-cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-walkforward-ridge-tournament-v8b")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock walk-forward ridge V8B self-test: PASS")
        return 0
    result = analyze(Path(args.price_cache_dir).resolve(), Path(args.funding_cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "predictionDays": result["predictionDays"],
        "validationPassingWinnerIds": result["validationPassingWinnerIds"],
        "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
