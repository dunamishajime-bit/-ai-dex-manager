/** Offline account-credit review. Never assigns a rebate to a Runner. */
const TYPE = 'APOLLOX_DEX_REBATE_RECOMMENDED';
const identity = v => typeof v === 'string' && /^[0-9]{1,100}$/.test(v) ? v : Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
const amount = v => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v) && v.length <= 60 ? v : null;
function sum(values) {
 const scale = Math.max(0,...values.map(v => (v.split('.')[1] || '').length));
 const units = values.reduce((a,v) => { const [w,f='']=v.split('.'); return a+BigInt(w+f.padEnd(scale,'0')); },0n);
 const s=units.toString().padStart(scale+1,'0');
 return scale ? s.slice(0,-scale)+'.'+s.slice(-scale) : s;
}
export function reviewAccountRebates(rows, fromExclusiveMs, toInclusiveMs) {
 const flags={orderAuthority:false,ownerAttestationIssued:false,signedObservationIssued:false,runnerAttributionVerified:false,historyCompletenessProven:false};
 const blocked=reason=>({status:'BLOCKED',reason,...flags});
 if(!Array.isArray(rows)||rows.length>100000||!Number.isSafeInteger(fromExclusiveMs)||!Number.isSafeInteger(toInclusiveMs)||fromExclusiveMs<=0||toInclusiveMs<=fromExclusiveMs) return blocked('INVALID_INPUT');
 const seen=new Set(), credits=[];
 for(const r of rows){
  if(!r||r.incomeType!==TYPE||r.asset!=='USDT'||!Number.isSafeInteger(r.time)||r.time<=fromExclusiveMs||r.time>toInclusiveMs) return blocked('INVALID_REBATE_ROW');
  const id=identity(r.tranId), usd=amount(r.income);
  if(id===null||usd===null||seen.has(id))return blocked('INVALID_OR_DUPLICATE_ID_OR_AMOUNT');
  seen.add(id); credits.push({id,usd,atMs:r.time,bucket:'ACCOUNT_CREDIT_UNALLOCATED'});
 }
 return {status:'ACCOUNT_CREDIT_REVIEW_ONLY',rowCount:credits.length,unallocatedCreditUsd:sum(credits.map(c=>c.usd)),credits,...flags};
}
