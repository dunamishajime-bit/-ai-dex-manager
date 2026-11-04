import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySharedRiskHealth} from '../scripts/ops/root/disdex-runner-health-snapshot-current.mjs';
const now=Date.parse('2026-11-04T08:00:00.000Z');
const risk=()=>({schema:'disdex-shared-crypto-daily-risk/v1',accountScope:'ASTER_FUTURES',updatedAt:now-1000,utcDay:'2026-11-04',sourceComplete:true,tripped:false,lossPct:0,maximumLossPct:7.5});
test('HP health preserves the exact 7.5 percent UTC fresh loss contract',()=>{
 assert.equal(classifySharedRiskHealth(risk(),now).safetyState,'HEALTHY');
 for(const [key,value] of [['maximumLossPct',8],['maximumLossPct',undefined],['updatedAt',now+1],['updatedAt',now-120001],
  ['utcDay','2026-11-03'],['lossPct',NaN],['lossPct',-1],['lossPct',8],['tripped',undefined],['sourceComplete',false]])
  assert.equal(classifySharedRiskHealth({...risk(),[key]:value},now).safetyState,'BLOCKED',key);
});
