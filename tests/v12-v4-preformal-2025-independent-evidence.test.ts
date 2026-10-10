import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
const file="docs/ops/v12-v4-cert-20261009/";
const source=readFileSync(file+"preformal-2025-native-route-coverage.json");
const ts=JSON.parse(String(source));
const py=JSON.parse(readFileSync(file+"preformal-2025-independent-exit-check.json","utf8"));
const ext=JSON.parse(readFileSync(file+"native-route-parity-after.json","utf8"));
test("16 previously external-absent routes gain 11 preformal observed opportunities, five remain unobserved",()=>{
 const all=PRODUCTION_EXIT_CATALOG.map(x=>x.route);
 const extRoutes=new Set(ext.actual.map((x:{route:string})=>x.route));
 assert.equal(extRoutes.size,25);
 const missing=all.filter(x=>!extRoutes.has(x));
 assert.equal(missing.length,16);
 assert.equal(ts.status,"READ_ONLY_PRE_FORMAL_ROUTE_OBSERVATION");
 assert.equal(ts.historicalPreFormalPeriod.start,"2025-01-13");
 assert.equal(ts.historicalPreFormalPeriod.endExclusive,"2025-08-10");
 assert.equal(ts.notPristineIndependentForward,true);
 assert.equal(ts.observedRoutes,11);
 assert.equal(ts.results.length,16);
 assert.deepEqual(new Set(ts.results.map((x:{route:string})=>x.route)),new Set(missing));
 assert.equal(ts.candidateRecords.length,178);
 assert.equal(new Set(ts.candidateRecords.map((c:{route:string;symbol:string;side:string;entryTs:number})=>
  [c.route,c.symbol,c.side,c.entryTs].join("|"))).size,178);
 assert.equal(ts.results.filter((x:{candidates:number})=>x.candidates===0).length,5);
 assert.equal(ts.orderEnabled,undefined);
 assert.equal(ts.ordersSent,0);assert.equal(ts.tradingMutation,0);
});
test("178 preformal independent Python Exit decisions match Production price-model proof digest",()=>{
 assert.equal(py.status,"PASS_PRE_FORMAL_INDEPENDENT_H1_EXITS");
 assert.equal(py.sourceSha256,createHash("sha256").update(source).digest("hex"));
 assert.equal(py.candidateCount,178);assert.equal(py.matched,178);
 assert.deepEqual(py.kindCounts,{ATR:38,TIME:140});
 assert.deepEqual(py.errors,[]);
 assert.equal(py.ordersSent,0);assert.equal(py.tradingMutation,0);
});
