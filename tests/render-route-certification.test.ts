import assert from "node:assert/strict";
import test from "node:test";
import { assertRenderIndependentCert } from "../lib/render-route-certification";

const sha = "a".repeat(40);
const valid = {
  schema: "disdex-render-independent-venue-certificate/v1",
  approvedSha: sha,
  route: "IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT",
  gross: 0.75,
  holdMinutes: 360,
  stopPct: 2,
  takeProfitPct: 2.5,
  venueStopReadback: true,
  partialFillVerified: true,
  timeoutExitVerified: true,
  integrated10And30BpsVerified: true,
  operatorApproval: "APPROVE_RENDER_INDEPENDENT_SHORT_AT_BOUND_SHA",
};

test("independent RENDER certificate is exact-contract and SHA bound", () => {
  assert.doesNotThrow(() => assertRenderIndependentCert(valid, sha));
  assert.throws(() => assertRenderIndependentCert({ ...valid, approvedSha: "b".repeat(40) }, sha), /UNPROVEN/);
  assert.throws(() => assertRenderIndependentCert({ ...valid, holdMinutes: 55 }, sha), /UNPROVEN/);
  assert.throws(() => assertRenderIndependentCert({ ...valid, venueStopReadback: false }, sha), /UNPROVEN/);
});
