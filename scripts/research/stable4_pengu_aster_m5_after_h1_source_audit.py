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
    def key(event: dict) -> tuple[int, str, str]:
        return event["entryTs"], event["side"], event["route"]
    baseline = {key(e) for e in ledger["rawSignalEvents"]["BASE"]}
    extended = {key(e) for e in ledger["rawSignalEvents"]["V8_V64"]}
    extension = [e for e in ledger["rawSignalEvents"]["V8_V64"] if key(e) not in baseline]
    cross_arm_dedup = {
        "baseline": len(baseline), "v8V64": len(extended),
        "shared": len(baseline & extended),
        "onlyBaseline": len(baseline - extended),
        "onlyV8V64": len(extended - baseline),
        "union": len(baseline | extended),
        "extendedOnlyByRoute": dict(sorted(Counter(e["route"] for e in extension).items())),
        "crossArmEventsAreIndependentTrades": False,
    }
    return {
        "crossArmDedup": cross_arm_dedup,
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


def verify_report(report: dict, ledger: dict, ledger_raw: bytes) -> None:
    """Fail closed on false venue fills, altered raw H1 events, or forged M5 counts."""
    if (report.get("schema") != "stable4-pengu-h1-signal-aster-m5-tape-quality/v1"
            or report.get("status") != "H1_EVENTS_M5_MARKET_DATA_INSPECTED_NO_FILLS"
            or report.get("sourceH1LedgerSha256") != hashlib.sha256(ledger_raw).hexdigest()
            or any(report.get(field) is not False for field in
                ("singleSevenWalletNativeReplay","entryExecutionOrNativeExitCertified",
                 "liveEligible","rootCertificateIssued","orderAuthority"))):
        raise ValueError("PENGU_M5_REPORT_SOURCE_OR_RELEASE_SCOPE_INVALID")
    summary = report.get("archiveClockCoverage", {})
    files = report.get("asterM5SourceFiles", [])
    if (summary.get("fromMs") != START or summary.get("untilMsExclusive") != END
            or summary.get("totalM5") != (END - START) // M5
            or summary.get("invalidM5") != 0
            or not isinstance(summary.get("zeroVolumeM5"), int)
            or summary["zeroVolumeM5"] < 0 or summary["zeroVolumeM5"] > summary["totalM5"]
            or not isinstance(files,list) or len(files) != 2):
        raise ValueError("PENGU_M5_REPORT_ARCHIVE_COVERAGE_INVALID")
    previous_last = None
    total = 0
    for i, ((folder, filename, digest), doc) in enumerate(zip(INPUTS, files)):
        if (doc.get("folder") != folder or doc.get("file") != filename
                or doc.get("sha256") != digest
                or type(doc.get("rows")) is not int or doc["rows"] <= 0
                or type(doc.get("firstMs")) is not int or type(doc.get("lastMs")) is not int
                or doc["lastMs"] - doc["firstMs"] != (doc["rows"] - 1) * M5
                or (i == 0 and doc["firstMs"] != START)
                or (i > 0 and doc["firstMs"] != previous_last + M5)):
            raise ValueError("PENGU_M5_REPORT_ARCHIVE_SOURCE_PIN_OR_GAP_INVALID")
        total += doc["rows"]
        previous_last = doc["lastMs"]
    if total != summary["totalM5"] or previous_last != END - M5:
        raise ValueError("PENGU_M5_REPORT_ARCHIVE_TOTAL_INVALID")
    if set(report.get("events", {})) != {"BASE","V8_V64"} or set(report.get("arms", {})) != {"BASE","V8_V64"}:
        raise ValueError("PENGU_M5_REPORT_ALTERNATE_ARM_INVALID")
    for arm in ("BASE","V8_V64"):
        originals = ledger.get("rawSignalEvents", {}).get(arm)
        rows = report["events"][arm]
        counts = report["arms"][arm]
        if (not isinstance(originals,list) or not isinstance(rows,list)
                or len(rows) != len(originals)
                or len(rows) != (54 if arm == "BASE" else 112)
                or counts.get("rawH1Signals") != len(rows)
                or counts.get("actualVenueFillsVerified") != 0
                or counts.get("noOrderAuthority") is not True):
            raise ValueError("PENGU_M5_REPORT_SOURCE_H1_ARM_MISMATCH:" + arm)
        first_5m = any_15m = all_15m = zero_15m = invalid_15m = 0
        for source, row in zip(originals, rows):
            ts = source.get("entryTs")
            obs = row.get("m5BarsAfterSignal")
            allowed = {"M5_BAR_MISSING","M5_BAR_INVALID",
                       "M5_BAR_ZERO_VOLUME","M5_BAR_POSITIVE_VOLUME_UNCERTIFIED"}
            if (type(ts) is not int or row.get("entryTs") != ts
                    or row.get("side") != source.get("side")
                    or row.get("route") != source.get("route")
                    or row.get("firstM5CompleteAt") != ts + M5
                    or row.get("first15MinutesCompleteAt") != ts + 3*M5
                    or not isinstance(obs,list) or len(obs) != 3
                    or any(o not in allowed for o in obs)
                    or row.get("entryExecuted") is not False
                    or row.get("nativeExitReplayed") is not False):
                raise ValueError("PENGU_M5_REPORT_EVENT_LINEAGE_OR_CUTOFF_INVALID")
            m5 = obs[0] == "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED"
            any15 = "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED" in obs
            all15 = all(o == "M5_BAR_POSITIVE_VOLUME_UNCERTIFIED" for o in obs)
            invalid = any(o in ("M5_BAR_MISSING", "M5_BAR_INVALID") for o in obs)
            status = ("M5_SOURCE_INVALID" if invalid else
                      "M5_15M_ALL_ZERO_VOLUME" if not any15 else
                      "M5_VOLUME_PRESENT_NOT_EXECUTION_PROOF")
            if (row.get("m5HasPositiveVolumeNotFillProof") is not m5
                    or row.get("anyPositiveVolumeInFirst15m") is not any15
                    or row.get("allThreeM5PositiveNotFillProof") is not all15
                    or row.get("status") != status):
                raise ValueError("PENGU_M5_REPORT_EVENT_VOLUME_OR_STATUS_INVALID")
            first_5m += m5
            any_15m += any15
            all_15m += all15
            zero_15m += status == "M5_15M_ALL_ZERO_VOLUME"
            invalid_15m += invalid
        expected = {
            "first5mPositiveVolume":first_5m,
            "first15mAnyPositiveVolume":any_15m,
            "first15mAllThreePositiveVolume":all_15m,
            "first15mAllZero":zero_15m,
            "first15mInvalidOrMissing":invalid_15m,
        }
        if any(counts.get(key) != val for key,val in expected.items()):
            raise ValueError("PENGU_M5_REPORT_EVENT_TOTALS_MISMATCH:" + arm)
    baseline = {(e["entryTs"],e["side"],e["route"]) for e in ledger["rawSignalEvents"]["BASE"]}
    extended = {(e["entryTs"],e["side"],e["route"]) for e in ledger["rawSignalEvents"]["V8_V64"]}
    extension = [e for e in ledger["rawSignalEvents"]["V8_V64"]
                 if (e["entryTs"],e["side"],e["route"]) not in baseline]
    expected_dedup = {
        "baseline":len(baseline), "v8V64":len(extended),
        "shared":len(baseline & extended),
        "onlyBaseline":len(baseline-extended),
        "onlyV8V64":len(extended-baseline),
        "union":len(baseline|extended),
        "extendedOnlyByRoute":dict(sorted(Counter(e["route"] for e in extension).items())),
        "crossArmEventsAreIndependentTrades":False,
    }
    if report.get("crossArmDedup") != expected_dedup:
        raise ValueError("PENGU_M5_REPORT_CROSS_ARM_DEDUP_FALSIFIED")


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
