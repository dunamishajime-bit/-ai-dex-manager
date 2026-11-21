#!/usr/bin/env python3
"""Restore P28 complete 1980-source-position JSON ledger from GitHub gzip/base64 text.

Usage:
 python scripts/research/prism7_p28_restore_full_1980_ledger_20261122.py \
  --dir docs/research-results/prism-phase2-20261122

Fails closed if SHA256 or 1980 count differs from evidence manifest.
"""
import argparse,base64,gzip,hashlib,json,pathlib
ARCHIVE="PRISM7_P28_LAYER3_FIXED_GROSS_1980_POSITION_LEDGERS_20261122.json.gz.b64"
MANIFEST="PRISM7_P28_LAYER3_FIXED_GROSS_1980_LEDGER_ARCHIVE_MANIFEST_20261122.json"
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dir",type=pathlib.Path,required=True)
    p.add_argument("--out",type=pathlib.Path)
    a=p.parse_args()
    man=json.loads((a.dir/MANIFEST).read_text(encoding="utf-8"))
    data=(a.dir/ARCHIVE).read_bytes()
    if hashlib.sha256(data).hexdigest()!=man["gz_base64_text_sha256"]:
        raise ValueError("P28_ARCHIVE_SOURCE_SHA256_MISMATCH")
    raw=gzip.decompress(base64.b64decode(data,validate=False))
    if len(raw)!=man["raw_original_size"] or hashlib.sha256(raw).hexdigest()!=man["raw_original_sha256"]:
        raise ValueError("P28_LOSSLESS_RESTORED_ORIGINAL_SOURCE_HASH_MISMATCH")
    rows=json.loads(raw)
    if len(rows)!=1980 or man["rows_verified"]!=1980:
        raise ValueError("P28_ARCHIVED_TRADE_SOURCE_COUNT_MISMATCH")
    dest=a.out if a.out else a.dir/man["raw_original_filename"]
    dest.write_bytes(raw)
    print("P28_FULL_1980_SOURCE_LEDGER_RESTORED_SHA256_PASS",dest,man["raw_original_sha256"])
if __name__=="__main__":
    main()
