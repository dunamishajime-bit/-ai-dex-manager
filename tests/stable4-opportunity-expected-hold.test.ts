import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import * as hold from "../lib/stable4-opportunity-expected-hold";
const expected=(input:any)=>{const f=(hold as any).expectedStable4OpportunityHoldHours;assert.equal(typeof f,"function");return f(input);};
const input=(strategy="V4",route="UNKNOWN",entrySnapshot:any={},side="LONG")=>({strategy,route,entrySnapshot,side});
test("frozen precedence prefers explicit hold metadata then strategy metadata before route heuristics",()=>{
 assert.equal(expected(input("V4","TIME_72H",{holdHours:8,maxHoldHours:12})),8);
 assert.equal(expected(input("PENGU","RECOVERY_V8",{longMaxHoldHours:120,shortMaxHoldHours:72})),120);
 assert.equal(expected(input("PENGU","SHORT_V20",{longMaxHoldHours:120,shortMaxHoldHours:72},"SHORT")),72);
 assert.equal(expected(input("HYPE","HYPE_REDESIGN_CAUSAL_H48R4_WSIG")),48);
 assert.equal(expected(input("V52","V50_POST_OPEN_BASIS",{entry_ts_ms:1000,forced_flat_ms:7201000})),2);
 assert.equal(expected(input("HYPE","HYPE_REDESIGN_CAUSAL_H48R4_WSIG",{maxHoldHours:9})),9);
});
test("score expectation preserves frozen naming quirks independently of repaired production exits",()=>{
 for(const [route,hours]of [["FAILED_BREAK_REV_SHORT_6H",24],["CONT_SHORT_MID_AGE24_48",24],["REC_G3_LATE_BTC_REL",24],["REC_X06_TIME_12H",12],["REC_X07_TIME_6H",6],["REC_Y06_REV_D0_T72",72],["REC_X13_TP1.5_SL1_H24",24],["NEAR|BRK48_H48_V1.2",48],["Q102_AVAX_ONLINE_KNN_STOP5_TP3_Q01365",24]] as const)assert.equal(expected(input("V4",route)),hours,route);
 assert.equal(expected(input("V4","TIME_0H")),1);assert.equal(expected(input("FET","FET_BRK48_RESIDUAL",{holdHours:.5})),1);
 assert.equal(expected(input("V4","TIME_12H_H48_T72")),12);
 assert.equal(expected(input("V4","UNKNOWN",{holdHours:"72"})),24);
});
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
const source=join(root,"DIRECTION_RESEARCH_20261109/three_layer_layer1_all_candidates_20261114.jsonl"),reference=join(root,"DIRECTION_RESEARCH_20261109/three_layer_layer2_online_ensemble_20261114.jsonl");
test("all 2892 frozen research expected horizons reproduce exactly",{skip:!existsSync(source)||!existsSync(reference)},()=>{
 const parse=(path:string)=>readFileSync(path,"utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x));const refs=new Map(parse(reference).map(x=>[x.id,x]));const rows=parse(source);assert.equal(rows.length,2892);
 for(const x of rows)assert.equal(expected(input(x.strategy,x.route,x.v,x.side)),refs.get(x.id).expectedHoldHours,x.id);
});
