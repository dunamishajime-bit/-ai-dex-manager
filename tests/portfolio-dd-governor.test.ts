import assert from "node:assert/strict";
import test from "node:test";
import { initialPortfolioDdGovernor, updatePortfolioDdGovernor, quality102GovernorGross } from "../lib/disdex-portfolio-dd-governor";

const t=1_800_000_000_000;
const row=(time:number,type:string,income:number,symbol="FETUSDT",tranId=String(time)+type)=>({time,incomeType:type,income:String(income),asset:"USDT",symbol,tranId});

test("governor starts at high-water and boosts Q102 to 3.0x at DD <=0.30%",()=>{
 const s=initialPortfolioDdGovernor(t,1000,[]);
 assert.equal(s.currentDrawdownPct,0);
 assert.deepEqual(quality102GovernorGross(1.661,s,t),{gross:3,boosted:true,reason:"DD_WITHIN_0P30"});
});

test("closed-event TWR accumulates commission and funding then gates above 0.30%",()=>{
 let s=initialPortfolioDdGovernor(t,1000,[]);
 s=updatePortfolioDdGovernor(s,[row(t+1000,"COMMISSION",-1),row(t+2000,"FUNDING_FEE",-1),row(t+3000,"REALIZED_PNL",-2)],t+4000);
 assert.equal(s.closedEvents,1);
 assert.ok(Math.abs(s.virtualEquityUsd-996)<1e-9);
 assert.ok(s.currentDrawdownPct>0.30);
 const g=quality102GovernorGross(2.465,s,t+4000);
 assert.equal(g.gross,2.465); assert.equal(g.boosted,false); assert.equal(g.reason,"DD_OVER_0P30");
});

test("new peak resets current DD and duplicate income is idempotent",()=>{
 let s=initialPortfolioDdGovernor(t,1000,[]);
 const loss=[row(t+1000,"REALIZED_PNL",-2)];
 s=updatePortfolioDdGovernor(s,loss,t+2000);
 const once=s.twrIndex;
 s=updatePortfolioDdGovernor(s,loss,t+3000);
 assert.equal(s.twrIndex,once);
 s=updatePortfolioDdGovernor(s,[row(t+4000,"REALIZED_PNL",10)],t+5000);
 assert.equal(s.currentDrawdownPct,0);
 assert.ok(s.twrPeak>1);
});

test("stale governor never boosts",()=>{
 const s=initialPortfolioDdGovernor(t,1000,[]);
 const g=quality102GovernorGross(1,s,t+180_000);
 assert.equal(g.gross,1); assert.equal(g.boosted,false); assert.equal(g.reason,"GOVERNOR_STALE");
});
