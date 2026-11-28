"""Source-hashed, monthly rolling 181d Q102 H1 readiness; no strategy or fills."""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path

H=3_600_000
FIRST_YEAR=2025
MONTHS=[(2025,m) for m in (10,11,12)]+[(2026,m) for m in range(1,10)]


def monthly(data_root:Path, integrity:dict)->dict:
    if (integrity.get("schema")!="stable4-q102-aster-archived-h1-source-integrity/v1"
            or integrity.get("orderAuthority") is not False
            or integrity.get("executionQuotesOrFillsCertified") is not False):
        raise ValueError("Q102_MONTHLY_SOURCE_INTEGRITY_MISSING")
    warmup=integrity["folders"]["aster-public-v3-h1-q102-warmup"]
    rows={}
    for ticker,meta in sorted(warmup.items()):
        path=data_root/"aster-public-v3-h1-q102-warmup"/meta["filename"]
        if not path.is_file() or path.is_symlink():
            raise ValueError("Q102_MONTHLY_ARCHIVE_MISSING:"+ticker)
        h=hashlib.sha256(path.read_bytes()).hexdigest()
        if h!=meta["sha256"]:
            raise ValueError("Q102_MONTHLY_ARCHIVE_SHA_MISMATCH:"+ticker)
        prices={}
        with gzip.open(path,"rt",encoding="utf8") as fd:
            for line in fd:
                a=json.loads(line)
                if not isinstance(a,list) or len(a)<8:
                    raise ValueError("Q102_MONTHLY_H1_ROW_INVALID:"+ticker)
                ts=int(a[0])
                op,hi,lo,cl,vol=[float(a[i]) for i in (1,2,3,4,5)]
                valid=(ts%H==0 and int(a[6])==ts+H-1
                       and all(math.isfinite(z) for z in (op,hi,lo,cl,vol))
                       and min(op,lo,cl)>0 and hi>=max(op,cl)
                       and lo<=min(op,cl) and vol>=0)
                if ts in prices:
                    raise ValueError("Q102_MONTHLY_DUPLICATE_ARCHIVE_HOUR:"+ticker)
                prices[ts]=valid
        conditions=[]
        for year,month in MONTHS:
            clock=int(datetime(year,month,1,tzinfo=timezone.utc).timestamp()*1000)
            required=[prices.get(ts) for ts in range(clock-181*24*H,clock,H)]
            bad=sum(v is False for v in required)
            absent=sum(v is None for v in required)
            status=("H1_181D_INVALID_SOURCE" if bad else
                    "H1_181D_INCOMPLETE_SOURCE" if absent else
                    "H1_181D_CLOSED_HISTORY_ONLY")
            conditions.append({"decisionMonth":f"{year:04d}-{month:02d}",
                               "status":status,"badH1":bad,"missingH1":absent,
                               "signalComputed":False,"venueEntryProven":False})
        rows[ticker]={"inputSha256":h,"months":conditions,
                      "historyReadyMonths":sum(r["status"]=="H1_181D_CLOSED_HISTORY_ONLY" for r in conditions)}
    return {
        "schema":"stable4-q102-archived-h1-monthly-181d-readiness/v1",
        "status":"PARTIAL_H1_HISTORY_READINESS_NO_NATIVE_SIGNALS_OR_FILLS",
        "intervalUtc":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
        "monthlyClocks":12,"requiredPriorDays":181,"archiveSourceSymbols":len(rows),
        "byTicker":rows,
        "limitations":[
            "Only Q102 Aster warmup directory's ten tickers, not complete native selector or all portfolios",
            "181d closed H1 continuity alone cannot establish source entry, Binance direction, ASTER M5 confirmation, fills or STOP",
            "No interpolation of invalid BTC September 2025 H1 or missing ENA/FIL prehistory",
            "Alternative market-data archives were not searched; no proof of actual live pin, funding or margin"
        ],
        "fullQ102NativeTradeReplay":False,"fullSevenRunnerWalletReplay":False,
        "rootCertificateIssued":False,"orderAuthority":False,"productionEligible":False,
    }


def verify_monthly_snapshot(snapshot:dict,source_integrity:dict)->None:
    """A valid H1 observation ledger never proves orders or certifies Q102 trades."""
    if (snapshot.get("schema")!="stable4-q102-archived-h1-monthly-181d-readiness/v1"
        or snapshot.get("status")!="PARTIAL_H1_HISTORY_READINESS_NO_NATIVE_SIGNALS_OR_FILLS"
        or snapshot.get("monthlyClocks")!=12 or snapshot.get("requiredPriorDays")!=181
        or snapshot.get("archiveSourceSymbols")!=10
        or snapshot.get("fullQ102NativeTradeReplay") is not False
        or snapshot.get("fullSevenRunnerWalletReplay") is not False
        or snapshot.get("rootCertificateIssued") is not False
        or snapshot.get("orderAuthority") is not False
        or snapshot.get("productionEligible") is not False):
        raise ValueError("Q102_MONTHLY_HISTORY_RELEASE_SCOPE_INVALID")
    src=source_integrity.get("folders",{}).get("aster-public-v3-h1-q102-warmup",{})
    rows=snapshot.get("byTicker",{})
    if set(src)!=set(rows):
        raise ValueError("Q102_MONTHLY_HISTORY_SYMBOL_SET_MISMATCH")
    expected=[f"{y:04d}-{m:02d}" for y,m in MONTHS]
    for ticker,item in rows.items():
        if item.get("inputSha256")!=src[ticker]["sha256"]:
            raise ValueError("Q102_MONTHLY_HISTORY_SOURCE_SHA_MISMATCH:"+ticker)
        months=item.get("months")
        if not isinstance(months,list) or len(months)!=12 or [r.get("decisionMonth") for r in months]!=expected:
            raise ValueError("Q102_MONTHLY_HISTORY_CLOCKS_INVALID:"+ticker)
        ready=0
        for m in months:
            absent=m.get("missingH1")
            bad=m.get("badH1")
            if (type(absent) is not int or type(bad) is not int or absent<0 or bad<0
                or absent+bad>181*24
                or m.get("signalComputed") is not False
                or m.get("venueEntryProven") is not False):
                raise ValueError("Q102_MONTHLY_HISTORY_ROW_INVALID:"+ticker)
            expected_status=("H1_181D_INVALID_SOURCE" if bad else
                             "H1_181D_INCOMPLETE_SOURCE" if absent else
                             "H1_181D_CLOSED_HISTORY_ONLY")
            if m.get("status")!=expected_status:
                raise ValueError("Q102_MONTHLY_HISTORY_STATUS_FORGED:"+ticker)
            ready+=int(expected_status=="H1_181D_CLOSED_HISTORY_ONLY")
        if item.get("historyReadyMonths")!=ready:
            raise ValueError("Q102_MONTHLY_HISTORY_READY_COUNT_INVALID:"+ticker)


if __name__=="__main__":
    import sys
    if len(sys.argv)!=3:
        raise ValueError("Q102_ARCHIVE_ROOT_AND_SOURCE_INTEGRITY_REQUIRED")
    print(json.dumps(monthly(Path(sys.argv[1]),json.loads(Path(sys.argv[2]).read_text(encoding="utf8"))),sort_keys=True))
