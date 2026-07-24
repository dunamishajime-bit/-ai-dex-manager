from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import statistics
import subprocess
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
V11_ROOT = REPO_ROOT / ".v11"
V13_ROOT = REPO_ROOT / ".v13"
sys.path.insert(0, str(V11_ROOT / "research"))
sys.path.insert(0, str(V13_ROOT / "research"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt
import v96_stock_perp_fade_enhancement_v11 as v11
import v96_stock_v13_edge_floor_tournament as v13edge

v13profit = v13edge.profit
v13hold = v13profit.hold
v13base = v13hold.base

UTC = dt.timezone.utc
NY = v13base.NY
DAY_MS = 86_400_000
STEP_MS = 30 * 60_000
PERIOD_START = dt.datetime(2025, 7, 1, tzinfo=UTC)
PERIOD_END = dt.datetime(2026, 7, 1, tzinfo=UTC)
START_MS = int(PERIOD_START.timestamp() * 1000)
END_MS = int(PERIOD_END.timestamp() * 1000)
STRATEGY_ID = "DISDEX_V96_CRYPTO_V11_V13D_ONE_YEAR_PORTFOLIO"
V11_SOURCE_SHA = "0fad24c105a7f0f61af6042ba04a8b1386ffec7c"
V13_SOURCE_SHA = "dbfd7e026a81343a23ab97d202761f7f9bbe5755"
SYMBOLS = tuple(v13base.SYMBOLS)

CRYPTO_GROSS_CAP = 1.0
STOCK_GROSS_CAP = 1.0
TOTAL_GROSS_CAP = 2.0
DAILY_LOSS_LIMIT = -0.02

SCENARIOS = {
    "FORWARD_MEDIAN_STOCK__CRYPTO_NORMAL": {"crypto": "normal", "v11OneWayBps": 12.0, "v13dCycleBps": 10.0},
    "NORMAL": {"crypto": "normal", "v11OneWayBps": 20.0, "v13dCycleBps": 16.0},
    "STOCK_P95__CRYPTO_NORMAL": {"crypto": "normal", "v11OneWayBps": 22.0, "v13dCycleBps": 26.0},
    "SEVERE": {"crypto": "severe", "v11OneWayBps": 50.0, "v13dCycleBps": 45.0},
}


def verify_source(path: Path, expected: str) -> None:
    actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if actual != expected:
        raise RuntimeError(f"source mismatch: {path}: expected {expected}, got {actual}")


def iso_ms(value: int) -> str:
    return dt.datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    if isinstance(value, tuple):
        return [rounded(item) for item in value]
    return value


def fetch_aster_full(symbol: str, cache_dir: Path) -> List[list]:
    path = cache_dir / f"aster-{symbol}-30m-{PERIOD_START.date()}-{PERIOD_END.date()}.json"
    cached = v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[list] = []
    cursor, stop = START_MS - 2 * DAY_MS, END_MS + DAY_MS - 1
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": v13base.ASTER_SYMBOL[symbol], "interval": "30m",
            "startTime": cursor, "endTime": stop, "limit": 1500,
        })
        page = v13base.request_json(f"{v13base.ASTER_KLINES_URL}?{query}")
        clean = [row for row in page if isinstance(row, list) and len(row) >= 6]
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row[0]) for row in clean) + STEP_MS
        if next_cursor <= cursor or len(clean) < 1500:
            break
        cursor = next_cursor
        time.sleep(0.05)
    dedup = {int(row[0]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    v13base.cache_write(path, result)
    return result


def fetch_xyz_full(symbol: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"xyz-{symbol}-30m-{PERIOD_START.date()}-{PERIOD_END.date()}.json"
    cached = v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[dict] = []
    cursor, stop, chunk_ms = START_MS - 2 * DAY_MS, END_MS + DAY_MS - 1, 60 * DAY_MS
    while cursor <= stop:
        chunk_end = min(stop, cursor + chunk_ms - 1)
        page = v13base.request_json(v13base.XYZ_INFO_URL, {
            "type": "candleSnapshot",
            "req": {"coin": v13base.XYZ_COIN[symbol], "interval": "30m", "startTime": cursor, "endTime": chunk_end},
        })
        if isinstance(page, list):
            rows.extend(row for row in page if isinstance(row, dict) and row.get("t") is not None)
        cursor = chunk_end + 1
        time.sleep(0.08)
    dedup = {int(row["t"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    v13base.cache_write(path, result)
    return result


def fetch_aster_funding_full(symbol: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"aster-{symbol}-funding-{PERIOD_START.date()}-{PERIOD_END.date()}.json"
    cached = v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[dict] = []
    cursor, stop = START_MS - DAY_MS, END_MS + DAY_MS - 1
    while cursor <= stop:
        query = urllib.parse.urlencode({
            "symbol": v13base.ASTER_SYMBOL[symbol], "startTime": cursor, "endTime": stop, "limit": 1000,
        })
        page = v13base.request_json(f"{v13hold.ASTER_FUNDING_URL}?{query}")
        clean = [row for row in page if isinstance(row, dict) and row.get("fundingTime") is not None] if isinstance(page, list) else []
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row["fundingTime"]) for row in clean) + 1
        if next_cursor <= cursor or len(clean) < 1000:
            break
        cursor = next_cursor
    dedup = {int(row["fundingTime"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    v13base.cache_write(path, result)
    return result


def fetch_xyz_funding_full(symbol: str, cache_dir: Path) -> List[dict]:
    path = cache_dir / f"xyz-{symbol}-funding-{PERIOD_START.date()}-{PERIOD_END.date()}.json"
    cached = v13base.cache_read(path)
    if isinstance(cached, list):
        return cached
    rows: List[dict] = []
    cursor, stop = START_MS - DAY_MS, END_MS + DAY_MS - 1
    for _ in range(100):
        page = v13base.request_json(v13base.XYZ_INFO_URL, {
            "type": "fundingHistory", "coin": v13base.XYZ_COIN[symbol], "startTime": cursor, "endTime": stop,
        })
        clean = [row for row in page if isinstance(row, dict) and row.get("time") is not None] if isinstance(page, list) else []
        if not clean:
            break
        rows.extend(clean)
        next_cursor = max(int(row["time"]) for row in clean) + 1
        if next_cursor <= cursor or next_cursor > stop or len(clean) < 500:
            break
        cursor = next_cursor
    dedup = {int(row["time"]): row for row in rows}
    result = [dedup[key] for key in sorted(dedup)]
    v13base.cache_write(path, result)
    return result


def build_v13_data(cache_dir: Path) -> Tuple[dict, dict]:
    v13base.INTERVAL_MS["30m"] = STEP_MS
    raw: Dict[Tuple[str, str], Sequence] = {}
    funding_raw: Dict[Tuple[str, str], Sequence] = {}
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for symbol in SYMBOLS:
            jobs += [
                ("ASTER", symbol, "bars", pool.submit(fetch_aster_full, symbol, cache_dir)),
                ("XYZ", symbol, "bars", pool.submit(fetch_xyz_full, symbol, cache_dir)),
                ("ASTER", symbol, "funding", pool.submit(fetch_aster_funding_full, symbol, cache_dir)),
                ("XYZ", symbol, "funding", pool.submit(fetch_xyz_funding_full, symbol, cache_dir)),
            ]
        for venue, symbol, kind, future in jobs:
            payload = future.result()
            (raw if kind == "bars" else funding_raw)[(venue, symbol)] = payload
            print(f"loaded V13 {venue} {symbol} {kind}: {len(payload)}")
    data, diagnostics = {}, {}
    for symbol in SYMBOLS:
        aster = v13base.parse_aster(raw[("ASTER", symbol)])
        xyz = v13base.parse_xyz(raw[("XYZ", symbol)])
        af = v13hold.parse_funding(funding_raw[("ASTER", symbol)], "fundingTime", ("fundingRate", "funding"))
        xf = v13hold.parse_funding(funding_raw[("XYZ", symbol)], "time", ("fundingRate", "funding"))
        common = sorted(set(aster) & set(xyz))
        data[symbol] = {"aster": aster, "xyz": xyz, "asterFunding": af, "xyzFunding": xf, "common": common, "commonSet": set(common)}
        regular_days = sorted({v13base.day_string(ts) for ts in common if v13base.regular_bar_start(ts)})
        diagnostics[symbol] = {
            "asterBars": len(aster), "xyzBars": len(xyz), "alignedBars": len(common),
            "regularSessions": len(regular_days), "firstSession": regular_days[0] if regular_days else None,
            "lastSession": regular_days[-1] if regular_days else None,
        }
    return data, diagnostics


def build_v11(cache_root: Path) -> Tuple[List[dict], dict]:
    cash, cash_diag = v11.load_cash_intraday(cache_root / "v11-cash")
    perp, perp_diag = v11.load_perp_intraday(cache_root / "v11-perp", cache_root / "v11-funding")
    days, aligned, alignment = v11.align_intraday(cash, perp)
    scores = v11.rolling_scores(days, aligned)
    candidate = v11.Candidate("BOTH__FLAT__CONVERGENCE__ABS_TOP1", "BOTH", "FLAT", "CONVERGENCE", "ABS_TOP1")
    rows = []
    for day in days:
        trade = v11.build_trade(candidate, day, aligned, scores)
        if trade is None or not (PERIOD_START.date().isoformat() <= day < PERIOD_END.date().isoformat()):
            continue
        leg = trade["legs"][0]
        rows.append({
            "strategy": "V11", "day": day, "symbol": leg["symbol"], "entryTs": int(leg["entryTs"]),
            "exitTs": int(leg["exitTs"]), "gross": float(trade["gross"]), "grossReturn": float(trade["grossReturn"]),
            "fundingReturn": float(trade["fundingReturn"]), "exitReason": leg["exitReason"],
        })
    return rows, {"cash": cash_diag, "perp": perp_diag, "alignment": alignment, "eligibleDays": len(days), "trades": len(rows)}


def build_v13d(cache_root: Path) -> Tuple[List[dict], dict]:
    data, diagnostics = build_v13_data(cache_root / "v13d")
    rows = v13edge.simulate_arm(20.0, "NO_PREVIOUS_SYMBOL", data)
    rows = [
        {"strategy": "V13D", "day": row["day"], "symbol": row["symbol"], "entryTs": int(row["quoteTs"]),
         "exitTs": int(row["exitTs"]), "gross": 1.0, "grossBps": float(row["grossBps"]),
         "exitReason": row["exitReason"], "entryBasisBps": float(row["spreadBps"])}
        for row in rows if START_MS <= int(row["quoteTs"]) < END_MS
    ]
    return rows, {"symbols": diagnostics, "trades": len(rows)}


def build_crypto() -> dict:
    raw = crypto_bt.v89.build_raw()
    profile = crypto_bt.build_core_profile(crypto_bt.NEW, raw)
    trades = crypto_bt.v69.scale_trades(crypto_bt.v96.TARGET_V67_GROSS)
    trade_start = min(int(row["entry_ts"]) for row in trades)
    trade_end = max(int(row["exit_ts"]) for row in trades)
    pengu_rows = crypto_bt.core.fetch_klines("PENGUUSDT", trade_start - 30 * crypto_bt.v69.DAY, trade_end + crypto_bt.v69.HOUR)
    combined = crypto_bt.combined_series(profile, pengu_rows)

    def cap(rows: Sequence[dict]) -> List[dict]:
        result = []
        for row in rows:
            ts = int(row["ts"])
            if not START_MS <= ts < END_MS:
                continue
            raw_max = max(0.0, float(row.get("maxGross", row.get("gross", 0.0))))
            scale = min(1.0, CRYPTO_GROSS_CAP / raw_max) if raw_max > 0 else 1.0
            result.append({"ts": ts, "return": float(row["return"]) * scale, "gross": raw_max * scale,
                           "sourceGross": raw_max, "scale": scale})
        return result

    normal, severe = cap(combined["normalRows"]), cap(combined["severeRows"])
    if not normal or not severe:
        raise RuntimeError("no Crypto V96 rows in fixed period")
    return {"normal": normal, "severe": severe, "diagnostics": {
        "normalRows": len(normal), "severeRows": len(severe), "first": iso_ms(normal[0]["ts"]),
        "last": iso_ms(normal[-1]["ts"]), "sourceMaxGross": max(row["sourceGross"] for row in normal),
        "cappedMaxGross": max(row["gross"] for row in normal), "minimumScale": min(row["scale"] for row in normal),
    }}


def route_stock(v11_rows: Sequence[dict], v13d_rows: Sequence[dict]) -> Tuple[List[dict], dict]:
    by11, by13 = {row["day"]: row for row in v11_rows}, {row["day"]: row for row in v13d_rows}
    routed, stats = [], Counter()
    for day in sorted(set(by11) | set(by13)):
        if day in by13:
            routed.append(dict(by13[day])); stats["V13D_SELECTED_1000"] += 1
            if day in by11: stats["V11_SKIPPED_STOCK_OCCUPIED"] += 1
        elif day in by11:
            routed.append(dict(by11[day])); stats["V11_FALLBACK_1030"] += 1
    return sorted(routed, key=lambda row: row["entryTs"]), dict(stats)


def trade_return(trade: dict, scenario: dict) -> float:
    if trade["strategy"] == "V11":
        return float(trade["grossReturn"]) - 2 * float(trade["gross"]) * float(scenario["v11OneWayBps"]) / 10_000
    return (float(trade["grossBps"]) - float(scenario["v13dCycleBps"])) / 10_000


def metrics(events: Sequence[dict]) -> dict:
    equity = peak = 1.0
    max_dd = gains = losses = 0.0
    values = []
    monthly = defaultdict(lambda: 1.0)
    for row in sorted(events, key=lambda item: (item["ts"], item.get("priority", 0))):
        value = float(row["return"]); values.append(value)
        gains += max(0.0, value); losses += max(0.0, -value)
        equity *= max(0.001, 1 + value); peak = max(peak, equity); max_dd = min(max_dd, equity / peak - 1)
        month = dt.datetime.fromtimestamp(row["ts"] / 1000, tz=UTC).strftime("%Y-%m"); monthly[month] *= max(0.001, 1 + value)
    compounded = equity - 1; years = 365 / 365.25
    return {"compoundedReturnPct": compounded * 100, "cagrPct": ((1 + compounded) ** (1 / years) - 1) * 100,
            "maxDrawdownPct": max_dd * 100, "profitFactor": gains / losses if losses > 1e-15 else (999.0 if gains else None),
            "positiveEventRatePct": sum(v > 0 for v in values) / len(values) * 100 if values else 0.0,
            "events": len(values), "monthlyReturnPct": {m: (v - 1) * 100 for m, v in sorted(monthly.items())}}


def simulate(crypto_rows: Sequence[dict], stock_rows: Sequence[dict], scenario: dict) -> dict:
    timeline = [{"kind": "CRYPTO", "ts": int(row["ts"]), "return": float(row["return"]), "priority": 2} for row in crypto_rows]
    timeline += [{"kind": "ENTRY", "ts": int(row["entryTs"]), "trade": row, "return": 0.0, "priority": 1} for row in stock_rows]
    timeline.sort(key=lambda row: (row["ts"], row["priority"]))
    events, stats = [], Counter(); current_day = locked_day = None; day_return = 0.0; index = 0
    while index < len(timeline):
        row = timeline[index]; day = dt.datetime.fromtimestamp(row["ts"] / 1000, tz=UTC).date().isoformat()
        if day != current_day: current_day, locked_day, day_return = day, None, 0.0
        if row["kind"] == "ENTRY":
            trade = row["trade"]
            if locked_day == day: stats["stockSkippedDailyLoss"] += 1
            else:
                timeline.append({"kind": "STOCK", "ts": int(trade["exitTs"]), "trade": trade,
                                 "return": trade_return(trade, scenario), "priority": 3})
                timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda item: (item["ts"], item["priority"]))
                stats[f"accepted{trade['strategy']}"] += 1
            index += 1; continue
        if locked_day == day:
            stats[f"{row['kind']}SkippedDailyLoss"] += 1; index += 1; continue
        strategy = row.get("trade", {}).get("strategy", "CRYPTO")
        event = {"ts": int(row["ts"]), "return": float(row["return"]), "strategy": strategy,
                 "symbol": row.get("trade", {}).get("symbol"), "priority": row["priority"]}
        events.append(event); day_return = (1 + day_return) * (1 + event["return"]) - 1
        if day_return <= DAILY_LOSS_LIMIT: locked_day = day; stats["dailyLossLocks"] += 1
        index += 1
    result = metrics(events)
    result.update({"acceptedV11Trades": sum(row["strategy"] == "V11" for row in events),
                   "acceptedV13DTrades": sum(row["strategy"] == "V13D" for row in events),
                   "observedMaximumGross": TOTAL_GROSS_CAP, "routingDiagnostics": dict(stats),
                   "bySleeve": {name: metrics([row for row in events if row["strategy"] == name]) for name in ("CRYPTO", "V11", "V13D")}})
    return result


def isolated_stock(rows: Sequence[dict], scenario: dict) -> dict:
    return metrics([{"ts": row["exitTs"], "return": trade_return(row, scenario), "strategy": row["strategy"], "priority": 1} for row in rows])


def analyze(cache_root: Path) -> dict:
    verify_source(V11_ROOT, V11_SOURCE_SHA); verify_source(V13_ROOT, V13_SOURCE_SHA)
    v11_rows, v11_diag = build_v11(cache_root)
    v13d_rows, v13d_diag = build_v13d(cache_root)
    routed, routing = route_stock(v11_rows, v13d_rows)
    crypto = build_crypto()
    results = {}
    for name, scenario in SCENARIOS.items():
        crypto_rows = crypto[scenario["crypto"]]
        results[name] = {
            "unified": simulate(crypto_rows, routed, scenario),
            "cryptoSleeveOneOnly": simulate(crypto_rows, [], scenario),
            "cryptoPlusV11Only": simulate(crypto_rows, v11_rows, scenario),
            "cryptoPlusV13DOnly": simulate(crypto_rows, v13d_rows, scenario),
            "v11Standalone": isolated_stock(v11_rows, scenario),
            "v13dStandalone": isolated_stock(v13d_rows, scenario),
            "routedStockStandalone": isolated_stock(routed, scenario),
        }
    normal, severe = results["NORMAL"]["unified"], results["SEVERE"]["unified"]
    status = ("ONE_YEAR_UNIFIED_HISTORICAL_LEAD_FORWARD_EXECUTION_REQUIRED"
              if normal["compoundedReturnPct"] > 0 and normal["maxDrawdownPct"] >= -35
              and severe["compoundedReturnPct"] > 0 and severe["maxDrawdownPct"] >= -55
              else "ONE_YEAR_UNIFIED_HISTORICAL_DIAGNOSTIC_NOT_PRODUCTION_APPROVED")
    return rounded({
        "version": 1, "strategyId": STRATEGY_ID, "generatedAt": dt.datetime.now(UTC).isoformat(), "status": status,
        "period": {"startInclusive": PERIOD_START.isoformat(), "endExclusive": PERIOD_END.isoformat(), "calendarDays": 365},
        "sourceCommits": {"cryptoResearchBase": "17d2acd512dac75f6c9b7c427cb4995b6ab8c81b", "v11": V11_SOURCE_SHA, "v13d": V13_SOURCE_SHA},
        "architecture": {
            "cryptoGrossCap": 1.0, "stockGrossCap": 1.0, "totalGrossCap": 2.0, "sleeveLending": False,
            "dailyLossLimitPct": 2.0, "dailyLossResolution": "completed event; triggering loss retained, later same-UTC-day events blocked",
            "stockPriority": "V13D 10:00 first; V11 10:30 only when V13D did not open",
            "stockVsCrypto": "independent sleeves; no cancellation or preemption",
            "timeRouterNy": [
                {"window": "00:00-09:29", "logic": "Crypto V96 only; Stock sleeve cash"},
                {"window": "09:30-09:59", "logic": "Crypto continues; collect Stock signals"},
                {"window": "10:00", "logic": "V13D evaluation"},
                {"window": "10:30", "logic": "V11 fallback when V13D absent"},
                {"window": "11:30-15:30", "logic": "Frozen Stock exit management; Crypto continues"},
                {"window": "after 15:30", "logic": "Crypto V96 only; Stock sleeve cash"},
            ],
        },
        "fixedStrategies": {
            "crypto": {"productionRevision": "V96 Core Volume50 / Turnover7.5 plus reserved PENGU 1.15", "portfolioAdaptation": "proportional cap to Crypto sleeve Gross 1.0"},
            "V11": {"candidateId": "BOTH__FLAT__CONVERGENCE__ABS_TOP1", "basisFloorBps": 50, "entryNy": "10:30", "gross": 1.0,
                    "exit": "Basis <=15 bps or zero-cross; stop at 1.5x entry Basis; otherwise 15:30"},
            "V13D": {"candidateId": "EDGE20__NO_PREVIOUS_SYMBOL", "basisFloorBps": 20, "entryNy": "10:00", "gross": 1.0,
                      "exit": "14:30 when completed 14:00 price PnL >=30 bps, otherwise 15:00", "previousSymbolCooldown": True},
        },
        "costScenarios": SCENARIOS,
        "data": {"crypto": crypto["diagnostics"], "V11": v11_diag, "V13D": v13d_diag,
                 "routedStock": {"trades": len(routed), "routing": routing}},
        "results": results,
        "limitations": [
            "V11 and V13D were selected on overlapping reused history; this is not an independent Holdout.",
            "V13D uses a strict next-open candle proxy and cannot prove queue consumption, exact bid/ask, partial-fill safety, or 250 ms hedge execution.",
            "XYZ stock-perpetual history may begin inside the one-year window; unavailable pre-launch sessions are not fabricated and V11 remains the causal fallback.",
            "Crypto V96 includes the fixed historical PENGU trade sequence; future reproducibility remains Forward-dependent.",
            "Daily-loss control is evaluated at completed-event resolution, not intrabar emergency-flatten resolution.",
        ],
        "safety": {"mode": "RESEARCH_ONLY", "orderSubmissionAllowed": False, "productionChanged": False,
                   "liveChanged": False, "vpsChanged": False, "realPositionsChanged": False},
    })


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# V96 Crypto + V11 + V13D One-Year Backtest", "", f"- Status: **{result['status']}**",
             f"- Period: {result['period']['startInclusive']} to {result['period']['endExclusive']}",
             f"- V11 trades: {result['data']['V11']['trades']}", f"- V13D trades: {result['data']['V13D']['trades']}",
             f"- Routed Stock trades: {result['data']['routedStock']['trades']}", "",
             "| Scenario | Return | CAGR | DD | PF | V11 | V13D |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for name, node in result["results"].items():
        row = node["unified"]
        lines.append(f"| {name} | {row['compoundedReturnPct']}% | {row['cagrPct']}% | {row['maxDrawdownPct']}% | {row['profitFactor']} | {row['acceptedV11Trades']} | {row['acceptedV13DTrades']} |")
    lines += ["", "- Crypto 1.0 / Stock 1.0 / total 2.0; no lending.", "- V13D first, V11 fallback.",
              "- Production / LIVE / VPS / orders changed: **NO**"]
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert (PERIOD_END - PERIOD_START).days == 365
    assert CRYPTO_GROSS_CAP + STOCK_GROSS_CAP == TOTAL_GROSS_CAP
    routed, diag = route_stock(
        [{"strategy": "V11", "day": "2026-01-05", "entryTs": 2}],
        [{"strategy": "V13D", "day": "2026-01-05", "entryTs": 1}],
    )
    assert len(routed) == 1 and routed[0]["strategy"] == "V13D"
    assert diag["V11_SKIPPED_STOCK_OCCUPIED"] == 1
    print("V96 Crypto + V11 + V13D one-year self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-crypto-v11-v13d-one-year")
    parser.add_argument("--output-dir", default=".research-state/v96-crypto-v11-v13d-one-year")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(); self_test()
    if args.self_test: return 0
    result = analyze(Path(args.cache_dir)); write_outputs(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"],
                      "normal": result["results"]["NORMAL"]["unified"], "severe": result["results"]["SEVERE"]["unified"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
