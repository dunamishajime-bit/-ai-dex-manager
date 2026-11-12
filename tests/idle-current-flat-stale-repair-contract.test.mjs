import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h=fs.readFileSync("scripts/ops/deploy/disdex_idle_current_flat_stale_repair.py","utf8");
const w=fs.readFileSync(".github/workflows/disdex-idle-current-flat-stale-repair.yml","utf8");

test("IDLE repair is exact-current, flat-only, exact-timeout-only and no venue mutation",()=>{
  for(const t of [
    "7688ed7c93a1918d8b44837339b7da5584a868f5",
    "3ad65403013b701db5d9e53e8814e6ab827a28e8",
    "IDLE_PRIORITY_SHORT",
    "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
    "IDLE_RUNNER_FAIL_CLOSED:Aster request timeout after 10000ms",
    "IDLE_BENIGN_SIGNED_FLAT_TIMEOUT_RECOVERY",
    '["systemctl","reset-failed",IDLE_UNIT]',
    '["systemctl","start",IDLE_UNIT]'
  ]) assert.ok(h.includes(t),t);
  assert.doesNotMatch(h,/placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType/);
  assert.match(h,/req\(review==TIMEOUT_REVIEW,"IDLE_CORE_REVIEW_NOT_EXACT_TIMEOUT"\)/);
  assert.match(h,/d\["manualReview"\]=None/);
  assert.match(h,/d\["updatedAt"\]=now/);
  assert.match(w,/name: disdex-production/);
});
