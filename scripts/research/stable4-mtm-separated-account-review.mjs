/** Offline accounting review; never constructs a signed DD observation or order permit. */
const RUNNERS=['V4','Q102','PENGU','FET','IDLE','HYPE','V52'];
const BUCKETS=[...RUNNERS,'LEGACY','MANUAL','ACCOUNT_CREDIT'];
const FLOW='EXTERNAL_FLOW';
const id=v=>typeof v==='string'&&v.length>0&&v.length<=200&&v.trim()===v;
const timestamp=v=>Number.isSafeInteger(v)&&v>0;
const decimal=v=>{
 if(typeof v!=='string'||v.length>80||! /^-?\d+(?:\.\d{1,30})?$/.test(v))throw Error('INVALID_DECIMAL');
 const [w,f='']=v.replace(/^-/, '').split('.');
 return BigInt(w+f.padEnd(30,'0'))*(v.startsWith('-')?-1n:1n);
};
const print=v=>{
 const s=(v<0n?-v:v).toString().padStart(31,'0');
 const f=s.slice(-30).replace(/0+$/,'');
 return (v<0n?'-':'')+s.slice(0,-30)+(f?'.'+f:'');
};
export function reviewSeparatedAccountMtm(input){
 const flags={orderAuthority:false,signedObservationIssued:false,ownerAttestationIssued:false,ddStateAdvanced:false};
 const blocked=reason=>({status:'BLOCKED',reason,...flags});
 try{
  if(!input||!timestamp(input.fromMs)||!timestamp(input.toMs)||input.fromMs>=input.toMs||
   !Array.isArray(input.events)||input.events.length>100000||!id(input.sourceEvidenceId))return blocked('INVALID_INPUT');
  const coverage=['income','priorMarks','currentMarks','flows','ownership'];
  if(coverage.some(k=>input.coverage?.[k]!==true))return blocked('INCOMPLETE_INPUT_COVERAGE');
  const prior=decimal(input.priorEquityUsd),current=decimal(input.equityUsd);
  if(prior<=0n||current<=0n)return blocked('INVALID_EQUITY');
  const totals=Object.fromEntries(BUCKETS.map(k=>[k,0n]));
  let flow=0n;
  const seen=new Set();
  const kinds=['REALIZED_PNL','COMMISSION','FUNDING_FEE','REBATE','UNREALIZED_DELTA','DEPOSIT','WITHDRAW'];
  for(const e of input.events){
   if(!e||!id(e.eventId)||!id(e.proofId)||seen.has(e.eventId)||!timestamp(e.atMs)||
    e.atMs<=input.fromMs||e.atMs>input.toMs||e.asset!=='USDT'||!kinds.includes(e.kind))
     return blocked('INVALID_OR_DUPLICATE_EVENT');
   seen.add(e.eventId);
   const n=decimal(e.usd);
   if(e.kind==='DEPOSIT'||e.kind==='WITHDRAW'){
    if(e.bucket!==FLOW||(e.kind==='DEPOSIT'?n<=0n:n>=0n))return blocked('INVALID_FLOW');
    flow+=n;continue;
   }
   if(!BUCKETS.includes(e.bucket))return blocked('UNKNOWN_OWNER_OR_BUCKET');
   if((e.kind==='REBATE')!==(e.bucket==='ACCOUNT_CREDIT')||(e.kind==='REBATE'&&n<0n)||(e.kind==='COMMISSION'&&n>0n))
    return blocked('INVALID_INCOME_BUCKET_OR_SIGN');
   totals[e.bucket]+=n;
  }
  const accounted=Object.values(totals).reduce((a,b)=>a+b,0n);
  if(current-prior-flow!==accounted)return blocked('ACCOUNT_MTM_NOT_RECONCILED');
  return {status:'RECONCILED_OFFLINE_REVIEW_ONLY',sourceEvidenceId:input.sourceEvidenceId,
   runnerMtmDeltaUsd:Object.fromEntries(RUNNERS.map(k=>[k,print(totals[k])])),
   nonRunnerMtmDeltaUsd:Object.fromEntries(['LEGACY','MANUAL','ACCOUNT_CREDIT'].map(k=>[k,print(totals[k])])),
   externalNetFlowUsd:print(flow),accountMtmDeltaUsd:print(accounted),
   coverageIndependentlyVerified:false,...flags};
 }catch{return blocked('INVALID_DECIMAL_OR_INPUT')}
}
