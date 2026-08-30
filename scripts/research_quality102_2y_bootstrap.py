from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import json
import re
import subprocess
from pathlib import Path

START = "2024-08-10T00:00:00.000Z"
END = "2026-08-10T00:00:00.000Z"
REFERENCE_SHA256 = "b45f492a67307cf1845fcce6af0919c5202a5853b13e7f0914daf11889bd5ead"
HISTORY_COMMIT = "e9cf7fcefe31f0324d0fc35de65a54de014d8b4e"
SOURCE = Path("scripts/research_latest_v8_dca_1y.py")
OUT = Path(".research-state/quality102-2y-bootstrap")


def decode_blobs(source: str) -> list[bytes]:
    out=[]
    for raw in re.findall(r"base64\.b64decode\('([^']+)'\)", source):
        try:
            out.append(gzip.decompress(base64.b64decode(raw)))
        except Exception:
            continue
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    current = decode_blobs(SOURCE.read_text(encoding="utf-8"))
    if len(current) < 2:
        raise SystemExit(f"expected current embedded candidate + engine, found {len(current)} payloads")
    candidate=current[0]
    digest=hashlib.sha256(candidate).hexdigest()
    if digest != REFERENCE_SHA256:
        raise SystemExit(f"Quality102 reference SHA mismatch: {digest}")
    rows=list(csv.DictReader(candidate.decode("utf-8").splitlines()))
    if len(rows) != 102:
        raise SystemExit(f"Quality102 reference count mismatch: {len(rows)}")
    (OUT / "quality102-reference-1y.csv").write_bytes(candidate)

    historical=subprocess.check_output(
        ["git","show",f"{HISTORY_COMMIT}:scripts/research_latest_v8_dca_1y.py"], text=True
    )
    payloads=decode_blobs(historical)
    manifest=[]
    for i,payload in enumerate(payloads):
        sha=hashlib.sha256(payload).hexdigest()
        try:
            text=payload.decode("utf-8")
            suffix="py" if any(x in text for x in ("def ","import ","exec(","argparse")) else "txt"
            path=OUT / f"recovered-payload-{i}.{suffix}"
            path.write_text(text,encoding="utf-8")
            first=text.splitlines()[0][:240] if text.splitlines() else ""
            quality_markers=[m for m in ("Quality102","SUPPLEMENT_QUALITY102","supplement-csv","S2","S3","S4") if m in text]
        except UnicodeDecodeError:
            path=OUT / f"recovered-payload-{i}.bin"
            path.write_bytes(payload)
            first="<binary>"; quality_markers=[]
        manifest.append({"index":i,"path":str(path),"bytes":len(payload),"sha256":sha,"firstLine":first,"qualityMarkers":quality_markers})

    quality_payloads=[x for x in manifest if x["qualityMarkers"]]
    report={
        "status":"QUALITY102_2Y_SOURCE_RECOVERED" if quality_payloads else "QUALITY102_2Y_SOURCE_NOT_FOUND",
        "requestedPeriod":{"startInclusive":START,"endExclusive":END},
        "capital":{"initialJpy":10000,"monthlyContributionJpy":20000,"contributionCountAfterStart":24,"totalContributedJpy":490000},
        "reference":{"sha256":digest,"candidateCount":len(rows),"fields":list(rows[0]) if rows else []},
        "historyCommit":HISTORY_COMMIT,
        "payloads":manifest,
        "qualityPayloads":quality_payloads,
        "acceptance":{
            "mustReproduceReferenceRowsExactly":True,
            "mustReproduceReferenceSha256":REFERENCE_SHA256,
            "mustGenerate2024SideCausally":True,
            "copyOrStretchReferenceRowsForbidden":True,
            "fabricatedPrelistingHistoryForbidden":True,
        },
        "safety":{"mode":"RESEARCH_ONLY","ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
    }
    (OUT / "bootstrap.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":report["status"],"candidateCount":len(rows),"payloadCount":len(payloads),"qualityPayloadCount":len(quality_payloads)},ensure_ascii=False))
    if not quality_payloads:
        raise SystemExit("exact Quality102 embedded source payload was not recovered")


if __name__ == "__main__":
    main()
