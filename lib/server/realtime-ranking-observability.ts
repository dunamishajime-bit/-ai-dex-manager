import { readFile } from 'node:fs/promises';
import { REALTIME_RANKING_REFRESH_MS,expireRealtimeRankingRows,fetObservationExpiry,freshTimestamp,gateCompletionMetric,nativeMetric,rankRows,realtimeRankingCacheExpiry,type Gate,type RankMetric,type RankRow,type RankingSourceStatus } from '@/lib/realtime-ranking';
import { loadCurrentProductionRuntime } from './current-production-runtime';
import { loadDecisionStatus } from './disdex-decision-status';
import { loadV12V4HpObservability } from './v12-v4-hp-observability';
import type { V12V4HpSnapshot } from '@/lib/v12-v4-hp-contract';
import { loadQuality102SymbolObservability } from './quality102-symbol-observability';
import { loadPenguRuntimeObservability } from './pengu-runtime-observability';
import { loadHypeRuntimeObservability } from './hype-runtime-observability';
import { loadFetGates } from './fet-gate-observability';
import { DIST_TERMINAL_LIVE_CONFIG } from '@/lib/disterminal-live-config';
import { V12_V4_HP_ROUTE_IDS, V12_V4_HP_TARGET } from '@/lib/v12-v4-hp-contract';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const list=(v:unknown)=>Array.isArray(v)?v.map(obj):[];
const num=(v:unknown)=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):undefined;
const text=(v:unknown)=>typeof v==='string'?v:'';
const ROOT='/home/deploy/disdex-trading/current';
async function json(path:string){const s=await readFile(path,'utf8');if(s.length>2*1024*1024)throw Error('SNAPSHOT_TOO_LARGE');return obj(JSON.parse(s));}
function flag(key:string,label:string,value:unknown,detail:string,kind:Gate['kind']='signal'):Gate{return {key,label,state:typeof value==='boolean'?value?'OK':'NO':'UNKNOWN',detail,kind};}
type RankRowOptions={metric?:RankMetric;rankingScope?:string;sourceRank?:number;rankingEligible?:boolean;rankingContractAvailable?:boolean;rankingExclusion?:string;sourceStatus?:RankingSourceStatus;sourceRoute?:string;sourceFeatures?:Record<string,number|boolean>};
function make(symbol:string,logic:string,side:string,gates:Gate[],fresh:boolean,checkedAt:number,reason:string,options:RankRowOptions={}):RankRow{
 const metric=options.metric??gateCompletionMetric(gates,fresh);
 return {id:logic+':'+symbol+':'+side+(options.sourceRoute?':'+options.sourceRoute:''),symbol,logic,side,gates,fresh,checkedAt,reason:!fresh?'観測が古い・未取得 / '+reason:reason,...metric,rankingScope:options.rankingScope??logic,rankingEligible:options.rankingEligible??false,rankingContractAvailable:options.rankingContractAvailable??false,...(options.sourceRank!==undefined?{sourceRank:options.sourceRank}:{}),...(options.rankingExclusion?{rankingExclusion:options.rankingExclusion}:{}),...(options.sourceStatus?{sourceStatus:options.sourceStatus}:{}),...(options.sourceRoute?{sourceRoute:options.sourceRoute}:{}),...(options.sourceFeatures?{sourceFeatures:options.sourceFeatures}:{}),href:'/decision-status/'+(logic.startsWith('Idle')?'idle-priority':logic.toLowerCase())};
}
function decisionSourceStatus(snapshot:V12V4HpSnapshot):RankingSourceStatus{
 if(snapshot.errors.some(error=>/V4_DECISION_SOURCE|V4_DECISION_SCHEMA|V4_DECISION_BATCH|V4_FILTERED|V4_CANDIDATE|V4_DECISION_ROW/.test(error)))return 'SOURCE_ERROR';
 if(snapshot.freshness.decision)return 'FRESH';
 if(snapshot.timestamps.decisionTs!==null||snapshot.timestamps.capturedAtMs!==null)return 'STALE';
 return snapshot.errors.length?'SOURCE_ERROR':'NOT_EVALUATED';
}
export function v12V4SnapshotToRankRows(snapshot:V12V4HpSnapshot,now=Date.now()):RankRow[]{
 const sourceStatus=decisionSourceStatus(snapshot),fresh=sourceStatus==='FRESH',checkedAt=snapshot.timestamps.decisionTs??snapshot.timestamps.capturedAtMs??now;
 const runtimeState=snapshot.displayStatus==='LIVE_VERIFIED'?'OK':snapshot.displayStatus==='UNAVAILABLE'||snapshot.displayStatus==='SOURCE_ERROR'?'UNKNOWN':'NO';
 const runtimeGate:Gate={key:'v4-runtime',label:'V12 V4 runtime状態',state:runtimeState,detail:'表示状態: '+snapshot.displayStatus,kind:'execution'};
 const metric=nativeMetric(undefined,'V4 decision source has no verified native score',fresh);
 const rows:RankRow[]=[
  ...snapshot.candidates.map(candidate=>make(candidate.symbol,'V12_V4',candidate.side??'WAIT',[runtimeGate],fresh,checkedAt,'V4候補 / '+(candidate.family??candidate.route)+' / '+candidate.rankingExclusion,{
    metric,rankingScope:'V12_V4',sourceRank:candidate.sourceRank??undefined,rankingEligible:false,rankingContractAvailable:false,
    rankingExclusion:candidate.rankingExclusion,sourceStatus,sourceRoute:candidate.route,sourceFeatures:candidate.features,
  })),
  ...snapshot.filtered.map(filtered=>make(filtered.symbol,'V12_V4',filtered.side??'WAIT',[
    {key:'causal-filter',label:'V4因果Gate',state:fresh?'NO':'UNKNOWN',detail:filtered.reason,kind:'signal'},runtimeGate,
  ],fresh,checkedAt,filtered.reason,{
    metric,rankingScope:'V12_V4',rankingEligible:false,rankingContractAvailable:false,rankingExclusion:'FILTERED_BY_V4_SOURCE',
    sourceStatus,sourceRoute:filtered.route,
  })),
 ];
 if(!rows.length){
  const sentinelStatus=sourceStatus==='FRESH'?'NOT_EVALUATED':sourceStatus;
  rows.push(make('—','V12_V4','WAIT',[{key:'source',label:'V4 decision rows',state:'UNKNOWN',detail:sentinelStatus==='SOURCE_ERROR'?'V4 decision source取得失敗':sentinelStatus==='STALE'?'V4 decision source stale':'このcycleにV4 candidate/filtered rowなし',kind:'signal'},runtimeGate],false,checkedAt,sentinelStatus==='SOURCE_ERROR'?'V4 decision source取得失敗':'V4 source row未出力',{
    metric:nativeMetric(undefined,'V4 decision source has no verified native score',false),rankingScope:'V12_V4',rankingEligible:false,rankingContractAvailable:false,sourceStatus:sentinelStatus,
  }));
 }
 return rows;
}
export function mergeV12V4RealtimeRows(existing:RankRow[],snapshot:V12V4HpSnapshot,now=Date.now()):RankRow[]{
 return [...existing.filter(row=>row.logic!=='V12'&&row.logic!=='V12_V4'),...v12V4SnapshotToRankRows(snapshot,now)];
}
export function v12V4RealtimeSummary(snapshot:V12V4HpSnapshot){
 return {displayStatus:snapshot.displayStatus,target:snapshot.target,actual:snapshot.actual,routeCoverage:snapshot.routeCoverage,timestamps:snapshot.timestamps,freshness:snapshot.freshness,errors:snapshot.errors,readOnly:true as const,tradingMutation:0 as const};
}
function unavailableV12V4RealtimeSummary(now:number){
 return {displayStatus:'UNAVAILABLE' as const,target:V12_V4_HP_TARGET,actual:{currentReleaseSha:null,activeRunnerId:null,activeRunnerState:'unavailable',activeRunnerSha:null,v4RunnerMode:'UNKNOWN' as const,v12PrimaryMode:'UNKNOWN' as const,legacyV12RunnerActive:null,v4ReleaseSha:null,heartbeatSha:null,orderEnabled:null},routeCoverage:{expected:V12_V4_HP_TARGET.expectedRouteCount,observed:0,candidateCount:null,filteredCount:null,unobserved:[...V12_V4_HP_ROUTE_IDS],completeness:false as const,semantics:'EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE' as const},timestamps:{checkedAt:now,heartbeatUpdatedAt:null,decisionTs:null,capturedAtMs:null},freshness:{heartbeat:false,decision:false},errors:['V4 observability取得失敗'],readOnly:true as const,tradingMutation:0 as const};
}
const SOURCES=['V12_V4','Q102','PENGU','FET','HYPE','Idle','V52'];
async function observe(){
 const now=Date.now(),current=await loadCurrentProductionRuntime(),rows:RankRow[]=[],errors:Record<string,string>={};
 let v12V4Snapshot:V12V4HpSnapshot|undefined;
 const sourceExpiries:number[]=[],sourceExpiryByLogic:Record<string,number>={};
 const constrainFreshness=(logic:string,at:unknown,maxAge:number,invalidatesScore=true)=>{const timestamp=Number(at),expiry=timestamp+maxAge;if(Number.isFinite(timestamp)&&timestamp>0){sourceExpiries.push(expiry);if(invalidatesScore)sourceExpiryByLogic[logic]=Math.min(sourceExpiryByLogic[logic]??Infinity,expiry);}};
 const jobs=[
  async()=>{
   v12V4Snapshot=await loadV12V4HpObservability();
   constrainFreshness('V12_V4',v12V4Snapshot.timestamps.heartbeatUpdatedAt,3*3600000);
   constrainFreshness('V12_V4',v12V4Snapshot.timestamps.decisionTs,3*3600000);
   rows.push(...v12V4SnapshotToRankRows(v12V4Snapshot,now));
  },
  async()=>{
   const d=await loadQuality102SymbolObservability(),rankAt=Date.parse(d.rankingCapturedAt||d.capturedAt),rankingFresh=freshTimestamp(rankAt,now,2*3600000)&&freshTimestamp(Date.parse(d.capturedAt),now,2*3600000);
   constrainFreshness('Q102',rankAt,2*3600000);constrainFreshness('Q102',Date.parse(d.capturedAt),2*3600000);
   for(const r of d.items){
    const models=list(r.diagnostics?.s34),best=models.sort((a,b)=>(num(b.rankingScore)??0)-(num(a.rankingScore)??0))[0],highVol=obj(r.diagnostics?.highVol);
    const gates:Gate[]=list(best?.gates).map(g=>({key:text(g.name),label:text(g.name),state:typeof g.pass==='boolean'?g.pass?'OK':'NO':'UNKNOWN',actual:typeof g.value==='string'||typeof g.value==='number'?g.value:undefined,required:typeof g.threshold==='string'||typeof g.threshold==='number'?g.threshold:undefined,detail:text(g.reason),kind:text(g.name).includes('GRID')?'execution':'signal'}));
    if(!gates.length)gates.push(flag('raw','候補条件',highVol.selectionAvailable===false?undefined:r.eligible,r.rankingReason||r.reason));
    for(const g of gates)if(g.key==='RAW_DETECTOR'&&g.state==='NO'&&num(best?.proximityScore)!==undefined)g.progress=Number(best.proximityScore)/100;
    gates.push(flag('eligible','実Runner最終Signal',r.eligible,r.rankingReason||r.reason));
    gates.push(flag('selection','同時候補の選定',r.selected,d.selectedReason,'execution'));
    const rawSide=num(best?.proximitySide)??num(best?.candidateSide);
    const hasNativeScore=typeof r.rankingScore==='number'&&Number.isFinite(r.rankingScore);
    const rankingContractAvailable=rankingFresh&&d.snapshotSource==='ranking'&&d.rankingAvailable;
    const metric=hasNativeScore
     ?nativeMetric(r.rankingScore,'Q102 Proximity V1（モデル単位）',rankingFresh)
     :gateCompletionMetric(gates,rankingFresh);
    const row=make(r.symbol,'Q102',r.side==='WAIT'?(rawSide===1?'LONG':rawSide===-1?'SHORT':'WAIT'):r.side,gates,rankingFresh,rankAt,r.rankingReason||r.reason,{
     metric,rankingScope:'Q102',sourceRank:r.rankingRank,rankingEligible:rankingContractAvailable&&r.rankingRank!==undefined&&hasNativeScore&&(r.rankingScore??0)>0,
     rankingContractAvailable,sourceStatus:rankingFresh?'FRESH':'STALE',
    });
    // Keep the native model output visible in the detail panel without feeding it
    // into the Gate-completion metric used by strategies that have no native score.
    if(hasNativeScore)row.gates.push({key:'native-score',label:'Q102 Proximity V1（モデル単位）',state:rankingFresh?'OK':'UNKNOWN',actual:r.rankingScore,detail:r.rankingStage||'snapshotのsource値',kind:'execution'});
    rows.push(row);
   }
  },
  async()=>{
   const d=await loadPenguRuntimeObservability(),s=d.latestSignal,signalAt=s?.referenceTs??0,lineage=current.runtimeLineage.units.pengu,runtimeVerified=d.releaseShaVerified===true||(d.releaseSha===undefined&&lineage.matchesCurrent&&freshTimestamp(lineage.updatedAt,now,3*3600000)),fresh=d.status==='LIVE'&&runtimeVerified&&freshTimestamp(d.updatedAt,now,3*3600000)&&freshTimestamp(signalAt,now,2*3600000)&&freshTimestamp(s?.diagnostics.latestCompletedPenguTs,now,2*3600000)&&s?.diagnostics.latestCompletedPenguTs===s?.diagnostics.latestCompletedBtcTs;
   constrainFreshness('PENGU',d.updatedAt,3*3600000);constrainFreshness('PENGU',signalAt,2*3600000);constrainFreshness('PENGU',s?.diagnostics.latestCompletedPenguTs,2*3600000);
   if(d.releaseSha===undefined)constrainFreshness('PENGU',lineage.updatedAt,3*3600000);
   for(const side of ['LONG','SHORT']){
    const eligible=side==='LONG'?(s?.side===1?true:s?.decision.longEligible):(s?.side===-1?true:s?.decision.shortEligible);
    const gates=[flag('direction',side+'専用ロジック',eligible,s?.decision.reason||d.reason)];
    gates.push(flag('snapshot-sha','判定snapshotのSHA',d.releaseShaVerified,d.releaseSha?'snapshot SHAを照合':'snapshotにSHA記載なし。稼働HeartbeatのSHAと鮮度は別途照合済み','execution'));
    if(side==='SHORT'){gates.push(flag('setup','戻り売りSetup Active',s?.diagnostics.shortSetupActive,'下落衝動後の戻りと反転を判定'));gates.push(flag('armed','Setup Armed',s?.diagnostics.shortSetupArmed,'Short専用の状態遷移'));}
    gates.push(flag('holding','既存保有・保留注文なし',!d.position&&!d.pending,d.position?'PENGU保有中':d.pending?'注文処理中':'空き状態','execution'));
    gates.push(...d.executionTrace.steps.map(g=>({key:g.key,label:g.label,state:g.state==='pass'?'OK' as const:g.state==='blocked'?'NO' as const:'UNKNOWN' as const,detail:g.detail,kind:'execution' as const})));
    rows.push(make('PENGUUSDT','PENGU',side,gates,fresh,signalAt,s?.reason||d.reason));
   }
  },
  async()=>{const d=await loadFetGates(),expiry=fetObservationExpiry(d.checkedAt,110000);constrainFreshness('FET',d.checkedAt,110000);sourceExpiries.push(expiry);sourceExpiryByLogic.FET=Math.min(sourceExpiryByLogic.FET??Infinity,expiry);rows.push(make(d.symbol,'FET',d.side,d.gates,d.fresh,d.checkedAt,d.reason));},
  async()=>{
   const d=await loadHypeRuntimeObservability(),s=d.sleeves.HYPE_LONG;
   constrainFreshness('HYPE',s.stateUpdatedAt,180000);constrainFreshness('HYPE',s.publicReferenceTs,20*60000);
   const gates:Gate[]=s.gates.map(g=>({key:g.key,label:g.label,state:g.status==='PASS'?'OK':g.status==='BLOCKED'?'NO':'UNKNOWN',actual:g.actual,required:g.threshold,detail:g.reason,kind:g.source==='PUBLIC_CANDLES'?'signal':'execution'}));
   gates.push(flag('position','新規保有枠',!s.position&&!s.pending,s.position?'HYPE保有中':s.pending?'保留注文あり':'保有なし','execution'));
   rows.push(make('HYPEUSDT','HYPE','LONG',gates,s.status==='LIVE'&&s.stateSha===current.releaseSha&&s.gates.some(g=>g.key==='DATA_FRESHNESS'&&g.status==='PASS'),s.publicReferenceTs||0,s.note));
  },
  async()=>{
   const d=await json(process.env.DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH||'/var/lib/disdex/idle-priority/decision-details.json');
   const at=num(d.updatedAt)??0,fresh=d.runtimeSha===current.releaseSha&&now-at>=-60000&&now-at<=2*3600000;
   const [state,residual]=await Promise.all([json('/var/lib/disdex/idle-priority/state.json').catch(()=>({} as Obj)),json('/var/lib/disdex/idle-priority/residual-long-state.json').catch(()=>({} as Obj))]);
   constrainFreshness('Idle Short',at,2*3600000);constrainFreshness('Idle Long',at,2*3600000);
   constrainFreshness('Idle Short',state.updatedAt,2*3600000,false);constrainFreshness('Idle Long',residual.updatedAt,2*3600000,false);
   for(const r of [...list(d.symbols),...list(d.residual)]){
    const isLong=!!r.decision,decision=obj(r.decision||r.routeDecision),generic=obj(r.generic),gates:Gate[]=[];
    if(!isLong)gates.push(flag('generic','汎用候補の成立',generic.accepted,text(generic.reason)));
    gates.push(flag('route','通貨専用 '+text(r.route),decision.accepted,text(decision.reason)));
    if(!isLong)gates.push(flag('cooldown','通貨Cooldown',r.cooldownAllowed,'同一通貨の候補間隔','execution'));
    const holding=obj(isLong?residual:state),hasPosition=!!holding.position||list(holding.positions).length>0,holdingFresh=holding.runtimeSha===current.releaseSha&&now-Number(holding.updatedAt)>=-60000&&now-Number(holding.updatedAt)<2*3600000;
    gates.push(flag('holding','Idle保有・保留なし',holdingFresh?!hasPosition&&!holding.pending&&!holding.manualReview:undefined,hasPosition?'Idle保有中':holding.pending?'Idle注文処理中':holdingFresh?'保有状態確認済み（共有枠は別途確認）':'保有状態の観測未確認','execution'));
    gates.push(flag('capacity','優先ロジック空き・残余Gross',undefined,'優先ロジックの保有・同時候補・証拠金をRunnerが最終確認','execution'));
    rows.push(make(text(r.symbol),isLong?'Idle Long':'Idle Short',isLong?'LONG':'SHORT',gates,fresh,at,text(decision.reason)));
   }
  },
  async()=>{
   const d=await loadDecisionStatus();
   for(const r of d.v52.items){const at=Date.parse(r.dataUpdatedAt||r.checkedAt),fresh=d.v52.marketOpen&&r.status!=='取得不能'&&!!r.dataUpdatedAt&&now-at>=-60000&&now-at<2*3600000;
    rows.push(make(r.symbol,'V52',r.side,[flag('market','株式市場・判定時間',d.v52.marketOpen,r.reason,'execution'),flag('signal','V52実Runner判定',undefined,'現行観測はBasis候補まで。指値の発注Signal・約定可否は未確認 / '+r.reason)],fresh,at,r.reason));
   }
   for(const symbol of DIST_TERMINAL_LIVE_CONFIG.stockSymbols)if(!d.v52.items.some(r=>r.symbol===symbol))rows.push(make(symbol,'V52','WAIT',[flag('signal','V52候補観測',undefined,'この銘柄は最新候補台帳に記録されていません')],false,now,'最新候補台帳に未記録。NOとは断定しません'));
  }
 ];
  const results=await Promise.allSettled(jobs.map(job=>job()));
  results.forEach((result,i)=>{if(result.status==='rejected'){
   errors[SOURCES[i]]='観測取得失敗';
   if(SOURCES[i]==='V12_V4')rows.push(make('—','V12_V4','WAIT',[flag('source','V4 decision観測',undefined,'取得不能')],false,now,'V4 observability取得失敗',{metric:nativeMetric(undefined,'V4 decision source has no verified native score',false),rankingScope:'V12_V4',rankingEligible:false,rankingContractAvailable:false,sourceStatus:'SOURCE_ERROR'}));
   else rows.push(make('—',SOURCES[i],'WAIT',[flag('source','観測接続',undefined,'取得不能')],false,now,'観測取得失敗',{sourceStatus:'SOURCE_ERROR'}));
  }});
 const [kill,risk]=await Promise.all([json(process.env.DISDEX_SHARED_KILL_SWITCH_PATH||'/var/lib/disdex/shared/kill-switch.json').catch(()=>null),json(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH||'/var/lib/disdex/shared/crypto-daily-risk.json').catch(()=>null)]);
 constrainFreshness('Shared Risk',risk?.updatedAt,10*60000,false);
 for(const row of rows)if(row.logic!=='V52'&&row.logic!=='FET'){
  row.gates.push(flag('shared-kill','共有Kill Switch',typeof kill?.active==='boolean'?!kill.active:undefined,kill?.active?'共有停止中':'共有停止状態','execution'));
  const riskFresh=risk?.sourceComplete===true&&risk?.utcDay===new Date(now).toISOString().slice(0,10)&&now-Number(risk.updatedAt)>=-60000&&now-Number(risk.updatedAt)<10*60000;
  row.gates.push(flag('shared-risk','共有日次損失ガード',riskFresh&&typeof risk?.tripped==='boolean'?!risk.tripped:undefined,risk?.tripped?'損失制限で停止':'当日の完全な共有状態を照合','execution'));
 }
 const checkedAt=Date.now(),freshRows=expireRealtimeRankingRows(rows,checkedAt,sourceExpiryByLogic);
 const snapshot={ok:true,readOnly:true,tradingMutation:0,checkedAt:now,refreshSeconds:REALTIME_RANKING_REFRESH_MS/1000,runtimeSha:current.releaseSha,rows:rankRows(v12V4Snapshot?mergeV12V4RealtimeRows(freshRows,v12V4Snapshot,now):freshRows),errors,v12V4:v12V4Snapshot?v12V4RealtimeSummary(v12V4Snapshot):unavailableV12V4RealtimeSummary(now),metric:'数値は各ロジックの実測native scoreまたはSignal Gate充足度です。尺度が異なるためロジック横断の比較・順位付けはしていません。発火確率・期待利益ではありません。'};
 return {snapshot,expires:realtimeRankingCacheExpiry(now,sourceExpiries,snapshot.rows)};
}
type Observation=Awaited<ReturnType<typeof observe>>;
let cached:{expires:number;value:Observation['snapshot']}|undefined,inflight:Promise<Observation>|undefined;
export async function loadRealtimeRanking(){
 if(cached&&cached.expires>Date.now())return cached.value;
 if(!inflight)inflight=observe().then(result=>{cached=result.expires>Date.now()?{value:result.snapshot,expires:result.expires}:undefined;return result;}).finally(()=>{inflight=undefined;});
 return (await inflight).snapshot;
}
