#!/usr/bin/env python3
"""Causal all-short-family M5 exit bank, old RNDR / new RENDER separate."""
from __future__ import annotations
import json,hashlib,collections
from pathlib import Path
from importlib import util
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
def import_file(name,path):
 spec=util.spec_from_file_location(name,path);mod=util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
orig=import_file('all_short_evidence_source',HERE/'render-2024-directional-long-short-search-20261024.py')
def main():
 raw=[];counts={};checksum={}
 for bars,btc,metrics,funding,symbol,expiry in orig.source():
  evidence,marks=orig.collect(bars,btc,metrics,funding,symbol,expiry)
  short=[x for x in evidence if any(k.startswith('SHORT_') for k in x['signals'])]
  for x in short:
   policy={name:orig.simulate(bars,x['i'],'SHORT',contract)
     for name,contract in orig.EXITS.items()}
   raw.append({'t':x['time'],'symbol':symbol,
      'shortSignals':sorted(k for k in x['signals'] if k.startswith('SHORT_')),
      'causalFeatures':x['mfeSignals'],'exitModels':policy})
  print('EPISODE',symbol,'SOURCE',len(evidence),'SHORT_EVENTS',len(short),
    'SIGNALS',dict(marks),flush=True)
  counts[symbol]={'allSignaledH1':len(evidence),'shortEventCount':len(short),
    'signalCounts':{k:v for k,v in marks.items() if k.startswith('SHORT_')}}
  checksum[symbol]=hashlib.sha256(str(bars[0][0]).encode()+str(bars[-1][0]).encode()).hexdigest()
 raw.sort(key=lambda x:(x['t'],x['symbol']))
 # Pre-open event outcome check; next-5minute fill / max24h / stop-first
 assert raw and all(x['t']<=min(v['exitTs'] for v in x['exitModels'].values()) for x in raw)  # stop possible within first 5m candle
 final={'status':'CAUSAL_RESEARCH_ONLY_ALL_SHORT_MARKET5M_FULL_EPISODES',
   'cutoff':'2026-08-10T00:00:00Z',
   'source':'BINANCE_VISION_PUBLISHER_SHA_VERIFIED_OLD_RNDR_AND_NEW_RENDER_NOT_SPLICED',
   'fill':'NEXT_M5_OPEN_STOP_PRIORITY_ROUNDTRIP_10_30bps',
   'counts':counts,'episodeStampDigest':checksum,'policies':orig.EXITS,
   'events':raw}
 dest=OUT/'RENDER_ALL_SIX_SHORT_CAUSAL_ENTRY_BANK_2024_2026AUG_20261024.json'
 dest.write_text(json.dumps(final,ensure_ascii=False,separators=(',',':'))+'\n','utf8')
 print('DONE',dest,'EVENTS',len(raw),'BY_SIGNAL',dict(collections.Counter(s for x in raw for s in x['shortSignals'])),flush=True)
if __name__=='__main__':main()
