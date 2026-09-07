import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildTradeFillNotificationEvent,
  isConfirmedTradeFill,
  processTradeFillNotificationSpool,
  renderTradeFillEmail,
  tradeFillNotificationKey,
} from "../lib/trade-fill-notification";

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-1",
    clientOrderId: "client-1",
    symbol: "BTCUSDT",
    side: "BUY",
    status: "FILLED",
    requestedQuantity: 0.01,
    submittedQuantity: 0.01,
    executedQuantity: 0.01,
    averagePrice: 100000,
    quoteQuantity: 1000,
    orderId: "order-1",
    executionUnknown: false,
    reconciled: true,
    ...overrides,
  } as any;
}

test("confirmed fills accept FILLED/PARTIALLY_FILLED and reject non-fills", () => {
  assert.equal(isConfirmedTradeFill(makeResult()), true);
  assert.equal(isConfirmedTradeFill(makeResult({ status: "PARTIALLY_FILLED" })), true);
  assert.equal(isConfirmedTradeFill(makeResult({ status: "NEW" })), false);
  assert.equal(isConfirmedTradeFill(makeResult({ executedQuantity: 0 })), false);
  assert.equal(isConfirmedTradeFill(makeResult({ clientOrderId: "" })), false);
});

test("strategy mapping and Japanese email rendering are deterministic", () => {
  const expected = new Map([
    ["V12_X1_ALL", "V12_X1.00_ALL"],
    ["PENGU_V8", "PENGU_DUAL_LS_V2_FINAL"],
    ["QUALITY102_CAUSAL_V1", "QUALITY102_CAUSAL_V1"],
    ["V52", "V52"],
  ]);

  for (const [runnerId, strategyId] of expected) {
    const event = buildTradeFillNotificationEvent(makeResult(), {
      env: { NODE_ENV: "test", DISDEX_RUNNER_ID: runnerId },
      executedAt: "2026-09-07T00:00:00.000Z",
      reason: "ENTRY_SIGNAL",
    });
    assert.equal(event.strategyId, strategyId);
    assert.equal(event.eventType, "ENTRY_FILL");
    const rendered = renderTradeFillEmail(event);
    assert.match(rendered.subject, /約定通知/);
    assert.match(rendered.text, new RegExp(strategyId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(rendered.text, /約定/);
    assert.match(rendered.text, /JST/);
  }

  const exit = buildTradeFillNotificationEvent(
    makeResult({ side: "SELL", reduceOnly: true, status: "PARTIALLY_FILLED" }),
    { env: { NODE_ENV: "test", DISDEX_RUNNER_ID: "V12_X1_ALL" }, eventType: "EXIT_FILL" },
  );
  assert.equal(exit.eventType, "EXIT_FILL");
  assert.equal(exit.reduceOnly, true);
  assert.match(renderTradeFillEmail(exit).text, /決済/);
});

test("notification key is stable and changes when fill facts change", () => {
  const event = buildTradeFillNotificationEvent(makeResult(), {
    env: { NODE_ENV: "test", DISDEX_RUNNER_ID: "V52" },
    executedAt: "2026-09-07T00:00:00.000Z",
  });
  assert.equal(tradeFillNotificationKey(event), tradeFillNotificationKey({ ...event }));
  assert.notEqual(
    tradeFillNotificationKey(event),
    tradeFillNotificationKey({ ...event, executedQuantity: event.executedQuantity / 2 }),
  );
  assert.notEqual(
    tradeFillNotificationKey(event),
    tradeFillNotificationKey({ ...event, status: "PARTIALLY_FILLED" }),
  );
});

test("spool processing sends each fill once across restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-fill-notification-"));
  try {
    const spoolPath = join(root, "inbox.jsonl");
    const statePath = join(root, "state.json");
    const lockPath = join(root, "notifier.lock");
    const event = buildTradeFillNotificationEvent(makeResult(), {
      env: { NODE_ENV: "test", DISDEX_RUNNER_ID: "PENGU_V8" },
      executedAt: "2026-09-07T00:00:00.000Z",
    });
    await writeFile(spoolPath, `${JSON.stringify(event)}\n`, "utf8");
    const sent: string[] = [];

    const first = await processTradeFillNotificationSpool({
      spoolPath,
      statePath,
      lockPath,
      send: async (item) => { sent.push(item.clientOrderId); },
    });
    const second = await processTradeFillNotificationSpool({
      spoolPath,
      statePath,
      lockPath,
      send: async (item) => { sent.push(item.clientOrderId); },
    });

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.deepEqual(sent, ["client-1"]);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.offset, (await readFile(spoolPath, "utf8")).length);
    assert.equal(Object.keys(state.sent).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed delivery keeps the event pending and permits a later retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-fill-notification-retry-"));
  try {
    const spoolPath = join(root, "inbox.jsonl");
    const statePath = join(root, "state.json");
    const lockPath = join(root, "notifier.lock");
    const event = buildTradeFillNotificationEvent(makeResult(), {
      env: { NODE_ENV: "test", DISDEX_RUNNER_ID: "QUALITY102_CAUSAL_V1" },
      executedAt: "2026-09-07T00:00:00.000Z",
    });
    await writeFile(spoolPath, `${JSON.stringify(event)}\n`, "utf8");

    await assert.rejects(
      processTradeFillNotificationSpool({
        spoolPath,
        statePath,
        lockPath,
        send: async () => {
          throw new Error("temporary mail failure");
        },
      }),
      /temporary mail failure/,
    );
    const failedState = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(failedState.offset, 0);

    const sent: string[] = [];
    const retry = await processTradeFillNotificationSpool({
      spoolPath,
      statePath,
      lockPath,
      send: async (item) => { sent.push(item.strategyId); },
    });
    assert.equal(retry.sent, 1);
    assert.deepEqual(sent, ["QUALITY102_CAUSAL_V1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
