import test from 'node:test';
import assert from 'node:assert/strict';
import {validateV4CanonicalBinding,CANONICAL_V4_PIN_IDS} from '../lib/disdex-v4-canonical-operator-binding.mjs';
const sha='a'.repeat(40);
function fixture(){
 const runners=Object.fromEntries(CANONICAL_V4_PIN_IDS.map((id,index)=>[id,{sha:index===0?sha:'b'.repeat(40)}]));
 return {sha,readiness:{target:'V12_V4_V2_M150_D05_CORE_NATIVE',implementationStatus:'READY',blockers:['OPERATOR_LIVE_ACTIVATION_REQUIRED']},
  manifest:{schema:'disdex-runner-pin-manifest/v1',target:'professional-dismanager.net',runners},
  artifact:{approvedSha:sha,target:'DD1296_FINAL_ALLIN_10BPS',approvedRunners:['V12_V4'],ordersEnabled:true,activationClass:'FULL_LIVE',
   approvedShaByRunner:Object.fromEntries(Object.entries(runners).map(([k,v])=>[k,v.sha])),route:'CODEX_SSH',authorizationMethod:'ROOT_SSH_SESSION'}};
}
test('monitor checks operator target and strategy policy independently with the exact live map',()=>{
 assert.equal(validateV4CanonicalBinding(fixture()).allowed,true);
});
test('monitor rejects scope expansion wrong peer sha wrong policy target or absent root route',()=>{
 for(const [key,value] of [['approvedRunners',['V12_V4','PENGU_V8']],['approvedSha','c'.repeat(40)],['ordersEnabled',false],
  ['target','V12_V4_V2_M150_D05_CORE_NATIVE'],['authorizationMethod','OWNER_SIGNED_TOKEN']]){
  const f=fixture();f.artifact[key]=value;assert.equal(validateV4CanonicalBinding(f).allowed,false,key);
 }
 const f=fixture();f.artifact.approvedShaByRunner.PENGU_V8='c'.repeat(40);assert.equal(validateV4CanonicalBinding(f).allowed,false);
 const p=fixture();p.readiness.target='OTHER_POLICY';assert.equal(validateV4CanonicalBinding(p).allowed,false);
});
