/** VPS-only public evidence collector. No credentials, account lock, or trade calls. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {isAbsolute,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const arg=k=>{const i=process.argv.indexOf(k),v=i>=0?process.argv[i+1]:undefined;if(!v||v.startsWith('--'))throw Error('ARGUMENT_REQUIRED:'+k);return v;};
const sdkRoot=arg('--sdk-root'),requestPath=arg('--request-path'),output=arg('--output-root');
if(![sdkRoot,requestPath,output].every(isAbsolute)||!/^[/]home[/]deploy[/]disdex-trading[/]releases[/][a-f0-9]{40}$/.test(sdkRoot))throw Error('ABSOLUTE_IMMUTABLE_PATHS_REQUIRED');
const marker=join(sdkRoot,'.disdex-release-sha'),st=await lstat(marker);
if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o222)!==0||(await readFile(marker,'utf8')).trim()!==basename(sdkRoot))throw Error('UNTRUSTED_SDK_RELEASE');
if(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH!=='/var/lib/disdex/shared/aster-rate-budget.json')throw Error('SHARED_ASTER_BUDGET_REQUIRED');
const {AsterV3Client}=await import(pathToFileURL(join(sdkRoot,'lib/aster-v3-client.ts')).href);
const readOnlyFetch=(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if((init.method??'GET')!=='GET'||u.origin!=='https://fapi.asterdex.com'||!['/fapi/v3/klines','/fapi/v3/fundingRate'].includes(u.pathname)||init.body!=null)throw Error('PUBLIC_GET_ONLY_BOUNDARY');return fetch(input,{...init,redirect:'error'});};
const client=new AsterV3Client({fetchImpl:readOnlyFetch,readOnlyRateLimitMaxRetries:0});
const requestsRaw=await readFile(requestPath),plan=JSON.parse(requestsRaw);
if(plan.schema!=='disdex-stable4-public-bootstrap-requests/v1'||!Array.isArray(plan.requests)||plan.requests.length>20)throw Error('REQUEST_PLAN_INVALID');
await mkdir(output,{recursive:true,mode:0o700});
async function retry(read){for(let n=0;n<5;n++){try{return await read();}catch(e){if(n===4||!(/RATE_BUDGET|429|TOO_MANY_REQUESTS/.test(String(e?.message??e))))throw e;await new Promise(r=>setTimeout(r,5000));}}}
for(const q of plan.requests){
 if(!/^[A-Z0-9]+USDT$/.test(q.symbol)||![q.from,q.through,q.supplementFrom].every(Number.isSafeInteger)||q.from<=0||q.through<q.from||q.through>Date.now()||q.through-q.from>90*86400000)throw Error('REQUEST_RANGE_INVALID');
 const m5=[],funding=[];
 if(q.includeM5&&q.supplementFrom<=q.through){
  let cursor=q.supplementFrom,done=false;
  for(let page=0;page<200;page++){
   const rows=await retry(()=>client.getKlines(q.symbol,'5m',1000,{startTime:cursor,endTime:q.through}));
   if(!Array.isArray(rows)||rows.length>1000)throw Error('M5_RESPONSE_INVALID');let last=cursor-300000;
   for(const row of rows){const t=Number(row[0]);if(!Number.isSafeInteger(t)||t<cursor||t>q.through||t<=last)throw Error('M5_NONADVANCING');last=t;m5.push(row);}
   if(rows.length<1000||last+300000>q.through){done=true;break;}cursor=last+300000;
  }
  if(!done)throw Error('M5_PAGINATION_LIMIT');
 }
 let cursor=q.from+1,done=cursor>=q.through;
 if(!done)for(let page=0;page<200;page++){
  // This adapter permits the same documented public GET on an existing SDK
  // release that predates the typed funding-history wrapper.
  const rows=await retry(()=>client.request({method:'GET',path:'/fapi/v3/fundingRate',params:{symbol:q.symbol,startTime:cursor,endTime:q.through-1,limit:1000},ratePriority:'MARKET_DATA'}));
  if(!Array.isArray(rows)||rows.length>1000)throw Error('FUNDING_RESPONSE_INVALID');let last=cursor-1;
  for(const row of rows){const t=Number(row.fundingTime);if(row.symbol!==q.symbol||!Number.isSafeInteger(t)||t<cursor||t>=q.through||t<=last||!Number.isFinite(Number(row.fundingRate)))throw Error('FUNDING_NONADVANCING');last=t;funding.push(row);}
  if(rows.length<1000||last>=q.through-1){done=true;break;}cursor=last+1;
 }
 if(!done)throw Error('FUNDING_PAGINATION_LIMIT');
 const result={schema:'disdex-stable4-public-bootstrap-evidence/v1',request:q,capturedAt:Date.now(),requestPlanSha256:createHash('sha256').update(requestsRaw).digest('hex'),sdkSha:basename(sdkRoot),ordersSent:0,m5,funding};
 await writeFile(join(output,q.symbol+'.json'),JSON.stringify(result)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'PUBLIC_BOOTSTRAP_EVIDENCE_CAPTURED',symbol:q.symbol,m5Rows:m5.length,fundingRows:funding.length,ordersSent:0}));
}
