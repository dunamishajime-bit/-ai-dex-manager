import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {V4ExecutionStore} from '../lib/v12-v4-execution-store';
import {rebindV4ActiveLineage} from '../lib/v12-v4-active-lineage-rebind';
import {publishV4MigratedState} from '../lib/v12-v4-state-publication';

const oldSha='a'.repeat(40),newSha='b'.repeat(40);
async function fixture(){
 const directory=await fs.mkdtemp(join(tmpdir(),'v4-state-publish-')),path=join(directory,'orders.json');
 const old=new V4ExecutionStore(path,oldSha).initialize({equityUsd:100,foreign:[],holdProtected:false});
 const before=await fs.readFile(path),candidate=rebindV4ActiveLineage(old,oldSha,newSha);
 return {directory,path,before,candidate,cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
}
test('SHA publication keeps old state in place until one atomic replacement and a durable exact backup exists',async(t)=>{
 const f=await fixture(),rename=fs.rename;
 try{
  let replacements=0;
  t.mock.method(fs,'rename',async(source,destination)=>{
   if(String(destination)===f.path){replacements++;assert.deepEqual(await fs.readFile(f.path),f.before);
    const backups=await fs.readdir(join(f.directory,'migrations'));assert.equal(backups.length,1);
    assert.deepEqual(await fs.readFile(join(f.directory,'migrations',backups[0])),f.before);}
   return rename(source,destination);
  });
  const result=await publishV4MigratedState({statePath:f.path,expectedOldBytes:f.before,candidate:f.candidate});
  assert.equal(replacements,1);assert.deepEqual(await fs.readFile(result.backupPath),f.before);
  assert.deepEqual(new V4ExecutionStore(f.path,newSha).read(),f.candidate);
 }finally{t.mock.restoreAll();await f.cleanup();}
});
test('publication failure before rename leaves the original readable and cleans only the unpublished temporary',async(t)=>{
 const f=await fixture();
 try{
  t.mock.method(fs,'rename',async()=>{throw new Error('fixture crash before replacement');});
  await assert.rejects(publishV4MigratedState({statePath:f.path,expectedOldBytes:f.before,candidate:f.candidate}),/fixture crash/);
  assert.deepEqual(await fs.readFile(f.path),f.before);new V4ExecutionStore(f.path,oldSha).read();
  assert.deepEqual((await fs.readdir(f.directory)).sort(),['migrations','orders.json']);
 }finally{t.mock.restoreAll();await f.cleanup();}
});
test('an interruption after replacement keeps the new valid document and original backup for reconciliation',async(t)=>{
 const f=await fixture(),rename=fs.rename;
 try{
  t.mock.method(fs,'rename',async(source,destination)=>{await rename(source,destination);throw new Error('fixture crash after replacement');});
  await assert.rejects(publishV4MigratedState({statePath:f.path,expectedOldBytes:f.before,candidate:f.candidate}),/fixture crash after/);
  new V4ExecutionStore(f.path,newSha).read();
  const backups=await fs.readdir(join(f.directory,'migrations'));assert.equal(backups.length,1);
  assert.deepEqual(await fs.readFile(join(f.directory,'migrations',backups[0])),f.before);
 }finally{t.mock.restoreAll();await f.cleanup();}
});
test('a concurrent state change or wrong candidate never overwrites the new observed state',async()=>{
 const f=await fixture();
 try{
  const changed=Buffer.from(f.before.toString()+' ');await fs.writeFile(f.path,changed);
  await assert.rejects(publishV4MigratedState({statePath:f.path,expectedOldBytes:f.before,candidate:f.candidate}),/STATE_CHANGED/);
  assert.deepEqual(await fs.readFile(f.path),changed);
  await fs.writeFile(f.path,f.before);const wrong={...f.candidate,releaseSha:oldSha};
  await assert.rejects(publishV4MigratedState({statePath:f.path,expectedOldBytes:f.before,candidate:wrong}),/LINEAGE/);
  assert.deepEqual(await fs.readFile(f.path),f.before);
 }finally{await f.cleanup();}
});
