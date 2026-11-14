import test from "node:test";
import assert from "node:assert/strict";
import {extractStable4EntryFeatures,extractStable4StrategyEntryFeatures,scoreStable4Opportunity,type Stable4OpportunityLabel} from "../lib/stable4-opportunity-model";
const H=3600000,T=1800000000000;
const candidate={strategy:"V52",symbol:"NVDAUSDT",side:"SHORT" as const,route:"V50_POST_OPEN_BASIS",entryTs:T,gross:2,expectedHoldHours:3,features:{entry_basis_bps:110,capture_basis_bps:145}};
const rows:Stable4OpportunityLabel[]=Array.from({length:40},(_,i)=>({...candidate,id:String(i),entryTs:T-(i+3)*24*H,exitTs:T-(i+2)*24*H,net30:i%4===0?-.01:.03,features:{entry_basis_bps:100+i,capture_basis_bps:130+i}}));
test("shared entry feature extraction excludes exit/outcome fields and preserves causal nested names",()=>{
 assert.deepEqual(extractStable4EntryFeatures({entry_basis_bps:110,capture_basis_bps:145,exit_basis_bps:5,features:{ret24:.02,volumeRatio:2,exit_return24:9,return72h:.04},realized:{return24h:9},exit:{atr:9},flag:true}),{entry_basis_bps:110,capture_basis_bps:145,"features.ret24":.02,"features.volumeRatio":2,"features.return72h":.04});
 assert.deepEqual(extractStable4StrategyEntryFeatures("V52",{entry_basis_bps:110,capture_basis_bps:145,exit_basis_bps:5,atrAtExit:9,rank:30}),{capture_basis_bps:145,entry_basis_bps:110});
 assert.throws(()=>extractStable4StrategyEntryFeatures("unknown",{}),/STRATEGY_SCHEMA/);
});
test("opportunity model uses same-strategy side outcomes completed strictly before entry",()=>{
 const base=scoreStable4Opportunity(candidate,rows);
 assert.ok(base.opportunityScore!>0);assert.ok(base.confidence!>0);assert.equal(base.analogs,40);
 const unavailable=[{...rows[0],id:"same-boundary",exitTs:T,net30:100},{...rows[0],id:"future",entryTs:T+H,exitTs:T+2*H,net30:100},{...rows[0],id:"other-strategy",strategy:"HYPE",net30:100},{...rows[0],id:"other-side",side:"LONG" as const,net30:100}];
 assert.deepEqual(scoreStable4Opportunity(candidate,[...rows,...unavailable]),base);
 assert.equal(base.opportunityScore,base.predEV30!*base.confidence!/2/.25);
});
test("unscored opportunity remains explicitly unknown and invalid numeric features fail closed",()=>{
 assert.equal(scoreStable4Opportunity(candidate,[]).opportunityScore,null);
 assert.throws(()=>scoreStable4Opportunity({...candidate,features:{entry_basis_bps:NaN}},rows),/FEATURE/);
 assert.throws(()=>scoreStable4Opportunity(candidate,[{...rows[0],exitTs:rows[0].entryTs}]),/CHRONOLOGY/);
});
