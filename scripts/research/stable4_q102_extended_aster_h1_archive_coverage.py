"""Source-hashed continuous ASTER-named H1 archive inventory for year + Q102 181d prehistory.

Read-only: never repair invalid candles, substitute exchange prices, infer
native Q102 entries or certify an executable venue quote/fill/STOP.
"""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path

H = 3_600_000
START = int(datetime(2025, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
END = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
PRE_START = START - 181 * 24 * H
MAIN = "aster-public-v3-h1"
EARLY = "aster-public-v3-h1-early"


def audit_file(file: Path) -> tuple[dict, dict[int, bool]]:
    if not file.is_file() or file.is_symlink() or not file.name.endswith(".jsonl.gz"):
        raise ValueError("Q102_EXTENDED_H1_ARCHIVE_UNSAFE")
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    bars: dict[int, bool] = {}
    first = last = previous = None
    count = zero = invalid = duplicate_or_reversed = missing_h1_slots = 0
    examples = []
    with gzip.open(file, "rt", encoding="utf8") as stream:
        for line in stream:
            row = json.loads(line)
            if not isinstance(row, list) or len(row) < 8:
                raise ValueError("Q102_EXTENDED_H1_ROW_SHAPE_INVALID:" + file.name)
            try:
                ts = int(row[0])
                close_ts = int(row[6])
                op, high, low, close, volume = [float(row[i]) for i in (1, 2, 3, 4, 5)]
            except (TypeError, ValueError, OverflowError, IndexError) as error:
                raise ValueError("Q102_EXTENDED_H1_ROW_NUMERIC_INVALID:" + file.name) from error
            if previous is not None:
                if ts <= previous:
                    duplicate_or_reversed += 1
                elif ts > previous + H and (ts - previous) % H == 0:
                    missing_h1_slots += (ts - previous) // H - 1
                elif ts != previous + H:
                    invalid += 1
            good = (
                ts > 0 and ts % H == 0 and close_ts == ts + H - 1
                and all(math.isfinite(v) for v in (op, high, low, close, volume))
                and min(op, low, close) > 0
                and high >= max(op, close) and low <= min(op, close)
                and volume >= 0
            )
            if not good:
                invalid += 1
                if len(examples) < 8:
                    examples.append(ts)
            zero += int(volume == 0)
            if ts in bars:
                duplicate_or_reversed += 1
            bars[ts] = bool(good)
            first = ts if first is None else first
            last = previous = ts
            count += 1
    # An empty file is a genuine source-coverage failure for its symbol,
    # not a reason to discard the remaining 35+ independently readable files.
    # Keep the source digest and zero-row metadata for fail-closed reporting.
    return ({
        "file": file.name,
        "sha256": digest.hexdigest(),
        "rows": count,
        "firstOpenMs": first,
        "lastOpenMs": last,
        "zeroVolumeH1": zero,
        "invalidH1": invalid,
        "duplicateOrReversed": duplicate_or_reversed,
        "missingH1Slots": missing_h1_slots,
        "invalidExampleOpenMs": examples,
    }, bars)


def evaluate(root: Path) -> dict:
    directory = root.resolve()
    data = {}
    for folder in (MAIN, EARLY):
        path = directory / folder
        if not path.is_dir() or path.is_symlink():
            raise ValueError("Q102_EXTENDED_H1_DIRECTORY_UNSAFE_OR_MISSING:" + folder)
        per = {}
        for file in sorted(path.glob("*USDT-1h-*.jsonl.gz")):
            symbol = file.name.split("USDT-1h-", 1)[0]
            if not symbol.isalnum() or symbol in per:
                raise ValueError("Q102_EXTENDED_H1_DUPLICATED_OR_INVALID_SYMBOL:" + folder)
            info, bars = audit_file(file)
            per[symbol] = (info, bars)
        if not per:
            raise ValueError("Q102_EXTENDED_H1_DIRECTORY_EMPTY:" + folder)
        data[folder] = per
    main = data[MAIN]
    early = data[EARLY]
    by_ticker = {}
    for symbol, (main_info, main_bars) in sorted(main.items()):
        early_info, early_bars = early.get(symbol, (None, {}))
        overlap = set(early_bars).intersection(main_bars)
        combined = dict(early_bars)
        combined.update(main_bars)
        def count_region(begin: int, end: int) -> dict:
            total = (end - begin) // H
            missing = invalid = 0
            for ts in range(begin, end, H):
                row = combined.get(ts)
                missing += int(row is None)
                invalid += int(row is False)
            return {
                "requiredHours": total,
                "missingHours": missing,
                "invalidHours": invalid,
                "validHours": total - missing - invalid,
                "closedH1HistoryReady": missing == 0 and invalid == 0 and not overlap,
            }
        prior = count_region(PRE_START, START)
        study = count_region(START, END)
        by_ticker[symbol] = {
            "main": main_info,
            "early": early_info,
            "earlyMainTimestampOverlap": len(overlap),
            "prior181d": prior,
            "studyYear": study,
            "yearAndCausalPrior181dReady": (
                prior["closedH1HistoryReady"] and study["closedH1HistoryReady"]
            ),
            "signalOrVenueExecutionProven": False,
        }
    ready = sorted(s for s,v in by_ticker.items() if v["yearAndCausalPrior181dReady"])
    return {
        "schema": "stable4-q102-aster-main-early-h1-full-year-pre181d-source-inventory/v1",
        "status": "LOCAL_H1_PRICE_HISTORY_READINESS_ONLY_NO_SOURCE_NATIVE_TRADES",
        "sourceDirectories": [MAIN, EARLY],
        "studyWindowUtc": ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"],
        "prior181dWindowUtc": ["2025-04-03T00:00:00Z", "2025-10-01T00:00:00Z"],
        "prior181dHours": (START - PRE_START) // H,
        "yearHours": (END - START) // H,
        "mainSymbols": len(main),
        "earlySymbols": len(early),
        "missingEarlySymbols": sorted(set(main) - set(early)),
        "yearAndPrior181dReadySymbols": ready,
        "yearAndPrior181dReadyCount": len(ready),
        "perTicker": by_ticker,
        "limitations": [
            "Two exact ASTER-named local public H1 archive directories only, not signed ASTER source or actual venue execution",
            "A valid hour with zero volume is usable as a closed H1 candle only under native source policy, never by itself an executable price",
            "Fails closed on missing, corrupt or duplicate causal H1 history, does not interpolate or substitute Binance",
            "H1 price history readiness is NOT the current approved Q102 multi-route universe, signal, ASTER M5 fill or STOP parity",
            "No PENGU/V4/IDLE/FET/HYPE/V52 native portfolio execution or account funding/Gross/DD, certificates or Owner approval",
        ],
        "fullNativeQ102AnnualEntryOrExitProven": False,
        "fullSevenRunnerSharedWalletReplayed": False,
        "rootCertificateIssued": False,
        "orderAuthority": False,
        "productionEligible": False,
    }


REVIEWED_EVIDENCE_GIT_BLOB_SHA1 = "fde409c99505a3fb9c36491a06a043a421482ac4"


def verify_snapshot(report: dict) -> None:
    """Frozen local source-H1 readiness, not strategy execution authorization."""
    if (report.get("schema") != "stable4-q102-aster-main-early-h1-full-year-pre181d-source-inventory/v1"
            or report.get("status") != "LOCAL_H1_PRICE_HISTORY_READINESS_ONLY_NO_SOURCE_NATIVE_TRADES"
            or report.get("studyWindowUtc") != ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"]
            or report.get("prior181dWindowUtc") != ["2025-04-03T00:00:00Z", "2025-10-01T00:00:00Z"]
            or report.get("sourceDirectories") != [MAIN, EARLY]
            or report.get("prior181dHours") != 4344 or report.get("yearHours") != 8760
            or report.get("mainSymbols") != 36 or report.get("earlySymbols") != 31
            or any(report.get(flag) is not False for flag in (
                "fullNativeQ102AnnualEntryOrExitProven", "fullSevenRunnerSharedWalletReplayed",
                "rootCertificateIssued", "orderAuthority", "productionEligible"))):
        raise ValueError("Q102_EXTENDED_H1_SOURCE_SCOPE_OR_RELEASE_INVALID")
    rows = report.get("perTicker")
    if not isinstance(rows, dict) or len(rows) != 36:
        raise ValueError("Q102_EXTENDED_H1_SYMBOL_COUNT_INVALID")
    missing = []
    ready = []
    num_early = 0
    for symbol, entry in rows.items():
        if not symbol.isalnum() or not symbol.isupper() or not isinstance(entry, dict):
            raise ValueError("Q102_EXTENDED_H1_SYMBOL_INVALID")
        main = entry.get("main")
        early = entry.get("early")
        if not isinstance(main, dict):
            raise ValueError("Q102_EXTENDED_H1_MAIN_SOURCE_MISSING:" + symbol)
        if early is None:
            missing.append(symbol)
        else:
            num_early += 1
        for group, part in ((MAIN, main), (EARLY, early)):
            if part is None:
                continue
            sha = part.get("sha256")
            if (not isinstance(sha, str) or len(sha) != 64
                    or any(ch not in "0123456789abcdef" for ch in sha)
                    or not isinstance(part.get("file"), str)
                    or not part["file"].startswith(symbol + "USDT-1h-")
                    or not part["file"].endswith(".jsonl.gz")
                    or type(part.get("rows")) is not int or part["rows"] < 0
                    or type(part.get("invalidH1")) is not int or part["invalidH1"] < 0
                    or type(part.get("missingH1Slots")) is not int or part["missingH1Slots"] < 0
                    or type(part.get("duplicateOrReversed")) is not int or part["duplicateOrReversed"] < 0
                    or part["invalidH1"] > part["rows"] + part["missingH1Slots"]):
                raise ValueError("Q102_EXTENDED_H1_SOURCE_DIGEST_OR_SHAPE_INVALID:" + symbol)
        prior, year = entry.get("prior181d"), entry.get("studyYear")
        for section, expected in ((prior, 4344), (year, 8760)):
            if not isinstance(section, dict) or section.get("requiredHours") != expected:
                raise ValueError("Q102_EXTENDED_H1_WINDOW_GRAIN_INVALID:" + symbol)
            valid, absent, invalid = (section.get(k) for k in ("validHours", "missingHours", "invalidHours"))
            if (any(type(v) is not int or v < 0 for v in (valid, absent, invalid))
                    or valid + absent + invalid != expected):
                raise ValueError("Q102_EXTENDED_H1_WINDOW_COUNTS_INVALID:" + symbol)
            expected_ready = absent == 0 and invalid == 0 and entry.get("earlyMainTimestampOverlap") == 0
            if section.get("closedH1HistoryReady") is not expected_ready:
                raise ValueError("Q102_EXTENDED_H1_WINDOW_READINESS_FORGED:" + symbol)
        is_ready = prior["closedH1HistoryReady"] and year["closedH1HistoryReady"]
        if (entry.get("yearAndCausalPrior181dReady") is not is_ready
                or entry.get("signalOrVenueExecutionProven") is not False):
            raise ValueError("Q102_EXTENDED_H1_NATIVE_SIGNAL_SCOPE_FORGED:" + symbol)
        if is_ready:
            ready.append(symbol)
    if (num_early != 31 or sorted(missing) != report.get("missingEarlySymbols")
            or sorted(ready) != report.get("yearAndPrior181dReadySymbols")
            or len(ready) != report.get("yearAndPrior181dReadyCount")
            or len(ready) != 21):
        raise ValueError("Q102_EXTENDED_H1_COVERAGE_SUMMARY_MISMATCH")
    if (rows["BTC"]["prior181d"]["invalidHours"] != 1
            or rows["FET"]["studyYear"]["missingHours"] != 2418
            or rows["LDO"]["early"]["rows"] != 0):
        raise ValueError("Q102_EXTENDED_H1_CRITICAL_SOURCE_ANOMALY_ERASED")


def verify_reviewed_snapshot(raw: bytes) -> dict:
    """Review SHA of the complete immutable source report before trusting summaries."""
    if not isinstance(raw, bytes):
        raise ValueError("Q102_EXTENDED_H1_REVIEWED_SNAPSHOT_BYTES_REQUIRED")
    sha1 = hashlib.sha1(
        b"blob " + str(len(raw)).encode("ascii") + b"\\0" + raw
    ).hexdigest()
    if sha1 != REVIEWED_EVIDENCE_GIT_BLOB_SHA1:
        raise ValueError("Q102_EXTENDED_H1_REVIEWED_SNAPSHOT_SHA_MISMATCH")
    report = json.loads(raw)
    verify_snapshot(report)
    return report


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise ValueError("Q102_EXTENDED_H1_ARCHIVE_ROOT_REQUIRED")
    print(json.dumps(evaluate(Path(sys.argv[1])), sort_keys=True, ensure_ascii=False))
