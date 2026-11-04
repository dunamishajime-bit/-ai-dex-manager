import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

const cwd='/home/deploy/disdex-trading/releases/'+'a'.repeat(40);
const entries={PENGU_V8:'scripts/disdex-pengu-dual-ls-v2-live-runner.ts',
 QUALITY102_CAUSAL_V1:'scripts/disdex-quality102-causal-v1-live-runner.ts',
 FET_BRK48_RESIDUAL:'scripts/disdex-fet-brk48-live-runner.ts',
 HYPE_TREND_LONG:'scripts/disdex-hype-trend-live-runner.ts',
 IDLE_PRIORITY_SHORT:'scripts/disdex-idle-priority-short-live-runner.ts'};

async function actualMatcher(){
 const source=await readFile('scripts/ops/root/disdex-runner-watchdog-current.mjs','utf8');
 const start=source.indexOf('function commandMatches('),end=source.indexOf('\nasync function markerExists(',start);
 assert.ok(start>=0&&end>start);
 return runInNewContext('('+source.slice(start,end)+')',{join,
  samePath:(a,b)=>resolve(a)===resolve(b),pathToken:(token,root,script)=>token===script||resolve(token)===join(root,script)});
}

test('all five peer daemons accept only their own same-PID release-local loader',async()=>{
 const matches=await actualMatcher();
 for(const [key,script] of Object.entries(entries)){
  const runner={key,script,expectedCwd:cwd},command=['/usr/bin/node','--import',join(cwd,'node_modules/tsx/dist/loader.mjs'),join(cwd,script),'--daemon'];
  assert.equal(matches({},runner,command.join(' ')),true,key);
  for(const bad of [[...command,'--once'],[command[0],command[1],'/tmp/loader.mjs',...command.slice(3)],
   [...command.slice(0,3),join(cwd,'scripts/unapproved.ts'),'--daemon'],[...command.slice(0,4),'--once']]){
   assert.equal(matches({},runner,bad.join(' ')),false,key);
  }
 }
});
test('HYPE direct loader cannot select the legacy sidecar instead of approved TREND',async()=>{
 const matches=await actualMatcher(),runner={key:'HYPE_TREND_LONG',script:entries.HYPE_TREND_LONG,expectedCwd:cwd};
 const command=`/usr/bin/node --import ${cwd}/node_modules/tsx/dist/loader.mjs ${cwd}/scripts/disdex-hype-zec-long-live-runner.ts --daemon`;
 assert.equal(matches({},runner,command),false);
});
