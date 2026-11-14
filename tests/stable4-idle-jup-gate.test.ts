import test from "node:test";
import assert from "node:assert/strict";
import {stable4IdleBlocks} from "../lib/disdex-stable4-idle";
const rel=-.04089204262472046,vol=1.2568362211142174;
const blocked=(mode:string,features?:unknown)=>(stable4IdleBlocks as any)(mode,"JUPUSDT",1800000000000,0,features);
test("JUP uses the exact causal relative and volume boundaries only in LIVE",()=>{
 assert.equal(blocked("LIVE",{rel24:rel,volumeRatio:vol}),false);
 assert.equal(blocked("LIVE",{rel24:rel-1e-12,volumeRatio:vol}),true);
 assert.equal(blocked("LIVE",{rel24:rel,volumeRatio:vol-1e-12}),true);
 for(const mode of ["OFF","SHADOW"])assert.equal(blocked(mode,{rel24:-1,volumeRatio:0}),false);
});
test("missing and non-finite JUP features fail closed without blocking unrelated routes",()=>{
 for(const f of [undefined,{}, {rel24:NaN,volumeRatio:vol},{rel24:rel,volumeRatio:Infinity}])assert.equal(blocked("LIVE",f),true);
 assert.equal(stable4IdleBlocks("LIVE","TIAUSDT",1800000000000,0),false);
});
