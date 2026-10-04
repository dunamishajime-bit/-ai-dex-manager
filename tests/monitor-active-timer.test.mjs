import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

function functionSource(path, name) {
  const text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const start=text.indexOf(name+'() {');
  assert.ok(start>=0);
  return text.slice(start,text.indexOf('\n}',start)+2);
}
const mock=`systemctl() { case "$*" in *LoadState*) echo loaded;; *ActiveState*) echo "$MOCK_ACTIVE";; *SubState*) echo "$MOCK_SUB";; esac; }; sleep() { :; };`;
function run(source,call,active,sub) {
  return spawnSync('bash',['-c',mock+'\n'+source+'\n'+call],{encoding:'utf8',env:{...process.env,MOCK_ACTIVE:active,MOCK_SUB:sub}});
}
const guard=functionSource('scripts/ops/root/disdex-current-runtime-coherence-guard','timer_waiting');
for(const sub of ['waiting','running']) test('guard accepts active timer '+sub,()=>assert.equal(run(guard,'timer_waiting monitor.timer','active',sub).status,0));
test('guard rejects inactive timer',()=>assert.notEqual(run(guard,'timer_waiting monitor.timer','inactive','waiting').status,0));
test('guard rejects unknown timer substate',()=>assert.notEqual(run(guard,'timer_waiting monitor.timer','active','failed').status,0));
const wiring=functionSource('scripts/ops/root/disdex-current-runtime-wiring','ensure_monitor_timer_active');
test('runtime wiring accepts a currently executing monitor without waiting on itself',()=>{
  const r=run(wiring,'ensure_monitor_timer_active disdex-current-runtime-coherence-guard.timer','active','running');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/DISDEX_MONITOR_TIMER_(ARMED|RUNNING)/);
});
