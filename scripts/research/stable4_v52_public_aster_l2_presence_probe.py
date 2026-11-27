"""Public read-only ASTER historical L2 file-presence probe, zero trading authority.

For five V52 stocks, checks a few hourly Parquet files with HTTP Range 0-3
on a public dataset host, never downloads bulk L2 or supplies private keys.
Do not infer continuous archives, true L2 state, execution/liquidity or fills
from 4 bytes of each sampled file.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HOST="https://api.cryptohftdata.com/download?"
SYMBOLS=("AMZNUSDT","METAUSDT","MSFTUSDT","NVDAUSDT","TSLAUSDT")
DATES=("2025-10-01","2026-01-10","2026-05-10","2026-09-02")

def probe():
    observations=[]
    for date in DATES:
        for symbol in SYMBOLS:
            p=f"aster_futures/{date}/12/{symbol}_orderbook.parquet"
            url=HOST+urllib.parse.urlencode({"file":p})
            item={"dateUtc":date,"hourUtc":12,"symbol":symbol,"datasetFile":p,"rangeRequest":"bytes=0-3"}
            try:
                req=urllib.request.Request(url,headers={"Range":"bytes=0-3","User-Agent":"DisDexNativeBT-SourceAudit-ReadOnly/1.0"})
                with urllib.request.urlopen(req,timeout=14) as resp:
                    b=resp.read(4)
                    total=resp.headers.get("Content-Range","")
                    match=re.fullmatch(r"bytes 0-3/(\d+)",total)
                    if resp.status!=206 or b!=b"PAR1" or not match or int(match.group(1))<=8:
                        item.update(status="UNVERIFIED_OR_UNEXPECTED_RANGE_RESPONSE",httpStatus=resp.status,responsePrefixHex=b.hex(),contentRange=total)
                    else:
                        item.update(status="PARQUET_MAGIC_RANGE_CONFIRMED",httpStatus=206,contentLengthBytes=int(match.group(1)))
            except urllib.error.HTTPError as error:
                item.update(status="NOT_CONFIRMED_HTTP_ERROR",httpStatus=error.code)
            except (urllib.error.URLError,TimeoutError) as error:
                item.update(status="NOT_CONFIRMED_NETWORK_ERROR",errorType=type(error).__name__)
            observations.append(item)
            print("PROBE",date,symbol,item["status"],item.get("contentLengthBytes",item.get("httpStatus")),flush=True)
    counts={sym:sum(x["status"]=="PARQUET_MAGIC_RANGE_CONFIRMED" for x in observations if x["symbol"]==sym) for sym in SYMBOLS}
    return {"schema":"stable4-v52-third-party-aster-l2-public-range-presence/v1",
       "status":"SAMPLE_ONLY_NO_ANNUAL_COVERAGE_OR_SOURCE_FILL_PROOF",
       "observedAtUtc":datetime.now(timezone.utc).isoformat(),
       "provider":"CryptoHFTData public historical Aster futures orderbook file endpoint",
       "providerDataset":"https://www.cryptohftdata.com/datasets/aster-orderbook-data",
       "symbols":list(SYMBOLS),"sampleDatesUtc":list(DATES),"observations":observations,
       "confirmedSampleFilesPerSymbol":counts,
       "actualHistoricalL2DataDownloaded":False,"continuousYearlyL2Proven":False,
       "nativeV52EntryReplayProven":False,"fillsCertified":False,"orderAuthority":False,
       "limitations":["Only four UTC-hour probes per symbol using public HTTP Range and Parquet magic, not row or book reconstruction; provider data may have known gaps or imprecise exchange timestamps.",
          "A positive 4-byte Parquet header does not prove the file contains nonempty usable orderbook rows, native V52 order queues, synchronous Hyperliquid xyz books or maker/hedge fills.",
          "No authenticated provider account, no bulk historical downloads, no API charges, no venue orders, no live authorization and no source-pin substitution."]}

if __name__=="__main__":
    if len(sys.argv)!=2:raise ValueError("NEW_SOURCE_AUDIT_OUTPUT_PATH_REQUIRED")
    report=probe()
    with open(sys.argv[1],"x",encoding="utf8",newline="\n") as f:json.dump(report,f,indent=2,sort_keys=True);f.write("\n")
    print("SUMMARY",json.dumps(report["confirmedSampleFilesPerSymbol"],sort_keys=True))
