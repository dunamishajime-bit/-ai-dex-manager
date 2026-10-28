import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import { readFile,writeFile,rename } from 'node:fs/promises';
import type { AsterV3Client, AsterPositionRiskRow } from './aster-v3-client';

export const V4_PRIMARY_OWNER_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79";
export type V4OwnerProof={symbol:string;side:"LONG"|"SHORT";quantity:number;price:number;stopClientOrderId:string};

export function v4ProofsFromIndependentEvidence(orders:any[],ledger:any,heartbeat:any,marker:string,now:number):V4OwnerProof[]{
 const sha=V4_PRIMARY_OWNER_SHA;
 if(marker.trim()!==sha||ledger?.releaseSha!==sha||heartbeat?.runtimeSha!==sha||heartbeat?.expectedSha!==sha
  ||heartbeat?.serviceUnit!==`disdex-v12-v4@${sha}.service`||heartbeat?.mode!=="LIVE"||heartbeat?.safetyState!=="HEALTHY"
  ||!Number.isFinite(Number(heartbeat?.lastTickAt))||Number(heartbeat.lastTickAt)>now+5000||now-Number(heartbeat.lastTickAt)>180000)return [];
 const legs=ledger?.state?.legs;
 const protections=ledger?.protections;
 if(!legs||!protections||typeof legs!=="object"||typeof protections!=="object")return [];
 const proofs:V4OwnerProof[]=[];
 const used=new Set<string>();
 for(const [key,leg] of Object.entries(legs as Record<string,any>)){
  if(leg?.status!=="OPEN")continue;
  const match=/^([A-Z0-9]+USDT):[^:]+:(LONG|SHORT):(\d+)$/.exec(key);
  if(!match)continue;
  const [,symbol,side]=match;
  const pr=protections[key];
  const quantity=Number(leg.qty),entryNotional=Number(leg.entryNotional);
  const stopId=String(pr?.stopClientOrderId||"");
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(entryNotional)||entryNotional<=0
   ||pr?.phase!=="STOP_CONFIRMED"||!Number.isFinite(Number(pr.protectedQty))||Math.abs(Number(pr.protectedQty)-quantity)>Math.max(1e-8,quantity*1e-9)
   ||!/^v12-v4-[0-9a-f]+$/.test(stopId)||used.has(stopId))continue;
  used.add(stopId);
  const matched=orders.filter(o=>o.clientOrderId===stopId&&o.symbol===symbol&&o.type==="STOP_MARKET");
  if(matched.length!==1)continue;
  const o=matched[0],qty=Number(o.origQty)-Number(o.executedQty),price=Number(o.stopPrice);
  if(o.side!==(side==="SHORT"?"BUY":"SELL")||o.reduceOnly!==true||!["NEW","PARTIALLY_FILLED"].includes(o.status)
   ||!Number.isFinite(qty)||Math.abs(qty-quantity)>Math.max(1e-8,quantity*1e-9)
   ||!Number.isFinite(price)||price<=0)continue;
  const avg=entryNotional/quantity,tol=Math.max(1e-8,avg*0.0002);
  if(side==="SHORT"&&price>avg*1.08+tol)continue;
  if(side==="LONG"&&price<avg*0.92-tol)continue;
  proofs.push({symbol,side:side as "LONG"|"SHORT",quantity,price,stopClientOrderId:stopId});
 }
 return proofs;
}
export async function readV4OwnerProofs(orders:any[],now:number):Promise<V4OwnerProof[]>{
 const root=`/home/deploy/disdex-trading/releases/${V4_PRIMARY_OWNER_SHA}`;
 try{
  const [ledger,hb,marker]=await Promise.all([
   readFile("/var/lib/disdex/v12-v4/orders.json","utf8"),
   readFile("/var/lib/disdex/runner-health/heartbeats/v12-v4.json","utf8"),
   readFile(`${root}/.disdex-release-sha`,"utf8"),
  ]);
  return v4ProofsFromIndependentEvidence(orders,JSON.parse(ledger),JSON.parse(hb),marker,now);
 }catch{return [];}
}
export function observeResidentProtection(positions:any[],orders:any[],states:Record<string,any>,runtimeSha:string,now:number,v4Proofs:readonly V4OwnerProof[]=[]){
 const owners=new Map<string,{strategy:string;symbol:string;side:string;quantity:number;price?:number}[]>();
 function add(strategy:string,p:any){if(!p)return;const ids=[p.stopClientOrderId,p.protection?.stopClientOrderId,p.residentStop?.clientOrderId,p.recoveryV8?.fullHardStopClientOrderId,p.recoveryV8?.partialStopClientOrderId,p.recoveryV8?.remainingHardStopClientOrderId].filter(Boolean);for(const id of ids){const rows=owners.get(id)||[];rows.push({strategy,symbol:String(p.symbol||(strategy==='PENGU'?'PENGUUSDT':'')).toUpperCase(),side:p.side===1||p.side==='LONG'?'SELL':p.side===-1||p.side==='SHORT'?'BUY':'UNKNOWN',quantity:Number(p.quantity),price:p.residentStop?.stopPrice??p.hardStop??p.stopPrice??p.protection?.lastAckStop??p.lastAckStop??(p.recoveryV8?(p.recoveryV8.logicalEntryPrice??p.entryPrice)*(1-(id===p.recoveryV8.partialStopClientOrderId?PENGU_RECOVERY_V8.partial.stopPct:PENGU_RECOVERY_V8.exit.hardStopPct)):undefined)});owners.set(id,rows);}}
 for(const p of v4Proofs)add("V12_V4",{symbol:p.symbol,side:p.side,quantity:p.quantity,stopClientOrderId:p.stopClientOrderId,stopPrice:p.price});
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
 try{const entries=await Promise.all(Object.entries(paths).map(async([s,p])=>[s,JSON.parse(await readFile(p,'utf8').catch(()=>'{"unavailable":true}'))]));const openOrders=await client.getOpenOrders();const now=Date.now();
  const v4Proofs=await readV4OwnerProofs(openOrders,now);
  snapshot=observeResidentProtection(positions,openOrders,Object.fromEntries(entries),runtimeSha,now,v4Proofs);}
 catch(error){snapshot={schema:'resident-stop-observation/v1',runtimeSha,checkedAt:Date.now(),ok:false,readOnly:true,error:error instanceof Error?error.message:String(error),positions:[]};}
 const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(snapshot)+'\n',{mode:0o644});await rename(temp,path);lastObservationAt=Date.now();lastObservationSha=runtimeSha;
}
