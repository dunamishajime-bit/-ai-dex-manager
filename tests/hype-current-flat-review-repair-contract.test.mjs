import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const h=fs.readFileSync("scripts/ops/deploy/disdex_hype_current_flat_review_repair.ts","utf8");
const w=fs.readFileSync(".github/workflows/disdex-hype-current-flat-review-repair.yml","utf8");

test("HYPE repair is incident-bound, idempotent and state-only",()=>{
  for(const x of [
    "d6bcc94512a6416189cd92d7203b9ac3b2c98e70",
    "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT",
    "XRPUSDT:REC_X06_TIME_12H:SHORT:1794067200000",
    "HYPE_CURRENT_FLAT_REVIEW_REPAIRED_AFTER_SIGNED_SCOPED_FLAT",
    "HYPE_CURRENT_FLAT_REVIEW_REPAIR_ALREADY_COMPLETE",
    "FileAccountOrderLock","HYPEUSDT","ZECUSDT",
  ]) assert.ok(h.includes(x),x);
  assert.doesNotMatch(h,/\.(?:placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType)\(/);
  assert.match(h,/ordersSent:0/);
  assert.match(h,/cancelsSent:0/);
  assert.match(h,/positionChangesSent:0/);
});

test("workflow is production-bound and starts only the exact HYPE unit without heredoc",()=>{
  assert.match(w,/github\.actor == 'dunamishajime-bit'/);
  assert.match(w,/name: disdex-production/);
  assert.match(w,/disdex-hype-long@d6bcc94512a6416189cd92d7203b9ac3b2c98e70\.service/);
  assert.match(w,/systemctl start "\$U"/);
  assert.match(w,/TEST_ORDERS_SENT=0/);
  assert.doesNotMatch(w,/python3 - <</);
});
