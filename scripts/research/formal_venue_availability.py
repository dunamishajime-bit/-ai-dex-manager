"""Research-only public GET evidence; no credentials or venue mutations.

Current exchange rules are NOT historical filters/margin/5x Cross readback.
An empty kline response never proves a pair was unavailable.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import zipfile
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode

H = 3600000
SYMBOLS = ('TAOUSDT', 'TIAUSDT', 'DOTUSDT', 'JUPUSDT', 'RENDERUSDT', 'DOGEUSDT', 'AVAXUSDT')
BASE = 'https://fapi.asterdex.com'


def signal_decision(row):
    if not isinstance(row.get('accepted'), bool):
        return {'error':'PRODUCTION_SIGNAL_SCHEMA_INVALID'}
    return {'eligible':row['accepted'], 'reason':row.get('reason')}


def classify(ts, onboard, bar_present, decision):
    if not isinstance(onboard, int) or onboard <= 0:
        return 'SOURCE_ERROR', 'LISTING_EVIDENCE_MISSING'
    if ts < onboard:
        return 'VENUE_PAIR_UNAVAILABLE', 'BEFORE_OFFICIAL_ONBOARD_DATE'
    first_full = ((onboard + H - 1) // H) * H
    if ts <= first_full:
        return 'NO_SIGNAL', 'NO_FULL_CLOSED_POST_LISTING_BAR'
    if not bar_present:
        return 'SOURCE_ERROR', 'SOURCE_EVIDENCE_MISSING'
    if decision is None:
        return 'SOURCE_ERROR', 'BASELINE_DECISION_EVIDENCE_MISSING'
    if decision.get('error'):
        # Actual evaluator reads d-1 through d-73. Never mask a valid signal
        # or a non-history failure behind an invented warmup gate.
        if (ts < first_full + 73*H and decision['error'] in
                {'IDLE_INSUFFICIENT_EXACT_CLOSED_H1_HISTORY', 'IDLE_H1_HISTORY_GAP', 'IDLE_ATR_PREVCLOSE_GAP'}):
            return 'NO_SIGNAL', 'POST_LISTING_HISTORY_WARMUP'
        return 'SOURCE_ERROR', decision['error']
    return ('ELIGIBLE', 'SIGNAL_GATE_PASS') if decision.get('eligible') else ('NO_SIGNAL', decision.get('reason') or 'SIGNAL_CONDITIONS_NOT_MET')


def collect(output):
    output.mkdir(parents=True, exist_ok=False)
    def get(path, params=None):
        url = BASE + path + ('?' + urlencode(params) if params else '')
        with urlopen(url, timeout=30) as response:
            raw = response.read()
        return url, raw, json.loads(raw)
    url, raw, info = get('/fapi/v1/exchangeInfo')
    (output / 'exchange-info.json').write_bytes(raw)
    pairs = {s['symbol']:s for s in info['symbols'] if s['symbol'] in SYMBOLS}
    if set(pairs) != set(SYMBOLS):
        raise RuntimeError('CURRENT_PAIR_EVIDENCE_INCOMPLETE')
    evidence = {'collectedAt': datetime.now(timezone.utc).isoformat(), 'source':url,
                'sha256':hashlib.sha256(raw).hexdigest(), 'pairs':pairs,
                'historicalFiltersVerified':False, 'venueMarginReadbackVerified':False,
                'ordersSent':0, 'cancelsSent':0, 'positionChangesSent':0, 'probes':[]}
    for symbol in ('TAOUSDT','TIAUSDT','JUPUSDT','RENDERUSDT'):
        onboard = pairs[symbol]['onboardDate']
        for name, start, end in [('before',onboard-2*H,onboard-1), ('after',onboard,onboard+3*H)]:
            url, raw, rows = get('/fapi/v1/klines', {'symbol':symbol,'interval':'1h','startTime':start,'endTime':end,'limit':4})
            filename = f'{symbol}-{name}.json'
            (output/filename).write_bytes(raw)
            evidence['probes'].append({'symbol':symbol,'phase':name,'url':url,'file':filename,
                'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(rows),
                'openTimes':[r[0] for r in rows],
                'fullClosedPreListingBars':sum(r[6]<onboard for r in rows)})
    (output/'listing-evidence.json').write_text(json.dumps(evidence, indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':'OFFICIAL_LISTING_EVIDENCE_COLLECTED','pairs':{s:pairs[s]['onboardDate'] for s in SYMBOLS}}))


def ledger(evidence_path, market_root, features_path, output):
    evidence = json.loads(evidence_path.read_text(encoding='utf-8'))
    features = [json.loads(line) for line in features_path.read_text(encoding='utf-8').splitlines() if line]
    if len(features)!=8784 or any(b['decisionTs']-a['decisionTs'] != H for a,b in zip(features,features[1:])):
        raise RuntimeError('FULL_H1_GRID_INVALID')
    market={}
    exchange_path=evidence_path.parent/'exchange-info.json'
    if hashlib.sha256(exchange_path.read_bytes()).hexdigest()!=evidence['sha256']:
        raise RuntimeError('EXCHANGE_INFO_HASH_MISMATCH')
    official={p['symbol']:p for p in json.loads(exchange_path.read_bytes())['symbols']}
    if any(official[s]['onboardDate']!=evidence['pairs'][s]['onboardDate'] for s in SYMBOLS):
        raise RuntimeError('ONBOARD_DATE_EVIDENCE_CONFLICT')
    inputs={'listing-evidence.json':hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
            'features.jsonl':hashlib.sha256(features_path.read_bytes()).hexdigest()}
    for symbol in (*SYMBOLS, 'BTCUSDT'):
        path=market_root/'normalized/aster/klines'/f'{symbol}.jsonl'
        raw=path.read_bytes(); inputs[symbol]=hashlib.sha256(raw).hexdigest()
        rows=[json.loads(line) for line in raw.decode().splitlines() if line]
        times=[r['event_time_ms'] for r in rows]
        if len(set(times))!=len(times): raise RuntimeError('DUPLICATE_H1:'+symbol)
        market[symbol]=set(times)
    output.mkdir(parents=True,exist_ok=False)
    counts={symbol:Counter() for symbol in SYMBOLS}
    with (output/'overlay-full-H1-source-decisions.jsonl').open('w',encoding='utf-8',newline='\n') as handle:
        for f in features:
            ts=f['decisionTs']; decisions={}
            for row in f['idle']:
                signal=row['signal']
                decisions[row['symbol']]=signal_decision(signal)
            for row in f['long']:
                decisions[row['symbol']]=signal_decision(row)
            for row in f['errors']: decisions[row['symbol']]={'error':row['reason']}
            for symbol in SYMBOLS:
                onboard=evidence['pairs'][symbol]['onboardDate']
                first_full=((onboard+H-1)//H)*H
                needed=range(max(first_full,ts-73*H),ts,H)
                present=(all(t in market[symbol] for t in needed)
                         and ts-H in market['BTCUSDT'] and ts-25*H in market['BTCUSDT'])
                state, reason=classify(ts,onboard,present,decisions.get(symbol))
                counts[symbol][state+':'+reason]+=1
                handle.write(json.dumps({'decisionTs':ts,'symbol':symbol,'status':state,'reason':reason,
                    'officialOnboardDate':onboard,'scope':'OVERLAY_SOURCE_AND_SIGNAL_ONLY_NOT_CORE_ADMISSION'})+'\n')
    manifest={'status':'BLOCKED_OVERLAY_FULL_H1_BASELINE_EVIDENCE_AND_MARGIN_PARITY_NOT_PROVEN',
              'hours':8784,'symbols':list(SYMBOLS),'rows':8784*len(SYMBOLS),'counts':counts,
              'inputs':inputs,'coreFullH1DecisionEvidence':False,'executionMarginParity':False,
              'listingMetadataScope':'Current official onboardDate corroborated by boundary klines; not historical status/filter timeline',
              'ledgerSha256':hashlib.sha256((output/'overlay-full-H1-source-decisions.jsonl').read_bytes()).hexdigest()}
    (output/'coverage-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest))


def bundle(evidence, ledger_root, output):
    output.mkdir(parents=True,exist_ok=False)
    paths=list(sorted(evidence.glob('*.json')))+list(sorted(ledger_root.glob('*.json*')))
    if len({p.name for p in paths})!=len(paths):raise RuntimeError('BUNDLE_DUPLICATE_NAMES')
    with zipfile.ZipFile(output/'source-evidence.zip','x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in paths:
            item=zipfile.ZipInfo(path.name,date_time=(2026,10,3,0,0,0))
            item.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(item,path.read_bytes())
    index={'status':'BLOCKED_OVERLAY_FULL_H1_BASELINE_EVIDENCE_AND_MARGIN_PARITY_NOT_PROVEN',
           'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths],
           'archiveSha256':hashlib.sha256((output/'source-evidence.zip').read_bytes()).hexdigest()}
    (output/'source-evidence-manifest.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf-8')
    (output/'coverage-manifest.json').write_bytes((ledger_root/'coverage-manifest.json').read_bytes())


if __name__=='__main__':
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    get=sub.add_parser('collect'); get.add_argument('--output',type=Path,required=True)
    scan=sub.add_parser('ledger')
    for name in ('evidence','market-root','features','output'):scan.add_argument('--'+name,type=Path,required=True)
    pack=sub.add_parser('bundle')
    for name in ('evidence','ledger-root','output'):pack.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    if args.command=='collect':collect(args.output)
    elif args.command=='ledger':ledger(args.evidence,args.market_root,args.features,args.output)
    else:bundle(args.evidence,args.ledger_root,args.output)
