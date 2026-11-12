import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script=fs.readFileSync("scripts/ops/deploy/disdex_v4_xrp_manual_close_reconcile.ts","utf8");
const workflow=fs.readFileSync(".github/workflows/disdex-v4-xrp-manual-close-reconcile.yml","utf8");

test("XRP manual-close reconciliation is exact and non-ordering",()=>{
  for(const token of [
    "XRPUSDT:REC_X06_TIME_12H:SHORT:1794067200000",
    "v12-v4-231ed20b6835c4148b5314d8da7e",
    "3ad65403013b701db5d9e53e8814e6ab827a28e8",
    "21785120","4143469655","21843239","4154566371","4143471979",
    "1.1581","1.0508","1.42709","0.00559025","0.01518936",
    "BT_REPAIR_FIXED_18H_NEXT_OPEN","reconcileV4ExternalFlatClose","TERMINAL","1794452508281",
  ]) assert.match(script,new RegExp(token.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&")));
  assert.match(script,/getPositions\(\)/);
  assert.match(script,/getOpenOrders\(\)/);
  assert.match(script,/getUserTrades\("XRPUSDT"/);
  assert.match(script,/getOrder\("XRPUSDT",STOP_CLIENT_ID\)/);
  assert.doesNotMatch(script,/\.(?:placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType)\(/);
  assert.match(script,/ordersSent:0/);
  assert.match(script,/cancelsSent:0/);
  assert.match(script,/positionChangesSent:0/);
  assert.match(script,/RUNNER_NOT_FAIL_CLOSED_BLOCKED/);
  assert.match(script,/V12_V4_XRP_MANUAL_CLOSE_RECONCILE/);
  assert.match(script,/account-order\.lock/);
  assert.match(script,/compatibilityDoc/);
  assert.match(script,/stage:"ACKNOWLEDGED"/);
  assert.match(script,/durableTerminalStop/);
  assert.match(script,/reconcileV4ExternalFlatClose/);
  assert.match(script,/process\.argv\.includes\("--preview"\)/);
  assert.match(script,/V4_XRP_MANUAL_RECONCILE_PREVIEW_PASS/);
  assert.match(script,/registryWrites:0/);
  assert.doesNotMatch(script,/applyProductionEvent/);
  assert.doesNotMatch(script,/advanceV4Protection/);
});

test("workflow is owner/environment bound and requires V4 fail-closed blocked",()=>{
  assert.match(workflow,/github\.actor == 'dunamishajime-bit'/);
  assert.match(workflow,/environment:/);
  assert.match(workflow,/name: disdex-production/);
  assert.match(workflow,/systemctl is-active disdex-v12-v4@3ad65403013b701db5d9e53e8814e6ab827a28e8\.service/);
  assert.match(workflow,/V4_FAIL_CLOSED_AND_PENDING_FLAT_FRESH=TRUE/);
  assert.match(workflow,/V4_PEER_ATTESTATION_RETRY_REQUIRED/);
  assert.doesNotMatch(workflow,/systemctl (?:stop|start|restart) disdex-v12-v4@/);
  assert.match(workflow,/runuser -u deploy/);
  assert.match(workflow,/ASTER_ORDERS_SENT=0/);
  assert.match(workflow,/ASTER_CANCELS_SENT=0/);
  assert.match(workflow,/ASTER_POSITION_CHANGES_SENT=0/);
});
