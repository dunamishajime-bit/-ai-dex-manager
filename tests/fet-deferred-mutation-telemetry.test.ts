import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('FET retry logs do not infer zero requests from a thrown API-budget exception',async()=>{
 const source=await readFile('scripts/disdex-fet-brk48-live-runner.ts','utf8');
 const start=source.indexOf('console.log(JSON.stringify({',source.indexOf('} catch (error)'));
 const end=source.indexOf('}));',start)+4;assert.ok(start>=0&&end>start);
 const modulePath='../lib/disdex-runner-mutation-telemetry.ts';
 const {runnerMutationTelemetry}=await import(modulePath);
 const rows:Record<string,unknown>[]=[];
 runInNewContext(source.slice(start,end),{runtimeSha:'a'.repeat(40),retryMs:30000,
  deferred:{reason:'BUDGET_COOLDOWN',kind:'RATE_BUDGET',waitMs:30000},runnerMutationTelemetry,
  console:{log:(s:string)=>rows.push(JSON.parse(s))}});
 assert.equal(rows.length,1);
 for(const key of ['ordersSent','cancelsSent','positionChangesSent'])assert.equal(rows[0][key],null);
 assert.equal(rows[0].mutationCountersKnown,false);
});
