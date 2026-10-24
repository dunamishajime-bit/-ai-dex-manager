import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("V52 decision status exposes the AMZN SHORT Yahoo gate evidence", async () => {
  const [panel, observability] = await Promise.all([
    readFile(new URL("../components/features/DecisionStatusPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/v52-top2-observability.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /AMZN SHORT \/ Yahoo 前NYSE営業日比 Gate/);
  assert.match(panel, /AMZN_SHORT_YAHOO_PREV_CLOSE_GT_1PCT/);
  assert.match(panel, /DATA_UNAVAILABLE（Fail Closed）/);
  assert.match(observability, /amznShortYahooGate\?: V52AmznShortYahooGate/);
  assert.match(observability, /latestConfirmedYahooReferencePrice/);
});
