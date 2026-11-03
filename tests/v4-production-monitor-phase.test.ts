import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {v4ExecutionPhase,v4MonitorIdentity} from '../lib/v12-v4-execution-phase';

const sha='a'.repeat(40);
const env={V12_V4_OPERATION_MODE:'MONITOR_ONLY',V12_V4_ORDERS_ENABLED:'false'};

test('production read-only phase requires three explicit matching switches',()=>{
 assert.equal(v4ExecutionPhase(['--monitor-only','--daemon'],env),'MONITOR_ONLY');
 assert.equal(v4ExecutionPhase(['--once'],{}),'PRODUCTION');
 for(const [args,vars] of [
  [['--daemon'],env],[['--monitor-only','--daemon'],{}],
  [['--monitor-only','--daemon'],{...env,V12_V4_ORDERS_ENABLED:'true'}],
  [['--monitor-only','--once','--init-signed-flat'],env],
  [['--monitor-only','--once','--daemon'],env],
  [['--monitor-only'],env],[['--daemon'],{V12_V4_ORDERS_ENABLED:'false'}],
  [['--daemon'],{V12_V4_ORDERS_ENABLED:'FALSE'}],
 ] as const)assert.throws(()=>v4ExecutionPhase([...args],vars));
});

test('monitor identity binds the actual production unit but never claims LIVE',()=>{
 const identity=v4MonitorIdentity(sha,true,{...env,V12_V4_SERVICE_UNIT:`disdex-v12-v4@${sha}.service`});
 assert.deepEqual(identity,{runnerId:'V12_V4',serviceUnit:`disdex-v12-v4@${sha}.service`,
  healthPath:'/var/lib/disdex/v12-v4/heartbeat.json',healthSchema:'disdex-v12-v4-runner-heartbeat/v1'});
 assert.equal(v4MonitorIdentity(sha,false,{}).runnerId,'V12_V4_MONITOR');
 for(const changes of [{V12_V4_SERVICE_UNIT:`disdex-v12-v4@${'b'.repeat(40)}.service`},
   {V12_V4_ORDERS_ENABLED:'true'},{V12_V4_OPERATION_MODE:'CERTIFIED'}]){
  assert.throws(()=>v4MonitorIdentity(sha,true,{...env,...changes}));
 }
});

test('production CLI dispatches read-only before any store or trading runtime is constructed',()=>{
 const source=readFileSync('scripts/v12-v4-production-runner.ts','utf8');
 const main=source.slice(source.indexOf('async function main(){'));
 const branch=main.indexOf('await runV4ReadOnlyMonitor(');
 assert.ok(branch>=0&&branch<main.indexOf('runtime=await buildV4ProductionRuntime()'));
 assert.match(main.slice(branch,main.indexOf('const once=')),/return;/);
 const monitor=readFileSync('scripts/v12-v4-monitor-only-runner.ts','utf8');
 assert.doesNotMatch(monitor,/V12AsterLiveAdapter|V4ExecutionStore|V4RunnerEngine|\.placeOrder\(|\.cancelOrder\(/);
 assert.match(monitor,/mode:"MONITOR_ONLY",liveEnabled:false/);
 assert.match(monitor,/if\(process\.argv\[1\]\?\.includes\("v12-v4-monitor-only-runner"\)\)/);
});
