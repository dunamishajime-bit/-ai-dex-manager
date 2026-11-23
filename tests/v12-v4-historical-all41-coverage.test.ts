import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
test("canonical original V4 BT has accepted examples for all 41 routes and all 37 TIME horizons",()=>{
 const file=join(process.cwd(),"docs/research/results/v4-production-cert-20261009/bt-baseline",
  "cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl");
 const ledger=readFileSync(file,"utf8").trim().split(/\r?\n/).map(s=>JSON.parse(s));
 const rows=ledger.filter(x=>x.strategy_id==="V12");
 assert.equal(ledger.length,1222);assert.equal(rows.length,828);
 const catalog=new Map(PRODUCTION_EXIT_CATALOG.map(x=>[x.route,x.spec]));
 assert.equal(catalog.size,41);
 const hits=new Set<string>();const kindCounts={TIME:0,ATR:0,NATIVE:0};
 for(const row of rows){
  const spec=catalog.get(row.route);
  assert.ok(spec,"Missing catalog route: "+row.route);
  hits.add(row.route);kindCounts[spec!.kind]++;
  if(spec!.kind==="TIME")
   assert.equal(row.planned_exit_ts_ms,row.entry_ts_ms+spec!.hours*3600000,
    "TIME exit horizon mismatch: "+row.route);
 }
 assert.equal(hits.size,41);
 assert.deepEqual(kindCounts,{TIME:746,ATR:44,NATIVE:38});
 // Historical coverage is necessary, NOT proof of exact live source parity.
});
