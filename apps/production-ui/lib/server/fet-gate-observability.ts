import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluateFet, fetObservationExpiry, FET_POLICY, type Gate } from '@/lib/realtime-ranking';
import { loadCurrentProductionRuntime } from './current-production-runtime';
import { loadFetRuntimeObservability } from './fet-runtime-observability';

const ROOT='/home/deploy/disdex-trading/current';
const CONFIG_SHA='8c5702345e380b0adea884ebbe066e985877daadf3078e5fdf719f4b081d9ac1';
const SIGNAL_SHA='577ad20f445d5f31917e4a057870912b9222db9440fd68cc0c71e39e2efa9b40';
async function json(path:string):Promise<Record<string,unknown>|null>{try{const s=await readFile(path,'utf8');if(s.length>512*1024)return null;return JSON.parse(s);}catch{return null;}}
let cached:{expires:number;value:Awaited<ReturnType<typeof observe>>}|undefined;
let inflight:Promise<Awaited<ReturnType<typeof observe>>>|undefined;
async function observe(){
 const now=Date.now(),runtime=await loadCurrentProductionRuntime();
 const fet=await loadFetRuntimeObservability({now,expectedReleaseSha:runtime.releaseSha});
 const [config,source,state,kill,risk]=await Promise.all([
  readFile(ROOT+'/config/fetBrk48Runtime.ts','utf8').catch(()=>''),readFile(ROOT+'/lib/fet-brk48-signal.ts','utf8').catch(()=>''),
  json(process.env.FET_BRK48_RESIDUAL_STATE_PATH||'/var/lib/disdex/fet-brk48-residual/state.json'),
  json(process.env.DISDEX_SHARED_KILL_SWITCH_PATH||'/var/lib/disdex/shared/kill-switch.json'),
  json(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH||'/var/lib/disdex/shared/crypto-daily-risk.json')]);
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const policyVerified=hash(config)===CONFIG_SHA&&hash(source)===SIGNAL_SHA;
 let observed:ReturnType<typeof evaluateFet>={valid:false,gates:[{key:'source',label:'Production判定ソース照合',state:'UNKNOWN',detail:'監査済みFET判定ソースと一致しないため市場条件を推測しません'}]};
 let candleError='';
 if(policyVerified){try{
  const res=await fetch('https://fapi.asterdex.com/fapi/v3/klines?symbol=FETUSDT&interval=1h&limit=120',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw new Error('HTTP '+res.status);
  observed=evaluateFet(await res.json(),now,FET_POLICY);
 }catch(e){candleError=e instanceof Error?e.message:'CANDLE_FETCH_FAILED';observed=evaluateFet([],now,FET_POLICY);observed.gates=observed.gates.map(g=>g.state==='UNKNOWN'?{...g,detail:'確定足取得失敗：'+candleError}:g);}}
 const cooldownUntil=Number(state?.cooldownUntilTs||0);
 const execution:Gate[]=[
  {key:'cooldown24h',label:'FET 決済後24h Cooldown',state:state?(now>=cooldownUntil?'OK':'NO'):'UNKNOWN',actual:Math.max(0,(cooldownUntil-now)/3600000),required:'残り0時間',detail:'until '+(cooldownUntil?new Date(cooldownUntil).toISOString():'未設定（決済履歴なし）'),kind:'execution'},
  {key:'runtime',label:'Runtime SHA・稼働状態',state:fet.status==='LIVE'?'OK':fet.status==='STALE'||!fet.configured?'UNKNOWN':'NO',actual:fet.runtimeSha?.slice(0,12),required:runtime.releaseSha.slice(0,12),detail:fet.reason,kind:'execution'},
  {key:'position',label:'FET保有・保留注文',state:fet.status==='LIVE'&&state?state.position||state.pending||state.manualReview?'NO':'OK':'UNKNOWN',detail:state?.position?'既存FETポジションを管理中':state?.pending?'未解決の注文あり':state?.manualReview?'手動確認が必要':'新規に対する保有・保留状態',kind:'execution'},
  {key:'kill',label:'共有Kill Switch',state:typeof kill?.active==='boolean'?kill.active?'NO':'OK':'UNKNOWN',detail:kill?.active?'共有停止中':typeof kill?.active==='boolean'?'共有停止なし':'状態未取得',kind:'execution'},
  {key:'risk',label:'共有日次損失ガード',state:risk&&risk.sourceComplete===true&&risk.utcDay===new Date(now).toISOString().slice(0,10)&&typeof risk.tripped==='boolean'&&Number(risk.updatedAt)<=now+60000&&now-Number(risk.updatedAt)<10*60000?risk.tripped?'NO':'OK':'UNKNOWN',detail:risk?.tripped?'損失制限で停止':'当日・10分以内・完全な共有状態を照合。Runnerでも再確認',kind:'execution'},
  {key:'capacity',label:'残余Gross・証拠金・数量',state:'UNKNOWN',required:'残余Gross ≥ 0.05 / 上限2.25 / Cross 5x',detail:'他ロジックの保有・保留注文・解放可能枠を含め、実Runnerがエントリー時に最終確認',kind:'execution'}
 ];
 if(observed.referenceTs)execution.push({key:'idempotency',label:'同じ確定足の重複発注防止',state:state&&fet.status==='LIVE'?Number(state.lastReferenceTs||0)>=observed.referenceTs?'NO':'OK':'UNKNOWN',detail:Number(state?.lastReferenceTs||0)>=observed.referenceTs?'この足のシグナルは処理済み':'未処理の足かを照合',kind:'execution'});
 const gates=[...observed.gates,...execution];
 const blockers=gates.filter(g=>g.state==='NO').map(g=>g.label+'：'+g.detail);
 return {ok:true,readOnly:true,tradingMutation:0,symbol:'FETUSDT',side:'LONG',checkedAt:now,runtimeSha:runtime.releaseSha,policyVerified,fresh:observed.valid&&fet.status==='LIVE',referenceTs:observed.referenceTs,gates,reason:blockers.join(' / ')||(gates.some(g=>g.state==='UNKNOWN'&&g.kind!=='execution')?'市場条件の観測未確認':'実測済み条件は通過。未確認の発注条件はRunner確認待ち'),candleError};
}
export async function loadFetGates(){
 const now=Date.now();if(cached&&cached.expires>now)return cached.value;
 if(!inflight)inflight=observe().then(value=>{const expires=fetObservationExpiry(value.checkedAt,60000);cached=expires>Date.now()?{value,expires}:undefined;return value;}).finally(()=>{inflight=undefined;});
 return inflight;
}
