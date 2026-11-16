"""Prepare a source-bound, public-GET-only Q102 evidence request plan OFFLINE.

No network, credentials, live runners, venue orders, or activation. The plan
does not certify source trust, writer exclusion or a deployable bootstrap.
Source observations and market-data cache remain on the owner PC.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import time

HOUR = 3_600_000
M5 = 300_000
MAX_RANGE = 90 * 86_400_000
SYMBOL = re.compile(r"[A-Z0-9]+USDT\Z")
ARCHIVE_SUFFIX = "-5m-20261001-20261108T20.jsonl.gz"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Q102_REQUEST_DUPLICATE_KEY")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError("Q102_REQUEST_NONFINITE_JSON:" + value)

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject_constant)


def integer(value):
    return type(value) is int and 0 <= value <= 9_007_199_254_740_991


def candle_ts(row):
    if not isinstance(row, list) or len(row) < 6:
        raise ValueError("Q102_ARCHIVE_ROW_INVALID")
    value = row[0]
    if type(value) is int:
        result = value
    elif isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        result = int(value)
    else:
        raise ValueError("Q102_ARCHIVE_TIMESTAMP_INVALID")
    if not integer(result) or result % M5:
        raise ValueError("Q102_ARCHIVE_TIMESTAMP_INVALID")
    return result


def archive_prefix(*, root, symbol, start, through):
    """Conservatively use only uninterrupted, sorted, 5m archival coverage."""
    archive = root / (symbol + ARCHIVE_SUFFIX)
    if not archive.exists():
        return start, {"symbol": symbol, "archivePresent": False,
                       "localCompleteBars": 0, "archiveSha256": None}
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > 100_000_000:
        raise ValueError("Q102_ARCHIVE_UNTRUSTED_FILE:" + symbol)
    raw = archive.read_bytes()
    try:
        data = gzip.decompress(raw)
    except (OSError, EOFError) as e:
        raise ValueError("Q102_ARCHIVE_GZIP_INVALID:" + symbol) from e
    if len(data) > 250_000_000:
        raise ValueError("Q102_ARCHIVE_TOO_LARGE")
    expected, last, complete = start, -1, 0
    gap = False
    for line in data.splitlines():
        if not line.strip():
            continue
        t = candle_ts(strict_json(line))
        if t <= last:
            raise ValueError("Q102_ARCHIVE_DUPLICATE_OR_UNSORTED:" + symbol)
        last = t
        if t < start or t > through or gap:
            continue
        if t > expected:
            gap = True
        elif t == expected:
            # The public collector may need the incomplete candle at 'through'.
            if t < through:
                complete += 1
            expected += M5
        # t < expected cannot occur with strictly increasing unique times.
    return expected, {"symbol": symbol, "archivePresent": True,
                      "localCompleteBars": complete, "archiveSha256": sha256(raw)}


def build(*, observations_raw, rolling_raw, m5_root, now_ms):
    observed = strict_json(observations_raw)
    rolling = strict_json(rolling_raw)
    if not isinstance(observed, dict) or not isinstance(rolling, dict):
        raise ValueError("Q102_REQUEST_INPUT_SCHEMA")
    if (observed.get("schema") != "disdex-stable4-observation-bootstrap/v1"
            or observed.get("status") != "OBSERVATIONS_CAUGHT_UP_OUTCOME_EVIDENCE_PENDING"
            or observed.get("ordersEnabled") is not False
            or observed.get("ordersSent") != 0
            or rolling.get("version") != 1):
        raise ValueError("Q102_REQUEST_OBSERVATION_UNTRUSTED")
    cache_sha = sha256(rolling_raw)
    if observed.get("sourceCacheSha256") != cache_sha:
        raise ValueError("Q102_REQUEST_ROLLING_HASH_MISMATCH")
    frontier = observed.get("lastObserved")
    model = observed.get("model")
    if (not integer(frontier) or frontier % HOUR or not isinstance(model, dict)
            or model.get("observedThrough") != frontier
            or not integer(now_ms) or frontier + HOUR > now_ms):
        raise ValueError("Q102_REQUEST_FRONTIER_INVALID")
    rows = observed.get("pendingEvidenceRequests")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20:
        raise ValueError("Q102_REQUEST_COUNT")
    seen, requests, coverage, total = set(), [], [], 0
    for q in rows:
        if not isinstance(q, dict):
            raise ValueError("Q102_REQUEST_ROW_INVALID")
        symbol = q.get("symbol")
        start, through, m5, count = (q.get("from"), q.get("through"),
                                     q.get("includeM5"), q.get("pendingCount"))
        if (not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol)
                or symbol in seen or not integer(start) or not integer(through)
                or start <= 0 or start % M5 or through % M5 or through < start
                or through - start > MAX_RANGE or through > now_ms
                or through > frontier + HOUR or type(m5) is not bool
                or not integer(count) or count == 0):
            raise ValueError("Q102_REQUEST_ROW_INVALID")
        seen.add(symbol)
        total += count
        if m5:
            supplement, audit = archive_prefix(
                root=Path(m5_root), symbol=symbol, start=start, through=through)
        else:
            supplement = through + M5
            audit = {"symbol": symbol, "archivePresent": False,
                     "localCompleteBars": 0, "archiveSha256": None,
                     "m5Required": False}
        requests.append({"symbol": symbol, "from": start, "through": through,
                         "includeM5": m5, "supplementFrom": supplement})
        coverage.append(audit)
    if total != model.get("pendingContinuationRows"):
        raise ValueError("Q102_REQUEST_PENDING_COUNT_MISMATCH")
    requests.sort(key=lambda x: x["symbol"])
    coverage.sort(key=lambda x: x["symbol"])
    return {"schema": "disdex-stable4-public-bootstrap-requests/v1",
            "sourceCacheSha256": cache_sha,
            "observationsSummarySha256": sha256(observations_raw),
            "observedThrough": frontier, "requests": requests,
            "localArchiveCoverage": coverage,
            "ordersEnabled": False, "ordersSent": 0,
            "sourceParserReviewed": False, "writerExclusionCertified": False,
            "bootstrapInstallationAuthorized": False}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--observations-summary", required=True, type=Path)
    p.add_argument("--rolling-h1", required=True, type=Path)
    p.add_argument("--m5-root", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    for path in (args.observations_summary, args.rolling_h1, args.m5_root, args.output):
        if not path.is_absolute():
            p.error("ABSOLUTE_PATHS_REQUIRED")
    if not args.m5_root.is_dir() or args.m5_root.is_symlink():
        p.error("LOCAL_M5_ROOT_MISSING")
    plan = build(observations_raw=args.observations_summary.read_bytes(),
                 rolling_raw=args.rolling_h1.read_bytes(),
                 m5_root=args.m5_root, now_ms=int(time.time()*1000))
    data = (json.dumps(plan, indent=2, sort_keys=True, ensure_ascii=True)+"\n").encode()
    if args.output.is_symlink():
        p.error("OUTPUT_SYMLINK_REJECTED")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        args.output.unlink(missing_ok=True)
        raise
    print(json.dumps({"status": "REVIEW_ONLY_PUBLIC_GET_PLAN_PREPARED",
                      "planSha256": sha256(data),
                      "requestCount": len(plan["requests"]),
                      "sourceSha256": plan["sourceCacheSha256"],
                      "bootstrapInstallationAuthorized": False,
                      "ordersSent": 0}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
