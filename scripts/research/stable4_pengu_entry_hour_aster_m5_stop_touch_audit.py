"""Offline first PARTIAL entry-hour hard-stop touch observation for PENGU.

No actual order, resident STOP placement/readback, fill or execution claim.
The source H1 exit helper deliberately skips the H1 bar containing entry
because its high/low includes PRE-ENTRY minutes. Observe ASTER M5 after model
entry t+5m instead; do not use future M5 volume for entry admission.
"""
from __future__ import annotations
import gzip
from hashlib import sha256
import json
from pathlib import Path
import math
import sys

ROOT=Path(__file__).resolve().parents[2]
H=3_600_000
M=300_000
IN_LEDGER=ROOT/"docs/research/STABLE4_PENGU_ALL_ROUTES_NATIVE_H1_POSITION_HELPER_REPLAY_20261128.json"
IN_SHA="93b4c4dd203da5394b77e58a7a23eaa359d3978ee27a6df5973aaddafde84e00"
CONFIGS=("config/penguDualLsV2Runtime.ts","config/penguRecoveryV8.ts")

def evaluate(data_root:Path)->dict:
    raw=IN_LEDGER.read_bytes()
    if sha256(raw).hexdigest()!=IN_SHA:raise ValueError("SOURCE_NATIVE_EXIT_LEDGER_SHA_MISMATCH")
    ledger=json.loads(raw)
    if (ledger["orderAuthority"] is not False or ledger["productionEligible"] is not False
        or ledger["fullPenguAnnualTradeReplay"] is not False):
        raise ValueError("SOURCE_NATIVE_SCOPE_OR_AUTHORITY_INVALID")
    for p, digest in ledger["sourcePins"].items():
        if sha256((ROOT/p).read_bytes()).hexdigest()!=digest:
            raise ValueError("SOURCE_MODULE_CHANGED:"+p)
    config=(ROOT/CONFIGS[0]).read_text(encoding="utf8")
    recovery=(ROOT/CONFIGS[1]).read_text(encoding="utf8")
    if config.count("hardStopPct: 0.08")<2 or recovery.count("hardStopPct: 0.06")<1:
        raise ValueError("PENGU_HARD_STOP_POLICY_CHANGED")
    tape={}
    source_files=[]
    for meta in ledger["asterm5Files"]:
        path=data_root/meta["folder"]/meta["file"]
        if not path.is_file() or path.is_symlink():raise ValueError("M5_SOURCE_FILE_MISSING")
        data=path.read_bytes()
        if sha256(data).hexdigest()!=meta["sha256"]:raise ValueError("M5_SOURCE_SHA_MISMATCH")
        n=0
        for line in gzip.decompress(data).splitlines():
            bar=json.loads(line)
            t=int(bar[0]);op,hi,lo,cl,vol,trades=map(float,[bar[1],bar[2],bar[3],bar[4],bar[5],bar[8]])
            valid=(t%M==0 and int(bar[6])==t+M-1 and
                   all(math.isfinite(x) for x in (op,hi,lo,cl,vol,trades)) and
                   min(op,lo,cl)>0 and hi>=max(op,cl) and lo<=min(op,cl) and
                   vol>=0 and trades>=0 and trades.is_integer() and (vol==0)==(trades==0))
            if t in tape:raise ValueError("M5_DUPLICATE_TIMESTAMP")
            tape[t]={'open':op,'high':hi,'low':lo,'close':cl,'volume':vol,'valid':valid}
            n+=1
        if n!=meta["rows"]:raise ValueError("M5_COUNT_MISMATCH")
        source_files.append({k:meta[k] for k in ("folder","file","sha256","rows")})
    rows={}
    summary={}
    for arm in ("BASE","V8_V64"):
        modeled=[];not_admitted=0
        for event in ledger["results"][arm]:
            if event["status"]!="SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":
                not_admitted+=1
                continue
            if event.get("actualVenueFillVerified") is not False or event["modelExecutionTs"]!=event["entryTs"]+M:
                raise ValueError("ENTRY_NOT_CAUSAL_OR_VENUE_FILL_FALSE_CLAIM")
            t=event["entryTs"]
            entry=event.get("entryPriceProxy")
            side=event["side"]
            route=event["route"]
            if not isinstance(entry,(int,float)) or not (entry>0) or side not in ("LONG","SHORT") or route not in ("SHORT_V20","LONG_V2_FINAL","RECOVERY_V8"):
                raise ValueError("SOURCE_ROUTE_PRICE_INVALID")
            pct=.06 if route=="RECOVERY_V8" else .08
            stop=entry*(1-pct if side=="LONG" else 1+pct)
            touch=None;bad=None;zero=0
            for clock in range(t+M,t+H,M):
                b=tape.get(clock)
                if not b or not b["valid"]:bad=clock;break
                if b["volume"]==0:zero+=1
                if side=="LONG" and b["low"]<=stop or side=="SHORT" and b["high"]>=stop:
                    touch={'barOpenTs':clock,'observedAfterTs':clock+M,
                           'positiveVolumeExPost':b['volume']>0,
                           'hardStopPrice':stop}
                    break
            modeled.append({'sourceEntryTs':t,'modelEntryTs':t+M,'route':route,'side':side,
                            'entryPriceProxy':entry,'hardStopPct':pct,'touch':touch,
                            'firstHourM5MissingOrInvalidTs':bad,'zeroVolumeM5InObservedFirstHour':zero,
                            'actualResidentStopVerified':False})
        s={'modeledPriceCandidateCount':len(modeled),'unmodeledSourceCandidates':not_admitted,
           'entryHourStopTouches':sum(r['touch'] is not None for r in modeled),
           'entryHourUnknownCoverage':sum(r['firstHourM5MissingOrInvalidTs'] is not None for r in modeled)}
        if s['modeledPriceCandidateCount']+not_admitted!=ledger['summary'][arm]['rawCandidates']:
            raise ValueError("SOURCE_CANDIDATE_COUNT")
        rows[arm]=modeled;summary[arm]=s
    return {'schema':'stable4-pengu-first-entry-hour-m5-hard-stop-observation/v1',
            'status':'PARTIAL_M5_HARD_STOP_TOUCH_OBSERVATION_NO_RESIDENT_STOP_PROOF',
            'sourceLedgerSha256':IN_SHA,'sourceConfigSha256':{p:sha256((ROOT/p).read_bytes()).hexdigest() for p in CONFIGS},
            'marketFiles':source_files,'summary':summary,'rows':rows,
            'orderAuthority':False,'fullPenguAnnualTradeReplay':False,'productionEligible':False,
            'limitations':[
                'The source-native H1 model skips entry H1 body because it includes pre-entry prices; this tool checks only the eleven 5m OHLC candles beginning at modeled entry t+5m until t+1h.',
                'An M5 stop touch is NOT a signed resident STOP readback or filled protective order; zero touches only describes archived OHLC within the admitted price-proxy subset.',
                'All admission is hypothetical: first M5 completed positive volume and next M5 open proxy, not order-book liquidity or actual fills. The next M5 volume must not determine the entry.',
                'No complete source-native per-hour position lifecycle, actual stop/order reconciliation, fees/funding, shared Gross/DD, annual seven-runner integration or LIVE approval.'
            ]}

if __name__=='__main__':
    if len(sys.argv)!=3:raise ValueError('ASTER_MARKET_DATA_ROOT_AND_OUTPUT_REQUIRED')
    result=evaluate(Path(sys.argv[1]))
    with open(sys.argv[2],'x',encoding='utf8',newline='\n') as f:json.dump(result,f,indent=2,sort_keys=True);f.write('\n')
    print(json.dumps(result['summary'],sort_keys=True))
