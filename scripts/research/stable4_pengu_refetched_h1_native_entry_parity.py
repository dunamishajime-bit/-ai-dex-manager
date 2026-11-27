"""Audit re-fetched public Binance inputs versus the frozen PENGU native entry ledger.

Never replace earlier byte pins; establish independent semantic event parity only.
Private OHLC/funding archives stay on owner PC, not in Git.
"""
from __future__ import annotations
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OLD_NAME="STABLE4_PENGU_BINANCE_NATIVE_H1_LEDGER_20261128.json"
OLD_SHA="d128ad78aed642b84eed105e85b73dc1856a3e657e1ad924ec17e5a9aff023fc"
H1_NAMES={"pengu":"PENGUUSDT_H1","btc":"BTCUSDT_H1","funding":"PENGUUSDT_FUNDING"}

def digest(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()

def analyze(data_root:Path)->dict:
    a=(ROOT/"docs/research"/OLD_NAME)
    if digest(a)!=OLD_SHA:raise ValueError("PINNED_LEDGER_CHANGED")
    old=json.loads(a.read_bytes())
    b=data_root/"PENGU_NATIVE_REFETCH_20261128.json"
    n=json.loads(b.read_bytes())
    m=json.loads((data_root/"manifest.json").read_bytes())
    if old["orderAuthority"] is not False or n["orderAuthority"] is not False or old["executionParityProven"] is not False or n["executionParityProven"] is not False:
        raise ValueError("AUTHORITY_SCOPE_MISMATCH")
    if n["status"]!="NATIVE_REAL_H1_RAW_SIGNAL_PARITY_PASS" or n["arms"]!=old["arms"] or n["rawSignalEvents"]!=old["rawSignalEvents"] or n["featureMissing"]!=old["featureMissing"] or n["ambiguous"]!=old["ambiguous"]:
        raise ValueError("SOURCE_NATIVE_ENTRY_EVENTS_CHANGED")
    if m["schema"]!="stable4-pengu-binance-public-h1-readonly-refetch/v1" or m["orderAuthority"] is not False or m["fillsCertified"] is not False or m["previousReviewPinsReplaced"] is not False:
        raise ValueError("REFETCH_SOURCE_SCOPE")
    diffs={}
    for k,source in H1_NAMES.items():
        meta=m["datasets"][source]
        file=data_root/meta["file"]
        if file.is_symlink() or not file.is_file() or digest(file)!=meta["sha256"] or meta["sha256"]!=n["input"][k]["sha256"] or meta["previousBytePin"]!=old["input"][k]["sha256"] or meta["rows"]!=n["input"][k]["count"]:
            raise ValueError("REFETCH_FILE_PIN_OR_COUNT_MISMATCH:"+k)
        diffs[k]={"count":meta["rows"],"oldSha256":meta["previousBytePin"],"refetchedSha256":meta["sha256"],"oldBytePinMatched":meta["sha256"]==meta["previousBytePin"]}
    if diffs["pengu"]["count"]!=10512 or diffs["btc"]["count"]!=10512 or diffs["funding"]["count"]!=2627:raise ValueError("REFETCH_DATA_COUNT")
    return {"schema":"stable4-pengu-binance-independent-h1-native-entry-parity/v1","status":"INDEPENDENT_REAL_H1_SOURCE_ENTRY_PARITY_PASS_NOT_EXECUTION","periodUtc":old["periodUtc"],"frozenSourceLedgerSha256":OLD_SHA,"privateInputNewReplaySha256":digest(b),"privateManifestSha256":digest(data_root/"manifest.json"),"dataDigests":diffs,"candidateSummary":{arm:{"rawCandidates":old["arms"][arm]["rawCandidates"],"longs":old["arms"][arm]["longs"],"shorts":old["arms"][arm]["shorts"]} for arm in ("BASE","V8_V64")},"semanticParity":{"sourceNativeRawEventsExact":True,"allNativeArmsExact":True,"missingFeaturesExact":True,"ambiguousExact":True},"orderAuthority":False,"fullPenguAnnualTradeReplay":False,"rootCertificateIssued":False,"productionEligible":False,"limitations":["Private H1 input files retained on owner PC, only hashes and independent outputs here. Two H1 serialized byte hashes differ from frozen inputs, so original SHA pins are NOT replaced or silently accepted as identical bytes.","All 54 BASE and 112 V8_V64 raw signals match exactly. This is native H1 ENTRY parity only; no ASTER M5 fill, order/STOP proof, source-native portfolio exits, funding PnL, Gross or DD.","New public source observations may change in later re-fetches; do not infer a release certificate or LIVE eligibility."]}

if __name__=="__main__":
    if len(sys.argv)!=3:raise ValueError("PRIVATE_DATA_ROOT_AND_RESEARCH_OUTPUT_REQUIRED")
    doc=analyze(Path(sys.argv[1]))
    with open(sys.argv[2],"x",encoding="utf8",newline="\n") as f:json.dump(doc,f,sort_keys=True,indent=2);f.write("\n")
    print(json.dumps({"status":doc["status"],"sourcePins":doc["dataDigests"],"candidateSummary":doc["candidateSummary"]},sort_keys=True))
