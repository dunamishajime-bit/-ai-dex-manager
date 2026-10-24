#!/usr/bin/env python3
"""RESEARCH ONLY: high-WR independent SHORT confirmation gate, chronological nonpristine splits.
Training feature conjunctions use 2024 alone, secondary validation 2025H1,
later 2025H2/2026 periods never used for model selection in this run.
Historical later periods were previously analyzed, so they are NOT untouched OOS.
No live execution, no real order/deployment, no modification to #4427 incumbent.
"""
from __future__ import annotations
import collections,datetime as dt,gzip,hashlib,itertools,json,math,statistics
from pathlib import Path
BASE=Path('C:/tmp/render-mtf-study-20261024')
REPO=Path('C:/tmp/render4427-independent-gates-audit-20261024')
OUT=REPO/'docs/research/results/render4427-scoped-priority-native8-20261024'
BANK=BASE/'RENDER_4427_INDEPENDENT_ALL_GATE_SHADOW_ENTRY_BANK_20261024.json.gz'
with gzip.open(BANK,'rt',encoding='utf8') as f: rows=json.load(f)['rows']
TIME={'train2024':(1704067200000,1735689600000),
      'verify2025H1':(1735689600000,1754006400000),
      'test2025H2':(1754006400000,1767225600000),
      'test2026JanAug':(1767225600000,1786320000000),
      'test2026AugOct':(1786320000000,1792800000000)}
FAMILIES=['BTC_RENDER_DIVERGE','REBOUND_FAIL','FALSE_BREAKOUT','TREND_BREAK','SELL_IMBALANCE','TREND_PRESSURE','PULLBACK_FADE']
EXIT=['S6','S12','T24']
def feat(f,name):
 v=f.get('h3')
 if name=='h3_nonpositive':return v is not None and v<=0
 if name=='h3_positive':return v is not None and v>=.25
 if name=='downH4':return f['h4']<=-1
 if name=='strongDownH4':return f['h4']<=-2
 if name=='downD1':return f['d1']<=-1
 if name=='strongDownD1':return f['d1']<=-2
 if name=='sell56':return f['sellPct']>=.56
 if name=='sell58':return f['sellPct']>=.58
 if name=='vol110':return f['volRatio']>=1.1
 if name=='vol140':return f['volRatio']>=1.4
 if name=='h1NotLate':return f['h1']>=-.8
 if name=='h1SharpDown':return f['h1']<=-.5
 if name=='h1Bottom':return f['position']<=.3
 if name=='h1Upper':return f['position']>=.55
 if name=='last15Down':return f['last15']<=-.2
 if name=='last15NotFast':return f['last15']>=-.2
 if name=='prevH1Positive':return f['prevH1ret']>=.25
 if name=='prevH1Negative':return f['prevH1ret']<=-.25
 if name=='btcUp':return f['btc1'] is not None and f['btc1']>=.3
 if name=='btcDown':return f['btc1'] is not None and f['btc1']<=-.3
 if name=='highUpperWick':return f['wickPct']>=.35
 if name=='smallUpperWick':return f['wickPct']<=.15
 raise ValueError(name)
PREDICATES=['downH4','strongDownH4','downD1','strongDownD1','sell56','sell58',
            'vol110','vol140','h1NotLate','h1SharpDown','h1Bottom','h1Upper',
            'last15Down','last15NotFast','prevH1Positive','prevH1Negative',
            'btcUp','btcDown','highUpperWick','smallUpperWick','h3_nonpositive','h3_positive']
PER_SYM={}
for row in rows:
 c={}
 for x in row['candidates']:c[(x['family'],x['exit'])]=x
 PER_SYM[(row['sym'],row['t'])]=c
def metrics(xs):
 n=len(xs)
 if not n:return {'n':0,'wr':None,'pf':None,'mean30':None,'wins':0,'wilsonLo90':None,'maxLoss':None}
 wins=sum(x>0 for x in xs);w=wins/n
 g=sum(x for x in xs if x>0);l=-sum(x for x in xs if x<0)
 z=1.645;center=(w+z*z/(2*n))/(1+z*z/n)
 radius=z*math.sqrt((w*(1-w)+z*z/(4*n))/n)/(1+z*z/n)
 return {'n':n,'wr':round(100*w,3),'pf':round(g/l,4) if l else None,
         'mean30':round(sum(xs)/n,5),'wins':wins,'wilsonLo90':round(100*(center-radius),3),
         'maxLoss':round(min(xs),4)}
def split_of(t):
 for k,(lo,hi) in TIME.items():
  if lo<=t<hi:return k
 return 'outside'
pool=collections.defaultdict(lambda:collections.defaultdict(list))
for row in rows:
 if row['oldFamily'] is not None:continue
 f=row['features'];checks={p:feat(f,p) for p in PREDICATES}
 period=split_of(row['t'])
 if period=='outside':continue
 for c in row['candidates']:
  if c['family'] not in FAMILIES:continue
  for p in PREDICATES:
   if checks[p]:pool[(c['family'],c['exit'],p)][period].append(c['net30'])
  for p,q in itertools.combinations(PREDICATES,2):
   if checks[p] and checks[q]:pool[(c['family'],c['exit'],p+'+'+q)][period].append(c['net30'])
results=[];trainpass=[]
for k,periods in pool.items():
 fm,ex,gate=k
 train=metrics(periods['train2024'])
 if train['n']<12 or train['wr']<70 or (train['pf'] is not None and train['pf']<1.35) or train['mean30']<=.08:continue
 val=metrics(periods['verify2025H1'])
 if val['n']<4 or val['mean30']<0 or val['wr']<60 or (val['pf'] is not None and val['pf']<1.0):continue
 dat={'family':fm,'exit':ex,'gate':gate,'train':train,'validation':val}
 # Preselection ranking is defined strictly on past training and validation only.
 dat['trainValRank']=round(.72*train['wilsonLo90']+.28*val['wr'] + 4*min(2,train['mean30']+val['mean30']) +min(4,math.log(train['n'])),5)
 for name in ('test2025H2','test2026JanAug','test2026AugOct'):
  dat[name]=metrics(periods[name])
 results.append(dat)
results.sort(key=lambda x:(-x['trainValRank'],-x['train']['n'],x['family'],x['exit'],x['gate']))
# Select top models *only* from prior train+validation scores; 2025H2/2026 data not ranked against.
by_fam={}
for m in results:
 k=(m['family'],m['exit'])
 by_fam.setdefault(k,m)
selected=list(by_fam.values())
report={
 'status':'RESEARCH_ONLY_CHRONOLOGICAL_HIGH_WR_NEW_GATE_SCREEN',
 'timestampJST':'2026-10-25',
 'bankSha256':hashlib.sha256(BANK.read_bytes()).hexdigest(),
 'testedPredicates':PREDICATES,
 'screen':{'singleAndPairFeatures':True,'familyCount':len(FAMILIES),'exitCount':len(EXIT),
          'signalLevelOnly':True,'incumbentOverlapsExcluded':True,
          'train2024Gate':'n>=12, WR>=70, PF>=1.35, mean net30>0.08%',
          'verification2025H1Gate':'n>=4, WR>=60, PF>=1, mean net30>=0',
          'futurePeriodsNotUsedToRank':True,
          'allPeriodsPreviouslyInspected':True},
 'trainValidationPassed':len(results),
 'strongCandidates':results[:120],
 'oneBestPerFamilyExit':selected,
 'warnings':['Results are on shadow signal bank, not de-overlapped portfolio fills',
  'All dates previously inspected during prior research: chronological test is NOT pristine OOS',
  'Some local train+val combinations are tiny and selection-biased (multiple comparisons)',
  'No safety controls relaxed, no LIVE/VPS/HP order execution'] }
OUT.mkdir(parents=True,exist_ok=True)
dest=OUT/'RENDER_4427_HIGH_WIN_RATE_2024_TRAIN_2025_VERIFY_2026_TEMPORAL_SCREEN_20261025.json'
dest.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('SCREEN',len(pool),'PASS_TRAIN_VAL',len(results),'BEST_PER_FAM_EXIT',len(selected),flush=True)
for x in selected[:30]:
 print('SELECT',x['family'],x['exit'],x['gate'],'RANK',x['trainValRank'],'TRAIN',x['train'],'VAL',x['validation'],
  'TEST25H2',x['test2025H2'],'TEST26',x['test2026JanAug'],'TEST26LATE',x['test2026AugOct'],flush=True)
print('OUT',dest,flush=True)
