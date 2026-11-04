/** Observations only. No exchange calls, permissions, state mutation or defaults
 * for missing financial data. Root-owned maintenance evidence remains evidence. */
import {open,lstat,readdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
const number=x=>typeof x==='number'&&Number.isFinite(x);
const fresh=(x,now,age)=>Number.isSafeInteger(x)&&x>0&&x<=now&&now-x<=age;
const unavailable=reason=>({status:'UNAVAILABLE',reason,cryptoGross:null,stockGross:null,totalGross:null,availableCryptoGross:null,availableStockGross:null,authorizesTrading:false});
export function classifyPendingExposure(raw,now){
 const no=reason=>({status:'BLOCKED',reason,activeCount:null,cryptoGross:null,stockGross:null,totalGross:null});
 if(raw?.schema!=='disdex-pending-exposure/v1'||raw.accountScope!=='ASTER_FUTURES'||!Array.isArray(raw.entries)||!fresh(raw.updatedAt,now,300000))return no('PENDING_EXPOSURE_STATE_INVALID');
 let cryptoGross=0,stockGross=0,activeCount=0;
 for(const e of raw.entries){
  if(!e||!['RELEASED','PENDING','SUBMITTED','UNKNOWN'].includes(e.status))return no('PENDING_EXPOSURE_STATUS_INVALID');
  if(e.status==='UNKNOWN')return no('PENDING_EXPOSURE_UNKNOWN_UNRECONCILED');
  if(e.status==='RELEASED')continue;
  if(!number(e.gross)||e.gross<0||!number(e.notionalUsd)||e.notionalUsd<0)return no('PENDING_EXPOSURE_VALUE_INVALID');
  if(!fresh(e.updatedAt,now,300000))return no('PENDING_EXPOSURE_FRESHNESS_INVALID');
  if(e.sleeve==='CRYPTO')cryptoGross+=e.gross;else if(e.sleeve==='STOCK')stockGross+=e.gross;else return no('PENDING_EXPOSURE_SLEEVE_INVALID');
  activeCount++;
 }
 if(!number(cryptoGross+stockGross))return no('PENDING_EXPOSURE_SUM_INVALID');
 return {status:'HEALTHY',reason:'',updatedAt:raw.updatedAt,activeCount,cryptoGross,stockGross,totalGross:cryptoGross+stockGross};
}
export function parseStrictCaps(text){
 const body=/^class StrictPortfolioCaps:\r?\n([\s\S]*?)^STRICT_CAPS\s*=\s*StrictPortfolioCaps\(\)/m.exec(text)?.[1];if(!body)return null;
 const caps={};for(const [key,field]of Object.entries({cryptoGross:'crypto_gross',stockGross:'stock_gross',totalGross:'total_gross',stockSlotGross:'stock_slot_gross'})){
  const match=new RegExp('^    '+field+': float = ([0-9]+(?:\\.[0-9]+)?)\\s*$','m').exec(body);
  if(!match||!number(Number(match[1]))||Number(match[1])<=0)return null;caps[key]=Number(match[1]);
 }
 return caps;
}
export function projectSignedFlatGross({report:r,sdkSha,pending:p,pendingDigest,caps,now}){
 const no=()=>unavailable('FRESH_SIGNED_FLAT_VENUE_EVIDENCE_REQUIRED');const v=r?.result;
 if(!/^[a-f0-9]{40}$/.test(sdkSha)||r?.sourceSha!==sdkSha||r.status!=='PENDING_MAINTENANCE_RECONCILED'||r.scope!=='PENDING_RECONCILE_ONLY'
  ||r.ordersEnabled!==false||r.authorizationMethod!=='ROOT_COMMITTED_NO_ORDER_MAINTENANCE'||!fresh(r.completedAt,now,120000)
  ||!v||!['PENDING_READONLY_RECONCILE_APPLIED','PENDING_READONLY_RECONCILE_VERIFIED'].includes(v.status)
  ||!fresh(v.verifiedAt,now,120000)||v.verifiedAt>r.completedAt||r.completedAt-v.verifiedAt>5000
  ||v.ownershipMode!=='FLAT_NO_OPEN_ORDERS'||v.positionCount!==0||v.openOrderCount!==0
  ||!['ordersSent','cancelsSent','positionChangesSent'].every(k=>Number.isSafeInteger(v[k])&&v[k]===0)
  ||!/^[a-f0-9]{64}$/.test(pendingDigest)||v.afterHash!==pendingDigest||p?.status!=='HEALTHY'
  ||!['cryptoGross','stockGross','totalGross'].every(k=>number(p[k])&&p[k]>=0)
  ||!caps||!['cryptoGross','stockGross','totalGross','stockSlotGross'].every(k=>number(caps[k])&&caps[k]>0))return no();
 return {status:'HEALTHY',reason:'FRESH_SIGNED_FLAT_NO_OPEN_ORDERS',source:'ROOT_COMMITTED_SIGNED_READ_ONLY_MAINTENANCE',sourceSha:sdkSha,
  asOf:v.verifiedAt,cryptoGross:0,stockGross:0,totalGross:0,reservedCryptoGross:p.cryptoGross,reservedStockGross:p.stockGross,reservedTotalGross:p.totalGross,
  availableCryptoGross:Math.max(0,Math.min(caps.cryptoGross-p.cryptoGross,caps.totalGross-p.totalGross)),
  availableStockGross:Math.max(0,Math.min(caps.stockGross-p.stockGross,caps.totalGross-p.totalGross)),caps,authorizesTrading:false};
}
export function projectV4Decision({row:r,sha,lastTickAt,now}){
 const no=()=>({status:'UNAVAILABLE',reason:'V4_DECISION_TELEMETRY_UNVERIFIED',items:[]});
 if(!/^[a-f0-9]{40}$/.test(sha)||r?.schema!=='disdex-v12-v4-gate-telemetry/v1'||r.runtimeSha!==sha||r.activeRunnerSha!==sha
  ||r.stale!==false||r.telemetryFresh!==true||r.lastTickAt!==lastTickAt||!fresh(r.updatedAt,now,180000)||!fresh(lastTickAt,now,180000)
  ||!Array.isArray(r.symbols)||r.symbols.length!==r.symbolCount)return no();
 const items=[];let routesEvaluated=0;
 for(const s of r.symbols){
  if(typeof s.symbol!=='string'||!s.symbol||!['LONG','SHORT',null].includes(s.nativeSide)||typeof s.sourceEligible!=='boolean'
   ||(s.nativeScore!==null&&!number(s.nativeScore))||typeof s.sourceReason!=='string')return no();
  if(s.routeGate?.state!=='NOT_EVALUATED'&&Array.isArray(s.routeGate?.routes))routesEvaluated+=s.routeGate.routes.length;
  items.push({symbol:s.symbol,direction:s.nativeSide||'UNAVAILABLE',logic:'V4_NATIVE_ENTRY_OBSERVATION',score:s.nativeScore,
   eligible:s.sourceEligible,reason:s.sourceReason,portfolioRank:s.portfolioRank??null,routeStatus:s.routeGate?.state??'UNAVAILABLE'});
 }
 items.sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)||a.symbol.localeCompare(b.symbol));
 return {status:'OBSERVED',sourceSha:sha,asOf:lastTickAt,decisionTs:r.decisionTs??null,symbolsEvaluated:items.length,routesEvaluated,items};
}

async function trustedText(path,{immutable=false,ownerUid=0,ownerGid}={}){
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==ownerUid||(ownerGid!==undefined&&before.gid!==ownerGid)||(before.mode&0o022)||(immutable&&(before.mode&0o222))||before.size>524288)throw Error('OBSERVABILITY_SOURCE_UNTRUSTED');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const actual=await fd.stat();if(before.ino!==actual.ino||before.dev!==actual.dev)throw Error('OBSERVABILITY_SOURCE_CHANGED');
  const text=await fd.readFile('utf8');const after=await fd.stat();if(actual.size!==after.size||actual.mtimeMs!==after.mtimeMs)throw Error('OBSERVABILITY_SOURCE_CHANGED');return text;
 }finally{await fd.close();}
}
export async function readSignedFlatGross({v52Root,pending,pendingDigest,now}){
 try{
  const folder='/var/lib/disdex/unified-deploy/pending-maintenance/results';const meta=await lstat(folder);
  if(!meta.isDirectory()||meta.isSymbolicLink()||meta.uid!==0||meta.gid!==0||(meta.mode&0o077)||await realpath(folder)!==folder)throw Error('OBSERVABILITY_REPORT_DIRECTORY');
  const status=JSON.parse(await trustedText('/var/lib/disdex/runner-health/pending-maintenance/status.json'));
  if(status.status!=='PENDING_MAINTENANCE_RECONCILED'||status.ordersEnabled!==false||!fresh(status.lastReconciledAt,now,120000)||!/^[a-f0-9]{40}$/.test(status.sourceSha))return unavailable('SIGNED_MAINTENANCE_NOT_FRESH');
  const marker=await trustedText('/home/deploy/disdex-trading/releases/'+status.sourceSha+'/.disdex-release-sha',{immutable:true});if(marker.trim()!==status.sourceSha)throw Error('OBSERVABILITY_SDK_SHA');
  const names=(await readdir(folder)).filter(x=>/^[a-f0-9]{32}\.json$/.test(x));if(!names.length||names.length>100000)throw Error('OBSERVABILITY_REPORT_INVENTORY');
  let latest=null;for(const name of names){const p=folder+'/'+name;const s=await lstat(p);if(!latest||s.mtimeMs>latest.at)latest={path:p,at:s.mtimeMs};}
  const report=JSON.parse(await trustedText(latest.path));if(report.result?.verifiedAt!==status.lastReconciledAt)return unavailable('SIGNED_MAINTENANCE_PUBLICATION_IN_PROGRESS');
  if(!/^\/home\/deploy\/disdex-trading\/releases\/[a-f0-9]{40}$/.test(v52Root))throw Error('OBSERVABILITY_POLICY_ROOT');
  const caps=parseStrictCaps(await trustedText(v52Root+'/scripts/disdex_strict_portfolio_planner.py',{immutable:true}));
  return projectSignedFlatGross({report,sdkSha:status.sourceSha,pending,pendingDigest,caps,now});
 }catch{return unavailable('SIGNED_VENUE_POSITION_SNAPSHOT_REQUIRED');}
}
export async function readV4Decision({runner,lastTickAt,now,pid}){
 try{
  if(!Number.isSafeInteger(pid)||pid<=0)throw Error('V4_OBSERVATION_PID');
  const owner=await lstat('/proc/'+pid);
  if(owner.uid<=0||owner.gid<=0)throw Error('V4_OBSERVATION_PROCESS_OWNER');
  const row=JSON.parse(await trustedText('/var/lib/disdex/v12-v4/gate-telemetry.json',{ownerUid:owner.uid,ownerGid:owner.gid}));
  return projectV4Decision({row,sha:runner.expectedSha,lastTickAt,now});
 }catch{return {status:'UNAVAILABLE',reason:'V4_DECISION_TELEMETRY_UNVERIFIED',items:[]};}
}
export function pendingBytesDigest(text){return createHash('sha256').update(text).digest('hex');}
