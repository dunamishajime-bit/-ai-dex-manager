from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import asdict
from pathlib import Path

import v96_stock_intraday_theme_flow_backtest as base
import v96_stock_swing_tournament_v3 as v3

UTC = dt.timezone.utc
STRATEGY_ID = "V96_STOCK_SWING_TOURNAMENT_V3B"


def common_history_days(bars: dict, minimum_symbols: int = 8, minimum_sessions: int = 61) -> list[str]:
    all_days = sorted(set().union(*(set(rows) for rows in bars.values())))
    eligible: list[str] = []
    for day in all_days:
        count = 0
        for symbol in base.SYMBOLS:
            rows = v3.history(bars.get(symbol, {}), day, minimum_sessions)
            if len(rows) >= minimum_sessions and rows[-1].day == day:
                count += 1
        if count >= minimum_symbols:
            eligible.append(day)
    return eligible


def analyze(cache_dir: Path) -> dict:
    raw = base.load_all(cache_dir)
    sessions = {symbol: base.regular_sessions(rows) for symbol, rows in raw.items()}
    bars = v3.daily_bars(sessions)
    eligible_days = common_history_days(bars)
    splits = base.chronological_splits(eligible_days)
    if len(eligible_days) < 30 or set(splits) != {"DEVELOPMENT", "VALIDATION", "HOLDOUT"}:
        raise RuntimeError(f"insufficient common-history days: {len(eligible_days)}")

    all_trades = {scenario.name: {} for scenario in base.SCENARIOS}
    for candidate in v3.CANDIDATES:
        for scenario in base.SCENARIOS:
            all_trades[scenario.name][candidate.candidate_id] = v3.replay_candidate(
                candidate, scenario, eligible_days, bars
            )

    families = {}
    for family in sorted(set(candidate.family for candidate in v3.CANDIDATES)):
        candidates = [candidate for candidate in v3.CANDIDATES if candidate.family == family]
        rows = []
        for candidate in candidates:
            dev = {
                scenario.name: v3.metrics(
                    v3.subset(all_trades[scenario.name][candidate.candidate_id], splits["DEVELOPMENT"])
                )
                for scenario in base.SCENARIOS
            }
            rows.append({
                "candidate": asdict(candidate),
                "development": dev,
                "score": v3.score(dev["FORWARD_MEDIAN"], dev["NORMAL"], dev["SEVERE"]),
            })
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 4]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: v3.metrics(
                v3.subset(all_trades[scenario.name][winner_id], splits["VALIDATION"])
            )
            for scenario in base.SCENARIOS
        }
        families[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": v3.validation_pass(validation),
        }

    passing = [item["winnerId"] for item in families.values() if item["validationPass"]]
    options = []
    for candidate_id in passing:
        validation = {
            scenario.name: v3.metrics(
                v3.subset(all_trades[scenario.name][candidate_id], splits["VALIDATION"])
            )
            for scenario in base.SCENARIOS
        }
        options.append({
            "portfolioId": candidate_id,
            "members": [candidate_id],
            "validation": validation,
            "validationScore": v3.score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]),
        })
    if len(passing) >= 2:
        validation = {}
        for scenario in base.SCENARIOS:
            validation[scenario.name] = v3.metrics(
                v3.subset(v3.combine(all_trades[scenario.name], passing), splits["VALIDATION"])
            )
        options.append({
            "portfolioId": "VALIDATION_SELECTED_SWING_ENSEMBLE",
            "members": sorted(passing),
            "validation": validation,
            "validationScore": v3.score(validation["FORWARD_MEDIAN"], validation["NORMAL"], validation["SEVERE"]),
        })

    selected_option = max(options, key=lambda item: (item["validationScore"], item["portfolioId"])) if options else None
    selected = None
    if selected_option:
        selected = {
            "portfolioId": selected_option["portfolioId"],
            "members": selected_option["members"],
            "validation": selected_option["validation"],
            "scenarios": {},
        }
        for scenario in base.SCENARIOS:
            trades = (
                all_trades[scenario.name][selected_option["members"][0]]
                if len(selected_option["members"]) == 1
                else v3.combine(all_trades[scenario.name], selected_option["members"])
            )
            selected["scenarios"][scenario.name] = {
                "full": v3.metrics(trades),
                "development": v3.metrics(v3.subset(trades, splits["DEVELOPMENT"])),
                "validation": v3.metrics(v3.subset(trades, splits["VALIDATION"])),
                "holdout": v3.metrics(v3.subset(trades, splits["HOLDOUT"])),
                "removals": v3.removals(trades),
                "trades": trades,
            }
        selected["holdoutPass"] = v3.holdout_pass({
            name: item["holdout"] for name, item in selected["scenarios"].items()
        })
        normal = selected["scenarios"]["NORMAL"]["full"]
        severe = selected["scenarios"]["SEVERE"]["full"]
        selected["cryptoLikeHistorical"] = bool(
            selected["holdoutPass"]
            and normal["compoundedReturnPct"] >= 50
            and normal["cagrPct"] >= 50
            and severe["compoundedReturnPct"] > 0
            and normal["maxDrawdownPct"] >= -35
        )

    if selected and selected["cryptoLikeHistorical"]:
        status = "CRYPTO_LIKE_SWING_EDGE_FOUND_SHADOW_ONLY"
    elif selected and selected["holdoutPass"]:
        status = "ROBUST_POSITIVE_SWING_EDGE_FOUND_SHADOW_ONLY"
    elif passing:
        status = "SWING_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_SWING_FAMILY"

    return v3.rounded({
        "version": "3B",
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(v3.CANDIDATES),
        "familyCount": len(set(candidate.family for candidate in v3.CANDIDATES)),
        "dataWindow": {"startUtc": base.START_UTC.isoformat(), "endUtc": base.END_UTC.isoformat()},
        "eligibility": {
            "minimumSymbolsWithHistory": 8,
            "minimumCompletedSessionsPerSymbol": 61,
            "eligibleDays": len(eligible_days),
            "firstEligibleDay": eligible_days[0],
            "lastEligibleDay": eligible_days[-1],
        },
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "portfolioOptions": options,
        "selected": selected,
        "classificationLimit": "The historical date range was already inspected by prior stock experiments. Any lead is reused historical evidence, not an independent holdout.",
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
        },
        "limitations": [
            "The corrected split begins only after at least eight symbols each have 61 completed regular sessions.",
            "Regular-session daily OHLC is used while multi-day returns include close-to-next-open gaps.",
            "Off-session Spread, Slippage and stop execution are represented only by cost and stop-fill stress.",
            "Current-listing survivorship bias and uneven symbol history remain.",
            "No positive result can be called independent Holdout evidence after earlier stock research inspected the same dates.",
        ],
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-swing-tournament-v3b.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Swing Tournament V3B — Corrected History Eligibility",
        "",
        f"- Status: **{result['status']}**",
        f"- Eligible window: {result['eligibility']['firstEligibleDay']}–{result['eligibility']['lastEligibleDay']}",
        f"- Eligible days: {result['eligibility']['eligibleDays']}",
        f"- Validation passing: {', '.join(result['validationPassingWinnerIds']) if result['validationPassingWinnerIds'] else 'NONE'}",
        "- Production / LIVE / VPS / orders changed: **NO**",
        "",
        "| Family | Winner | Dev trades | Dev median | Dev severe | Validation median | Validation severe | Pass |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for family, item in result["families"].items():
        winner = next(
            row for row in item["developmentCandidates"]
            if row["candidate"]["candidate_id"] == item["winnerId"]
        )
        lines.append(
            f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['trades']} | "
            f"{winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{winner['development']['SEVERE']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
            f"{item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | "
            f"{'YES' if item['validationPass'] else 'NO'} |"
        )
    selected = result.get("selected")
    if selected:
        lines.extend([
            "",
            "## Selected reused-historical test",
            "",
            f"Portfolio: **{selected['portfolioId']}**",
            f"Holdout pass: **{'YES' if selected['holdoutPass'] else 'NO'}**",
            f"Crypto-like threshold: **{'YES' if selected['cryptoLikeHistorical'] else 'NO'}**",
            "",
            "| Scenario | Full | CAGR | PF | DD | Holdout | Holdout PF | Trades |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ])
        for name in ("FORWARD_MEDIAN", "NORMAL", "FORWARD_P95", "SEVERE"):
            item = selected["scenarios"][name]
            lines.append(
                f"| {name} | {item['full']['compoundedReturnPct']}% | {item['full']['cagrPct']}% | "
                f"{item['full']['profitFactor']} | {item['full']['maxDrawdownPct']}% | "
                f"{item['holdout']['compoundedReturnPct']}% | {item['holdout']['profitFactor']} | "
                f"{item['full']['trades']} |"
            )
    (output_dir / "v96-stock-swing-tournament-v3b.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(v3.CANDIDATES) == 27
    assert len(set(candidate.family for candidate in v3.CANDIDATES)) == 9
    sample = {
        "A": {f"2026-01-{day:02d}": v3.DailyBar(f"2026-01-{day:02d}", 1, 1, 1, 1, 1, 1) for day in range(1, 32)}
    }
    assert common_history_days(sample, minimum_symbols=1, minimum_sessions=10)[0] == "2026-01-10"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-stock-intraday-theme-flow")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-swing-tournament-v3b")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock swing tournament V3B self-test: PASS")
        return 0
    result = analyze(Path(args.cache_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "eligibility": result["eligibility"],
        "validationPassingWinnerIds": result["validationPassingWinnerIds"],
        "selected": result.get("selected", {}).get("portfolioId") if result.get("selected") else None,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
