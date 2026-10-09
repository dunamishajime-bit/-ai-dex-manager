"""Build a route priority score from integrated repaired V4 evidence.

Score inputs: Bayesian win rate, 30bps PF, 30bps mean return/notional,
first/second-half stress PF floor, sample confidence, downside tail.
Research only.
"""
from pathlib import Path
import json,math,statistics

ROOT=Path(__file__).resolve().parents[2]
CASE=ROOT/'docs/research/results/v12-v4-route-repair-secondpass-integrated-20261009/cases/SECONDPASS/runs'
OUT=ROOT/'docs/research/results/v12-v4-priority-gross-v2-20261009'
MID=1778457600000

def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
def pf(vals):
 pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
 return pos/neg if neg else 999
def clip(x,a,b):return max(a,min(b,x))
def scale(x,a,b):return clip((x-a)/(b-a),0,1)

t10=[x for x in rows(CASE/'PRICE_MODEL_10BPS/portfolio-trades.jsonl') if x.get('strategy_id')=='V12']
t30=[x for x in rows(CASE/'PRICE_MODEL_30BPS/portfolio-trades.jsonl') if x.get('strategy_id')=='V12']
routes=sorted({x.get('route') for x in t10 if x.get('route')})
out=[]
for rt in routes:
 a=[x for x in t10 if x.get('route')==rt]; b=[x for x in t30 if x.get('route')==rt]
 vals10=[x['total_pnl_jpy'] for x in a]; vals30=[x['total_pnl_jpy'] for x in b]
 rets30=[x['total_pnl_jpy']/x['notional_entry_jpy'] for x in b if x.get('notional_entry_jpy')]
 f=[x['total_pnl_jpy'] for x in b if x['entry_ts_ms']<MID];s=[x['total_pnl_jpy'] for x in b if x['entry_ts_ms']>=MID]
 n=len(b);wins=sum(v>0 for v in vals30);wr=wins/n if n else 0
 wr_sh=(wins+12)/(n+20) if n else .6
 p30=pf(vals30);mean30=sum(rets30)/len(rets30) if rets30 else 0
 floor_pf=min(pf(f) if f else 0,pf(s) if s else 0)
 q10=statistics.quantiles(rets30,n=10,method='inclusive')[0] if len(rets30)>=10 else min(rets30 or [0])
 conf=min(1,n/40)
 # 100-point quality score. Tail only penalizes severe < -5% outcomes.
 score=100*(.30*scale(wr_sh,.45,.80)+.25*scale(mean30,0,.03)+.20*scale(math.log(max(p30,.01)),math.log(1),math.log(3))+
            .15*scale(math.log(max(floor_pf,.01)),math.log(1),math.log(2.5))+.10*conf)
 score-=100*.12*scale(-q10,.05,.12)
 if sum(vals30)<0:score-=15
 score=clip(score,0,100)
 if score>=80:tier='S';gross=.40
 elif score>=70:tier='A';gross=.30
 elif score>=60:tier='B';gross=.20
 elif score>=50:tier='C';gross=.12
 else:tier='D';gross=.05
 out.append({'route':rt,'score':score,'tier':tier,'gross':gross,'n30':n,'wr30':wr,'wr_shrunk':wr_sh,'pf30':p30,
             'mean_return30':mean30,'first_pf30':pf(f) if f else None,'second_pf30':pf(s) if s else None,'floor_pf30':floor_pf,
             'q10_return30':q10,'net30_jpy':sum(vals30),'net10_jpy':sum(vals10)})
out.sort(key=lambda x:x['score'],reverse=True)
for i,x in enumerate(out,1):
 x['priority_order']=i
 # Avoid rank=3 special handling; Core keeps native rank. Non-core unique rank starts 4.
 x['priority_rank']=None if x['route']=='FAILED_BREAK_REV_SHORT_6H' else i+3
 print(i,x['tier'],round(x['score'],1),x['route'],'gross',x['gross'],'n',x['n30'],'wr',round(x['wr30']*100,1),'pf',round(x['pf30'],2),'mean',round(x['mean_return30']*100,2),'floor',round(x['floor_pf30'],2))
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'route-priority-score.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
