import { causalReturn, recordSideExit, v12EntryReason, type SideLossLedger } from './dd1296-entry-policy';
import type { V12AsterLiveAdapter } from './v12-aster-live-adapter';
import type { V12ActivePositionState, V12X1AllRunnerState } from './v12-x1-all-runner-state';
import type { V12Signal } from './v12-x1-all';
import type { AsterKline } from './aster-v3-client';
export type V12BoundaryCache=Map<string,Promise<AsterKline[]>>;

export async function evaluateV12Dd1296Entry(adapter:V12AsterLiveAdapter,state:V12X1AllRunnerState,signal:Pick<V12Signal,'symbol'|'side'|'rank'|'entryTs'>,now:number,cache?:V12BoundaryCache) {
  const symbol=signal.symbol.endsWith('USDT')?signal.symbol:`${signal.symbol}USDT`;
  if(now < (state.sideLossLedger?.[signal.side]?.until||0)) return 'V12_SIDE_LOSS_COOLDOWN_6H';
  if(symbol!=='ATOMUSDT' && !(symbol==='AVAXUSDT'&&signal.rank===1)) return undefined;
  const ts=signal.entryTs;
  const load=(sym:string,hours:number,limit:number)=>{
    const key=`${ts}|${sym}|${hours}`;const existing=cache?.get(key);if(existing)return existing;
    const request=adapter.client.getKlines(sym,'1h',limit,{startTime:ts-hours*3_600_000,endTime:ts}).then(rows=>{if(!rows.some(r=>Number(r[0])===ts))cache?.delete(key);return rows;}).catch(error=>{cache?.delete(key);throw error;});
    if(cache){if(cache.size>24)cache.clear();cache.set(key,request);}return request;
  };
  const [asset,btc]=await Promise.all([load(symbol,24,26),load('BTCUSDT',3,5)]);
  const convert=(rows:typeof asset)=>rows.map(r=>({timestampMs:Number(r[0]),open:Number(r[1]),close:Number(r[4])}));
  const a=convert(asset),b=convert(btc),ae=a.find(r=>r.timestampMs===ts),be=b.find(r=>r.timestampMs===ts);
  if(!ae||!be) return 'V12_DD1296_CAUSAL_BOUNDARY_MISSING';
  try {return v12EntryReason(symbol,signal.side,signal.rank,causalReturn(a,ae,3),causalReturn(b,be,3),symbol==='AVAXUSDT'&&signal.side==='LONG'?causalReturn(a,ae,24):0);} catch {return 'V12_DD1296_CAUSAL_LOOKBACK_MISSING';}
}

/** Venue fills cover entry fees, all partial reductions, final close and funding. */
export async function getV12ConfirmedExitEvidence(adapter:V12AsterLiveAdapter,position:V12ActivePositionState,now:number) {
  const entry=await adapter.client.getOrder(position.symbol,position.positionId);
  if(!entry?.orderId || !(Number(entry.executedQty)>0))throw new Error('V12_NET_EXIT_ENTRY_FILL_MISSING');
  const trades=await adapter.client.getUserTrades(position.symbol,{startTime:position.entrySignalTs,endTime:now,limit:1000});
  if(!trades.length || trades.length>=1000)throw new Error('V12_NET_EXIT_TRADE_COVERAGE_UNPROVEN');
  const entryFills=trades.filter(r=>String(r.orderId)===String(entry.orderId));
  if(!entryFills.length)throw new Error('V12_NET_EXIT_ENTRY_TRADES_MISSING');
  const first=Math.min(...entryFills.map(r=>Number(r.time)));
  const minId=entryFills.reduce((min,r)=>BigInt(String(r.id))<min?BigInt(String(r.id)):min,BigInt(String(entryFills[0].id)));
  const fills=trades.filter(r=>Number(r.time)>=first && Number(r.time)<=now && r.id!==undefined && BigInt(String(r.id))>=minId).sort((a,b)=>Number(a.time)-Number(b.time)||(BigInt(String(a.id))<BigInt(String(b.id))?-1:1));
  const unique=new Set<string>();let openQty=0,opened=0,net=0,last=0,flat=false;
  const openingSide=position.side==='LONG'?'BUY':'SELL',tol=Math.max(1e-8,Number(entry.executedQty)*1e-6);
  for(const r of fills) {
    if(r.id===undefined || r.symbol!==position.symbol || !['BUY','SELL'].includes(r.side||'') || !Number.isFinite(Number(r.realizedPnl)) || !Number.isFinite(Number(r.commission)) || r.commissionAsset!=='USDT' || !(Number(r.qty)>0) || !(Number(r.time)>0))throw new Error('V12_NET_EXIT_FILL_INVALID');
    if(unique.has(String(r.id)))continue;unique.add(String(r.id));
    if(r.side===openingSide){if(String(r.orderId)!==String(entry.orderId))throw new Error('V12_NET_EXIT_FOREIGN_OPENING_FILL');opened+=Number(r.qty);openQty+=Number(r.qty);}
    else openQty-=Number(r.qty);
    if(openQty < -tol || opened > Number(entry.executedQty)+tol)throw new Error('V12_NET_EXIT_QUANTITY_RECONCILIATION_FAILED');
    net+=Number(r.realizedPnl)-Number(r.commission);last=Math.max(last,Number(r.time));
    if(Math.abs(openQty)<=tol && Math.abs(opened-Number(entry.executedQty))<=tol){flat=true;break;}
  }
  if(!flat)throw new Error('V12_NET_EXIT_QUANTITY_RECONCILIATION_FAILED');
  const income=await adapter.client.getIncomeHistory({symbol:position.symbol,incomeType:'FUNDING_FEE',startTime:first,endTime:last,limit:1000});
  if(income.length>=1000)throw new Error('V12_NET_EXIT_FUNDING_COVERAGE_UNPROVEN');
  const seen=new Set<string>();for(const r of income){if(r.asset!=='USDT'||!Number.isFinite(Number(r.income))||r.incomeType!=='FUNDING_FEE'||r.symbol!==position.symbol)throw new Error('V12_NET_EXIT_FUNDING_INVALID');const id=String(r.tranId||`${r.time}|${r.income}`);if(!seen.has(id)){net+=Number(r.income);seen.add(id);}}
  return {id:position.positionId,side:position.side,netPnl:net,exitTs:last};
}

export async function recordV12ConfirmedExitBatch(adapter:V12AsterLiveAdapter,state:V12X1AllRunnerState,positions:readonly V12ActivePositionState[],now:number) {
  const ledger:SideLossLedger=state.sideLossLedger ||= {initializedAt:now};
  const events=[];const seen=new Set<string>();
  for(const p of positions){if(ledger.completed?.includes(p.positionId)||seen.has(p.positionId))continue;seen.add(p.positionId);events.push(await getV12ConfirmedExitEvidence(adapter,p,now));}
  events.sort((a,b)=>a.exitTs-b.exitTs||a.id.localeCompare(b.id));
  for(const event of events)recordSideExit(ledger,event);
}
export async function recordV12ConfirmedExit(adapter:V12AsterLiveAdapter,state:V12X1AllRunnerState,position:V12ActivePositionState,now:number){return recordV12ConfirmedExitBatch(adapter,state,[position],now);}
