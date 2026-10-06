import { readFile } from 'node:fs/promises';
import { fetObservationExpiry,freshTimestamp,hypeRankingFresh,gateScore,rankRows,type Gate,type RankRow } from '@/lib/realtime-ranking';
import { loadCurrentProductionRuntime,extractObjectNumber } from './current-production-runtime';
import { loadDecisionStatus } from './disdex-decision-status';
import { loadQuality102SymbolObservability } from './quality102-symbol-observability';
import { loadPenguRuntimeObservability } from './pengu-runtime-observability';
import { loadHypeRuntimeObservability } from './hype-runtime-observability';
import { loadFetGates } from './fet-gate-observability';
import { DIST_TERMINAL_LIVE_CONFIG } from '@/lib/disterminal-live-config';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const list=(v:unknown)=>Array.isArray(v)?v.map(obj):[];
const num=(v:unknown)=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):undefined;
const text=(v:unknown)=>typeof v==='string'?v:'';
const ROOT='/home/deploy/disdex-trading/current';
async function json(path:string){const s=await readFile(path,'utf8');if(s.length>2*1024*1024)throw Error('SNAPSHOT_TOO_LARGE');return obj(JSON.parse(s));}
function flag(key:string,label:string,value:unknown,detail:string,kind:Gate['kind']='signal'):Gate{return {key,label,state:typeof value==='boolean'?value?'OK':'NO':'UNKNOWN',detail,kind};}
function minimum(key:string,label:string,value:unknown,threshold:number):Gate{const n=num(value);return {key,label,state:n===undefined?'UNKNOWN':n>=threshold?'OK':'NO',actual:n,required:'≥ '+threshold,detail:n===undefined?'実測未取得':n>=threshold?'必要値を通過':'必要値未達',progress:n===undefined?undefined:threshold>0?n/threshold:0};}
function make(symbol:string,logic:string,side:string,gates:Gate[],fresh:boolean,checkedAt:number,reason:string):RankRow{return {id:logic+':'+symbol+':'+side,symbol,logic,side,gates,fresh,checkedAt,reason:!fresh?'観測が古い・未取得 / '+reason:reason,score:gateScore(gates,fresh),href:'/decision-status/'+(logic.startsWith('Idle')?'idle-priority':logic.toLowerCase())};}
const SOURCES=['V12','Q102','PENGU','FET','HYPE','Idle','V52'];
async function observe(){
 const now=Date.now(),current=await loadCurrentProductionRuntime(),rows:RankRow[]=[],errors:Record<string,string>={};
 const jobs=[
  async()=>{
   const [d,s,source]=await Promise.all([json(process.env.V12_DECISION_SNAPSHOT_PATH||'/var/lib/disdex/v12-x1-all/decision-snapshot.json'),json(process.env.V12_X1_ALL_STATE_PATH||'/var/lib/disdex/v12-x1-all/runner.json'),readFile(ROOT+'/config/v12X1AllRuntime.ts','utf8')]);
   const at=num(d.observedAt)??num(d.referenceTs)??0,fresh=s.runtimeCommitSha===current.releaseSha&&s.mode==='LIVE'&&now-Number(s.updatedAt)>=-60000&&now-Number(s.updatedAt)<=3*3600000&&now-at>=-60000&&now-at<=3*3600000;
   const vol=extractObjectNumber(source,'minimumVolumeRatio'),mom=extractObjectNumber(source,'minimumMomentumPct');
   for(const r of list(d.candidates)){
    const side=text(r.side),gates=[minimum('volume','出来高比率',r.volumeRatio,vol),minimum('momentum',side==='SHORT'?'下落モメンタム':'上昇モメンタム',side==='SHORT'&&num(r.momentum)!==undefined?-Number(r.momentum):r.momentum,mom)];
    if(d.btcRegime==='NEUTRAL')gates.push(minimum('score','Neutral Score',r.score,current.v12.neutralScoreThreshold));
    gates.push(flag('authoritative','実Runner全Signal Gate',r.signalEligible,text(r.signalReason)||text(d.reason)));
    gates.push(flag('execution','資金競合・保有・Margin Guard',undefined,'発注時の実Runner確認待ち','execution'));
    rows.push(make(text(r.symbol).replace(/USDT$/,'')+'USDT','V12',side||'WAIT',gates,fresh,at,text(r.signalReason)||text(d.reason)));
   }
  },
  async()=>{
   const d=await loadQuality102SymbolObservability(),rankAt=Date.parse(d.rankingCapturedAt||d.capturedAt),rankingFresh=freshTimestamp(rankAt,now,2*3600000)&&freshTimestamp(Date.parse(d.capturedAt),now,2*3600000);
   for(const r of d.items){
    const models=list(r.diagnostics?.s34),best=models.sort((a,b)=>(num(b.rankingScore)??0)-(num(a.rankingScore)??0))[0],highVol=obj(r.diagnostics?.highVol);
    const gates:Gate[]=list(best?.gates).map(g=>({key:text(g.name),label:text(g.name),state:typeof g.pass==='boolean'?g.pass?'OK':'NO':'UNKNOWN',actual:typeof g.value==='string'||typeof g.value==='number'?g.value:undefined,required:typeof g.threshold==='string'||typeof g.threshold==='number'?g.threshold:undefined,detail:text(g.reason),kind:text(g.name).includes('GRID')?'execution':'signal'}));
    if(!gates.length)gates.push(flag('raw','候補条件',highVol.selectionAvailable===false?undefined:r.eligible,r.rankingReason||r.reason));
    for(const g of gates)if(g.key==='RAW_DETECTOR'&&g.state==='NO'&&num(best?.proximityScore)!==undefined)g.progress=Number(best.proximityScore)/100;
    gates.push(flag('eligible','実Runner最終Signal',r.eligible,r.rankingReason||r.reason));
    gates.push(flag('selection','同時候補の選定',r.selected,d.selectedReason,'execution'));
    gates.push(flag('capacity','保有枠・残余Gross・証拠金・数量',undefined,'候補選定後に実Runnerが注文直前の余力・競合を確認','execution'));
    const rawSide=num(best?.proximitySide)??num(best?.candidateSide);
    const row=make(r.symbol,'Q102',r.side==='WAIT'?(rawSide===1?'LONG':rawSide===-1?'SHORT':'WAIT'):r.side,gates,rankingFresh,rankAt,r.rankingReason||r.reason);
    // Q102 native proximity incorporates its stage and audited detector distances.
    // Display separately; common ranking always uses the same gate completion formula.
    if(r.rankingScore!==undefined)row.gates.push({key:'native-score',label:'Q102内部接近度（参考）',state:'OK',actual:r.rankingScore,detail:r.rankingStage||'',kind:'reference'});
    rows.push(row);
   }
  },
  async()=>{
   const d=await loadPenguRuntimeObservability(),s=d.latestSignal,signalAt=s?.referenceTs??0,lineage=current.runtimeLineage.units.pengu,runtimeVerified=d.releaseShaVerified===true||(d.releaseSha===undefined&&lineage.matchesCurrent&&freshTimestamp(lineage.updatedAt,now,3*3600000)),fresh=d.status==='LIVE'&&runtimeVerified&&freshTimestamp(d.updatedAt,now,3*3600000)&&freshTimestamp(signalAt,now,2*3600000)&&freshTimestamp(s?.diagnostics.latestCompletedPenguTs,now,2*3600000)&&s?.diagnostics.latestCompletedPenguTs===s?.diagnostics.latestCompletedBtcTs;
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
  async()=>{const d=await loadFetGates();rows.push(make(d.symbol,'FET',d.side,d.gates,d.fresh,d.checkedAt,d.reason));},
  async()=>{
   const d=await loadHypeRuntimeObservability(),s=d.sleeves.HYPE_LONG;
   const gates:Gate[]=s.gates.map(g=>({key:g.key,label:g.label,state:g.status==='PASS'?'OK':g.status==='BLOCKED'?'NO':'UNKNOWN',actual:g.actual,required:g.threshold,detail:g.reason,kind:g.source==='PUBLIC_CANDLES'||['TREND_ALIGNMENT_NOT_MET','REGIME_SLOPE_NOT_MET','BREAKOUT_NOT_MET','DISTANCE_FROM_SLOW_EMA_TOO_LARGE'].includes(g.key)?'signal':'execution'}));
   gates.push(flag('position','新規保有枠',!s.position&&!s.pending,s.position?'HYPE保有中':s.pending?'保留注文あり':'保有なし','execution'));
   rows.push(make('HYPEUSDT','HYPE','LONG',gates,hypeRankingFresh(s,current.releaseSha,now),s.lastDecision?.at||0,s.note));
  },
  async()=>{
   const d=await json(process.env.DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH||'/var/lib/disdex/idle-priority/decision-details.json');
   const at=num(d.updatedAt)??0,fresh=d.runtimeSha===current.releaseSha&&now-at>=-60000&&now-at<=2*3600000;
   const [state,residual]=await Promise.all([json('/var/lib/disdex/idle-priority/state.json').catch(()=>({})),json('/var/lib/disdex/idle-priority/residual-long-state.json').catch(()=>({}))]);
   for(const r of [...list(d.symbols),...list(d.residual)]){
    const isLong=!!r.decision,decision=obj(r.decision||r.routeDecision),generic=obj(r.generic),gates:Gate[]=[];
    if(!isLong)gates.push(flag('generic','汎用候補の成立',generic.accepted,text(generic.reason)));
    gates.push(flag('route','通貨専用 '+text(r.route),decision.accepted,text(decision.reason)));
    if(!isLong)gates.push(flag('cooldown','通貨Cooldown',r.cooldownAllowed,'実約定したSHORTエントリーから12時間（未達・未約定候補では開始しない）','execution'));
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
 results.forEach((result,i)=>{if(result.status==='rejected'){errors[SOURCES[i]]='観測取得失敗';rows.push(make('—',SOURCES[i],'WAIT',[flag('source','観測接続',undefined,'取得不能')],false,now,'観測取得失敗'));}});
 const [kill,risk]=await Promise.all([json(process.env.DISDEX_SHARED_KILL_SWITCH_PATH||'/var/lib/disdex/shared/kill-switch.json').catch(()=>null),json(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH||'/var/lib/disdex/shared/crypto-daily-risk.json').catch(()=>null)]);
 for(const row of rows)if(row.logic!=='V52'&&row.logic!=='FET'){
  row.gates.push(flag('shared-kill','共有Kill Switch',typeof kill?.active==='boolean'?!kill.active:undefined,kill?.active?'共有停止中':'共有停止状態','execution'));
  const riskFresh=risk?.sourceComplete===true&&risk?.utcDay===new Date(now).toISOString().slice(0,10)&&now-Number(risk.updatedAt)>=-60000&&now-Number(risk.updatedAt)<10*60000;
  row.gates.push(flag('shared-risk','共有日次損失ガード',riskFresh&&typeof risk?.tripped==='boolean'?!risk.tripped:undefined,risk?.tripped?'損失制限で停止':'当日の完全な共有状態を照合','execution'));
 }
 return {ok:true,readOnly:true,tradingMutation:0,checkedAt:now,refreshSeconds:120,runtimeSha:current.releaseSha,rows:rankRows(rows.map(row=>({...row,score:gateScore(row.gates,row.fresh)}))),errors,metric:'確認済み発注制約のない候補を優先し、市場条件と発注条件の充足度で順位付け（ロジックごとに条件数は異なります）。100はすべての条件を確認・通過した場合のみ。未達・未確認の条件があれば100未満です。'};
}
let cached:{expires:number;value:Awaited<ReturnType<typeof observe>>}|undefined,inflight:Promise<Awaited<ReturnType<typeof observe>>>|undefined;
export async function loadRealtimeRanking(){
 if(cached&&cached.expires>Date.now())return cached.value;
 if(!inflight)inflight=observe().then(value=>{const expires=Math.min(fetObservationExpiry(value.checkedAt,110000),...value.rows.filter(r=>r.logic==='FET').map(r=>fetObservationExpiry(r.checkedAt,110000)));cached=expires>Date.now()?{value,expires}:undefined;return value;}).finally(()=>{inflight=undefined;});
 return inflight;
}
