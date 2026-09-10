import { strict as assert } from "node:assert";
import test from "node:test";
import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { Quality102CausalV1AsterMarketDataProvider } from "../lib/disdex-quality102-causal-v1-market-data";

const ipBan = () => new AsterApiError({ message: "IP banned", status: 418, retryAfterMs: 1 });

test("AsterV3Client never retries HTTP 418", async () => {
  let calls = 0;
  const client = new AsterV3Client({
    fetchImpl: async () => { calls += 1; return new Response('{"code":-1003,"msg":"IP banned"}', { status: 418, headers: { "retry-after": "0" } }); },
    readOnlyRateLimitMaxRetries: 3,
    readOnlyRateLimitBackoffBaseMs: 1,
    readOnlyRateLimitBackoffMaxMs: 1,
  });
  await assert.rejects(client.ping(), (error: unknown) => error instanceof AsterApiError && error.status === 418);
  assert.equal(calls, 1);
});
test("order reconciliation stops immediately on HTTP 418", async () => {
  let calls = 0;
  const client = { getOrder: async () => { calls += 1; throw ipBan(); } } as unknown as AsterV3Client;
  const executor = new AsterDirectTradeExecutor(client, { reconciliationAttempts: 3, reconciliationDelayMs: 250 });
  const result = await executor.reconcileOrder("BTCUSDT", "reconcile-418");
  assert.equal(calls, 1);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.executionUnknown, true);
});

test("V12 protection reconciliation stops immediately on HTTP 418", async () => {
  let calls = 0;
  const client = { getOrder: async () => { calls += 1; throw ipBan(); } } as unknown as AsterV3Client;
  const adapter = new V12AsterLiveAdapter(client, { reconciliationAttempts: 3, reconciliationDelayMs: 100 });
  const result = await adapter.queryOrderSameId("BTCUSDT", "v12-418");
  assert.equal(calls, 1);
  assert.equal(result, null);
});
test("Q102 market-data pagination stops immediately on HTTP 418", async () => {
  let calls = 0;
  const client = { getKlines: async () => { calls += 1; throw ipBan(); } } as unknown as AsterV3Client;
  const provider = new Quality102CausalV1AsterMarketDataProvider(client, {
    symbols: ["BTCUSDT"],
    historyHours: 181 * 24,
    pageLimit: 500,
    cacheTtlMs: 0,
    requestSpacingMs: 0,
    rateLimitAttempts: 3,
    now: () => Date.now(),
  });
  await assert.rejects(
    (provider as unknown as { getKlines(symbol: string, limit: number, start: number, end: number): Promise<unknown> }).getKlines("BTCUSDT", 1, 1, 2),
    /QUALITY102_ASTER_IP_BAN_418_FAIL_CLOSED/,
  );
  assert.equal(calls, 1);
});
