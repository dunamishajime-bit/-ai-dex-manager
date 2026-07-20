from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_aster_v35_core_only_v37_runner as aster

START = v4.START_2023
END = v4.END
HOUR = v4.HOUR
NORMAL_TURNOVER_BPS = 10.0
SEVERE_TURNOVER_BPS = 50.0
SEVERE_ADVERSE_BPS = 3.0


@dataclass(frozen=True)
class Candidate:
    symbol: str
    slow_bars: int
    momentum_bars: int
    minimum_momentum_pct: float
    gross: float

    @property
    def candidate_id(self) -> str:
        return (
            f"{self.symbol}_SMA{self.slow_bars}_MOM{self.momentum_bars}"
            f"_MIN{self.minimum_momentum_pct:g}_G{self.gross:g}"
        ).replace(".", "p")


def candidate_space(symbol: str) -> List[Candidate]:
    return [
        Candidate(symbol, slow, momentum, minimum, gross)
        for slow in (120, 180, 240)
        for momentum in (20, 40, 60)
        for minimum in (0.0, 3.0, 6.0)
        for gross in (0.25, 0.40, 0.60)
    ]


def funding_buckets(points: List[dict]) -> Dict[int, float]:
    buckets: Dict[int, float] = {}
    width = 12 * HOUR
    for point in points:
        ts = int(point["ts"]) // width * width
        buckets[ts] = buckets.get(ts, 0.0) + float(point["rate"])
    return buckets


def sma(values: List[float], index: int, length: int) -> Optional[float]:
    if index - length + 1 < 0:
        return None
    return statistics.fmean(values[index - length + 1:index + 1])


def momentum(values: List[float], index: int, length: int) -> Optional[float]:
    prior = index - length
    if prior < 0 or values[prior] <= 0:
        return None
    return (values[index] / values[prior] - 1.0) * 100.0


def run_candidate(
    candidate: Candidate,
    bars: List[dict],
    funding: Dict[int, float],
    severe: bool,
) -> List[dict]:
    close = [float(row["close"]) for row in bars]
    rows: List[dict] = []
    previous_target = 0.0
    turnover_bps = SEVERE_TURNOVER_BPS if severe else NORMAL_TURNOVER_BPS
    for index, bar in enumerate(bars):
        ts = int(bar["ts"])
        target = 0.0
        source = index - 1
        if source >= 0:
            average = sma(close, source, candidate.slow_bars)
            mom = momentum(close, source, candidate.momentum_bars)
            if (
                average is not None
                and mom is not None
                and close[source] > average
                and mom >= candidate.minimum_momentum_pct
            ):
                target = candidate.gross
        turnover = abs(target - previous_target)
        previous_target = target
        gross_return = target * (float(bar["close"]) / float(bar["open"]) - 1.0)
        funding_cost = target * funding.get(ts, 0.0)
        cost = turnover * turnover_bps / 10_000.0
        adverse = target * SEVERE_ADVERSE_BPS / 10_000.0 if severe else 0.0
        rows.append({
            "ts": ts,
            "return": gross_return - funding_cost - cost - adverse,
            "gross": target,
        })
    return rows


def compound(values: List[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return (equity - 1.0) * 100.0


def metrics(rows: List[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    equity = peak = 1.0
    max_dd = 0.0
    monthly: Dict[str, List[float]] = {}
    for row in active:
        value = float(row["return"])
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        monthly.setdefault(month, []).append(value)
    monthly_returns = [compound(values) / 100.0 for values in monthly.values()]
    gains = sum(value for value in monthly_returns if value > 0)
    losses = abs(sum(value for value in monthly_returns if value < 0))
    years = max(0.25, (end - start) / (365.25 * v4.DAY))
    annual: Dict[str, float] = {}
    for year in range(2023, 2027):
        values = [float(row["return"]) for row in active if dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=dt.timezone.utc).year == year]
        if values:
            annual[str(year)] = compound(values)
    return {
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "monthlyProfitFactor": gains / losses if losses > 0 else 999.0 if gains > 0 else None,
        "positiveMonthRatePct": sum(value > 0 for value in monthly_returns) / len(monthly_returns) * 100.0 if monthly_returns else None,
        "averageGross": statistics.fmean(float(row["gross"]) for row in active) if active else 0.0,
        "maxGross": max((float(row["gross"]) for row in active), default=0.0),
        "annualReturnsPct": annual,
        "bars": len(active),
    }


def fold_bounds(times: List[int], count: int = 5) -> List[Tuple[int, int]]:
    start = max(START, times[0])
    end = min(END, times[-1] + 12 * HOUR)
    span = end - start
    return [(start + span * index // count, start + span * (index + 1) // count) for index in range(count)]


def select_for_outer(
    candidates: List[Candidate],
    normal: Dict[str, List[dict]],
    severe: Dict[str, List[dict]],
    folds: List[Tuple[int, int]],
    outer_index: int,
) -> Tuple[Optional[Candidate], int]:
    train_start = folds[0][0]
    train_end = folds[outer_index - 1][0]
    validation_start, validation_end = folds[outer_index - 1]
    eligible = []
    for candidate in candidates:
        key = candidate.candidate_id
        train = metrics(normal[key], train_start, train_end)
        train_severe = metrics(severe[key], train_start, train_end)
        validation = metrics(normal[key], validation_start, validation_end)
        validation_severe = metrics(severe[key], validation_start, validation_end)
        if (
            train["compoundedReturnPct"] > 0
            and train_severe["compoundedReturnPct"] > 0
            and validation["compoundedReturnPct"] >= 0
            and validation_severe["compoundedReturnPct"] >= 0
            and (train_severe["monthlyProfitFactor"] or 0) >= 1.05
        ):
            score = (
                validation_severe["compoundedReturnPct"],
                validation["compoundedReturnPct"],
                train_severe["compoundedReturnPct"],
                -candidate.gross,
                -candidate.slow_bars,
            )
            eligible.append((score, candidate))
    eligible.sort(key=lambda item: item[0], reverse=True)
    return (eligible[0][1] if eligible else None, len(eligible))


def stitch(
    selections: List[dict],
    normal: Dict[str, List[dict]],
    severe: Dict[str, List[dict]],
) -> Tuple[List[dict], List[dict]]:
    normal_rows: List[dict] = []
    severe_rows: List[dict] = []
    for item in selections:
        if not item["candidateId"]:
            continue
        start, end = item["testStart"], item["testEnd"]
        normal_rows.extend(row for row in normal[item["candidateId"]] if start <= int(row["ts"]) < end)
        severe_rows.extend(row for row in severe[item["candidateId"]] if start <= int(row["ts"]) < end)
    return normal_rows, severe_rows


def combine_rows(left: List[dict], right: List[dict]) -> List[dict]:
    left_map = {int(row["ts"]): row for row in left}
    right_map = {int(row["ts"]): row for row in right}
    result = []
    for ts in sorted(set(left_map) | set(right_map)):
        a = left_map.get(ts, {"return": 0.0, "gross": 0.0})
        b = right_map.get(ts, {"return": 0.0, "gross": 0.0})
        raw_gross = float(a["gross"]) + float(b["gross"])
        scale = min(1.0, 1.20 / raw_gross) if raw_gross > 0 else 1.0
        result.append({
            "ts": ts,
            "return": (float(a["return"]) + float(b["return"])) * scale,
            "gross": raw_gross * scale,
        })
    return result


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = {
        symbol: {"candles": aster.fetch_candles(symbol), "funding": aster.fetch_funding(symbol)}
        for symbol in ("BTC", "ETH")
    }
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in raw}
    funding = {symbol: funding_buckets(raw[symbol]["funding"]) for symbol in raw}
    common_times = sorted(set(int(row["ts"]) for row in bars["BTC"]) & set(int(row["ts"]) for row in bars["ETH"]))
    folds = fold_bounds(common_times, 5)

    asset_results = {}
    stitched_rows = {}
    for symbol in ("BTC", "ETH"):
        candidates = candidate_space(symbol)
        normal = {candidate.candidate_id: run_candidate(candidate, bars[symbol], funding[symbol], False) for candidate in candidates}
        severe = {candidate.candidate_id: run_candidate(candidate, bars[symbol], funding[symbol], True) for candidate in candidates}
        selections = []
        for outer in (2, 3, 4):
            selected, eligible = select_for_outer(candidates, normal, severe, folds, outer)
            test_start, test_end = folds[outer]
            if selected:
                normal_test = metrics(normal[selected.candidate_id], test_start, test_end)
                severe_test = metrics(severe[selected.candidate_id], test_start, test_end)
                candidate_id = selected.candidate_id
            else:
                normal_test = metrics([], test_start, test_end)
                severe_test = metrics([], test_start, test_end)
                candidate_id = None
            selections.append({
                "outerFold": outer,
                "candidateId": candidate_id,
                "eligibleCandidates": eligible,
                "testStart": test_start,
                "testEnd": test_end,
                "normal": normal_test,
                "severe": severe_test,
            })
        stitched_normal, stitched_severe = stitch(selections, normal, severe)
        stitched_rows[symbol] = {"normal": stitched_normal, "severe": stitched_severe}
        oos_start, oos_end = folds[2][0], folds[4][1]
        asset_results[symbol] = {
            "candidateCount": len(candidates),
            "selections": selections,
            "stitchedOos": metrics(stitched_normal, oos_start, oos_end),
            "stitchedOosSevere": metrics(stitched_severe, oos_start, oos_end),
        }

    combined_normal = combine_rows(stitched_rows["BTC"]["normal"], stitched_rows["ETH"]["normal"])
    combined_severe = combine_rows(stitched_rows["BTC"]["severe"], stitched_rows["ETH"]["severe"])
    oos_start, oos_end = folds[2][0], folds[4][1]
    combined = {
        "stitchedOos": metrics(combined_normal, oos_start, oos_end),
        "stitchedOosSevere": metrics(combined_severe, oos_start, oos_end),
    }
    positive_outer = sum(
        item["normal"]["compoundedReturnPct"] > 0 and item["severe"]["compoundedReturnPct"] > 0
        for symbol in ("BTC", "ETH")
        for item in asset_results[symbol]["selections"]
    )
    status = "MAJOR_CORE_BASELINE_PASS" if (
        combined["stitchedOos"]["compoundedReturnPct"] > 0
        and combined["stitchedOosSevere"]["compoundedReturnPct"] > 0
        and positive_outer >= 4
    ) else "NO_STABLE_MAJOR_CORE_BASELINE"
    result = rounded({
        "version": 73,
        "strategyId": "MAJOR_CORE_BTC_ETH_V73",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "execution": "Previous completed 12h bar signal, next 12h open-to-close return",
        "candidateDesign": {
            "perAssetCandidates": len(candidate_space("BTC")),
            "slowBars": [120, 180, 240],
            "momentumBars": [20, 40, 60],
            "minimumMomentumPct": [0, 3, 6],
            "gross": [0.25, 0.40, 0.60],
            "combinedGrossCap": 1.20,
        },
        "folds": [
            {
                "start": dt.datetime.fromtimestamp(start / 1000, tz=dt.timezone.utc).isoformat(),
                "end": dt.datetime.fromtimestamp(end / 1000, tz=dt.timezone.utc).isoformat(),
            }
            for start, end in folds
        ],
        "assets": asset_results,
        "combined": combined,
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "This is a constrained baseline, not a final optimized Core.",
            "Aster history is reused research data and not pristine future evidence.",
            "Only simple long/cash trend candidates are tested in V73.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "major-core-btc-eth-v73.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# Major Core BTC / ETH V73", "",
        f"- Status: **{status}**",
        "- PENGU: excluded from selection and results", "",
    ]
    for symbol in ("BTC", "ETH"):
        item = result["assets"][symbol]
        report.extend([
            f"## {symbol}",
            f"- Stitched OOS: {item['stitchedOos']['compoundedReturnPct']}% / CAGR {item['stitchedOos']['cagrPct']}% / DD {item['stitchedOos']['maxDrawdownPct']}% / monthly PF {item['stitchedOos']['monthlyProfitFactor']}",
            f"- Stitched OOS Severe: {item['stitchedOosSevere']['compoundedReturnPct']}% / DD {item['stitchedOosSevere']['maxDrawdownPct']}%",
            "",
        ])
    report.extend([
        "## BTC + ETH", 
        f"- Stitched OOS: {result['combined']['stitchedOos']['compoundedReturnPct']}% / CAGR {result['combined']['stitchedOos']['cagrPct']}% / DD {result['combined']['stitchedOos']['maxDrawdownPct']}% / monthly PF {result['combined']['stitchedOos']['monthlyProfitFactor']}",
        f"- Stitched OOS Severe: {result['combined']['stitchedOosSevere']['compoundedReturnPct']}% / DD {result['combined']['stitchedOosSevere']['maxDrawdownPct']}%",
        "", "- Production / LIVE / VPS changed: **NO**",
    ])
    (state_dir / "major-core-btc-eth-v73.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
