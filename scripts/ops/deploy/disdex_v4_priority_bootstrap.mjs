import {constants} from 'node:fs';
import {open,lstat,readFile,rename,unlink,chown,chmod} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const reason='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha';
function require(ok,code){if(!ok)throw Error('V4_PRIORITY_'+code);}
export function validateGrant(g,now,parentPid){
 require(g?.schema==='disdex-v4-priority-root-grant/v1'&&g.repository==='dunamishajime-bit/-ai-dex-manager'
  &&g.deploymentTarget==='professional-dismanager.net'&&g.operatorTarget==='DD1296_FINAL_ALLIN_10BPS'
  &&g.scope==='V12_V4_PREPARATION_ONLY'&&g.ordersEnabled===false&&g.authorizesTrading===false
  &&g.authorizationMethod==='ROOT_SSH_SESSION'&&g.parentPid===parentPid
  &&/^[a-f0-9]{40}$/.test(g.candidateSha)&&/^[a-f0-9]{32}$/.test(g.nonce)
  &&/^[a-f0-9]{64}$/.test(g.planSha256),'GRANT_BINDING');
 require(Number.isSafeInteger(g.issuedAt)&&Number.isSafeInteger(g.expiresAt)
  &&g.issuedAt<=now&&now<g.expiresAt&&g.expiresAt-g.issuedAt<=300000,'GRANT_EXPIRED');return true;
}
export function validateObsoleteHold(k){
 require(k?.active===true&&k.action==='HOLD_PROTECTED'&&k.operator==='disdex-v52-aster-only'
  &&k.recoverable===true&&k.reason===reason,'EXACT_OBSOLETE_HOLD_REQUIRED');return true;
}
async function regularBytes(path,allowed=[0]){
 const before=await lstat(path);require(before.isFile()&&!before.isSymbolicLink()&&allowed.includes(before.uid)
  &&(before.mode&0o022)===0,'UNTRUSTED_FILE');
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await fd.stat();require(s.dev===before.dev&&s.ino===before.ino&&s.size<=16*1048576,'FILE_CHANGED');
  return {bytes:await fd.readFile(),metadata:s};}finally{await fd.close();}
}
export async function atomicOwnedWrite(path,bytes,{expectedHash,metadata}){
 const check=async()=>{
  if(expectedHash===null){try{await lstat(path);throw Error('V4_PRIORITY_TARGET_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
  else require(sha((await regularBytes(path,[metadata.uid])).bytes)===expectedHash,'TARGET_CAS_MISMATCH');
 };
 await check();const temp=join(dirname(path),'.'+randomUUID()+'.tmp');let owned=false;
 try{const fd=await open(temp,'wx',metadata.mode&0o777);owned=true;
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  await chown(temp,metadata.uid,metadata.gid);await chmod(temp,metadata.mode&0o777);await check();
  await rename(temp,path);owned=false;
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
  try{await parent.sync();}finally{await parent.close();}
 }finally{if(owned)await unlink(temp).catch(()=>{});}
}
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');

async function main(){
 require(process.getuid?.()===0,'ROOT_REQUIRED');
 require(process.argv.length===4&&process.argv[2]==='--grant','EXPLICIT_GRANT_REQUIRED');
 const grantPath=process.argv[3];
 require(/^\/var\/lib\/disdex\/unified-deploy\/v4-priority\/transactions\/[a-f0-9]{32}\/grant.json$/.test(grantPath),'GRANT_PATH');
 const g=JSON.parse((await regularBytes(grantPath)).bytes);
 const authority=()=>validateGrant(g,Date.now(),process.ppid);authority();
 const rawPlan=(await regularBytes(join(dirname(grantPath),'plan.json'))).bytes;
 require(sha(rawPlan)===g.planSha256,'PLAN_HASH');const p=JSON.parse(rawPlan);
 require(p.candidateSha===g.candidateSha&&p.bootstrapProgramSha256===sha(await readFile(fileURLToPath(import.meta.url))),'SOURCE_BINDING');
 const used=await open(grantPath+'.used','wx',0o600);try{await used.writeFile(g.nonce);await used.sync();}finally{await used.close();}
 const root='/home/deploy/disdex-trading/releases/'+g.candidateSha;
 require((await regularBytes(root+'/.disdex-release-sha')).bytes.toString().trim()===g.candidateSha,'RELEASE_MARKER');
 const from=path=>import(pathToFileURL(root+'/'+path));
 const {FileAccountOrderLock}=await from('lib/disdex-account-order-lock.ts');
 const {AsterV3Client}=await from('lib/aster-v3-client.ts');
 const {collectV4DynamicEvidence,validateV4RefreshLease}=await from('scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts');
 const {validateV4ProductionCertificate,validateV4SharedExecutionEvidencePayloads,readV4ProductionCertificate}=await from('lib/v12-v4-certified-gates.ts');
 const {validateV4RefreshCommit}=await from('lib/v12-v4-refresh-commit.ts');
 const {PRODUCTION_EXIT_CATALOG}=await from('lib/v12-v4-production-lifecycle.ts');
 const {V12_V4_V2_POLICY}=await from('lib/v12-v4-v2-shadow.ts');
 const {V12_V4_CERTIFIED_GROSS_CONTRACT}=await from('lib/v12-v4-production-contract.ts');
 const {V12_V4_TIME_EMERGENCY_RESEARCH_ID}=await from('lib/v12-v4-time-emergency-stop-research.ts');
 const {assertV4EntrySafety}=await from('lib/v12-v4-entry-safety.ts');
 const shared='/var/lib/disdex/shared';
 const json=async path=>JSON.parse((await regularBytes(path,[0,p.deployUid])).bytes);
 const runtime=async()=>({sharedRisk:await json(shared+'/crypto-daily-risk.json'),marginGuard:await json(shared+'/margin-risk/guard-live.json'),
  killSwitch:await json(shared+'/kill-switch.json'),pendingExposure:await json(shared+'/pending-exposure.json')});
 const actualFetch=globalThis.fetch;
 const fetchImpl=(input,init={})=>{
  const u=new URL(typeof input==='string'?input:input.url??String(input));
  require((init.method??'GET')==='GET'&&u.origin==='https://fapi.asterdex.com'
   &&['/fapi/v3/time','/fapi/v3/balance','/fapi/v3/positionRisk','/fapi/v3/openOrders'].includes(u.pathname)
   &&init.body==null&&!u.username&&!u.password&&!u.hash,'READONLY_HTTP_BOUNDARY');
  return actualFetch(input,{...init,redirect:'error'});
 };
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY,requestTimeoutMs:15000,readOnlyRateLimitMaxRetries:0,fetchImpl});
 const lock=new FileAccountOrderLock(shared+'/account-order.lock',120000,shared+'/pending-exposure.json');
 const lease=await lock.acquire('V4_PRIORITY_CERTIFICATE_BOOTSTRAP');require(lease,'ACCOUNT_LOCK_BUSY');
 let renewalError=false;const timer=setInterval(()=>{void lease.renew().catch(()=>{renewalError=true;});},30000);
 const killPath=shared+'/kill-switch.json';let cleared=null;let original;
 const liveAuthority=()=>{authority();require(!renewalError,'ACCOUNT_LEASE_RENEWAL_FAILED');};
 try{
  original=await regularBytes(killPath,[0,p.deployUid]);require(sha(original.bytes)===p.killHash,'KILL_CHANGED');
  const kill=JSON.parse(original.bytes);validateObsoleteHold(kill);liveAuthority();
  require(Date.now()-g.signedVerifiedAt<=30000&&Date.now()>=g.signedVerifiedAt,'SIGNED_FLAT_PROOF_STALE');
  require(sha((await regularBytes('/var/lib/disdex/v12-v4/orders.json',[p.deployUid])).bytes)===g.migratedStateHash,'LEDGER_CHANGED');
  const refreshPath='/var/lib/disdex/unified-deploy/refresh-leases/v4/'+g.candidateSha+'.json';
  const refreshLease=JSON.parse((await regularBytes(refreshPath)).bytes);
  validateV4RefreshLease({lease:refreshLease,sha:g.candidateSha,now:Math.floor(Date.now()/1000)});
  // The authentic root grant authorizes only this exact obsolete cause.
  const clearedKill={...kill,active:false,clearedAt:new Date().toISOString(),clearedBy:'codex-ssh',
   recoveryPlanSha256:g.planSha256,recoveryNonceDigest:sha(Buffer.from(g.nonce))};
  const clearedBytes=encode(clearedKill);
  await atomicOwnedWrite(killPath,clearedBytes,{expectedHash:p.killHash,metadata:original.metadata});cleared=sha(clearedBytes);
  await assertV4EntrySafety({env:{DISDEX_SHARED_KILL_SWITCH_FILE:killPath}});
  const dynamic=await collectV4DynamicEvidence({sha:g.candidateSha,client,runtime:await runtime(),readRuntime:runtime,clock:Date.now});
  liveAuthority();
  require(dynamic.signedAsterAccount.positions.every(x=>Number.isFinite(Number(x.positionAmt))&&Number(x.positionAmt)===0)
   &&dynamic.signedAsterAccount.openOrders.length===0,'VENUE_CHANGED_FROM_SIGNED_FLAT');
  const staticPayloads={},staticRaw={};
  for(const [key,row] of Object.entries(p.staticEvidence)){
   const b=(await regularBytes(row.path)).bytes;require(sha(b)===row.sha256,'STATIC_SOURCE_CHANGED');
   staticRaw[key]=b;staticPayloads[key]=JSON.parse(b);
  }
  const payloads={...staticPayloads,...dynamic};validateV4SharedExecutionEvidencePayloads(payloads,g.candidateSha,Date.now(),true);
  const hashes=Object.fromEntries(Object.entries(payloads).map(([key,v])=>[key,sha(staticRaw[key]??encode(v))]));
  const approvedAt=new Date().toISOString();
  const certPath='/etc/disdex/v12-v4-production-certification.json';const certOld=await regularBytes(certPath);
  require(sha(certOld.bytes)===p.certificateHash,'CERTIFICATE_CHANGED');
  const prior=JSON.parse(certOld.bytes);const reuse=prior.approvedSha===g.candidateSha;
  const certificate=reuse?prior:{schema:'disdex-v12-v4-production-certification/v4',approvedSha:g.candidateSha,
   policyId:V12_V4_V2_POLICY,approvedAt,validUntil:new Date(Date.parse(approvedAt)+7*86400000).toISOString(),
   verifiedRoutes:PRODUCTION_EXIT_CATALOG.map(x=>x.route),venueEvidenceBasis:'ESTABLISHED_ASTER_PRODUCTION_EXECUTION',
   evidenceSha256:hashes,approvedGross:V12_V4_CERTIFIED_GROSS_CONTRACT,
   risksAcknowledged:{v4FirstLiveFillNotYetObserved:true,weakIndependentForwardPerformance:true},
   operatorAcknowledgement:'I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS_WITH_BOUNDED_DYNAMIC_REFRESH',
   dynamicRefreshPolicy:'BOUNDED_ROOT_REFRESH_V1',route:'CODEX_SSH',authorizationMethod:'ROOT_SSH_SESSION',
   approvalPlanSha256:g.planSha256,approvalNonceDigest:sha(Buffer.from(g.nonce))};
  validateV4ProductionCertificate(certificate,g.candidateSha);
  if(reuse)for(const key of Object.keys(staticRaw))require(certificate.evidenceSha256[key]===hashes[key],'REUSED_STATIC_CERT_MISMATCH');
  const files={routeSourceParity:'route-source-parity.json',v4ExecutionTests:'v4-execution-tests.json',
   establishedAsterOrders:'established-aster-orders.json',signedAsterAccount:'signed-aster-account.json',sharedRiskAndPeers:'shared-risk-and-peers.json'};
  const outputMeta={uid:0,gid:p.deployGid,mode:0o640};
  for(const [key,name] of Object.entries(files)){
   liveAuthority();const path='/etc/disdex/v12-v4-evidence/'+name;
   await atomicOwnedWrite(path,staticRaw[key]??encode(payloads[key]),{expectedHash:p.evidenceTargetHashes[key],metadata:outputMeta});
  }
  const first=dynamic.signedAsterAccount;
  const dynamicHashes=Object.fromEntries(Object.keys(dynamic).map(key=>[key,hashes[key]]));
  const commit={schema:'disdex-v4-dynamic-evidence-commit/v1',sha:g.candidateSha,scope:'V4_EVIDENCE_REFRESH_ONLY',
   ordersEnabled:false,authorizesTrading:false,refreshGeneration:first.refreshGeneration,capturedAt:first.capturedAt,
   leaseId:refreshLease.leaseId,leaseApprovedAt:refreshLease.approvedAt,leaseExpiresAt:refreshLease.expiresAt,
   planSha256:refreshLease.planSha256,evidenceSha256:dynamicHashes,evidencePayloads:dynamic};
  validateV4RefreshCommit(commit,g.candidateSha);liveAuthority();
  await atomicOwnedWrite('/etc/disdex/v12-v4-evidence/refresh-commit.json',encode(commit),{expectedHash:p.commitHash,metadata:outputMeta});
  if(!reuse)await atomicOwnedWrite(certPath,encode(certificate),{expectedHash:p.certificateHash,metadata:outputMeta});
  const timePath='/etc/disdex/v12-v4-time-stop-approvals/'+g.candidateSha+'.json';
  if(p.timeApprovalTargetHash===null){
   require(p.timePolicyId===V12_V4_TIME_EMERGENCY_RESEARCH_ID,'TIME_POLICY_CHANGED');
   const timeApproval={schema:'disdex-v12-v4-time-stop-approval/v1',approvedSha:g.candidateSha,
    approvedAt:new Date().toISOString(),routeCount:37,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID,
    operatorAcknowledgement:'I_APPROVE_V12_V4_TIME37_FIXED8_EMERGENCY_STOP',
    authorizationMethod:'ROOT_SSH_SESSION',approvalPlanSha256:g.planSha256};
   await atomicOwnedWrite(timePath,encode(timeApproval),{expectedHash:null,metadata:outputMeta});
  }
  await readV4ProductionCertificate(g.candidateSha);
  await assertV4EntrySafety({env:{DISDEX_SHARED_KILL_SWITCH_FILE:killPath}});liveAuthority();
  require(sha((await regularBytes(killPath,[0,p.deployUid])).bytes)===cleared,'KILL_CHANGED_AFTER_BOOTSTRAP');
  console.log(JSON.stringify({status:'V4_BOOTSTRAP_READY_NOT_ORDER_ACTIVATED',candidateSha:g.candidateSha,
   clearedKillHash:cleared,certificateApprovedAt:certificate.approvedAt,refreshLeaseExpiresAt:refreshLease.expiresAt,
   verifiedAt:Date.now(),ordersSent:0,cancelsSent:0,positionChangesSent:0}));
 }catch(error){
  if(cleared&&sha((await regularBytes(killPath,[0,p.deployUid])).bytes)===cleared)
   await atomicOwnedWrite(killPath,original.bytes,{expectedHash:cleared,metadata:original.metadata});
  throw error;
 }finally{clearInterval(timer);await lease.release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
 const code=/^[A-Z0-9_:]+$/.test(String(error.message))?error.message:'V4_PRIORITY_REDACTED_FAILURE';
 console.error(JSON.stringify({status:'V4_PRIORITY_FAILED_CLOSED',reason:code,ordersSent:0,cancelsSent:0,positionChangesSent:0}));process.exitCode=2;
});
