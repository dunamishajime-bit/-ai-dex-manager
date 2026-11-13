import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script=fs.readFileSync("scripts/ops/deploy/disdex_v4_doge_manual_close_reconcile.ts","utf8");
const workflow=fs.readFileSync(".github/workflows/disdex-v4-doge-manual-close-reconcile.yml","utf8");

test("manual DOGE reconciliation is exact and non-ordering",()=>{
  for(const token of [
    "DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000",
    "v12-v4-98ded39746ed3502a4d7b0e26ef9",
    "53a0be396719f0284af4e11b35c66a4ac7d58f79",
    "3169513690","23900268","0.07497","1.2543",
    "MANUAL_ASTER_CLOSE","PLANNED_TIME_EXIT_MANUAL_SETTLEMENT",
  ]) assert.match(script,new RegExp(token.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&")));
  assert.match(script,/getPositions\("DOGEUSDT"\)/);
  assert.match(script,/getOpenOrders\("DOGEUSDT"\)/);
  assert.match(script,/getUserTrades\("DOGEUSDT"/);
  assert.doesNotMatch(script,/\.(?:placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType)\(/);
});

test("workflow is owner-bound and runs read-only postflight",()=>{
  assert.match(workflow,/github\.actor == 'dunamishajime-bit'/);
  assert.match(workflow,/github\.event\.issue\.number == 317/);
  assert.match(workflow,/DISDEX_RECONCILE_DOGE_MANUAL_CLOSE_20261102/);
  assert.match(workflow,/disdex-production/);
  assert.match(workflow,/V4_QUIESCED=TRUE/);
  assert.match(workflow,/disdex_v4_doge_operator_postflight\.py/);
  assert.match(workflow,/ASTER_ORDERS_SENT=0/);
  assert.match(workflow,/ASTER_CANCELS_SENT=0/);
  assert.match(workflow,/ASTER_POSITION_CHANGES_SENT=0/);
});
