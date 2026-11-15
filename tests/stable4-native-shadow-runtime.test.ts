import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {STABLE4_NATIVE_SHADOW_PARTITION_PATHS,STABLE4_NATIVE_POLICY_FILES,computeStable4NativePolicySourceDigest,createStable4FetNativeShadowObserver,createStable4IdleNativeShadowObserver} from "../lib/stable4-native-shadow-runtime";
const SHA="a".repeat(40);
test("runtime uses the exact preinitialized per-framework canonical paths",()=>{
 assert.equal(STABLE4_NATIVE_SHADOW_PARTITION_PATHS.FET,"/var/lib/disdex/shared/stable4-native-shadow/FET.json");
 assert.equal(STABLE4_NATIVE_SHADOW_PARTITION_PATHS.IDLE,"/var/lib/disdex/shared/stable4-native-shadow/IDLE.json");
});
test("reviewed real native policy byte changes alter the bound digest while ordering does not",()=>{
 for(const strategy of ["FET","IDLE"] as const){
  const sources=STABLE4_NATIVE_POLICY_FILES[strategy].map(path=>({path,bytes:readFileSync(resolve(__dirname,"..",path))}));
  const digest=computeStable4NativePolicySourceDigest(strategy,sources);assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(computeStable4NativePolicySourceDigest(strategy,[...sources].reverse()),digest);
  const changed=sources.map((s,i)=>({...s,bytes:i===0?Buffer.concat([s.bytes,Buffer.from("\n// changed")]):s.bytes}));
  assert.notEqual(computeStable4NativePolicySourceDigest(strategy,changed),digest);
  assert.throws(()=>computeStable4NativePolicySourceDigest(strategy,sources.slice(1)));
  assert.throws(()=>computeStable4NativePolicySourceDigest(strategy,[...sources,sources[0]]));
 }
});
test("OFF and SHADOW create no observer and perform no source/store IO",()=>{
 for(const mode of ["OFF","SHADOW",undefined] as const){assert.equal(createStable4FetNativeShadowObserver(mode,"invalid"),undefined);assert.equal(createStable4IdleNativeShadowObserver(mode,"invalid"),undefined);}
});
test("LIVE observer construction is lazy and unavailable immutable source rejects only observation",async()=>{
 const fet=createStable4FetNativeShadowObserver("LIVE",SHA),idle=createStable4IdleNativeShadowObserver("LIVE",SHA);
 assert.equal(typeof fet,"function");assert.equal(typeof idle,"function");
 // This checkout has no immutable production marker for the requested SHA.
 // Construction must still succeed, so callers' detached hooks can report the
 // rejection without disabling native entries, exits or resident protection.
 await assert.rejects(fet!({rows:[],decisionTs:1800000000000,capturedAt:1800000000000}),/SOURCE/);
 await assert.rejects(idle!({market:{decisionTs:1800000000000,btc:[],symbols:{} as any,residualSymbols:{} as any},signals:[],capturedAt:1800000000000}),/SOURCE/);
});
