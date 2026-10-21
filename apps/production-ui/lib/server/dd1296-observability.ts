import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {adaptV12V4DecisionToState, loadV12V4LiveSource} from './v12-v4-live-source';
async function json(path:string){const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>2_000_000)throw Error('DD1296_OBSERVATION_TOO_LARGE');const value=JSON.parse(text);if(!value||typeof value!=='object')throw Error('DD1296_OBSERVATION_MALFORMED');return value;}
export async function loadDd1296Observability(options:{releaseRoot?:string;stateRoot?:string;now?:number}={}){
 const root=options.releaseRoot||'/home/deploy/disdex-trading/current',state=options.stateRoot||'/var/lib/disdex',now=options.now??Date.now();
 const sha=(await readFile(join(root,'.disdex-release-sha'),'utf8')).trim();if(!/^[a-f0-9]{40}$/.test(sha))throw Error('DD1296_RELEASE_SHA_INVALID');
 const paths={v12:'v12-x1-all/runner.json',v12Decision:'v12-x1-all/decision-snapshot.json',pengu:'pengu-dual-ls-v2/runner-live.json',q102:'quality102-causal-v1/state.json',q102Decision:'quality102-causal-v1/decision-snapshot.json',fet:'fet-brk48-residual/state.json',protection:'shared/resident-stop-observation.json'};
 const [v12V4, result] = await Promise.all([
  loadV12V4LiveSource({now}).catch(() => ({available:false} as Awaited<ReturnType<typeof loadV12V4LiveSource>>)),
  Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>{try{return[k,await json(join(state,p))];}catch{return[k,null];}}))),
 ]);
 const gross=await json(join(root,'config/q102FamilySideGross.json'));
 const validState=(s:any,expectedSha=sha)=>s&&(!s.runtimeCommitSha||s.runtimeCommitSha===expectedSha)&&typeof s.updatedAt==='number'&&s.updatedAt<=now+5000&&now-s.updatedAt<=3*3600000;
 const v12V4State=v12V4.available?adaptV12V4DecisionToState(v12V4):null;
 const v12=validState(v12V4State,v12V4.runtimeSha||sha)?v12V4State:(validState(result.v12)?result.v12:null),fet=validState(result.fet)?result.fet:null,q102=validState(result.q102)?result.q102:null;
 const until=Number(fet?.cooldownUntilTs||0);
 const fetReturn = fet?.lastEvaluationReturn72hObservedTs===Math.floor(now/3600000)*3600000 ? fet?.lastEvaluationReturn72h : undefined;
 const protection=result.protection;const freshProtection=protection?.ok===true&&protection.runtimeSha===sha&&protection.checkedAt<=now+5000&&now-protection.checkedAt<=120000;
 const decisions=result.q102Decision?.runtimeCommitSha===sha?result.q102Decision.items:[];
 return{runtimeSha:sha,checkedAt:now,readOnly:true,tradingMutation:0,q102:{familySideGross:gross,position:q102?.position?{family:q102.position.family,side:q102.position.side===1?'LONG':'SHORT',quantity:q102.position.quantity,appliedGross:q102.position.acceptedEntryGross??null}:null,candidates:Array.isArray(decisions)?decisions.map((r:any)=>({symbol:r.symbol,family:r.family,side:r.side,appliedGross:r.requestedGross,reason:r.reason,selected:r.selected})):[],fetBrkExhaustionThreshold:-.12},fet:{configured:!!fet,return72h:fetReturn??null,gateThreshold:.02,gatePass:typeof fetReturn==='number'?fetReturn+1e-12>=.02:null,cooldownUntil:until,cooldownRemainingMs:Math.max(0,until-now),cooldownPass:!!fet&&now>=until,lastEvaluationReason:fet?.lastEvaluationReason??null},v12:{configured:!!v12,source:v12V4.available?'VPS_V12_V4_REALTIME_DECISION':'VPS_V12_LEGACY_STATE',sideLossLedger:v12?.sideLossLedger??null,lastDecision:v12?.latestDd1296Decision??null,lastGateMetrics:v12?.latestDd1296GateMetrics??null,avaxShort:{btc3hNegative:true,relativeThreshold:-.0075,reason:'V12_AVAX_R1_SHORT_REBOUND'},atom:{relativeThreshold:.00603,reason:'V12_ATOM_EXHAUSTION_CAUSAL'},avaxLong:{directional24hThreshold:.0165,reason:'V12_AVAX_LONG_WEAK24_CAUSAL'}},protection:{fresh:freshProtection,readBackStatus:freshProtection?'VERIFIED':'UNVERIFIED',lastReconciledAt:protection?.checkedAt??null,positions:freshProtection?protection.positions:[],unprotectedCount:freshProtection?protection.unprotectedCount:null,orphanStops:freshProtection?protection.orphanStops:[]},v52:{dynamicBasisStop:true,basisStopMultiple:1.75,fixedEntryReferenceStop:false,phase2ResearchOnly:true}};
}
export type Dd1296Observation=Awaited<ReturnType<typeof loadDd1296Observability>>;
