import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extractObjectNumber} from './current-production-runtime';
import type {HypeZecGate,HypeZecSleeve} from './hype-zec-runtime-observability';
export type HypeGate=HypeZecGate;
export type HypeSleeve=HypeZecSleeve & {strategy:'HYPE_LONG';symbol:'HYPEUSDT'};
export type HypeOverview={ok:true;readOnly:true;tradingMutation:0;capturedAt:string;releaseSha:string;sourceDeployed:boolean;stateAvailable:boolean;serviceActive:boolean;sharedKillActive:boolean|null;sleeves:{HYPE_LONG:HypeSleeve}};
async function json(path:string){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
/** HYPE75 H1 runner is authoritative; legacy 15m sidecar gates are not its Entry logic. */
export async function loadHypeRuntimeObservability(now=Date.now(),options:{releaseRoot?:string;stateRoot?:string}={}):Promise<HypeOverview>{
 const root=options.releaseRoot??'/home/deploy/disdex-trading/current',stateRoot=options.stateRoot??'/var/lib/disdex';
 const sha=(await readFile(join(root,'.disdex-release-sha'),'utf8')).trim();if(!/^[a-f0-9]{40}$/.test(sha))throw Error('HYPE75_CURRENT_SHA_INVALID');
 const [source,state,hb,kill]=await Promise.all([readFile(join(root,'config/hypeTrendLongPolicy.ts'),'utf8'),json(join(stateRoot,'hype-zec-long/runner.json')),json(join(stateRoot,'runner-health/heartbeats/hype-trend-long.json')),json(join(stateRoot,'shared/kill-switch.json'))]);
 const n=(key:string)=>extractObjectNumber(source,key);
 const shaOk=state?.runtimeCommitSha===sha&&hb?.runtimeSha===sha&&hb?.expectedSha===sha;
 const fresh=Number.isFinite(hb?.heartbeatAt)&&hb.heartbeatAt<=now+5000&&now-hb.heartbeatAt<=120000;
 const active=shaOk&&fresh&&Number(hb?.mainPid)>0&&hb?.liveEnabled===true;
 const pending=Boolean(state?.pending),manual=typeof state?.manualReview==='string'?state.manualReview:undefined;
 const last=state?.lastDecision?.strategy==='HYPE_LONG'?state.lastDecision:null;
 const decisionFresh=Number.isFinite(state?.lastDecisionTs)&&state.lastDecisionTs<=now+5000&&now-state.lastDecisionTs<=3*3600000;
 const currentFailure=Array.isArray(state?.failures)&&state.failures.some((f:any)=>Number(f.occurredAt)>Number(state.lastDecisionTs??0));
 const blocked=pending||!!manual||currentFailure||hb?.safetyState!=='HEALTHY';
 const killActive=typeof kill?.active==='boolean'?kill.active:null;
 const status:HypeSleeve['status']=!state||!hb?'NOT_DEPLOYED':!shaOk?'BLOCKED':!fresh?'STALE':state.mode!=='LIVE'?'SHADOW':!active||blocked||killActive!==false?'UNCONFIRMED':'LIVE';
 const gate=(key:string,label:string,pass:boolean|null,actual:unknown,threshold:unknown,reason:string):HypeGate=>({key,label,status:pass===null?'UNKNOWN':pass?'PASS':'BLOCKED',actual:actual===undefined?undefined:String(actual),threshold:threshold===undefined?undefined:String(threshold),reason,source:'RUNNER_STATE'});
 const gates:HypeGate[]=[gate('RUNTIME_H1','HYPE75 実Runner / 確定H1',status==='LIVE',status,'current SHA・heartbeat・LIVE・保護state正常','過去の解消済みエラーは監査履歴として保持'),gate('SHARED_KILL','Kill Switch',killActive===null?null:!killActive,killActive,'false','未知なら注文可能とは扱わない')];
 for(const [reason,label,threshold] of [
  ['TREND_ALIGNMENT_NOT_MET','HYPE close > EMA fast > EMA slow',`EMA${n('fastEmaPeriod')} > EMA${n('slowEmaPeriod')}`],
  ['REGIME_SLOPE_NOT_MET','EMA regime 24h slope',`≥ ${n('minimumRegimeSlopeBps')}bps`],
  ['BREAKOUT_NOT_MET','確定H1・過去高値breakout',`${n('breakoutLookbackHours')}h / ≥ ${n('minimumBreakoutBps')}bps`],
  ['DISTANCE_FROM_SLOW_EMA_TOO_LARGE','Slow EMA距離',`≤ ${n('maximumDistanceFromSlowEmaBps')}bps`],
 ] as const)gates.push(gate(reason,label,decisionFresh&&last?.reason===reason?false:decisionFresh&&last?.reason==='HYPE_TREND_LONG_SIGNAL_ACCEPTED'?true:null,decisionFresh&&last?.reason===reason?last.reason:undefined,threshold,'Runnerが記録した判定のみ表示。未記録の個別実測・PASSは推測しない'));
 gates.push(gate('ACTUAL_ENTRY','最新の実Runner Entry判定',decisionFresh&&last?last.accepted===true:null,last?.reason,'HYPE_TREND_LONG_SIGNAL_ACCEPTED','最新判定がリスク・容量で拒否される場合も含む'));
 gates.push({...gate('VENUE_AND_PORTFOLIO','5x Cross・容量・保護注文',null,undefined,'注文直前 read-back','Entry成立・実約定・STOP保護は別の確認'),source:'EXECUTION'});
 const pos=Array.isArray(state?.positions)?state.positions.find((p:any)=>p.strategy==='HYPE_LONG'&&p.symbol==='HYPEUSDT'):null;
 const sleeve:HypeSleeve={strategy:'HYPE_LONG',symbol:'HYPEUSDT',status,runtimeSha:sha,stateSha:state?.runtimeCommitSha,stateMode:state?.mode,serviceActive:active,stateUpdatedAt:state?.updatedAt,lastDecision:last?{accepted:last.accepted===true,reason:last.reason,at:state.lastDecisionTs}:undefined,position:pos?{quantity:pos.quantity,entryPrice:pos.entryPrice,stopPrice:pos.stopPrice,takeProfitPrice:pos.takeProfitPrice}:undefined,pending,manualReview:manual,maxGross:n('maximumGross'),riskPct:n('riskPct'),publicSignalEligible:decisionFresh&&last?last.accepted===true:null,publicReferenceTs:last?.signalTs,gates,note:`HYPE75 / 確定H1 / Gross ${n('maximumGross')}x / STOP ATR×${n('stopAtrMultiple')} / trail ATR×${n('trailingAtrMultiple')} / hold≤${n('maximumHoldHours')}h。過去エラー履歴${state?.failures?.length??0}件は保持。現在の判定: ${last?.reason??'未取得'}。`};
 return{ok:true,readOnly:true,tradingMutation:0,capturedAt:new Date(now).toISOString(),releaseSha:sha,sourceDeployed:true,stateAvailable:!!state,serviceActive:active,sharedKillActive:killActive,sleeves:{HYPE_LONG:sleeve}};
}
