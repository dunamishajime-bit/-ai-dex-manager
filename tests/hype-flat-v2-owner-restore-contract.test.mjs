import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const helper=fs.readFileSync("scripts/ops/deploy/disdex_hype_sha_flat_restore.py","utf8");
const contract=fs.readFileSync("scripts/ops/deploy/disdex_hype_sha_flat_restore_contract.py","utf8");
const venue=fs.readFileSync("scripts/ops/deploy/disdex_hype_sha_flat_restore_venue.py","utf8");
const workflow=fs.readFileSync(".github/workflows/disdex-hype-flat-v2-owner-restore.yml","utf8");
const request=fs.readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml","utf8");

test("flat-v2 restore is exact-SHA, 3x signed-flat, two-approval and fail-closed",()=>{
  for(const t of [
    "d6bcc94512a6416189cd92d7203b9ac3b2c98e70",
    "a7eee1f91d86d51f2333da117243d044ae1332dc",
    "3ad65403013b701db5d9e53e8814e6ab827a28e8",
    "SIGNED_ASTER_FLAT_3X","HYPE_TREND_LONG_SHA_RESTORE","V4_HYPE_PEER_PIN_CONTINUITY"
  ]) assert.ok(contract.includes(t)||workflow.includes(t),t);
  assert.match(venue,/signedVenueReads:3/);
  assert.match(venue,/positions\.length!==0\|\|orders\.length!==0/);
  assert.match(venue,/HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT/);
  assert.match(venue,/replayProductionJournal/);
  assert.doesNotMatch(venue,/placeMarketOrder|placeConditionalOrder|placeStopMarketOrder|cancelOrder|setLeverage|setMarginType/);
  assert.match(workflow,/approval_id:/);
  assert.match(workflow,/v4_approval_id:/);
  assert.match(workflow,/name: disdex-production/);
  assert.match(request,/HYPE_TREND_LONG_SHA_RESTORE/);
  assert.match(request,/V4_HYPE_PEER_PIN_CONTINUITY/);
  assert.match(request,/HYPE_SHA_FLAT_RESTORE_V2/);
  assert.doesNotMatch(helper,/XRPUSDT_SHORT_13\.3|v12-v4-231ed20b6835c4148b5314d8da7e/);
});
