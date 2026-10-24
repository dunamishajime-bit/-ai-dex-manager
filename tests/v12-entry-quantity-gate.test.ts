import assert from "node:assert/strict";
import test from "node:test";

import { isV12BenignEntryQuantityGateError } from "../lib/v12-live-execution-engine";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";

test("V12 classifies an Aster minQty rejection as a non-order capacity gate", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Quantity 0.000795 is below Aster minQty 0.001 for BTCUSDT."),
    ),
    true,
  );
});

test("V12 classifies an Aster minNotional rejection as a non-order capacity gate", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Notional 4.8721 is below Aster minimum 5 for ETHUSDT."),
    ),
    true,
  );
});

test("V12 accepts scientific notation in venue-minimum errors", () => {
  assert.equal(
    isV12BenignEntryQuantityGateError(
      new Error("Quantity 7.95e-4 is below Aster minQty 1e-3 for BTCUSDT."),
    ),
    true,
  );
});

test("V12 does not downgrade unknown venue errors into a no-op", () => {
  assert.equal(isV12BenignEntryQuantityGateError(new Error("Aster exchange info unavailable.")), false);
});

test("V12 does not downgrade unrelated quantity errors", () => {
  assert.equal(isV12BenignEntryQuantityGateError(new Error("Quantity mismatch after fill.")), false);
});

test("shared V12 entry transport rejects a missing approved notional ceiling before executeMarket", async () => {
  const saved = Object.fromEntries([
    "DISDEX_SHARED_KILL_SWITCH_FILE",
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
    "DISDEX_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
  ].map((name) => [name, process.env[name]]));
  for (const name of Object.keys(saved)) delete process.env[name];
  try {
    const adapter = new V12AsterLiveAdapter({} as any);
    let executeCalls = 0;
    (adapter.executor as any).executeMarket = async () => {
      executeCalls += 1;
      return { status: "FILLED", executedQuantity: 1, executionUnknown: false };
    };
    for (const maxEntryNotionalUsd of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      await assert.rejects(() => adapter.executeEntry({
        signalTs: 1_700_000_000_000,
        symbol: "BTCUSDT",
        side: "LONG",
        quantity: 1,
        expectedPrice: 100,
        maxEntryNotionalUsd,
      }), /V12_ENTRY_APPROVED_NOTIONAL_REQUIRED/);
    }
    assert.equal(executeCalls, 0);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("shared V12 entry transport forwards the approved ceiling while exits remain reduce-only compatible", async () => {
  const saved = Object.fromEntries([
    "DISDEX_SHARED_KILL_SWITCH_FILE",
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
    "DISDEX_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
  ].map((name) => [name, process.env[name]]));
  for (const name of Object.keys(saved)) delete process.env[name];
  try {
    const adapter = new V12AsterLiveAdapter({} as any);
    const calls: any[] = [];
    (adapter.executor as any).executeMarket = async (input: any) => {
      calls.push(input);
      return { status: "FILLED", executedQuantity: 1, executionUnknown: false };
    };
    await adapter.executeEntry({ signalTs: 1_700_000_000_000, symbol: "BTCUSDT", side: "LONG", quantity: 1, expectedPrice: 100, maxEntryNotionalUsd: 125 });
    await adapter.executeExit({ signalTs: 1_700_000_000_001, symbol: "BTCUSDT", positionSide: "LONG", quantity: 1, expectedPrice: 100 });
    assert.equal(calls[0].maxEntryNotionalUsd, 125);
    assert.equal(calls[1].reduceOnly, true);
    assert.equal(calls[1].maxEntryNotionalUsd, undefined);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
