from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

from quality102_rebuilt_v1 import MAX_QUALITY_GROSS, SELECTOR_ID, select_candidates
from quality102_rebuilt_v1_outcomes import materialize_supplement_rows

UTC = dt.timezone.utc
HOUR_MS = 3_600_000
START = dt.datetime(2024, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
WARM_START = dt.datetime(2024, 5, 1, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
WARM_START_MS = int(WARM_START.timestamp() * 1000)

UNIVERSE = (
    "AAVE", "APT", "ARB", "AVAX", "DOGE", "DOT", "FET", "LDO", "NEAR",
    "ONDO", "OP", "RENDER", "SEI", "SOL", "SUI", "TAO", "UNI",
)

DATA_BASE = "https://data.binance.vision/data/futures/um"
NORMAL_COST_BPS = 20.0
STRESS_COST_BPS = 60.0
CSV_FIELDS = (
    "entry", "exit", "symbol", "family", "variant", "side", "normal_net",
    "stress_net", "gross_return", "hold_hours", "exit_reason", "quality_rule",
    "stage", "ret14", "strength", "layer",
)


def month_starts(start: dt.datetime, end: dt.datetime):
    cur = dt.datetime(start.year, start.month, 1, tzinfo=UTC)
    while cur < end:
        yield cur
        cur = dt.datetime(cur.year + (cur.month == 12), 1 if cur.month == 12 else cur.month + 1, 1, tzinfo=UTC)


def fetch_bytes(url: str, *, retries: int = 3) -> bytes | None:
    request = urllib.request.Request(url, headers={"User-Agent": "quality102-rebuilt-v1-research/1"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if attempt + 1 >= retries:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 >= retries:
                raise
        time.sleep(1.0 + attempt)
    return None


def parse_archive(raw: bytes) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"expected one CSV in archive, found {names}")
        text = archive.read(names[0]).decode("utf-8-sig")
    for record in csv.reader(io.StringIO(text)):
        if len(record) < 6:
            continue
        try:
            open_ms = int(record[0])
            open_price = float(record[1])
            high = float(record[2])
            low = float(record[3])
            close = float(record[4])
            volume = float(record[5])
        except ValueError:
            continue
        # Timestamp is the exact hour boundary at which this candle is fully
        # known. Selection therefore cannot use an unfinished bar.
        rows.append({
            "ts": open_ms + HOUR_MS,
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        })
    return rows


def load_symbol(symbol: str, cache_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    pair = f"{symbol}USDT"
    cache_dir.mkdir(parents=True, exist_ok=True)
    all_rows: dict[int, dict[str, Any]] = {}
    found_months: list[str] = []
    missing_months: list[str] = []

    for month in month_starts(WARM_START, END):
        ym = month.strftime("%Y-%m")
        cache_path = cache_dir / f"{pair}-1h-{ym}.zip"
        raw: bytes | None
        if cache_path.exists():
            raw = cache_path.read_bytes()
        else:
            url = f"{DATA_BASE}/monthly/klines/{pair}/1h/{pair}-1h-{ym}.zip"
            raw = fetch_bytes(url)
            if raw is not None:
                cache_path.write_bytes(raw)
        if raw is None:
            missing_months.append(ym)
            continue
        found_months.append(ym)
        for row in parse_archive(raw):
            ts = int(row["ts"])
            if WARM_START_MS <= ts < END_MS:
                all_rows[ts] = row

    # The requested end is inside August 2026. Monthly August may not exist yet,
    # so fetch only the required daily archives for the partial final month.
    final_month = dt.datetime(END.year, END.month, 1, tzinfo=UTC)
    final_ym = final_month.strftime("%Y-%m")
    if final_ym in missing_months:
        day = final_month
        while day < END:
            ymd = day.strftime("%Y-%m-%d")
            cache_path = cache_dir / f"{pair}-1h-{ymd}.zip"
            if cache_path.exists():
                raw = cache_path.read_bytes()
            else:
                url = f"{DATA_BASE}/daily/klines/{pair}/1h/{pair}-1h-{ymd}.zip"
                raw = fetch_bytes(url)
                if raw is not None:
                    cache_path.write_bytes(raw)
            if raw is not None:
                for row in parse_archive(raw):
                    ts = int(row["ts"])
                    if WARM_START_MS <= ts < END_MS:
                        all_rows[ts] = row
            day += dt.timedelta(days=1)

    rows = [all_rows[key] for key in sorted(all_rows)]
    diagnostic = {
        "symbol": symbol,
        "pair": pair,
        "rowCount": len(rows),
        "firstCloseTs": rows[0]["ts"] if rows else None,
        "lastCloseTs": rows[-1]["ts"] if rows else None,
        "foundMonthlyArchives": found_months,
        "missingMonthlyArchives": missing_months,
    }
    return rows, diagnostic


def iso_ms(value: int) -> str:
    return dt.datetime.fromtimestamp(value / 1000, tz=UTC).isoformat()


def csv_row(trade: dict[str, Any]) -> dict[str, Any]:
    return {
        "entry": iso_ms(int(trade["entry_ms"])),
        "exit": iso_ms(int(trade["exit_ms"])),
        "symbol": trade["symbol"],
        "family": trade["family"],
        "variant": f"{SELECTOR_ID}_{trade['family']}",
        "side": trade["side"],
        "normal_net": f"{float(trade['normal_net']):.12g}",
        "stress_net": f"{float(trade['stress_net']):.12g}",
        "gross_return": f"{float(trade['gross_return']):.12g}",
        "hold_hours": f"{float(trade['duration_hours']):.12g}",
        "exit_reason": trade["exit_reason"],
        "quality_rule": trade["stage"],
        "stage": trade["stage"],
        "ret14": "",
        "strength": f"{float(trade['strength']):.12g}",
        "layer": trade["layer"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/quality102-rebuilt-v1-2y")
    parser.add_argument("--cache-dir", default=".cache/binance-vision-quality102-rebuilt-v1")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache_dir)

    symbol_bars: dict[str, list[dict[str, Any]]] = {}
    diagnostics: list[dict[str, Any]] = []
    for symbol in UNIVERSE:
        rows, diagnostic = load_symbol(symbol, cache_dir)
        diagnostics.append(diagnostic)
        if rows:
            symbol_bars[symbol] = rows
        print(f"DATA {symbol} rows={len(rows)} first={diagnostic['firstCloseTs']} last={diagnostic['lastCloseTs']}")

    if len(symbol_bars) < 8:
        raise SystemExit(f"insufficient symbol coverage: {sorted(symbol_bars)}")

    selected = select_candidates(symbol_bars, start_ms=START_MS, end_ms=END_MS)
    if not selected:
        raise SystemExit("QUALITY102_REBUILT_V1 produced zero candidates")
    materialized = materialize_supplement_rows(
        selected,
        symbol_bars,
        end_ms=END_MS,
        normal_cost_bps=NORMAL_COST_BPS,
        stress_cost_bps=STRESS_COST_BPS,
    )
    if not materialized:
        raise SystemExit("no selected candidates closed inside the requested period")

    csv_path = output_dir / "quality102-rebuilt-v1.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for trade in materialized:
            writer.writerow(csv_row(trade))

    csv_sha = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    family_counts = Counter(str(row["family"]) for row in materialized)
    layer_counts = Counter(str(row["layer"]) for row in materialized)
    exit_counts = Counter(str(row["exit_reason"]) for row in materialized)
    normal_values = [float(row["normal_net"]) for row in materialized]
    stress_values = [float(row["stress_net"]) for row in materialized]

    report = {
        "schema": "quality102-rebuilt-v1-2y/v1",
        "status": "QUALITY102_REBUILT_V1_GENERATED",
        "selectorId": SELECTOR_ID,
        "selectorRecovered": False,
        "fixed102ReplayUsed": False,
        "requestedPeriod": {
            "startInclusive": START.isoformat(),
            "endExclusive": END.isoformat(),
        },
        "data": {
            "source": "Binance Vision USD-M monthly/daily public 1h archives",
            "barTimestampSemantics": "candle-close boundary",
            "universe": list(UNIVERSE),
            "symbolsWithData": sorted(symbol_bars),
            "diagnostics": diagnostics,
        },
        "selection": {
            "selectedCount": len(selected),
            "closedCount": len(materialized),
            "qualityGrossCap": MAX_QUALITY_GROSS,
            "familyCounts": dict(sorted(family_counts.items())),
            "layerCounts": dict(sorted(layer_counts.items())),
            "exitReasonCounts": dict(sorted(exit_counts.items())),
            "firstEntry": iso_ms(int(materialized[0]["entry_ms"])),
            "lastEntry": iso_ms(int(materialized[-1]["entry_ms"])),
        },
        "outcomes": {
            "normalCostBps": NORMAL_COST_BPS,
            "stressCostBps": STRESS_COST_BPS,
            "normalNetSum": sum(normal_values),
            "stressNetSum": sum(stress_values),
            "normalPositiveCount": sum(value > 0.0 for value in normal_values),
            "stressPositiveCount": sum(value > 0.0 for value in stress_values),
        },
        "csv": {"path": str(csv_path), "sha256": csv_sha},
        "capitalContract": {
            "initialJpy": 10_000,
            "monthlyContributionJpy": 20_000,
            "contributionCountAfterStart": 24,
            "totalContributedJpy": 490_000,
        },
        "safety": {
            "mode": "RESEARCH_ONLY",
            "ordersSent": False,
            "liveChanged": False,
            "vpsChanged": False,
            "productionChanged": False,
        },
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "selectedCount": len(selected),
        "closedCount": len(materialized),
        "csvSha256": csv_sha,
        "families": report["selection"]["familyCounts"],
        "layers": report["selection"]["layerCounts"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
