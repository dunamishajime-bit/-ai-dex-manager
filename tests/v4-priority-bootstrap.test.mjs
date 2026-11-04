import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateGrant,validateObsoleteHold,atomicOwnedWrite,permitsSharedMarginMetadata} from '../scripts/ops/deploy/disdex_v4_priority_bootstrap.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const NOW=2000000000000;
test('only the canonical deploy-owned Margin Guard may have deploy-group write permission',()=>{
 const path='/var/lib/disdex/shared/margin-risk/guard-live.json';
 const metadata={uid:1000,gid:1000,mode:0o100660};
 assert.equal(permitsSharedMarginMetadata(path,metadata,1000,1000),true);
 for(const [p,m] of [[path,{...metadata,uid:999}],[path,{...metadata,gid:999}],
  [path,{...metadata,mode:0o100666}],['/etc/disdex/v12-v4-production-certification.json',metadata],
  ['/var/lib/disdex/shared/kill-switch.json',metadata]])
  assert.equal(permitsSharedMarginMetadata(p,m,1000,1000),false);
});
const grant=()=>({schema:'disdex-v4-priority-root-grant/v1',repository:'dunamishajime-bit/-ai-dex-manager',
 deploymentTarget:'professional-dismanager.net',operatorTarget:'DD1296_FINAL_ALLIN_10BPS',
 candidateSha:'a'.repeat(40),scope:'V12_V4_PREPARATION_ONLY',ordersEnabled:false,authorizesTrading:false,
 authorizationMethod:'ROOT_SSH_SESSION',parentPid:4242,issuedAt:NOW-1000,expiresAt:NOW+299000,
 nonce:'b'.repeat(32),planSha256:'c'.repeat(64)});
test('root child authority is short, single-purpose and bound to the actual parent',()=>{
 assert.equal(validateGrant(grant(),NOW,4242),true);
 for(const [field,value] of [['ordersEnabled',true],['authorizesTrading',true],['parentPid',4243],
  ['scope','FULL_PROJECT'],['expiresAt',NOW],['issuedAt',NOW+1],['deploymentTarget','other'],['candidateSha','x']]){
  assert.throws(()=>validateGrant({...grant(),[field]:value},NOW,4242));
 }
});
test('a different or non-recoverable Kill must never be cleared',()=>{
 const kill={active:true,action:'HOLD_PROTECTED',operator:'disdex-v52-aster-only',recoverable:true,
 reason:'V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha'};
 assert.equal(validateObsoleteHold(kill),true);
 for(const [k,v] of [['active',false],['reason','DAILY_LOSS'],['recoverable',false],['operator','other']])
  assert.throws(()=>validateObsoleteHold({...kill,[k]:v}));
});
test('atomic root publication preserves a valid prior file until replacement and rejects changed evidence',
 {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'disdex-v4-priority-test-'));const path=join(dir,'state.json');
 try{
  const before=Buffer.from('{"before":true}\n');await writeFile(path,before,{mode:0o600});
  const metadata=await stat(path);
  await assert.rejects(()=>atomicOwnedWrite(path,Buffer.from('{}'),{expectedHash:'0'.repeat(64),metadata}));
  assert.deepEqual(await readFile(path),before);
  await atomicOwnedWrite(path,Buffer.from('{"after":true}\n'),{expectedHash:hash(before),metadata});
  assert.equal(JSON.parse(await readFile(path,'utf8')).after,true);
  assert.equal((await stat(path)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('atomic root publication never follows a substituted target symlink',
 {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'disdex-v4-priority-test-'));const path=join(dir,'state.json');const sentinel=join(dir,'sentinel');
 try{
  await writeFile(sentinel,'SAFE',{mode:0o600});await symlink(sentinel,path);
  const metadata=await stat(sentinel);
  await assert.rejects(()=>atomicOwnedWrite(path,Buffer.from('BAD'),{expectedHash:hash(Buffer.from('SAFE')),metadata}));
  assert.equal(await readFile(sentinel,'utf8'),'SAFE');
 }finally{await rm(dir,{recursive:true,force:true});}
});
