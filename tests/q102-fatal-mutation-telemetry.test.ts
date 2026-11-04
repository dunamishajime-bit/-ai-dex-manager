import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('Q102 fatal handler never certifies zero orders after an unknown outcome',async()=>{
 const source=await readFile('scripts/disdex-quality102-causal-v1-live-runner.ts','utf8');
 const start=source.indexOf('console.error(JSON.stringify({',source.indexOf('main().catch('));
 const end=source.indexOf('}));',start)+4;assert.ok(start>=0&&end>start);
 const modulePath='../lib/disdex-runner-mutation-telemetry.ts';
 const {runnerMutationTelemetry}=await import(modulePath);
 const rows:Record<string,unknown>[]=[];
 runInNewContext(source.slice(start,end),{error:new Error('unknown venue response'),
  QUALITY102_CAUSAL_V1:{strategyId:'QUALITY102_CAUSAL_V1'},isAsterDepositRequirementError:()=>false,
  runnerMutationTelemetry,console:{error:(s:string)=>rows.push(JSON.parse(s))}});
 assert.equal(rows.length,1);
 for(const key of ['ordersSent','cancelsSent','positionChangesSent'])assert.equal(rows[0][key],null);
 assert.equal(rows[0].mutationCountersKnown,false);
});
