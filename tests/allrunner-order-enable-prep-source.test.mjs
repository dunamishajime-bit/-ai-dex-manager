import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("prep workflow is a separate protected non-order approval",()=>{
  const w=fs.readFileSync(".github/workflows/disdex-allrunner-order-enable-prep.yml","utf8");
  assert.match(w,/environment:\s*\n\s+name:\s*disdex-production/);
  assert.match(w,/github\.ref == 'refs\/heads\/master'/);
  assert.match(w,/github\.actor == 'dunamishajime-bit'/);
  assert.match(w,/ALL_RUNNERS_ORDER_ENABLE_PREP/);
  assert.match(w,/FULL_PROJECT/);
  assert.match(w,/--orders-enabled false/);
  assert.match(w,/ordersEnabled"\)\s+is\s+False|ordersEnabled.*false/s);
  assert.doesNotMatch(w,/--orders-enabled true/);
  assert.match(w,/StrictHostKeyChecking=yes/);
  assert.match(w,/install-disdex-allrunner-order-enable/);
  assert.match(w,/disdex-allrunner-order-enable-prep/);
});

test("prep helper cannot enable orders, restart services, or mutate activation json",()=>{
  const h=fs.readFileSync("scripts/ops/deploy/disdex_allrunner_order_enable_prep.py","utf8");
  assert.match(h,/daemon-reload/);
  assert.match(h,/MainPID/);
  assert.match(h,/NRestarts/);
  assert.match(h,/activation_snapshot/);
  assert.match(h,/ordersEnabled.*false|orders_enabled.*False/is);
  assert.doesNotMatch(h,/systemctl",\s*"restart"|systemctl.*restart/i);
  assert.doesNotMatch(h,/systemctl",\s*"start"|systemctl.*start/i);
  assert.doesNotMatch(h,/systemctl",\s*"stop"|systemctl.*stop/i);
  assert.doesNotMatch(h,/create_order|place_order|cancel_order|test_order/i);
  assert.doesNotMatch(h,/atomic_json|write.*operator-activation/i);
});
