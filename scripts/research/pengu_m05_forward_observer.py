"""Read-only M05 forward evidence. Public klines only; no order/auth clients."""
import pathlib,json,time,math,statistics,urllib.request,urllib.parse,argparse,hashlib
H=3600000
def merge_observations(existing,incoming):
 out=dict(existing)
 for r in incoming:
  if not isinstance(r,dict) or r.get('route')!='SHORT_V20' or not isinstance(r.get('referenceTs'),(int,float)):continue
  key='SHORT_V20:'+str(int(r['referenceTs']))
  old=out.get(key,{})
  if old.get('productionOutcome')=='EXITED' and r.get('productionOutcome')!='EXITED':continue
  out[key]={**old,**r}
 return out
def summary_metrics(rows):
 def stats(rs):
  done=[r for r in rs if r.get('productionOutcome')=='EXITED' and isinstance(r.get('realizedNetAccountReturn'),(int,float)) and math.isfinite(r['realizedNetAccountReturn'])]
  pnls=[r['realizedNetAccountReturn'] for r in done];w=sum(p>0 for p in pnls);loss=-sum(p for p in pnls if p<0)
  excursions=[r for r in done if r.get('excursionCoverage')=='COMPLETE_H1_CONTAINED']
  return {'candidates':len(rs),'n':len(done),'wins':w,'win_rate':w/len(done) if done else None,'pf_net_account_returns':sum(p for p in pnls if p>0)/loss if loss else None,'mean_net_account_return':statistics.mean(pnls) if pnls else None,'excursion_complete_count':len(excursions),'mean_mfe_h1_contained':statistics.mean(r['mfe_h1_contained'] for r in excursions) if excursions else None,'mean_mae_h1_contained':statistics.mean(r['mae_h1_contained'] for r in excursions) if excursions else None}
 rs=list(rows.values())
 return {'all':stats(rs),'difference':stats([r for r in rs if r.get('wouldBlock') is True]),'pass':stats([r for r in rs if r.get('wouldBlock') is False]),'review_20_candidates_reached':len(rs)>=20,'automatic_promotion':False,'scope':'Net account returns are Production overlay metrics; PF is return-weighted, not currency PnL. Contained H1 MFE/MAE exclude partial fill/exit bars.'}
def bar_excursions(r,bars,now):
 price=r.get('entryFillPrice');start=r.get('entryFillObservedAt')
 if not isinstance(price,(int,float)) or price<=0 or not isinstance(start,(int,float)):return {'excursionCoverage':'ENTRY_FILL_MISSING'}
 end=min(now,r.get('exitFillObservedAt') or now)
 first=math.ceil(start/H)*H;last=math.floor(end/H)*H
 expected=list(range(first,last,H));byts={int(b[0]):b for b in bars}
 if any(ts not in byts for ts in expected):return {'excursionCoverage':'GAP','expectedBars':len(expected),'observedBars':sum(ts in byts for ts in expected)}
 returns=[]
 for ts in expected:
  b=byts[ts];returns.extend([1-float(b[2])/price,1-float(b[3])/price])
 exitprice=r.get('exitFillPrice')
 if isinstance(exitprice,(int,float)) and r.get('exitFillObservedAt',now+1)<=now:returns.append(1-exitprice/price)
 return {'excursionCoverage':'COMPLETE_H1_CONTAINED','mfe_h1_contained':max([0.]+returns),'mae_h1_contained':min([0.]+returns),'containedBars':len(expected),'excursionUpdatedAt':now}
def fetch_bars(start,end,endpoint):
 if end<=start:return []
 query=urllib.parse.urlencode({'symbol':'PENGUUSDT','interval':'1h','startTime':start,'endTime':end-1,'limit':1000})
 request=urllib.request.Request(endpoint+'?'+query,headers={'User-Agent':'DisDex-M05-ReadOnly-Observer/1'})
 with urllib.request.urlopen(request,timeout=12) as response:rows=json.load(response)
 if not isinstance(rows,list):raise ValueError('PUBLIC_KLINES_FORMAT_INVALID')
 return rows
def atomic(path,value):
 path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');tmp.replace(path)
def main():
 p=argparse.ArgumentParser();p.add_argument('--state',default='/var/lib/disdex/pengu-dual-ls-v2/runner-live.json');p.add_argument('--output',default='/var/lib/disdex/shadow/pengu-m05');p.add_argument('--endpoint',default='https://fapi.asterdex.com/fapi/v1/klines');args=p.parse_args()
 statepath=pathlib.Path(args.state);out=pathlib.Path(args.output);ledger=out/'observations.json';now=int(time.time()*1000)
 raw=statepath.read_bytes();state=json.loads(raw);existing=json.loads(ledger.read_text()) if ledger.exists() else {};rows=merge_observations(existing,state.get('m05ShadowHistory',[]));errors=[]
 for k,r in rows.items():
  if r.get('productionOutcome') not in ['ENTRY_FILLED','EXITED'] or not r.get('entryFillObservedAt'):continue
  if r.get('productionOutcome')=='EXITED' and r.get('excursionCoverage')=='COMPLETE_H1_CONTAINED':continue
  cutoff=min(now,r.get('exitFillObservedAt') or now)
  if int(r.get('excursionUpdatedAt',0))//H>=int(cutoff)//H:continue
  try:
   start=math.ceil(r['entryFillObservedAt']/H)*H;end=math.floor(cutoff/H)*H
   rows[k]={**r,**bar_excursions(r,fetch_bars(start,end,args.endpoint),now)}
  except Exception as e:
   rows[k]={**r,'excursionCoverage':'FETCH_FAILED','excursionLastError':type(e).__name__};errors.append(k+':'+type(e).__name__)
 result={**summary_metrics(rows),'checkedAt':now,'stateUpdatedAt':state.get('updatedAt'),'stateSha256':hashlib.sha256(raw).hexdigest(),'errors':errors,'stateWritten':False,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0}
 atomic(ledger,rows);atomic(out/'summary.json',result);print(json.dumps(result))
if __name__=='__main__':main()
