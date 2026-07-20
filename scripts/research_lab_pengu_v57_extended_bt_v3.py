from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import research_lab_pengu_v57_extended_bt as base
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v50 as v50

HOUR = v47.HOUR
DAY = 24 * HOUR
ARCHIVE_BASE = "https://data.binance.vision/data/futures/um/monthly"
ARCHIVE_START = dt.date(2024, 1, 1)
USER_AGENT = "DisDex-PENGU-V57-Binance-Archive-BT/1.0"


def previous_complete_month(now: dt.datetime) -> dt.date:
    first_of_current = dt.date(now.year, now.month, 1)
    previous_day = first_of_current - dt.timedelta(days=1)
    return dt.date(previous_day.year, previous_day.month, 1)


def iter_months(start: dt.date, end_inclusive: dt.date) -> Iterable[Tuple[int, int]]:
    cursor = dt.date(start.year, start.month, 1)
    while cursor <= end_inclusive:
        yield cursor.year, cursor.month
        if cursor.month == 12:
            cursor = dt.date(cursor.year + 1, 1, 1)
        else:
            cursor = dt.date(cursor.year, cursor.month + 1, 1)


def normalize_timestamp(value: str | int | float) -> int:
    timestamp = int(float(value))
    while timestamp > 10_000_000_000_000:
        timestamp //= 1000
    return timestamp


def download_zip_text(url: str, timeout: int = 60) -> Optional[str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        if not names:
            raise RuntimeError(f"No CSV found in archive: {url}")
        return archive.read(names[0]).decode("utf-8-sig")


def kline_url(symbol: str, year: int, month: int) -> str:
    stamp = f"{year:04d}-{month:02d}"
    return f"{ARCHIVE_BASE}/klines/{symbol}/1h/{symbol}-1h-{stamp}.zip"


def funding_url(symbol: str, year: int, month: int) -> str:
    stamp = f"{year:04d}-{month:02d}"
    return f"{ARCHIVE_BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{stamp}.zip"


def parse_kline_csv(text: str) -> List[dict]:
    rows: List[dict] = []
    for raw in csv.reader(io.StringIO(text)):
        if not raw or len(raw) < 7:
            continue
        try:
            open_time = normalize_timestamp(raw[0])
            close_time = normalize_timestamp(raw[6])
            row = {
                "ts": open_time,
                "open": float(raw[1]),
                "high": float(raw[2]),
                "low": float(raw[3]),
                "close": float(raw[4]),
                "volume": float(raw[5]),
                "closeTime": close_time,
            }
        except (TypeError, ValueError):
            continue
        rows.append(row)
    return rows


def first_matching_key(keys: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lowered = {key.lower(): key for key in keys}
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    for key in keys:
        normalized = key.lower().replace("_", "")
        for candidate in candidates:
            if candidate.lower().replace("_", "") in normalized:
                return key
    return None


def parse_funding_csv(text: str) -> List[dict]:
    parsed: List[dict] = []
    raw_rows = list(csv.reader(io.StringIO(text)))
    if not raw_rows:
        return parsed

    header = raw_rows[0]
    has_header = bool(header and not header[0].strip().lstrip("-").isdigit())
    if has_header:
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = reader.fieldnames or []
        ts_key = first_matching_key(
            fieldnames,
            ("calc_time", "funding_time", "fundingRateTimestamp", "fundingTime", "timestamp"),
        )
        rate_key = first_matching_key(
            fieldnames,
            ("last_funding_rate", "funding_rate", "fundingRate", "rate"),
        )
        if ts_key is None or rate_key is None:
            raise RuntimeError(f"Unrecognized funding CSV header: {fieldnames}")
        for row in reader:
            try:
                parsed.append({
                    "ts": normalize_timestamp(row[ts_key]),
                    "rate": float(row[rate_key]),
                })
            except (KeyError, TypeError, ValueError):
                continue
        return parsed

    for row in raw_rows:
        if len(row) < 2:
            continue
        try:
            timestamp = normalize_timestamp(row[0])
            rate = float(row[-1])
        except (TypeError, ValueError):
            continue
        parsed.append({"ts": timestamp, "rate": rate})
    return parsed


def fetch_archive_klines(symbol: str, months: Iterable[Tuple[int, int]]) -> tuple[List[dict], List[str]]:
    rows: List[dict] = []
    found: List[str] = []
    for year, month in months:
        stamp = f"{year:04d}-{month:02d}"
        text = download_zip_text(kline_url(symbol, year, month))
        if text is None:
            continue
        monthly = parse_kline_csv(text)
        if monthly:
            rows.extend(monthly)
            found.append(stamp)
            print(f"Archive klines {symbol} {stamp}: {len(monthly)}")
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)], found


def fetch_archive_funding(symbol: str, months: Iterable[Tuple[int, int]]) -> tuple[List[dict], List[str]]:
    rows: List[dict] = []
    found: List[str] = []
    for year, month in months:
        stamp = f"{year:04d}-{month:02d}"
        text = download_zip_text(funding_url(symbol, year, month))
        if text is None:
            continue
        monthly = parse_funding_csv(text)
        if monthly:
            rows.extend(monthly)
            found.append(stamp)
            print(f"Archive funding {symbol} {stamp}: {len(monthly)}")
    unique = {int(row["ts"]): row for row in rows}
    return [unique[key] for key in sorted(unique)], found


def month_pairs(stamps: Iterable[str]) -> List[Tuple[int, int]]:
    return [(int(stamp[:4]), int(stamp[5:7])) for stamp in stamps]


def trim_to_complete_funding_window(
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    funding_months: List[str],
) -> tuple[List[dict], List[dict], List[dict], int]:
    if not funding_months:
        raise RuntimeError("No Binance archive funding months found for PENGUUSDT")
    last_stamp = max(funding_months)
    year = int(last_stamp[:4])
    month = int(last_stamp[5:7])
    if month == 12:
        cutoff_date = dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc)
    else:
        cutoff_date = dt.datetime(year, month + 1, 1, tzinfo=dt.timezone.utc)
    cutoff = int(cutoff_date.timestamp() * 1000)
    return (
        [row for row in pengu if int(row["ts"]) < cutoff],
        [row for row in btc if int(row["ts"]) < cutoff],
        [row for row in funding if int(row["ts"]) < cutoff],
        cutoff,
    )


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    now_end = int(now.timestamp() * 1000) // HOUR * HOUR

    print("Fetching complete Aster history")
    aster = base.venue_result(
        "ASTER",
        base.build_fixed_trades(
            v47.fetch_klines("PENGUUSDT", now_end),
            v47.fetch_klines("BTCUSDT", now_end),
            v47.fetch_funding("PENGUUSDT", now_end),
        ),
    )

    last_complete = previous_complete_month(now)
    all_months = list(iter_months(ARCHIVE_START, last_complete))
    print(f"Scanning Binance archive through {last_complete:%Y-%m}")
    archive_pengu, pengu_months = fetch_archive_klines("PENGUUSDT", all_months)
    if not pengu_months:
        raise RuntimeError("No Binance archive PENGUUSDT monthly klines found")
    relevant_months = month_pairs(pengu_months)
    archive_btc, btc_months = fetch_archive_klines("BTCUSDT", relevant_months)
    archive_funding, funding_months = fetch_archive_funding("PENGUUSDT", relevant_months)
    archive_pengu, archive_btc, archive_funding, archive_cutoff = trim_to_complete_funding_window(
        archive_pengu,
        archive_btc,
        archive_funding,
        funding_months,
    )
    archive = base.venue_result(
        "BINANCE_USDM_PUBLIC_ARCHIVE",
        base.build_fixed_trades(archive_pengu, archive_btc, archive_funding),
    )

    external_pass = bool(
        archive["included"]["compoundedReturnPct"] > 0
        and archive["includedSevere"]["compoundedReturnPct"] > 0
        and archive["largeWaveProfitsExcluded"]["compoundedReturnPct"] > 0
        and archive["largeWaveProfitsExcludedSevere"]["compoundedReturnPct"] > 0
        and (archive["included"]["profitFactor"] or 0) >= 1.10
        and (archive["largeWaveProfitsExcluded"]["profitFactor"] or 0) >= 1.05
    )
    comparison = {
        "archiveDays": (archive["endTs"] - archive["startTs"]) / DAY,
        "asterDays": (aster["endTs"] - aster["startTs"]) / DAY,
        "archiveMinusAsterDays": (
            archive["endTs"] - archive["startTs"] - (aster["endTs"] - aster["startTs"])
        ) / DAY,
        "archiveWaveContributionPctPoints": (
            archive["included"]["compoundedReturnPct"]
            - archive["largeWaveProfitsExcluded"]["compoundedReturnPct"]
        ),
        "asterWaveContributionPctPoints": (
            aster["included"]["compoundedReturnPct"]
            - aster["largeWaveProfitsExcluded"]["compoundedReturnPct"]
        ),
    }
    result = rounded({
        "version": 57,
        "strategyId": "PENGU_V57_FIXED_BINANCE_PUBLIC_ARCHIVE",
        "generatedAt": now.isoformat(),
        "parametersFrozen": True,
        "externalValidationPassed": external_pass,
        "aster": aster,
        "binanceUsdMArchive": archive,
        "archiveCoverage": {
            "penguMonths": pengu_months,
            "btcMonths": btc_months,
            "fundingMonths": funding_months,
            "cutoffTs": archive_cutoff,
            "cutoffIso": dt.datetime.fromtimestamp(archive_cutoff / 1000, tz=dt.timezone.utc).isoformat(),
        },
        "comparison": comparison,
        "assumptions": {
            "gross": 0.15,
            "baseRoundTripCostPct": 0.14,
            "severeRoundTripCostPct": 0.28,
            "largeWaveDefinition": "abs 24h move >=20% OR abs 72h move >=35%",
            "largeWaveExcludedMethod": (
                "Positive trade returns overlapping same-direction major events are set to zero; "
                "losses, funding and costs remain."
            ),
            "execution": (
                "completed 1h candles, signal close then next-open execution; "
                "no parameter retuning on Binance archive"
            ),
            "source": "Binance official USD-M monthly public data archive",
            "apiFallbacks": "Binance REST returned 451 and Bybit REST returned 403 from GitHub runner; archive files used instead",
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v57-extended-bt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = [
        "# PENGU V57 Fixed Binance Public Archive BT",
        "",
        f"- External validation: **{'PASS' if external_pass else 'FAIL'}**",
        "- Parameters frozen before archive test: **YES**",
        "",
        "## Binance USD-M official archive",
        f"- Period: {archive['startIso']} to {archive['endIso']}",
        f"- Included: {archive['included']['compoundedReturnPct']}% / PF {archive['included']['profitFactor']} / DD {archive['included']['maxDrawdownPct']}% / N {archive['included']['trades']}",
        f"- Included Severe: {archive['includedSevere']['compoundedReturnPct']}% / DD {archive['includedSevere']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {archive['largeWaveProfitsExcluded']['compoundedReturnPct']}% / PF {archive['largeWaveProfitsExcluded']['profitFactor']} / DD {archive['largeWaveProfitsExcluded']['maxDrawdownPct']}%",
        f"- Excluded Severe: {archive['largeWaveProfitsExcludedSevere']['compoundedReturnPct']}% / DD {archive['largeWaveProfitsExcludedSevere']['maxDrawdownPct']}%",
        f"- Wave contribution: {comparison['archiveWaveContributionPctPoints']} percentage points",
        "",
        "## Aster replication",
        f"- Period: {aster['startIso']} to {aster['endIso']}",
        f"- Included: {aster['included']['compoundedReturnPct']}% / PF {aster['included']['profitFactor']} / DD {aster['included']['maxDrawdownPct']}% / N {aster['included']['trades']}",
        f"- Included Severe: {aster['includedSevere']['compoundedReturnPct']}% / DD {aster['includedSevere']['maxDrawdownPct']}%",
        f"- Large-wave profits excluded: {aster['largeWaveProfitsExcluded']['compoundedReturnPct']}% / PF {aster['largeWaveProfitsExcluded']['profitFactor']} / DD {aster['largeWaveProfitsExcluded']['maxDrawdownPct']}%",
        f"- Excluded Severe: {aster['largeWaveProfitsExcludedSevere']['compoundedReturnPct']}% / DD {aster['largeWaveProfitsExcludedSevere']['maxDrawdownPct']}%",
        f"- Wave contribution: {comparison['asterWaveContributionPctPoints']} percentage points",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v57-extended-bt.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
