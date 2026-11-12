import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const helper=fs.readFileSync("scripts/ops/deploy/disdex_stopped_runner_live_recovery.py","utf8");
const workflow=fs.readFileSync(".github/workflows/disdex-stopped-runner-live-recovery.yml","utf8");

test("recovery helper is exact-pinned and starts only the three stopped LIVE runners",()=>{
  for(const token of [
    "3ad65403013b701db5d9e53e8814e6ab827a28e8",
    "1657e173d250ad58f53e62f7bb0a3428fb405496",
    "d6bcc94512a6416189cd92d7203b9ac3b2c98e70",
    "7688ed7c93a1918d8b44837339b7da5584a868f5",
    "ef1ab178e26a7bf5bddb6473467765edba242e1d",
    "8495daf24e53a6cf0dd5e38f022008fa8f78c688",
    "2737c30e1f6d014d24a2c6d025e7f91332bf7962",
    'START_ORDER = ("PENGU_V8", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT")',
    "OPERATOR_ACTIVATION_READY",
    "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
    "V4_DID_NOT_UNBLOCK",
    '["systemctl", "start", unit]',
  ]) assert.ok(helper.includes(token),token);
  assert.doesNotMatch(helper,/placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType/);
  assert.doesNotMatch(helper,/\["systemctl", "(?:stop|restart)"/);
  assert.ok(helper.includes('"testOrdersSent": 0'));
  assert.ok(helper.includes('"forcedOrdersSent": 0'));
  assert.ok(helper.includes('"stopChangesByHelper": 0'));
  assert.ok(helper.includes('"killSwitchChangesByHelper": 0'));
  assert.ok(helper.includes('"activationChangesByHelper": 0'));
});

test("workflow is owner/environment bound and uses unified production concurrency",()=>{
  assert.match(workflow,/github\.actor == 'dunamishajime-bit'/);
  assert.match(workflow,/name: disdex-production/);
  assert.match(workflow,/group: disdex-unified-production/);
  assert.match(workflow,/disdex_stopped_runner_live_recovery\.py/);
  assert.match(workflow,/STOPPED_RUNNER_RECOVERY_ACTION=PASS/);
  assert.doesNotMatch(workflow,/systemctl (?:stop|restart)/);
});
