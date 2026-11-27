"""Read-only SHA and causal H1 continuity audit for existing ASTER Q102 archives.

Never treats a presence of rows as an executable entry/fill or as proof that
Q102's complete selector / actual production data source can run.
"""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path

H = 3_600_000
TARGET_START = int(datetime(2025, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
CAUSAL_181D_START = TARGET_START - 181 * 24 * H
SOURCE_FOLDERS = ("aster-public-v3-h1", "aster-public-v3-h1-q102-warmup")


def audit_h1(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Q102_H1_ARCHIVE_UNSAFE_OR_MISSING")
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    rows = gaps = duplicated = bad = zero = 0
    first = last = previous = None
    prehistory_rows = prehistory_bad = prehistory_missing = 0
    prehistory_first = prehistory_last = prehistory_prev = None
    with gzip.open(path, "rt", encoding="utf8") as stream:
        for line in stream:
            bar = json.loads(line)
            if not isinstance(bar, list) or len(bar) < 8:
                raise ValueError("Q102_H1_ARCHIVE_ROW_INVALID")
            ts = int(bar[0])
            close_ts = int(bar[6])
            op, high, low, close, volume = [float(bar[i]) for i in (1, 2, 3, 4, 5)]
            if first is None:
                first = ts
            if previous is not None:
                if ts <= previous or ts % H:
                    duplicated += 1
                elif ts > previous + H:
                    gaps += (ts - previous) // H - 1
                elif ts != previous + H:
                    bad += 1
            bar_invalid = (ts % H or close_ts != ts + H - 1
                           or not all(math.isfinite(z) for z in (op, high, low, close, volume))
                           or min(op, low, close) <= 0 or low > min(op, close)
                           or high < max(op, close) or volume < 0)
            bad += int(bool(bar_invalid))
            if CAUSAL_181D_START <= ts < TARGET_START:
                prehistory_rows += 1
                if prehistory_first is None:
                    prehistory_first = ts
                if prehistory_prev is not None and ts != prehistory_prev + H:
                    prehistory_missing += 1
                prehistory_bad += int(bool(bar_invalid))
                prehistory_prev = prehistory_last = ts
            zero += int(volume == 0)
            rows += 1
            last = previous = ts
    if rows == 0:
        raise ValueError("Q102_H1_ARCHIVE_EMPTY")
    return {
        "filename": path.name, "sha256": h.hexdigest(),
        "firstOpenMs": first, "lastOpenMs": last,
        "rows": rows, "missingH1Slots": gaps, "duplicateOrReversed": duplicated,
        "invalidOHLCOrTime": bad, "zeroVolumeHours": zero,
        "prehistory181dRows": prehistory_rows,
        "prehistory181dInvalidOHLCOrTime": prehistory_bad,
        "prehistory181dDiscontinuities": prehistory_missing,
        "covers181dToTargetStart": prehistory_rows == 181 * 24
            and prehistory_first == CAUSAL_181D_START
            and prehistory_last == TARGET_START - H
            and prehistory_missing == 0 and prehistory_bad == 0,
        "fillsOrPricesCertified": False,
    }


def evaluate(root: Path) -> dict:
    files = {}
    for sub in SOURCE_FOLDERS:
        directory = root / sub
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("Q102_H1_ARCHIVE_DIRECTORY_MISSING:" + sub)
        selected = sorted(directory.glob("*USDT-1h-*.jsonl.gz"))
        if not selected:
            raise ValueError("Q102_H1_ARCHIVE_FILES_MISSING:" + sub)
        market = {}
        for file in selected:
            symbol = file.name.split("USDT-1h-", 1)[0]
            if not symbol.isalnum() or symbol in market:
                raise ValueError("Q102_H1_ARCHIVE_DUPLICATE_SYMBOL:" + sub)
            market[symbol] = audit_h1(file)
        files[sub] = market
    main = files[SOURCE_FOLDERS[0]]
    warm = files[SOURCE_FOLDERS[1]]
    common = sorted(set(main) & set(warm))
    return {
        "schema": "stable4-q102-aster-archived-h1-source-integrity/v1",
        "status": "PARTIAL_SOURCE_ARCHIVE_COVERAGE_NOT_NATIVE_REPLAY",
        "studyWindowStartUtc": "2025-10-01T00:00:00Z",
        "causal181DayStartUtc": datetime.fromtimestamp(CAUSAL_181D_START/1000, timezone.utc).isoformat(),
        "sourceDirectory": str(root),
        "folders": files,
        "mainSymbols": len(main), "warmupSymbols": len(warm),
        "matchingSymbols": common, "matchingCount": len(common),
        "mainWithoutMatchingWarmup": sorted(set(main)-set(warm)),
        "matchedWarmupCoveringTargetStart": [
            s for s in common if warm[s]["covers181dToTargetStart"]
        ],
        "allQ102NativeSourceHoursProven": False,
        "fullAnnualSevenWalletReplayed": False,
        "executionQuotesOrFillsCertified": False,
        "rootCertificateIssued": False,
        "orderAuthority": False,
        "productionEligible": False,
        "limitations": [
            "Aster public H1 archives only; alternate Binance / other local archives were not evaluated",
            "Warmup files may have stale, zero-volume or missing H1 bars; checked without interpolation",
            "Presence of 181d H1 does not prove native Q102 route selection or executable ASTER M5 fills",
            "The folder contains instruments not necessarily in Q102 production source universe",
            "No fees, funding, gross, drawdown, STOP, verified order state or owner signature",
        ],
    }


def verify_snapshot(payload: dict) -> None:
    """Validate locally computed archive evidence, never promote to fill parity."""
    if (payload.get("schema") != "stable4-q102-aster-archived-h1-source-integrity/v1"
            or payload.get("status") != "PARTIAL_SOURCE_ARCHIVE_COVERAGE_NOT_NATIVE_REPLAY"
            or payload.get("orderAuthority") is not False
            or payload.get("productionEligible") is not False
            or payload.get("executionQuotesOrFillsCertified") is not False
            or payload.get("fullAnnualSevenWalletReplayed") is not False
            or payload.get("rootCertificateIssued") is not False):
        raise ValueError("Q102_H1_ARCHIVE_RELEASE_SCOPE_INVALID")
    folders = payload.get("folders", {})
    if set(folders) != set(SOURCE_FOLDERS):
        raise ValueError("Q102_H1_ARCHIVE_FOLDER_SCOPE_INVALID")
    main, warm = [folders[p] for p in SOURCE_FOLDERS]
    overlap = sorted(set(main) & set(warm))
    valid = []
    for folder in (main, warm):
        for symbol, row in folder.items():
            first = row.get("firstOpenMs")
            last = row.get("lastOpenMs")
            count = row.get("rows")
            pre = row.get("prehistory181dRows")
            bad = row.get("prehistory181dInvalidOHLCOrTime")
            gaps = row.get("prehistory181dDiscontinuities")
            if (not symbol.isalnum() or not row.get("filename", "").startswith(symbol + "USDT-1h-")
                    or not isinstance(row.get("sha256"), str)
                    or len(row["sha256"]) != 64
                    or any(z not in "0123456789abcdef" for z in row["sha256"])
                    or type(count) is not int or count <= 0
                    or type(pre) is not int or not 0 <= pre <= 181 * 24
                    or type(bad) is not int or bad < 0
                    or type(gaps) is not int or gaps < 0
                    or not isinstance(first, int) or not isinstance(last, int)
                    or last < first or (last - first) // H + 1 < count
                    or row.get("fillsOrPricesCertified") is not False):
                raise ValueError("Q102_H1_ARCHIVE_ROW_PROVENANCE_INVALID:" + symbol)
            if row["covers181dToTargetStart"] and (
                    pre != 181 * 24 or bad != 0 or gaps != 0
                    or first > CAUSAL_181D_START or last < TARGET_START - H):
                raise ValueError("Q102_H1_ARCHIVE_CAUSAL_PREHISTORY_FALSIFIED:" + symbol)
    for symbol in overlap:
        if warm[symbol]["covers181dToTargetStart"]:
            valid.append(symbol)
    if (payload.get("mainSymbols") != len(main)
            or payload.get("warmupSymbols") != len(warm)
            or payload.get("matchingCount") != len(overlap)
            or payload.get("matchingSymbols") != overlap
            or payload.get("mainWithoutMatchingWarmup") != sorted(set(main) - set(warm))
            or payload.get("matchedWarmupCoveringTargetStart") != valid):
        raise ValueError("Q102_H1_ARCHIVE_COVERAGE_SUMMARY_INVALID")


def verify_btc_aster_binance_conflict(conflict:dict, integrity:dict)->None:
    """A second copy of the corrupt ASTER bar does not authorize Binance repair."""
    if (conflict.get("schema") != "stable4-q102-btc-h1-aster-binance-20250913-exact-source-disagreement/v1"
            or conflict.get("status") != "SOURCE_DATA_CONFLICT_BLOCKED_NO_INTERPOLATION"
            or conflict.get("barOpenMs") != 1757768400000
            or conflict.get("barCloseMs") != 1757771999999
            or any(conflict.get(k) is not False for k in (
                "autoRepairApplied", "priceSubstitutionAllowed",
                "q102VenueCausalHistoryFixed", "sevenRunnerPortfolioNativeReplayComplete",
                "rootCertificateIssued", "orderAuthority", "productionEligible"))):
        raise ValueError("Q102_BTC_CROSS_VENUE_REPAIR_SCOPE_INVALID")
    ast=conflict.get("aster",{})
    binance=conflict.get("binanceReference",{})
    original=integrity.get("folders",{}).get(
        "aster-public-v3-h1-q102-warmup",{}).get("BTC",{})
    inputs=ast.get("sources")
    expected_main="aster-public-v3-h1-early/BTCUSDT-1h-20250301-20250924.jsonl.gz"
    expected_warm="aster-public-v3-h1-q102-warmup/BTCUSDT-1h-20250301-20261001.jsonl.gz"
    names={i.get("path"):i.get("sha256") for i in inputs} if isinstance(inputs,list) else {}
    if (len(names)!=2 or names.get(expected_main)!="b14581251ac605a8cace032c39ef4ec10561974201796d94e62083dfa7e83fd3"
            or names.get(expected_warm)!=original.get("sha256")
            or names.get(expected_warm)!="d2a29b0142c096ebe2de1cf02010fc25464f7a8a00bccabe3a119a9400ff2ba0"
            or ast.get("open")!=115941.8 or ast.get("high")!=115916.1
            or not ast["high"]<ast["open"]
            or not original.get("prehistory181dInvalidOHLCOrTime")==1
            or binance.get("isSameVenue") is not False
            or binance.get("ohlcInternallyConsistent") is not True
            or binance.get("high")!=115947.5
            or binance.get("open")!=115947.5
            or binance.get("source",{}).get("sha256")!="596723e2c9e64aeacbad0be8bd5d1e5f2878a8ec6545818e4f26e852babfb837"):
        raise ValueError("Q102_BTC_CROSS_VENUE_SOURCE_CONFLICT_INVALID")


def verify_btc_native_m5_disagreement(m5:dict,conflict:dict)->None:
    """Never promote an inconsistent M5 aggregation to a repaired H1 price."""
    if (m5.get("schema")!="stable4-q102-btc-aster-named-m5-aggregation-crosscheck/v1"
            or m5.get("status")!="BLOCKED_H1_AGGREGATION_MISMATCH_WITH_CORRUPT_M5_BAR"
            or m5.get("timestampUtc")!="2025-09-13T13:00:00Z"
            or any(m5.get(k) is not False for k in (
                "automaticH1RepairApplied","venueExecutionCertified","rootCertificateIssued",
                "orderAuthority","productionEligible"))):
        raise ValueError("Q102_BTC_M5_H1_RELEASE_BOUNDARY_INVALID")
    source=m5.get("source",{})
    if (source.get("file")!="PREPERIOD_TRAIN_20250322_20251001/aster-m5/BTCUSDT-5m-20250322-20251001.jsonl.gz"
            or source.get("sha256")!="59aa88e6bc1943945167aebca3c01b67f50d86810731b07b2df44a707607b589"):
        raise ValueError("Q102_BTC_M5_H1_SOURCE_PIN_INVALID")
    rows=m5.get("m5Rows")
    if not isinstance(rows,list) or len(rows)!=12 or m5.get("m5RowsObserved")!=12:
        raise ValueError("Q102_BTC_M5_H1_EXPECTED_TWELVE_CANDLES")
    open_ts=1757768400000
    invalid=[]
    for i,bar in enumerate(rows):
        values=[bar.get(k) for k in ("open","high","low","close","volume")]
        if (bar.get("openTimeMs")!=open_ts+i*300_000
                or any(type(v) not in (int,float) or not math.isfinite(v) for v in values)):
            raise ValueError("Q102_BTC_M5_H1_CAUSAL_CLOCK_OR_VALUE_INVALID")
        op,hi,lo,cl,vol=values
        good=(op>0 and lo>0 and cl>0 and hi>=max(op,cl)
              and lo<=min(op,cl) and vol>=0)
        if bar.get("ohlcValid") is not good:
            raise ValueError("Q102_BTC_M5_H1_INVALID_FLAG_FALSIFIED")
        if not good:
            invalid.append(i)
    if invalid!=[10] or m5.get("invalidM5Indices")!=[10]:
        raise ValueError("Q102_BTC_M5_H1_CORRUPT_BAR_NOT_PRESERVED")
    aggregated={
        "open":rows[0]["open"],
        "high":max(r["high"] for r in rows),
        "low":min(r["low"] for r in rows),
        "close":rows[-1]["close"],
        "volume":round(sum(r["volume"] for r in rows),6),
    }
    h1=m5.get("h1Recorded",{})
    aster=conflict.get("aster",{})
    if (m5.get("m5Aggregate")!=aggregated
            or any(h1.get(k)!=aster.get(k) for k in aggregated)
            or not h1["high"]<h1["open"]
            or not aggregated["high"]>h1["high"]
            or m5.get("h1HighLessThanOpen") is not True
            or m5.get("m5HighExceedsH1High") is not True):
        raise ValueError("Q102_BTC_M5_H1_AGGREGATION_RECONCILIATION_FAILED")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise ValueError("Q102_ARCHIVE_ROOT_REQUIRED")
    print(json.dumps(evaluate(Path(sys.argv[1])), sort_keys=True))
