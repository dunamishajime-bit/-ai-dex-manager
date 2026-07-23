from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import statistics
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
STRATEGY_ID = "V96_STOCK_BASIS_MATURE_V9"
SYMBOLS = ("AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT")
INTERVAL = "30m"
INTERVAL_MS = 30 * 60 * 1000
SIGNAL_MINUTE = 600
ENTRY_MINUTE = 630
EXIT_MINUTE = 930


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_bps: float


CANDIDATES = tuple(
    [Candidate(f"TRADE_PAIR_{x}", "TRADE_INDEX_PAIR", x) for x in (5.0, 10.0, 20.0)]
    + [Candidate(f"MARK_PAIR_{x}", "MARK_INDEX_PAIR", x) for x in (3.0, 6.0, 12.0)]
    + [Candidate(f"FUND_FADE_{x}", "FUNDING_CONFIRMED_FADE", x) for x in (5.0, 10.0, 20.0)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def request_series(symbol: str, kind: str, cache_dir: Path) -> List[list]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-{kind}-{INTERVAL}-{base.START_UTC.date()}-{base.END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    endpoint = {
        "trade": "/fapi/v1/klines",
        "mark": "/fapi/v1/markPriceKlines",
        "index": "/fapi/v1/indexPriceKlines",
    }[kind]
    key = "pair" if kind == "index" else "symbol"
    cursor = int(base.START_UTC.timestamp() * 1000)
    end_ms = int(base.END_UTC.timestamp() * 1000)
    rows: List[list] = []
    while cursor < end_ms:
        payload = base.request_json(endpoint, {
            key: symbol,
            "interval": INTERVAL,
            "startTime": cursor,
            "endTime": end_ms - 1,
            "limit": 1500,
        })
        if not isinstance(payload, list) or not payload:
            break
        rows.extend(row for row in payload if isinstance(row, list) and len(row) >= 5)
        next_cursor = int(payload[-1][0]) + INTERVAL_MS
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(payload) < 1500:
            break
        time.sleep(0.04)
    dedup = {int(row[0]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def load_market(cache_dir: Path) -> Dict[str, Dict[str, List[list]]]:
    result = {symbol: {} for symbol in SYMBOLS}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(request_series, symbol, kind, cache_dir): (symbol, kind)
            for symbol in SYMBOLS for kind in ("trade", "mark", "index")
        }
        for future in concurrent.futures.as_completed(futures):
            symbol, kind = futures[future]
            result[symbol][kind] = future.result()
            print(f"loaded {kind} {symbol}: {len(result[symbol][kind])}")
    return result


def row_map(rows: Sequence[list]) -> Dict[int, list]:
    return {int(row[0]): row for row in rows if isinstance(row, list) and len(row) >= 5}


def local_parts(ts: int) -> Tuple[str, int, int]:
    local = dt.datetime.fromtimestamp(ts / 1000.0, tz=UTC).astimezone(NY)
    return local.date().isoformat(), local.hour * 60 + local.minute, local.weekday()


def build_days(
    market: Dict[str, Dict[str, List[list]]],
    funding_raw: Dict[str, List[dict]],
) -> Tuple[List[str], Dict[str, Dict[str, dict]], dict]:
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    per_symbol: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOLS:
        trade = row_map(market[symbol]["trade"])
        mark = row_map(market[symbol]["mark"])
        index = row_map(market[symbol]["index"])
        by_day: Dict[str, dict] = defaultdict(dict)
        for ts in sorted(set(trade) & set(mark) & set(index)):
            day, minute, weekday = local_parts(ts)
            if weekday >= 5 or minute not in {SIGNAL_MINUTE, ENTRY_MINUTE, EXIT_MINUTE}:
                continue
            tr, mk, ix = trade[ts], mark[ts], index[ts]
            values = {
                "ts": ts,
                "tradeOpen": finite(tr[1]),
                "tradeClose": finite(tr[4]),
                "markClose": finite(mk[4]),
                "indexClose": finite(ix[4]),
            }
            if min(values["tradeOpen"], values["tradeClose"], values["markClose"], values["indexClose"]) <= 0:
                continue
            by_day[day][minute] = values
        completed: Dict[str, dict] = {}
        for day, slots in by_day.items():
            if not all(minute in slots for minute in (SIGNAL_MINUTE, ENTRY_MINUTE, EXIT_MINUTE)):
                continue
            signal = slots[SIGNAL_MINUTE]
            entry = slots[ENTRY_MINUTE]
            exit_bar = slots[EXIT_MINUTE]
            fund = funding_mod.funding_snapshot(funding.get(symbol, []), signal["ts"] + INTERVAL_MS)
            completed[day] = {
                "symbol": symbol,
                "signalTs": signal["ts"],
                "entryTs": entry["ts"],
                "exitTs": exit_bar["ts"],
                "entry": entry["tradeOpen"],
                "exit": exit_bar["tradeOpen"],
                "tradeBasisBps": (signal["tradeClose"] / signal["indexClose"] - 1.0) * 10000.0,
                "markBasisBps": (signal["markClose"] / signal["indexClose"] - 1.0) * 10000.0,
                "fundingBps": None if fund is None else fund["latest"] * 10000.0,
                "fundingPoints": funding.get(symbol, []),
            }
        per_symbol[symbol] = completed
        diagnostics["symbols"][symbol] = {
            "tradeBars": len(trade), "markBars": len(mark), "indexBars": len(index), "completeDays": len(completed)
        }
    common = sorted(set.intersection(*(set(per_symbol[symbol]) for symbol in SYMBOLS)))
    return common, per_symbol, diagnostics


def trade_for(candidate: Candidate, day: str, data: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    states = [data[symbol][day] for symbol in SYMBOLS]
    if candidate.family in {"TRADE_INDEX_PAIR", "MARK_INDEX_PAIR"}:
        field = "tradeBasisBps" if candidate.family == "TRADE_INDEX_PAIR" else "markBasisBps"
        low = min(states, key=lambda row: row[field])
        high = max(states, key=lambda row: row[field])
        spread = high[field] - low[field]
        if spread < candidate.threshold_bps:
            return None
        legs = ((low, 1, 0.5), (high, -1, 0.5))
        detail = {"field": field, "spreadBps": spread, "low": low[field], "high": high[field]}
    else:
        eligible = [
            row for row in states
            if row["fundingBps"] is not None
            and abs(row["tradeBasisBps"]) >= candidate.threshold_bps
            and row["tradeBasisBps"] * row["fundingBps"] > 0
            and abs(row["fundingBps"]) >= 0.20
        ]
        if not eligible:
            return None
        selected = max(eligible, key=lambda row: abs(row["tradeBasisBps"]))
        side = 1 if selected["tradeBasisBps"] < 0 else -1
        legs = ((selected, side, 1.0),)
        detail = {"field": "tradeBasisBps", "basisBps": selected["tradeBasisBps"], "fundingBps": selected["fundingBps"]}
    price_return = 0.0
    funding_return = 0.0
    symbols = []
    for row, side, weight in legs:
        symbols.append(row["symbol"])
        price_return += weight * side * (row["exit"] / row["entry"] - 1.0)
        funding_return += weight * (-side) * funding_mod.funding_between(
            row["fundingPoints"], row["entryTs"], row["exitTs"]
        )
    return {
        "candidateId": candidate.candidate_id,
        "family": candidate.family,
        "entryDay": day,
        "exitDay": day,
        "symbols": symbols,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "detail": detail,
    }


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def pf(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def max_dd(values: Sequence[float]) -> float:
    equity = peak = 1.0
    result = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        result = min(result, equity / peak - 1.0)
    return result


def metrics(trades: Sequence[dict], scenario: base.CostScenario, scale: float = 1.0) -> dict:
    cost = 2.0 * scenario.turnover_bps / 10000.0
    values = [scale * (finite(trade["grossReturn"]) - cost) for trade in trades]
    wins = [value for value in values if value > 0]
    compounded = product(values)
    span = max(1.0 / 365.25, len({trade["exitDay"] for trade in trades}) / 252.0) if trades else 1.0
    return {
        "trades": len(trades),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / span) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": pf(values),
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_dd(values) * 100.0,
        "fundingSumPct": sum(finite(trade["fundingReturn"]) for trade in trades) * scale * 100.0,
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    return [trade for trade in trades if interval[0] <= trade["exitDay"] <= interval[1]]


def splits(days: Sequence[str]) -> dict:
    n = len(days)
    dev = max(1, int(n * 0.60))
    val = max(dev + 1, int(n * 0.80))
    return {
        "DEVELOPMENT": (days[0], days[dev - 1]),
        "VALIDATION": (days[dev], days[val - 1]),
        "HOLDOUT": (days[val], days[-1]),
    }


def score(result: dict) -> float:
    return (
        result["FORWARD_MEDIAN"]["compoundedReturnPct"]
        + 0.5 * result["NORMAL"]["compoundedReturnPct"]
        + 0.25 * result["SEVERE"]["compoundedReturnPct"]
        + 2.0 * ((result["FORWARD_MEDIAN"].get("profitFactor") or 0.0) - 1.0)
    )


def validation_pass(result: dict) -> bool:
    return bool(
        result["FORWARD_MEDIAN"]["trades"] >= 5
        and result["FORWARD_MEDIAN"]["compoundedReturnPct"] > 0
        and result["NORMAL"]["compoundedReturnPct"] > 0
        and result["SEVERE"]["compoundedReturnPct"] > 0
        and (result["FORWARD_MEDIAN"].get("profitFactor") or 0) > 1.05
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(market_cache: Path, funding_cache: Path) -> dict:
    market = load_market(market_cache)
    funding_raw = funding_mod.load_funding(funding_cache)
    days, data, diagnostics = build_days(market, funding_raw)
    if len(days) < 30:
        status = "INSUFFICIENT_ALIGNED_INDEX_HISTORY"
        return rounded({
            "version": 9, "strategyId": STRATEGY_ID, "status": status,
            "candidateCount": len(CANDIDATES), "familyCount": 3,
            "eligibleDays": len(days), "diagnostics": diagnostics,
            "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False},
        })
    split = splits(days)
    all_trades = {
        candidate.candidate_id: [
            trade for day in days if (trade := trade_for(candidate, day, data)) is not None
        ] for candidate in CANDIDATES
    }
    families = {}
    passing = []
    for family in sorted({candidate.family for candidate in CANDIDATES}):
        rows = []
        for candidate in [item for item in CANDIDATES if item.family == family]:
            development = {
                scenario.name: metrics(subset(all_trades[candidate.candidate_id], split["DEVELOPMENT"]), scenario)
                for scenario in base.SCENARIOS
            }
            rows.append({"candidate": asdict(candidate), "development": development, "score": score(development)})
        eligible = [row for row in rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
        winner = max(eligible or rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: metrics(subset(all_trades[winner_id], split["VALIDATION"]), scenario)
            for scenario in base.SCENARIOS
        }
        passed = validation_pass(validation)
        if passed:
            passing.append(winner_id)
        families[family] = {
            "developmentCandidates": rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": passed,
        }
    selected = None
    if passing:
        options = []
        for candidate_id in passing:
            validation = {
                scenario.name: metrics(subset(all_trades[candidate_id], split["VALIDATION"]), scenario)
                for scenario in base.SCENARIOS
            }
            options.append((score(validation), candidate_id, validation))
        _, candidate_id, validation = max(options)
        trades = all_trades[candidate_id]
        selected = {"candidateId": candidate_id, "validation": validation, "gross1": {}, "gross2Sensitivity": {}}
        for scenario in base.SCENARIOS:
            selected["gross1"][scenario.name] = {
                "full": metrics(trades, scenario),
                "development": metrics(subset(trades, split["DEVELOPMENT"]), scenario),
                "validation": metrics(subset(trades, split["VALIDATION"]), scenario),
                "holdout": metrics(subset(trades, split["HOLDOUT"]), scenario),
            }
            selected["gross2Sensitivity"][scenario.name] = {
                "full": metrics(trades, scenario, 2.0),
                "holdout": metrics(subset(trades, split["HOLDOUT"]), scenario, 2.0),
            }
        selected["holdoutPass"] = all(
            selected["gross1"][name]["holdout"]["trades"] >= 4
            and selected["gross1"][name]["holdout"]["compoundedReturnPct"] > 0
            for name in ("FORWARD_MEDIAN", "NORMAL", "SEVERE")
        )
        selected["cryptoLike"] = bool(
            selected["holdoutPass"]
            and selected["gross1"]["NORMAL"]["full"]["compoundedReturnPct"] >= 50
            and selected["gross1"]["NORMAL"]["full"]["cagrPct"] >= 50
            and selected["gross1"]["SEVERE"]["full"]["compoundedReturnPct"] > 0
        )
    if selected and selected["cryptoLike"]:
        status = "CRYPTO_LIKE_BASIS_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPass"]:
        status = "ROBUST_POSITIVE_BASIS_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "BASIS_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_BASIS_FAMILY"
    return rounded({
        "version": 9, "strategyId": STRATEGY_ID, "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES), "familyCount": 3,
        "universe": list(SYMBOLS),
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1], "interval": INTERVAL},
        "splits": split, "families": families,
        "validationPassingWinnerIds": passing, "selected": selected,
        "diagnostics": diagnostics,
        "selectionDiscipline": {"developmentSelectionOnly": True, "validationScreeningOnly": True, "holdoutRetuningAllowed": False},
        "limitations": [
            "Aster index is an oracle/reference index, not a directly traded cash-equity hedge.",
            "The final period overlaps previously inspected Stock history and is not an independent Holdout.",
            "Historical order-book and event gates are not reconstructed.",
            "Gross 2.0 is sensitivity only.",
        ],
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False, "liveChanged": False, "vpsChanged": False, "cryptoV96Changed": False},
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-basis-mature-v9.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Basis Mature V9", "", f"- Status: **{result['status']}**",
        f"- Candidates / families: {result.get('candidateCount')} / {result.get('familyCount')}",
        f"- Eligible days: {result.get('dataWindow', {}).get('eligibleDays', result.get('eligibleDays', 0))}",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    if result.get("families"):
        lines += ["", "| Family | Winner | Dev median | Dev severe | Validation median | Validation severe | Pass |", "| --- | --- | ---: | ---: | ---: | ---: | --- |"]
        for family, item in result["families"].items():
            winner = next(row for row in item["developmentCandidates"] if row["candidate"]["candidate_id"] == item["winnerId"])
            lines.append(
                f"| {family} | {item['winnerId']} | {winner['development']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
                f"{winner['development']['SEVERE']['compoundedReturnPct']}% | {item['winnerValidation']['FORWARD_MEDIAN']['compoundedReturnPct']}% | "
                f"{item['winnerValidation']['SEVERE']['compoundedReturnPct']}% | {'YES' if item['validationPass'] else 'NO'} |"
            )
    if result.get("selected"):
        selected = result["selected"]
        lines += ["", "## Selected candidate", "", f"- Candidate: **{selected['candidateId']}**", f"- Holdout pass: **{'YES' if selected['holdoutPass'] else 'NO'}**", f"- Crypto-like: **{'YES' if selected['cryptoLike'] else 'NO'}**"]
    (output_dir / "v96-stock-basis-mature-v9.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 9
    assert len({candidate.family for candidate in CANDIDATES}) == 3
    assert abs(product([0.10, -0.05]) - 0.045) < 1e-12
    print("V96 Stock Basis Mature V9 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-basis-mature-v9")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.market_cache_dir), Path(args.funding_cache_dir))
    write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
