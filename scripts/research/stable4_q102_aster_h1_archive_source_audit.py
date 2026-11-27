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
            if (ts % H or close_ts != ts + H - 1
                    or not all(math.isfinite(z) for z in (op, high, low, close, volume))
                    or min(op, low, close) <= 0 or low > min(op, close)
                    or high < max(op, close) or volume < 0):
                bad += 1
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
        "covers181dToTargetStart": first <= CAUSAL_181D_START
            and last >= TARGET_START - H and gaps == 0
            and duplicated == 0 and bad == 0,
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


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise ValueError("Q102_ARCHIVE_ROOT_REQUIRED")
    print(json.dumps(evaluate(Path(sys.argv[1])), sort_keys=True))
