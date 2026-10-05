import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import { readFile,writeFile,rename } from 'node:fs/promises';
import type { AsterV3Client, AsterPositionRiskRow } from './aster-v3-client';
export function observeResidentProtection(positions:any[],orders:any[],states:Record<string,any>,runtimeSha:string,now:number){
 const owners=new Map<string,{strategy:string;symbol:string;side:string;quantity:number;price?:number}[]>();
 function add(strategy:string,p:any){if(!p)return;const ids=[p.stopClientOrderId,p.protection?.stopClientOrderId,p.residentStop?.clientOrderId,p.recoveryV8?.fullHardStopClientOrderId,p.recoveryV8?.partialStopClientOrderId,p.recoveryV8?.remainingHardStopClientOrderId].filter(Boolean);for(const id of ids){const rows=owners.get(id)||[];rows.push({strategy,symbol:String(p.symbol||(strategy==='PENGU'?'PENGUUSDT':'')).toUpperCase(),side:p.side===1||p.side==='LONG'?'SELL':p.side===-1||p.side==='SHORT'?'BUY':'UNKNOWN',quantity:Number(p.quantity),price:p.residentStop?.stopPrice??p.hardStop??p.stopPrice??p.protection?.lastAckStop??p.lastAckStop??(p.recoveryV8?(p.recoveryV8.logicalEntryPrice??p.entryPrice)*(1-(id===p.recoveryV8.partialStopClientOrderId?PENGU_RECOVERY_V8.partial.stopPct:PENGU_RECOVERY_V8.exit.hardStopPct)):undefined)});owners.set(id,rows);}}
 for(const [strategy,s] of Object.entries(states)){if(!(Number(s.updatedAt)>0)||now-Number(s.updatedAt)>300000||Number(s.updatedAt)>now+5000)continue;if((s.runtimeCommitSha&&s.runtimeCommitSha!==runtimeSha)||(s.runtimeSha&&s.runtimeSha!==runtimeSha))continue;add(strategy,s.position);for(const p of s.positions||s.activePositions||[])add(strategy,p);}
 const active=positions.filter(p=>Math.abs(Number(p.positionAmt))>1e-12);
 const rows=active.map(p=>{
  const quantity=Math.abs(Number(p.positionAmt)),side=Number(p.positionAmt)>0?'SELL':'BUY';
  const stops=orders.filter(o=>o.symbol===p.symbol&&o.type==='STOP_MARKET');
  const known=stops.filter(o=>{const own=owners.get(o.clientOrderId);return own?.length===1&&own[0].symbol===p.symbol&&own[0].side===side&&Math.abs(own[0].quantity-quantity)<=Math.max(1e-8,quantity*1e-9)&&Number(own[0].price)>0;});
  const strategies=[...new Set(known.flatMap(o=>(owners.get(o.clientOrderId)||[]).map(x=>x.strategy)))];
  const good=stops.length>0&&known.length===stops.length&&strategies.length===1&&new Set(stops.map(o=>o.clientOrderId)).size===stops.length&&stops.every(o=>o.side===side&&o.reduceOnly===true&&['NEW','PARTIALLY_FILLED'].includes(o.status)&&Number(o.stopPrice)>0&&Number(o.executedQty)>=0&&Number(o.origQty)>Number(o.executedQty)&&(!owners.get(o.clientOrderId)?.[0].price||Math.abs(Number(o.stopPrice)-owners.get(o.clientOrderId)![0].price!)<=Math.max(1e-8,Number(o.stopPrice)*1e-9)))&&Math.abs(stops.reduce((n,o)=>n+Number(o.origQty)-Number(o.executedQty),0)-quantity)<=Math.max(1e-8,quantity*1e-9);
  const stock=/^(AMZN|META|MSFT|NVDA|TSLA)USDT$/.test(p.symbol);
  return{symbol:p.symbol,positionSide:side==='SELL'?'LONG':'SHORT',quantity,strategy:strategies[0]??(stock?'V52':'UNKNOWN'),protected:stock?null:good,readBackStatus:stock?'DYNAMIC_BASIS_ONLY':good?'VERIFIED':'UNVERIFIED',lastReconciledAt:now,orders:stops.map(o=>({orderId:o.orderId,clientOrderId:o.clientOrderId,side:o.side,reduceOnly:o.reduceOnly,quantity:Number(o.origQty)-Number(o.executedQty),stopPrice:Number(o.stopPrice),status:o.status}))};
 });
 return{schema:'resident-stop-observation/v1',runtimeSha,checkedAt:now,ok:true,readOnly:true,ordersSent:0,cancelsSent:0,positions:rows,orphanStops:orders.filter(o=>o.type==='STOP_MARKET'&&!active.some(p=>p.symbol===o.symbol)).map(o=>({symbol:o.symbol,clientOrderId:o.clientOrderId})),unprotectedCount:rows.filter(p=>p.protected===false).length};
}
let lastObservationAt=0,lastObservationSha="";
export async function refreshResidentProtectionObservation(client:AsterV3Client,positions:AsterPositionRiskRow[],path:string,runtimeSha:string){
 if(Date.now()-lastObservationAt<60_000&&lastObservationSha===runtimeSha)return;
 const paths:Record<string,string>={V12:'/var/lib/disdex/v12-x1-all/runner.json',PENGU:'/var/lib/disdex/pengu-dual-ls-v2/runner-live.json',Q102:'/var/lib/disdex/quality102-causal-v1/state.json',FET:'/var/lib/disdex/fet-brk48-residual/state.json',HYPE:'/var/lib/disdex/hype-zec-long/runner.json',IDLE:'/var/lib/disdex/idle-priority/state.json',RESIDUAL:'/var/lib/disdex/idle-priority/residual-long-state.json'};
 let snapshot:any;
 try{const entries=await Promise.all(Object.entries(paths).map(async([s,p])=>[s,JSON.parse(await readFile(p,'utf8').catch(()=>'{"unavailable":true}'))]));snapshot=observeResidentProtection(positions,await client.getOpenOrders(),Object.fromEntries(entries),runtimeSha,Date.now());}
 catch(error){snapshot={schema:'resident-stop-observation/v1',runtimeSha,checkedAt:Date.now(),ok:false,readOnly:true,error:error instanceof Error?error.message:String(error),positions:[]};}
 const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(snapshot)+'\n',{mode:0o644});await rename(temp,path);lastObservationAt=Date.now();lastObservationSha=runtimeSha;
}
