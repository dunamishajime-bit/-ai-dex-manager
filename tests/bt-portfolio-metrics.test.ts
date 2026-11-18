import {test} from "node:test";
import {strict as assert} from "node:assert";
import {portfolioMetrics} from "../lib/bt-verification/portfolio-metrics";
import type {ReplayFrame} from "../lib/bt-verification/replay";
const frame=(date:string,equity:number,netDepositsJpy=0):ReplayFrame=>({
 timestamp:date,btc:null,equity,realized:0,positions:[],events:[],netDepositsJpy
});
test("deposits alone generate zero trading profit and zero drawdown",()=>{
 const f=[frame("2026-01-01T00:00:00Z",10000),frame("2026-02-01T00:00:00Z",15000,5000),
   frame("2026-03-01T00:00:00Z",20000,10000)];
 const result=portfolioMetrics(f,2);
 assert.equal(result.tradingProfit,0);assert.equal(result.maxDD,0);
 assert.equal(result.netDeposits,10000);
});
test("returns and drawdown are unitized across contributions",()=>{
 const f=[frame("2026-01-01T00:00:00Z",10000),frame("2026-02-01T00:00:00Z",11000),
 frame("2026-03-01T00:00:00Z",21000,10000),
 frame("2026-04-01T00:00:00Z",18900,10000)];
 const r=portfolioMetrics(f,3);
 assert.equal(r.tradingProfit,-1100);
 assert.ok(r.maxDD<0);
 assert.ok(Math.abs(r.maxDD+10)<1e-6);
});
test("nonmonotonic external deposits fail rather than inflate returns",()=>{
 assert.throws(()=>portfolioMetrics([frame("2026-01-01T00:00:00Z",10000,1000),
  frame("2026-01-02T00:00:00Z",9000,0)],1),/NONMONOTONIC/);
});