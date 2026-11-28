"""Verify the independent Binance PENGU native H1 annual source-event ledger.

Research-only audit of immutable input digests and all raw source events.
No signed ASTER fills, funding PnL, owner certificate, or LIVE authority.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "docs/research/STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json"
H = 3600000
START = 1759276800000  # 2025-10-01T00:00:00Z
END = 1790812800000    # 2026-10-01T00:00:00Z
NATIVE_BLOB_PINS = {
    "lib/pengu-dual-ls-v2.ts": "c8f4ee8b906b12ae2e10c71205f02d602090fe97",
    "config/penguDualLsV2Runtime.ts": "87fb2e0df27d739f50ebc5b924af8ce6b694e6e8",
    "lib/pengu-recovery-v8.ts": "b42013283aa1fedc7b289bca883e95b10684c30a",
    "config/penguRecoveryV8.ts": "5691802c42b94692b9fe26067c4674e794099bb6",
    "lib/disdex-v35-signal-engine.ts": "b6615e6df25ad90fefb503e6b0f3bcd24ddffb5e",
}
DATA_DIGEST_PINS = {
    "pengu": "9f287209dbffc67d447433cdc5f8b159a459659554b2e07282b236bab1676af0",
    "btc": "155accb6e2885bdafe72c0eb48c3737f85daca44caaea4272c932c41a826ac6c",
    "funding": "f2220113447f695ffd40a8cd59c4428d3dc9cb9c30ee8b7e3884dd3ee279738a",
}


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def validate(report: dict, root: Path = ROOT) -> dict:
    if report.get("schema") != "stable4-pengu-real-h1-native-entry-ledger/v1":
        raise ValueError("NATIVE_H1_LEDGER_SCHEMA_INVALID")
    if (report.get("status") != "NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS"
            or report.get("periodUtc") != ["2025-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]
            or report.get("sourceRealMarketData") is not True
            or report.get("executionParityProven") is not False
            or report.get("annualProfitOrDdCertified") is not False
            or report.get("productionEligible") is not False
            or report.get("rootCertificateIssued") is not False
            or report.get("orderAuthority") is not False):
        raise ValueError("NATIVE_H1_LEDGER_CANNOT_CLAIM_EXECUTION")
    for path, digest in NATIVE_BLOB_PINS.items():
        p = root / path
        if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(root):
            raise ValueError("NATIVE_SOURCE_PATH_UNSAFE")
        if git_blob_sha(p.read_bytes()) != digest:
            raise ValueError("NATIVE_SOURCE_GIT_BLOB_PIN_MISMATCH:" + path)
    for name, digest in DATA_DIGEST_PINS.items():
        detail = report.get("input", {}).get(name, {})
        if detail.get("sha256") != digest:
            raise ValueError("NATIVE_REAL_H1_INPUT_DIGEST_MISMATCH:" + name)
        if detail.get("count") != (2627 if name == "funding" else 10512):
            raise ValueError("NATIVE_REAL_H1_INPUT_COVERAGE_MISMATCH:" + name)
    if report.get("featureMissing") != 0 or report.get("ambiguous") != 0:
        raise ValueError("NATIVE_REAL_H1_SOURCE_GAPS")
    totals = {}
    for arm in ("BASE", "V8_V64"):
        entries = report.get("rawSignalEvents", {}).get(arm)
        summary = report.get("arms", {}).get(arm)
        if not isinstance(entries, list) or not isinstance(summary, dict):
            raise ValueError("NATIVE_H1_SOURCE_ARM_MISSING:" + arm)
        if (summary.get("rawCandidates") != len(entries)
                or summary.get("checked") != len(entries)
                or summary.get("mismatches") != 0 or summary.get("details") != []):
            raise ValueError("NATIVE_H1_FULL_EVENT_PARITY_UNVERIFIED:" + arm)
        if summary.get("rawCandidates") != (54 if arm == "BASE" else 112):
            raise ValueError("NATIVE_H1_SOURCE_EVENT_COUNT_CHANGED")
        previous = START - 1
        longs = shorts = 0
        routes = {}
        for row in entries:
            if not isinstance(row, dict):
                raise ValueError("NATIVE_H1_EVENT_SHAPE_INVALID")
            entry = row.get("entryTs")
            bar = row.get("barTs")
            if (not isinstance(entry, int) or isinstance(entry, bool)
                    or not isinstance(bar, int) or isinstance(bar, bool)
                    or entry - bar != H or entry % H or not START <= entry < END
                    or entry <= previous or row.get("symbol") != "PENGUUSDT"
                    or row.get("gross") != 1
                    or row.get("side") not in ("LONG", "SHORT")
                    or row.get("route") not in ("SHORT_V20", "LONG_V2_FINAL", "RECOVERY_V8")
                    or (row["route"] == "SHORT_V20" and row["side"] != "SHORT")
                    or (row["route"] != "SHORT_V20" and row["side"] != "LONG")):
                raise ValueError("NATIVE_H1_SOURCE_EVENT_CAUSALITY_INVALID")
            previous = entry
            longs += row["side"] == "LONG"
            shorts += row["side"] == "SHORT"
            routes[row["route"]] = routes.get(row["route"], 0) + 1
        if (longs != summary.get("longs") or shorts != summary.get("shorts")
                or routes != summary.get("byRoute")):
            raise ValueError("NATIVE_H1_SOURCE_EVENT_SUMMARY_MISMATCH")
        totals[arm] = {"events": len(entries), "longs": longs, "shorts": shorts}
    return {
        "status": "NATIVE_REAL_H1_SOURCE_ENTRY_ONLY_VERIFIED",
        "checkedTotal": sum(v["events"] for v in totals.values()),
        "arms": totals,
        "noVenueM5Certificate": True,
        "noOrders": True,
        "noCumulativeDdOrPnlClaim": True,
    }


def main() -> None:
    print(json.dumps(validate(json.loads(LEDGER.read_text(encoding="utf8"))), sort_keys=True))


if __name__ == "__main__":
    main()
