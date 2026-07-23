from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

import v96_stock_basis_mature_v9 as v9
import v96_stock_funding_carry_tournament_v4 as funding_mod
import v96_stock_intraday_theme_flow_backtest as base

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
STRATEGY_ID = "V96_STOCK_CASH_PERP_BASIS_V10"
SYMBOL_MAP = {
    "AMZNUSDT": "AMZN",
    "METAUSDT": "META",
    "MSFTUSDT": "MSFT",
    "NVDAUSDT": "NVDA",
    "TSLAUSDT": "TSLA",
}
SIGNAL_CASH_MINUTE = 570   # 09:30-10:30 hourly bar close
ENTRY_CASH_MINUTE = 630    # 10:30 hourly bar open
EXIT_CASH_MINUTE = 870     # 14:30-15:30 hourly bar close
SIGNAL_PERP_MINUTE = 600   # 10:00-10:30 30m bar close
ENTRY_PERP_MINUTE = 630
EXIT_PERP_MINUTE = 930
CASH_ONE_WAY_BPS = {
    "FORWARD_MEDIAN": 2.0,
    "NORMAL": 5.0,
    "FORWARD_P95": 10.0,
    "SEVERE": 20.0,
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold_bps: float


CANDIDATES = tuple(
    [Candidate(f"PERP_FADE_{value}", "PERP_ONLY_BASIS_FADE", value) for value in (10.0, 25.0, 50.0)]
    + [Candidate(f"CASH_HEDGE_{value}", "CASH_HEDGED_CONVERGENCE", value) for value in (10.0, 25.0, 50.0)]
    + [Candidate(f"FUND_HEDGE_{value}", "FUNDING_CONFIRMED_CASH_HEDGE", value) for value in (10.0, 25.0, 50.0)]
    + [Candidate(f"XS_PERP_PAIR_{value}", "CROSS_SECTIONAL_PERP_PAIR", value) for value in (10.0, 25.0, 50.0)]
)


def finite(value: object, fallback: float = 0.0) -> float:
    return base.finite(value, fallback)


def fetch_yahoo_chart(ticker: str, cache_dir: Path) -> dict:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{ticker}-60m-{base.START_UTC.date()}-{base.END_UTC.date()}.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return payload
    params = urllib.parse.urlencode({
        "period1": int(base.START_UTC.timestamp()),
        "period2": int(base.END_UTC.timestamp()),
        "interval": "60m",
        "includePrePost": "false",
        "events": "div,splits",
    })
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{urllib.parse.quote(ticker)}?{params}"
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0 DisDex-Research/1.0",
                    "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=35) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
                return payload
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
                errors.append(f"{host}:{type(exc).__name__}:{exc}")
                time.sleep(min(8.0, 0.8 * (2 ** attempt)))
    payload = {"chart": {"result": None, "error": {"description": "; ".join(errors[-6:])}}}
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return payload


def parse_cash(payload: dict) -> Tuple[Dict[str, dict], dict]:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(results, list) or not results:
        error = chart.get("error") if isinstance(chart, dict) else None
        return {}, {"error": error, "bars": 0, "completeDays": 0}
    root = results[0]
    timestamps = root.get("timestamp") or []
    indicators = root.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    opens = quote.get("open") or []
    closes = quote.get("close") or []
    by_day: Dict[str, dict] = defaultdict(dict)
    valid_bars = 0
    for index, raw_ts in enumerate(timestamps):
        if index >= len(opens) or index >= len(closes):
            continue
        open_price = finite(opens[index], math.nan)
        close_price = finite(closes[index], math.nan)
        if not math.isfinite(open_price) or not math.isfinite(close_price) or min(open_price, close_price) <= 0:
            continue
        ts_ms = int(raw_ts) * 1000
        local = dt.datetime.fromtimestamp(raw_ts, tz=UTC).astimezone(NY)
        minute = local.hour * 60 + local.minute
        if local.weekday() >= 5 or minute not in {SIGNAL_CASH_MINUTE, ENTRY_CASH_MINUTE, EXIT_CASH_MINUTE}:
            continue
        by_day[local.date().isoformat()][minute] = {
            "ts": ts_ms,
            "open": open_price,
            "close": close_price,
        }
        valid_bars += 1
    completed = {}
    for day, slots in by_day.items():
        if all(minute in slots for minute in (SIGNAL_CASH_MINUTE, ENTRY_CASH_MINUTE, EXIT_CASH_MINUTE)):
            completed[day] = {
                "signal": slots[SIGNAL_CASH_MINUTE]["close"],
                "signalTs": slots[SIGNAL_CASH_MINUTE]["ts"] + 60 * 60 * 1000,
                "entry": slots[ENTRY_CASH_MINUTE]["open"],
                "entryTs": slots[ENTRY_CASH_MINUTE]["ts"],
                "exit": slots[EXIT_CASH_MINUTE]["close"],
                "exitTs": slots[EXIT_CASH_MINUTE]["ts"] + 60 * 60 * 1000,
            }
    return completed, {
        "bars": valid_bars,
        "completeDays": len(completed),
        "firstDay": min(completed) if completed else None,
        "lastDay": max(completed) if completed else None,
        "exchangeTimezone": (root.get("meta") or {}).get("exchangeTimezoneName"),
        "gmtoffset": (root.get("meta") or {}).get("gmtoffset"),
        "events": sorted((root.get("events") or {}).keys()),
    }


def load_cash(cache_dir: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    data: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"source": "Yahoo Finance public chart response", "symbols": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(fetch_yahoo_chart, ticker, cache_dir): (symbol, ticker)
            for symbol, ticker in SYMBOL_MAP.items()
        }
        for future in concurrent.futures.as_completed(futures):
            symbol, ticker = futures[future]
            rows, detail = parse_cash(future.result())
            data[symbol] = rows
            diagnostics["symbols"][symbol] = {"ticker": ticker, **detail}
            print(f"loaded cash {ticker}: {len(rows)} complete days")
    return dict(sorted(data.items())), diagnostics


def load_perp(market_cache: Path, funding_cache: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    market = v9.load_market(market_cache)
    funding_raw = funding_mod.load_funding(funding_cache)
    funding = {symbol: funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    result: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOL_MAP:
        trade = v9.row_map(market[symbol]["trade"])
        by_day: Dict[str, dict] = defaultdict(dict)
        for ts, row in trade.items():
            day, minute, weekday = v9.local_parts(ts)
            if weekday >= 5 or minute not in {SIGNAL_PERP_MINUTE, ENTRY_PERP_MINUTE, EXIT_PERP_MINUTE}:
                continue
            open_price = finite(row[1])
            close_price = finite(row[4])
            if min(open_price, close_price) <= 0:
                continue
            by_day[day][minute] = {"ts": ts, "open": open_price, "close": close_price}
        completed = {}
        for day, slots in by_day.items():
            if not all(minute in slots for minute in (SIGNAL_PERP_MINUTE, ENTRY_PERP_MINUTE, EXIT_PERP_MINUTE)):
                continue
            signal = slots[SIGNAL_PERP_MINUTE]
            entry = slots[ENTRY_PERP_MINUTE]
            exit_bar = slots[EXIT_PERP_MINUTE]
            fund = funding_mod.funding_snapshot(funding.get(symbol, []), signal["ts"] + 30 * 60 * 1000)
            completed[day] = {
                "signal": signal["close"],
                "signalTs": signal["ts"] + 30 * 60 * 1000,
                "entry": entry["open"],
                "entryTs": entry["ts"],
                "exit": exit_bar["open"],
                "exitTs": exit_bar["ts"],
                "fundingBps": None if fund is None else fund["latest"] * 10000.0,
                "fundingPoints": funding.get(symbol, []),
            }
        result[symbol] = completed
        diagnostics["symbols"][symbol] = {
            "tradeBars": len(trade),
            "fundingRows": len(funding.get(symbol, [])),
            "completeDays": len(completed),
        }
    return result, diagnostics


def align(cash: Dict[str, Dict[str, dict]], perp: Dict[str, Dict[str, dict]]) -> Tuple[List[str], Dict[str, Dict[str, dict]], dict]:
    aligned: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"symbols": {}}
    for symbol in SYMBOL_MAP:
        days = sorted(set(cash.get(symbol, {})) & set(perp.get(symbol, {})))
        rows = {}
        rejected_clock = 0
        for day in days:
            c = cash[symbol][day]
            p = perp[symbol][day]
            if abs(c["signalTs"] - p["signalTs"]) > 5 * 60 * 1000 or abs(c["entryTs"] - p["entryTs"]) > 5 * 60 * 1000:
                rejected_clock += 1
                continue
            rows[day] = {
                "symbol": symbol,
                "cash": c,
                "perp": p,
                "basisBps": (p["signal"] / c["signal"] - 1.0) * 10000.0,
            }
        aligned[symbol] = rows
        diagnostics["symbols"][symbol] = {
            "commonDays": len(days),
            "alignedDays": len(rows),
            "clockRejected": rejected_clock,
            "firstDay": min(rows) if rows else None,
            "lastDay": max(rows) if rows else None,
        }
    common = sorted(set.intersection(*(set(aligned[symbol]) for symbol in SYMBOL_MAP)))
    return common, aligned, diagnostics


def funding_pnl(row: dict, side: int, weight: float) -> float:
    perp = row["perp"]
    total_rate = funding_mod.funding_between(perp["fundingPoints"], perp["entryTs"], perp["exitTs"])
    return weight * (-side) * total_rate


def candidate_trade(candidate: Candidate, day: str, aligned: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    states = [aligned[symbol][day] for symbol in SYMBOL_MAP]
    threshold = candidate.threshold_bps
    legs = []
    execution_mode = "ASTER_PERP_ONLY"
    if candidate.family == "CROSS_SECTIONAL_PERP_PAIR":
        low = min(states, key=lambda row: row["basisBps"])
        high = max(states, key=lambda row: row["basisBps"])
        spread = high["basisBps"] - low["basisBps"]
        if spread < threshold:
            return None
        legs = [(low, 1, 0.5, 0.0), (high, -1, 0.5, 0.0)]
        detail = {"spreadBps": spread, "lowBasisBps": low["basisBps"], "highBasisBps": high["basisBps"]}
    else:
        eligible = [row for row in states if abs(row["basisBps"]) >= threshold]
        if candidate.family == "FUNDING_CONFIRMED_CASH_HEDGE":
            eligible = [
                row for row in eligible
                if row["perp"]["fundingBps"] is not None
                and row["basisBps"] * row["perp"]["fundingBps"] > 0
                and abs(row["perp"]["fundingBps"]) >= 0.20
            ]
        if not eligible:
            return None
        selected = max(eligible, key=lambda row: abs(row["basisBps"]))
        perp_side = 1 if selected["basisBps"] < 0 else -1
        if candidate.family == "PERP_ONLY_BASIS_FADE":
            legs = [(selected, perp_side, 1.0, 0.0)]
        else:
            execution_mode = "THEORETICAL_CASH_AND_PERP_HEDGE"
            legs = [(selected, perp_side, 0.5, 0.5)]
        detail = {
            "basisBps": selected["basisBps"],
            "fundingBps": selected["perp"]["fundingBps"],
        }
    perp_return = 0.0
    cash_return = 0.0
    funding_return = 0.0
    symbols = []
    cash_gross = 0.0
    perp_gross = 0.0
    for row, perp_side, perp_weight, cash_weight in legs:
        symbols.append(row["symbol"])
        p = row["perp"]
        c = row["cash"]
        perp_return += perp_weight * perp_side * (p["exit"] / p["entry"] - 1.0)
        funding_return += funding_pnl(row, perp_side, perp_weight)
        perp_gross += perp_weight
        if cash_weight:
            cash_side = -perp_side
            cash_return += cash_weight * cash_side * (c["exit"] / c["entry"] - 1.0)
            cash_gross += cash_weight
    return {
        "candidateId": candidate.candidate_id,
        "family": candidate.family,
        "entryDay": day,
        "exitDay": day,
        "symbols": symbols,
        "executionMode": execution_mode,
        "perpGross": perp_gross,
        "cashGross": cash_gross,
        "perpReturn": perp_return,
        "cashReturn": cash_return,
        "fundingReturn": funding_return,
        "grossReturn": perp_return + cash_return + funding_return,
        "detail": detail,
    }


def product(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 1.0
    result = 0.0
    for value in values:
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        result = min(result, equity / peak - 1.0)
    return result


def metrics(trades: Sequence[dict], scenario: base.CostScenario, multiplier: float = 1.0) -> dict:
    cash_bps = CASH_ONE_WAY_BPS[scenario.name]
    values = []
    for trade in trades:
        perp_cost = 2.0 * trade["perpGross"] * scenario.turnover_bps / 10000.0
        cash_cost = 2.0 * trade["cashGross"] * cash_bps / 10000.0
        values.append(multiplier * (trade["grossReturn"] - perp_cost - cash_cost))
    compounded = product(values)
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    if trades:
        start = dt.date.fromisoformat(trades[0]["entryDay"])
        end = dt.date.fromisoformat(trades[-1]["exitDay"])
        years = max(1.0 / 365.25, (end - start).days / 365.25)
    else:
        years = 1.0
    return {
        "trades": len(values),
        "compoundedReturnPct": compounded * 100.0,
        "cagrPct": ((1.0 + compounded) ** (1.0 / years) - 1.0) * 100.0 if compounded > -1 else -100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": len(wins) / len(values) * 100.0 if values else 0.0,
        "averageTradePct": statistics.mean(values) * 100.0 if values else 0.0,
        "maxDrawdownPct": max_drawdown(values) * 100.0,
        "perpReturnSumPct": sum(trade["perpReturn"] for trade in trades) * multiplier * 100.0,
        "cashReturnSumPct": sum(trade["cashReturn"] for trade in trades) * multiplier * 100.0,
        "fundingReturnSumPct": sum(trade["fundingReturn"] for trade in trades) * multiplier * 100.0,
    }


def subset(trades: Sequence[dict], interval: Tuple[str, str]) -> List[dict]:
    return [trade for trade in trades if interval[0] <= trade["exitDay"] <= interval[1]]


def chronological_splits(days: Sequence[str]) -> dict:
    n = len(days)
    dev_end = max(1, int(n * 0.60))
    val_end = max(dev_end + 1, int(n * 0.80))
    return {
        "DEVELOPMENT": (days[0], days[dev_end - 1]),
        "VALIDATION": (days[dev_end], days[val_end - 1]),
        "HOLDOUT": (days[val_end], days[-1]),
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
        and (result["FORWARD_MEDIAN"].get("profitFactor") or 0.0) > 1.05
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def analyze(cash_cache: Path, perp_cache: Path, funding_cache: Path) -> dict:
    cash, cash_diagnostics = load_cash(cash_cache)
    perp, perp_diagnostics = load_perp(perp_cache, funding_cache)
    days, aligned, alignment = align(cash, perp)
    safety = {
        "mode": "RESEARCH_ONLY",
        "orderSubmissionAllowed": False,
        "productionChanged": False,
        "liveChanged": False,
        "vpsChanged": False,
        "cryptoV96Changed": False,
    }
    if len(days) < 30:
        return rounded({
            "version": 10,
            "strategyId": STRATEGY_ID,
            "status": "INSUFFICIENT_ALIGNED_CASH_PERP_HISTORY",
            "candidateCount": len(CANDIDATES),
            "familyCount": 4,
            "eligibleDays": len(days),
            "cashDiagnostics": cash_diagnostics,
            "perpDiagnostics": perp_diagnostics,
            "alignmentDiagnostics": alignment,
            "safety": safety,
        })
    splits = chronological_splits(days)
    all_trades = {
        candidate.candidate_id: [
            trade for day in days if (trade := candidate_trade(candidate, day, aligned)) is not None
        ] for candidate in CANDIDATES
    }
    families = {}
    passing = []
    for family in sorted({candidate.family for candidate in CANDIDATES}):
        candidate_rows = []
        for candidate in [item for item in CANDIDATES if item.family == family]:
            development = {
                scenario.name: metrics(subset(all_trades[candidate.candidate_id], splits["DEVELOPMENT"]), scenario)
                for scenario in base.SCENARIOS
            }
            candidate_rows.append({"candidate": asdict(candidate), "development": development, "score": score(development)})
        eligible = [row for row in candidate_rows if row["development"]["FORWARD_MEDIAN"]["trades"] >= 8]
        winner = max(eligible or candidate_rows, key=lambda row: (row["score"], row["candidate"]["candidate_id"]))
        winner_id = winner["candidate"]["candidate_id"]
        validation = {
            scenario.name: metrics(subset(all_trades[winner_id], splits["VALIDATION"]), scenario)
            for scenario in base.SCENARIOS
        }
        passed = validation_pass(validation)
        if passed:
            passing.append(winner_id)
        families[family] = {
            "developmentCandidates": candidate_rows,
            "winnerId": winner_id,
            "winnerValidation": validation,
            "validationPass": passed,
        }
    selected = None
    if passing:
        options = []
        for candidate_id in passing:
            validation = {
                scenario.name: metrics(subset(all_trades[candidate_id], splits["VALIDATION"]), scenario)
                for scenario in base.SCENARIOS
            }
            options.append((score(validation), candidate_id, validation))
        _, candidate_id, validation = max(options)
        trades = all_trades[candidate_id]
        selected = {"candidateId": candidate_id, "validation": validation, "gross1": {}, "gross2Sensitivity": {}}
        for scenario in base.SCENARIOS:
            selected["gross1"][scenario.name] = {
                "full": metrics(trades, scenario),
                "development": metrics(subset(trades, splits["DEVELOPMENT"]), scenario),
                "validation": metrics(subset(trades, splits["VALIDATION"]), scenario),
                "holdout": metrics(subset(trades, splits["HOLDOUT"]), scenario),
            }
            selected["gross2Sensitivity"][scenario.name] = {
                "full": metrics(trades, scenario, 2.0),
                "holdout": metrics(subset(trades, splits["HOLDOUT"]), scenario, 2.0),
            }
        selected["executionMode"] = trades[0]["executionMode"] if trades else None
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
        status = "CRYPTO_LIKE_CASH_PERP_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif selected and selected["holdoutPass"]:
        status = "ROBUST_POSITIVE_CASH_PERP_EDGE_FOUND_REUSED_HISTORY_SHADOW_ONLY"
    elif passing:
        status = "CASH_PERP_VALIDATION_LEAD_FAILED_REUSED_HOLDOUT"
    else:
        status = "NO_VALIDATION_PASSING_CASH_PERP_FAMILY"
    return rounded({
        "version": 10,
        "strategyId": STRATEGY_ID,
        "status": status,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "candidateCount": len(CANDIDATES),
        "familyCount": 4,
        "universe": list(SYMBOL_MAP),
        "dataWindow": {"eligibleDays": len(days), "first": days[0], "last": days[-1]},
        "splits": splits,
        "families": families,
        "validationPassingWinnerIds": passing,
        "selected": selected,
        "cashDiagnostics": cash_diagnostics,
        "perpDiagnostics": perp_diagnostics,
        "alignmentDiagnostics": alignment,
        "selectionDiscipline": {
            "thresholdSelection": "DEVELOPMENT only",
            "familyScreening": "VALIDATION only",
            "finalEvaluation": "reused historical HOLDOUT once",
            "holdoutRetuningAllowed": False,
        },
        "limitations": [
            "Yahoo Finance public chart responses are an unofficial, unauthenticated research source and may have retention or availability limits.",
            "Cash bars are unadjusted intraday prices; corporate-action events are reported but not back-adjusted.",
            "USDT is treated as approximately equal to USD for basis calculation.",
            "Cash-hedged candidates require a separate equity broker, short availability where applicable, and synchronized two-venue execution.",
            "Historical cash borrow fees, exact order-book depth and event gates are not reconstructed.",
            "The final period overlaps prior Stock research and is not an independent Holdout.",
            "Gross 2.0 is sensitivity only.",
        ],
        "safety": safety,
    })


def write_report(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-cash-perp-basis-v10.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# V96 Stock Cash / Perp Basis V10",
        "",
        f"- Status: **{result['status']}**",
        f"- Candidates / families: {result['candidateCount']} / {result['familyCount']}",
        f"- Eligible aligned days: {result.get('dataWindow', {}).get('eligibleDays', result.get('eligibleDays', 0))}",
        "- Production / LIVE / VPS / Crypto V96 / orders changed: **NO**",
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
        lines += ["", "## Selected candidate", "", f"- Candidate: **{selected['candidateId']}**", f"- Execution mode: **{selected['executionMode']}**", f"- Holdout pass: **{'YES' if selected['holdoutPass'] else 'NO'}**", f"- Crypto-like: **{'YES' if selected['cryptoLike'] else 'NO'}**"]
    (output_dir / "v96-stock-cash-perp-basis-v10.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert len(CANDIDATES) == 12
    assert len({candidate.family for candidate in CANDIDATES}) == 4
    assert abs(product([0.10, -0.05]) - 0.045) < 1e-12
    assert CASH_ONE_WAY_BPS["SEVERE"] > CASH_ONE_WAY_BPS["NORMAL"]
    print("V96 Stock Cash / Perp Basis V10 self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cash-cache-dir", default=".cache/v96-stock-cash-yahoo-v10")
    parser.add_argument("--perp-cache-dir", default=".cache/v96-stock-basis-mature-v9")
    parser.add_argument("--funding-cache-dir", default=".cache/v96-stock-funding")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-cash-perp-basis-v10")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cash_cache_dir), Path(args.perp_cache_dir), Path(args.funding_cache_dir))
    write_report(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
