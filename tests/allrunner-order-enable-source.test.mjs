import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = () => fs.readFileSync(".github/workflows/disdex-allrunner-order-enable.yml","utf8");
const helper = () => fs.readFileSync("scripts/ops/deploy/disdex_allrunner_order_enable.py","utf8");
const installer = () => fs.readFileSync("scripts/ops/root/install-disdex-allrunner-order-enable","utf8");

test("order-enable workflow is protected and redeems only ALL_RUNNERS_ORDER_ENABLE", () => {
  const w = workflow();
  assert.match(w,/environment:\s*\n\s+name:\s*disdex-production/);
  assert.match(w,/github\.ref == 'refs\/heads\/master'/);
  assert.match(w,/github\.actor == 'dunamishajime-bit'/);
  assert.match(w,/action["']?\s*:\s*["']redeem["']/);
  assert.match(w,/ALL_RUNNERS_ORDER_ENABLE/);
  assert.match(w,/FULL_PROJECT/);
  assert.match(w,/ordersEnabled["']?\]\s+is True|ordersEnabled.*true|orders-enabled true/s);
  assert.match(w,/disdex_owner_approval\.py verify/);
  assert.match(w,/DISDEX_HP_APPROVER_PUBLIC_KEY_PEM/);
  assert.match(w,/\/usr\/local\/sbin\/disdex-allrunner-order-enable/);
  assert.doesNotMatch(w,/scp .*disdex_allrunner_order_enable\.py/s);
  assert.match(w,/StrictHostKeyChecking=yes/);
  assert.match(w,/--read-approval-stdin/);
  assert.match(w,/sha256sum -c/);
  assert.ok(
    w.indexOf("Verify installed root-owned executor identity before redemption") <
      w.indexOf("Redeem separate ALL_RUNNERS_ORDER_ENABLE approval"),
    "installed root-owned identity must be proven before approval redemption",
  );
});

test("root helper is fail-closed and never mutates venue or kill switch", () => {
  const h = helper();
  assert.match(h,/FINAL_ALL_RUNNERS_AUDIT/);
  assert.match(h,/kill-switch\.json/);
  assert.match(h,/crypto-daily-risk\.json/);
  assert.match(h,/pending-exposure\.json/);
  assert.match(h,/validate_activation_wiring/);
  assert.match(h,/consume.*nonce|nonce_dir|approval replay/i);
  assert.match(h,/publish_activation_transaction/);
  assert.doesNotMatch(h,/cancelOrder|cancel_order|createOrder|create_order|placeOrder|place_order/);
  assert.doesNotMatch(h,/kill.*active.*=.*false/i);
});

test("installer pins root-owned helper and supporting verifier modules", () => {
  const i = installer();
  assert.match(i,/install -o root -g root -m 0755/);
  assert.match(i,/disdex-allrunner-order-enable/);
  assert.match(i,/disdex_owner_approval\.py/);
  assert.match(i,/disdex_deployment_contract\.py/);
  assert.match(i,/disdex_allrunner_final_verify\.py/);
  assert.match(i,/sha256sum|SHA256/);
});
