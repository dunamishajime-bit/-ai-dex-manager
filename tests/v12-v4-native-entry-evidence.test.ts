import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG,nativeEvidenceForProductionRoute} from "../lib/v12-v4-production-lifecycle";
test("native EXIT provenance is attached to catalog Native route, never failed-break TIME candidate",()=>{
 const native=PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind==="NATIVE");
 assert.equal(native.length,1);
 assert.equal(native[0].route,"REC_G3_LATE_BTC_REL");
 assert.equal(nativeEvidenceForProductionRoute(native[0].route),"WR60_BASELINE_1978_PARITY");
 for(const r of PRODUCTION_EXIT_CATALOG.filter(r=>r.spec.kind!=="NATIVE")){
  assert.equal(nativeEvidenceForProductionRoute(r.route),undefined);
 }
 assert.equal(nativeEvidenceForProductionRoute("FAILED_BREAK_REV_SHORT_6H"),undefined);
});
