#!/usr/bin/env python3
"""RESEARCH ONLY: RENDER entry filters and higher profit floors, without full8 wallet.
For entry eligibility, use only already-completed M5 feature snapshots; ex-post guard
outcomes are diagnosis only. Any model result requires full8 dynamic replay.
"""
from __future__ import annotations
import collections,datetime,json,math,statistics
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
SRC=REPO/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json'
OUT=SRC.with_name('IDLE_RENDER_ENTRY_VETO_WINRETENTION_STATIC_SCREEN_20261024.json')
def allow(r,name):
 f=r['features']
 def a(k,v):return f[k]>=v
 if name=='ENTRY_RETAIN_OLD':return True
 if name=='VETO_RET3_BELOW_M1P5_BTC3_BELOW_M1':return not(f['ret3h']<-1.5 and f['btc3h']<-1)
 if name=='VETO_RET3_BELOW_M2_BTC3_BELOW_M0P75':return not(f['ret3h']<-2 and f['btc3h']<-.75)
 if name=='VETO_RET3_BELOW_M1_BTC3_BELOW_M1':return not(f['ret3h']<-1 and f['btc3h']<-1)
 if name=='VETO_RET3_BELOW_M2_REL3_GT0':return not(f['ret3h']<-2 and f['rel3h']>0)
 if name=='VETO_BTC3_BELOW_M1_REL3_GT0':return not(f['btc3h']<-1 and f['rel3h']>0)
 if name=='VETO_RET3_BELOW_M1_AND_VOLRATIO_BELOW0P8':return not(f['ret3h']<-1 and f['volratio']<.8)
 if name=='VETO_ATR_GT0P8_AND_BTC3_BELOW_M0P75':return not(f['atr3h']>.8 and f['btc3h']<-.75)
 if name=='VETO_RET3_BELOW_M1P5_AND_BTC3_BELOW_M0P5':return not(f['ret3h']<-1.5 and f['btc3h']<-.5)
 if name=='VETO_REL3_ABOVE0_AND_BTC3_BELOW_M0P5':return not(f['rel3h']>0 and f['btc3h']<-.5)
 if name=='VETO_RET3_BELOW_M1P5_OR_REL3_ABOVE1P5':return not(f['ret3h']<-1.5 or f['rel3h']>1.5)
 raise KeyError(name)
RULES=('ENTRY_RETAIN_OLD','VETO_RET3_BELOW_M1P5_BTC3_BELOW_M1',
'VETO_RET3_BELOW_M2_BTC3_BELOW_M0P75','VETO_RET3_BELOW_M1_BTC3_BELOW_M1',
'VETO_RET3_BELOW_M2_REL3_GT0','VETO_BTC3_BELOW_M1_REL3_GT0',
'VETO_RET3_BELOW_M1_AND_VOLRATIO_BELOW0P8','VETO_ATR_GT0P8_AND_BTC3_BELOW_M0P75',
'VETO_RET3_BELOW_M1P5_AND_BTC3_BELOW_M0P5','VETO_REL3_ABOVE0_AND_BTC3_BELOW_M0P5',
'VETO_RET3_BELOW_M1P5_OR_REL3_ABOVE1P5')
def metrics(rows):
 return {'n':len(rows),'wins':sum(z['win'] for z in rows),
  'wr':round(100*sum(z['win'] for z in rows)/len(rows),2) if rows else None,
  'returnSumPct':round(sum(z['pnlFromPricePct'] for z in rows),3)}
def main():
 j=json.loads(SRC.read_text('utf8'))
 result={'status':'SELECTED_TRADE_ENTRY_SCREEN_ONLY_NOT_FULL8_NOT_LIVE',
 'costs':{},'sourceNote':'Selected COMBO_KEEP90 ledger; not independent OOS. JUP+DOT kept unchanged.'}
 for cost in ('10','30'):
  selected=j['costs'][cost]['symbols']['RENDERUSDT']['allTradeFeatures']
  cases={}
  for name in RULES:
   kept=[r for r in selected if allow(r,name)]
   removed=[r for r in selected if not allow(r,name)]
   x={'kept':metrics(kept),'removed':metrics(removed),
      'keptPercent':round(100*len(kept)/len(selected),2),
      'removedWinnerEntryTs':[r['entryTs'] for r in removed if r['win']],
      'removedLoserEntryTs':[r['entryTs'] for r in removed if not r['win']]}
   cases[name]=x
   if name=='ENTRY_RETAIN_OLD' or len(kept)>=20:
    print('SCREEN',cost,name,'RETAIN',len(kept),'WINS',x['kept']['wins'],'WR',x['kept']['wr'],
     'CUT_WINS',x['removed']['wins'],'CUT_LOSSES',x['removed']['n']-x['removed']['wins'],flush=True)
  result['costs'][cost]={'initial':metrics(selected),'cases':cases}
 OUT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf8',newline='\n')
 print('SCREEN_SAVED',OUT,OUT.stat().st_size)
if __name__=='__main__':main()
