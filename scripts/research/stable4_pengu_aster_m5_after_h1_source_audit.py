"""PENGU native Binance H1 raw events vs SHA-pinned ASTER M5 market-data quality.

Offline source observation, never a fill/price/slippage/STOP simulation.
An H1 event at t cannot use the ASTER bar [t,t+5m) until t+5m.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path

M5 = 300_000
H = 3_600_000
START = int(datetime(2025, 9, 24, tzinfo=timezone.utc).timestamp() * 1000)
END = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
INPUTS = (
    ("aster-public-v3-5m-prefix", "PENGUUSDT-5m-20250924-20260803.jsonl.gz",
     "daf02f259b0fa6fb4b422e243c1ab9ad3a5b971adda4c502eab3dbe53507daf4"),
    ("aster-public-v3-5m-suffix", "PENGUUSDT-5m-20260803-20261001.jsonl.gz",
     "d683acaec16b304a3b141ca5abd3509bb161cf62aab93ef7a15b1bfff3eeb14b"),
)


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def observe(root: Path, ledger: dict, ledger_sha256: str) -> dict:
    if (ledger.get("schema") != "stable4-pengu-real-h1-native-entry-ledger/v1"
            or ledger.get("status") != "NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS"
            or ledger.get("sourceRealMarketData") is not True
            or ledger.get("executionParityProven") is not False
            or ledger.get("orderAuthority") is not False):
        raise ValueError("PENGU_H1_EVENT_SOURCE_UNVERIFIED")
    if not isinstance(ledger_sha256, str) or len(ledger_sha256) != 64:
        raise ValueError("PENGU_H1_EVENT_LEDGER_SHA_REQUIRED")

    files = []
    tape = {}
    invalid = 0
    zero = 0
    last = None
    previous = None
    for folder, filename, pin in INPUTS:
        path = root / folder / filename
        if not path.is_file() or path.is_symlink():
            raise ValueError("PENGU_ASTER_M5_ARCHIVE_UNSAFE_OR_MISSING")
        actual = sha_file(path)
        if actual != pin:
            raise ValueError("PENGU_ASTER_M5_ARCHIVE_SOURCE_SHA_MISMATCH:" + filename)
        rows = 0
        file_first = None
        with gzip.open(path, "rt", encoding="utf8") as stream:
            for line in stream:
                row = json.loads(line)
                if not isinstance(row, list) or len(row) < 9:
                    raise ValueError("PENGU_ASTER_M5_ARCHIVE_ROW_UNREADABLE")
                ts = row[0]
                if type(ts) is not int or ts % M5 or ts < START or ts >= END:
                    raise ValueError("PENGU_ASTER_M5_ARCHIVE_CLOCK_INVALID")
                if previous is not None and ts != previous + M5:
                    raise ValueError("PENGU_ASTER_M5_ARCHIVE_GAP_OR_DUPLICATE")
                o, h, l, c, v = [float(row[i]) for i in (1, 2, 3, 4, 5)]
                trades = int(row[8])
                valid = (int(row[6]) == ts + M5 - 1 and
                         all(math.isfinite(x) for x in (o, h, l, c, v)) and
                         min(o, l, c) > 0 and h >= max(o, c) and l <= min(o, c) and
                         v >= 0 and trades >= 0 and (v == 0) == (trades == 0))
                if not valid:
                    invalid += 1
                if v == 0:
                    zero += 1
                tape[ts] = (valid, v, trades, c)
                if file_first is None:
                    file_first = ts
                previous = last = ts
                rows += 1
        files.append({"folder": folder, "file": filename, "sha256": actual,
                      "rows": rows, "firstMs": file_first, "lastMs": previous})
    if (not files or files[0]["firstMs"] != START or last != END - M5
            or len(tape) != (END - START) // M5):
        raise ValueError("PENGU_ASTER_M5_ANNUAL_CLOCK_INCOMPLETE")

    by_arm = {}
    observations = {}
    for arm in ("BASE", "V8_V64"):
        signals = ledger.get("rawSignalEvents", {}).get(arm)
        summary = ledger.get("arms", {}).get(arm)
        if (not isinstance(signals, list) or not isinstance(summary, dict)
                or len(signals) != (54 if arm == "BASE" else 112)
                or summary.get("rawCandidates") != len(signals)
                or summary.get("mismatches") != 0):
            raise ValueError("PENGU_H1_RAW_EVENT_COVERAGE_INVALID:" + arm)
        statuses = Counter()
        rows = []
        previous_signal = None
        for event in signals:
            ts = event.get("entryTs")
            if (type(ts) is not int or type(event.get("barTs")) is not int
                    or ts != event["barTs"] + H or ts % H
                    or event.get("symbol") != "PENGUUSDT"
                    or event.get("side") not in ("LONG", "SHORT")
                    or event.get("route") not in ("SHORT_V20", "LONG_V2_FINAL", "RECOVERY_V8")
                    or event.get("gross") != 1
                    or (previous_signal is not None and ts <= previous_signal)):
                raise ValueError("PENGU_H1_EVENT_CAUSALITY_INVALID:" + arm)
            previous_signal = ts
            obs = []
            for offset in (0, M5, 2 * M5):
                row = tape.get(ts + offset)
                if row is None:
                    obs.append("M5_BAR_MISSING")
                elif not row[0]:
                    obs.append("M5_BAR_INVALID")
                elif row[1] == 0:
                    obs.append("M5_BAR_ZERO_VOLUME")
                else:
                    obs.append("M5_BAR_POSITIVE_VOLUME_UNCERTIFIED")
            # A 5m bar following an H1 event is only observable when CLOSED.
            # Positive volume is not a venue executable bid/ask or fill proof.
            m5 = obs[0] == "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED"
            m15 = all(x == "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED" for x in obs)
            any15 = any(x == "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED" for x in obs)
            status = ("M5_SOURCE_INVALID" if any(x in ("M5_BAR_MISSING", "M5_BAR_INVALID") for x in obs)
                      else "M5_15M_ALL_ZERO_VOLUME" if not any15
                      else "M5_VOLUME_PRESENT_NOT_EXECUTION_PROOF")
            statuses[status] += 1
            rows.append({
                "entryTs": ts, "side": event["side"], "route": event["route"],
                "m5BarsAfterSignal": obs,
                "firstM5CompleteAt": ts + M5,
                "first15MinutesCompleteAt": ts + 3 * M5,
                "m5HasPositiveVolumeNotFillProof": m5,
                "allThreeM5PositiveNotFillProof": m15,
                "anyPositiveVolumeInFirst15m": any15,
                "status": status, "entryExecuted": False,
                "nativeExitReplayed": False,
            })
        observations[arm] = rows
        by_arm[arm] = {
            "rawH1Signals": len(signals),
            "first5mPositiveVolume": sum(x["m5HasPositiveVolumeNotFillProof"] for x in rows),
            "first15mAnyPositiveVolume": sum(x["anyPositiveVolumeInFirst15m"] for x in rows),
            "first15mAllThreePositiveVolume": sum(x["allThreeM5PositiveNotFillProof"] for x in rows),
            "first15mAllZero": statuses["M5_15M_ALL_ZERO_VOLUME"],
            "first15mInvalidOrMissing": statuses["M5_SOURCE_INVALID"],
            "actualVenueFillsVerified": 0,
            "noOrderAuthority": True,
        }
    return {
        "schema": "stable4-pengu-h1-signal-aster-m5-tape-quality/v1",
        "status": "H1_EVENTS_M5_MARKET_DATA_INSPECTED_NO_FILLS",
        "sourceH1LedgerSha256": ledger_sha256,
        "asterM5SourceFiles": files,
        "archiveClockCoverage": {"fromMs": START, "untilMsExclusive": END,
                                 "totalM5": len(tape), "invalidM5": invalid,
                                 "zeroVolumeM5": zero},
        "arms": by_arm, "events": observations,
        "limitations": [
            "ASTER public M5 candle close becomes observable only at t+5m; a 15m window only at t+15m",
            "A nonzero M5 volume does not certify executable entry, size, slippage, exchange order, or fill",
            "This is 166 H1 raw-source candidates across two alternate configuration arms, NOT 166 unique trades",
            "No signed Binance-to-ASTER 5m confirmation policy, actual venue fills, STOP, fees, funding, Gross or DD",
            "No source-native exit lifecycle, cross-runner one-wallet replay, certificate or Owner permission",
        ],
        "singleSevenWalletNativeReplay": False,
        "entryExecutionOrNativeExitCertified": False,
        "liveEligible": False, "rootCertificateIssued": False, "orderAuthority": False,
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 4:
        raise ValueError("PENGU_DATA_ROOT_H1_LEDGER_AND_OUTPUT_REQUIRED")
    root, source, output = [Path(x) for x in sys.argv[1:]]
    raw = source.read_bytes()
    report = observe(root, json.loads(raw), hashlib.sha256(raw).hexdigest())
    with output.open("x", encoding="utf8") as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps({"status": report["status"], "arms": report["arms"],
                      "archive": report["archiveClockCoverage"],
                      "orderAuthority": False}))
