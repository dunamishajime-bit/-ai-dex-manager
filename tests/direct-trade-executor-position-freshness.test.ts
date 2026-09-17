import assert from "node:assert/strict";
import test from "node:test";

import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import type { AsterV3Client } from "../lib/aster-v3-client";

test("position snapshot freshness uses observation time, not the last position mutation time", async () => {
  const lastPositionMutation = Date.now() - 4 * 60 * 60 * 1000;
  const client = {
    getPositions: async () => [{
      symbol: "PENGUUSDT",
      positionAmt: "4354",
      entryPrice: "0.006938",
      markPrice: "0.00698",
      unRealizedProfit: "0.19",
      positionSide: "BOTH" as const,
      leverage: "5",
      marginType: "cross",
      updateTime: lastPositionMutation,
    }],
  } as unknown as AsterV3Client;

  const observedBeforeRead = Date.now();
  const [position] = await new AsterDirectTradeExecutor(client).getPositions();

  assert.ok(position);
  assert.ok(position.updatedAt >= observedBeforeRead);
  assert.ok(position.updatedAt < Date.now() + 1000);
});
