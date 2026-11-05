import test from 'node:test';
import assert from 'node:assert/strict';
import * as observation from '../lib/disdex-health-observability.mjs';

const sha='e'.repeat(40),now=1793850000000;
function fixture(){return {
 sha,now,
 snapshot:{schemaVersion:1,strategyId:'QUALITY102_CAUSAL_V1',selectorMode:'CAUSAL_V4',runtimeCommitSha:sha,
  capturedAt:new Date(now-20000).toISOString(),decisionTs:now-20000,referenceTs:now-60000,
  selectedReason:'QUALITY102_CAUSAL_V4_NO_SIGNAL',items:[]},
 tick:{schemaVersion:1,runtimeCommitSha:sha,timestamp:new Date(now-5000).toISOString(),
  mode:'LIVE',status:'no-change',message:'QUALITY102_CAUSAL_V4_NO_SIGNAL',ordersSent:0,
  signal:{side:0,requestedGross:0,reason:'QUALITY102_CAUSAL_V4_NO_SIGNAL'}},
};}
function project(input){assert.equal(typeof observation.projectQ102Decision,'function','validated legacy decision-file reader is required');return observation.projectQ102Decision(input);}

test('Q102 flat no-signal displays the actual completed result without certifying a legacy tick',()=>{
 const result=project(fixture());
 assert.equal(result.status,'OBSERVED');assert.equal(result.finalDecision,'QUALITY102_CAUSAL_V4_NO_SIGNAL');
 assert.equal(result.family,null);assert.equal(result.layer,null);assert.equal(result.score,null);
 assert.equal(result.authorizesTrading,false);assert.equal(result.tickVerified,false);
});
test('Q102 selected family and layer preserve a real zero score and the final execution block',()=>{
 const input=fixture();input.snapshot.selectedSymbol='INJUSDT';
 input.snapshot.items=[{symbol:'INJUSDT',selected:true,eligible:true,side:'SHORT',family:'BRK',layer:'S3',score:0}];
 input.tick.message='SHARED_ACCOUNT_LOCK_BUSY';
 const result=project(input);assert.equal(result.family,'BRK');assert.equal(result.layer,'S3');
 assert.equal(result.score,0);assert.equal(result.finalDecision,'SHARED_ACCOUNT_LOCK_BUSY');
 assert.equal(result.authorizesTrading,false);
});
test('Q102 stale, future, foreign-SHA and mixed decision generations are unavailable',()=>{
 const cases=[input=>{input.tick.runtimeCommitSha='f'.repeat(40);},
  input=>{input.snapshot.runtimeCommitSha='f'.repeat(40);},
  input=>{input.tick.timestamp=new Date(now+1).toISOString();},
  input=>{input.now=now+7200001;},
  input=>{input.snapshot.decisionTs=now;input.snapshot.capturedAt=new Date(now).toISOString();},
  input=>{input.snapshot.capturedAt=new Date(now-20001).toISOString();},
  input=>{input.snapshot.items=[{selected:true},{selected:true}];},
  input=>{input.now=String(now);},
 ];
 for(const change of cases){const input=fixture();change(input);const result=project(input);
  assert.equal(result.status,'UNAVAILABLE');assert.equal(result.authorizesTrading,false);}
});
test('Q102 proximity scores and coercible values are never invented as strategy scores',()=>{
 for(const score of [undefined,null,'',false,'5',Infinity]){
  const input=fixture();input.snapshot.selectedSymbol='INJUSDT';
  input.snapshot.items=[{symbol:'INJUSDT',selected:true,eligible:true,side:'SHORT',score,rankingScore:99}];
  assert.equal(project(input).score,null);
 }
});
