/** VPS-only public H1 catch-up for STABLE4 Q102. GET only, never credentials/orders. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {isAbsolute,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const H=3600000;
const fail=(reason)=>{throw Error('Q102_PUBLIC_H1_'+reason);};
const arg=(k)=>{const i=process.argv.indexOf(k),v=i>=0?process.argv[i+1]:undefined;
  if(!v||v.startsWith('--'))fail('ARGUMENT_REQUIRED:'+k);return v;};
const sdkRoot=arg('--sdk-root'),requestPath=arg('--request-path'),output=arg('--output-root');
if(![sdkRoot,requestPath,output].every(isAbsolute)
  ||!/^\/home\/deploy\/disdex-trading\/releases\/[a-f0-9]{40}$/.test(sdkRoot))
  fail('ABSOLUTE_PINNED_PATHS_REQUIRED');
if(process.env.ASTER_API_PRIVATE_KEY||process.env.ASTER_USER_ADDRESS)fail('TRADING_CREDENTIALS_PRESENT');
if(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH!=='/var/lib/disdex/shared/aster-rate-budget.json')
  fail('SHARED_RATE_BUDGET_REQUIRED');
const marker=join(sdkRoot,'.disdex-release-sha'),markerStat=await lstat(marker);
if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.uid!==0
  ||(markerStat.mode&0o022)!==0||(await readFile(marker,'utf8')).trim()!==basename(sdkRoot))
  fail('IMMUTABLE_SDK_MARKER_INVALID');
const trustedSDK=join(sdkRoot,'lib/aster-v3-client.ts');
const st=await lstat(trustedSDK);
if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)
  fail('SDK_SOURCE_NOT_ROOT_IMMUTABLE');
const planRaw=await readFile(requestPath);
const plan=JSON.parse(planRaw);
if(plan.schema!=='disdex-stable4-q102-h1-public-catchup-plan/v1'
   || !/^[a-f0-9]{64}$/.test(plan.sourceCacheSha256)
   || !Array.isArray(plan.symbols)||plan.symbols.length!==20
   || !Number.isSafeInteger(plan.fromTs)||!Number.isSafeInteger(plan.throughTs)
   || plan.fromTs<=0||plan.fromTs%H!==0||plan.throughTs%H!==0
   || plan.throughTs<plan.fromTs||plan.throughTs-plan.fromTs>48*H
   || plan.throughTs+H>Date.now()
   ||new Set(plan.symbols).size!==plan.symbols.length
   ||plan.symbols.some(s=>typeof s!=='string'||!/^[A-Z0-9]+USDT$/.test(s)))
  fail('STRICT_PLAN_VALIDATION_FAILED');
const {AsterV3Client}=await import(pathToFileURL(trustedSDK).href);
const fetchImpl=(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url??String(input));
  if((init.method??'GET')!=='GET'||url.origin!=='https://fapi.asterdex.com'
      ||url.pathname!=='/fapi/v3/klines'||init.body!=null)
    fail('PUBLIC_GET_ONLY_BOUNDARY');
  return fetch(input,{...init,redirect:'error'});
};
const client=new AsterV3Client({fetchImpl,readOnlyRateLimitMaxRetries:0});
const wantCount=(plan.throughTs-plan.fromTs)/H+1;
await mkdir(output,{recursive:true,mode:0o700});
for(const symbol of plan.symbols){
  const rows=await client.getKlines(symbol,'1h',1000,
    {startTime:plan.fromTs,endTime:plan.throughTs+H-1});
  if(!Array.isArray(rows)||rows.length!==wantCount)fail('H1_COVERAGE_GAP:'+symbol);
  for(let i=0;i<rows.length;i++){
    const r=rows[i],ts=Number(r?.[0]),open=Number(r?.[1]),hi=Number(r?.[2]),
      lo=Number(r?.[3]),close=Number(r?.[4]),base=Number(r?.[5]),quote=Number(r?.[7]);
    if(!Array.isArray(r)||ts!==plan.fromTs+i*H||ts+H>Date.now()
        ||![open,hi,lo,close,base,quote].every(Number.isFinite)
        ||lo<=0||base<0||quote<0||hi<Math.max(open,close)||lo>Math.min(open,close))
       fail('H1_INVALID_ROW:'+symbol+':'+i);
  }
  const payload={schema:'disdex-stable4-q102-h1-public-catchup-evidence/v1',
    symbol,sourceCacheSha256:plan.sourceCacheSha256,
    requestPlanSha256:createHash('sha256').update(planRaw).digest('hex'),
    sdkSha:basename(sdkRoot),capturedAt:Date.now(),ordersSent:0,rows};
  await writeFile(join(output,symbol+'.json'),JSON.stringify(payload)+'\n',
    {flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'PUBLIC_H1_CAPTURED',symbol,rows:rows.length,ordersSent:0}));
}
