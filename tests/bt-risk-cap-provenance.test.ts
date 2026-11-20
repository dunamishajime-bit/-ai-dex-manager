import test from "node:test";
import assert from "node:assert/strict";
import {auditedRiskSourceDifferences} from "../lib/bt-verification/risk-cap-provenance";
import storedV4 from "../docs/research-results/BT_V4_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json";
import storedHype from "../docs/research-results/BT_HYPE_SOURCE_GROSS_CAP_DRIFT_20261119_UNCERTIFIED.json";

test("audited historical model vs pinned source gross caps return 4 differential rows",()=>{
 const rows=auditedRiskSourceDifferences(storedHype,storedV4);
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(x=>x.difference),[2.5,0.75,1.0,1.25]);
});
test("risk evidence with claimed certification or actual overrun fails closed",()=>{
 assert.deepEqual(auditedRiskSourceDifferences({...storedHype,production_bt_parity_certified:true},storedV4),[]);
 assert.deepEqual(auditedRiskSourceDifferences(storedHype,{...storedV4,actual_exchange_gross_excess_verified:true}),[]);
});
test("source value arithmetic inconsistency fails closed",()=>{
 const mutated=structuredClone(storedV4);
 mutated.caps.totalGrossCap.delta_x=0;
 assert.deepEqual(auditedRiskSourceDifferences(storedHype,mutated),[]);
});
test("missing source verification fails closed",()=>{
 assert.deepEqual(auditedRiskSourceDifferences({...storedHype,live_static_source_bytes_verified_from_vps:false},storedV4),[]);
});
