import fs from "fs/promises";
import path from "path";

import {
  V11AsterProtectiveApiError,
  V11AsterProtectiveClient,
} from "../lib/research-lab/perp/v11-aster-protective-client";

const TEST_PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const TEST_USER = "0x1111111111111111111111111111111111111111";

type Captured = { method: string; url: string; body: string; headers: HeadersInit | undefined };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V11_ASTER_CONTRACT_FAIL:${message}`);
}

function paramsFrom(captured: Captured) {
  const url = new URL(captured.url);
  return captured.method === "GET" ? url.searchParams : new URLSearchParams(captured.body);
}

async function main() {
  const calls: Captured[] = [];
  let responseMode: "ok" | "503" = "ok";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = String(init?.method || "GET");
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, url, body, headers: init?.headers });
    if (responseMode === "503") {
      return new Response(JSON.stringify({ code: -1000, msg: "unknown execution" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/positionSide/dual")) return new Response(JSON.stringify({ dualSidePosition: false }), { status: 200 });
    if (method === "POST") return new Response(JSON.stringify({ symbol: "BTCUSDT", clientOrderId: "v11-stop-test", status: "NEW", side: "SELL", positionSide: "BOTH", type: "STOP_MARKET", reduceOnly: true, stopPrice: "95000" }), { status: 200 });
    if (method === "DELETE") return new Response(JSON.stringify({ symbol: "BTCUSDT", clientOrderId: "v11-stop-old", status: "CANCELED", reduceOnly: true }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const client = new V11AsterProtectiveClient({
    baseUrl: "https://unit.test",
    userAddress: TEST_USER,
    privateKey: TEST_PRIVATE_KEY,
    fetchImpl: fakeFetch,
    requestTimeoutMs: 2000,
  });

  const mode = await client.getPositionMode();
  assert(mode.dualSidePosition === false, "one-way response not parsed");
  const modeCall = calls.at(-1)!; const modeParams = paramsFrom(modeCall);
  assert(modeCall.method === "GET", "position mode must be GET");
  assert(new URL(modeCall.url).pathname === "/fapi/v3/positionSide/dual", "position mode endpoint mismatch");
  assert(modeParams.get("user") === TEST_USER, "signed GET missing user");
  assert(modeParams.get("signer") === client.signerAddress, "signed GET missing signer");
  assert(Boolean(modeParams.get("nonce")) && Boolean(modeParams.get("signature")), "signed GET missing nonce/signature");

  const placed = await client.placeReduceOnlyStopMarket({
    symbol: "BTCUSDT",
    side: "SELL",
    quantity: "0.01",
    stopPrice: "95000",
    newClientOrderId: "v11-stop-test",
  });
  assert(placed.status === "NEW", "stop response not parsed");
  const stopCall = calls.at(-1)!; const stopParams = paramsFrom(stopCall);
  assert(stopCall.method === "POST", "stop must be POST");
  assert(new URL(stopCall.url).pathname === "/fapi/v3/order", "stop endpoint mismatch");
  assert(stopParams.get("type") === "STOP_MARKET", "stop type mismatch");
  assert(stopParams.get("positionSide") === "BOTH", "V11 stop must be one-way BOTH");
  assert(stopParams.get("reduceOnly") === "true", "V11 stop must be reduce-only");
  assert(stopParams.get("quantity") === "0.01", "stop quantity mismatch");
  assert(stopParams.get("stopPrice") === "95000", "stop price mismatch");
  assert(stopParams.get("workingType") === "CONTRACT_PRICE", "workingType mismatch");
  assert(stopParams.get("priceProtect") === "FALSE", "priceProtect default mismatch");
  assert(stopParams.get("newOrderRespType") === "ACK", "stop response type mismatch");
  assert(stopParams.get("newClientOrderId") === "v11-stop-test", "stop client id mismatch");
  assert(!stopParams.has("closePosition"), "reduce-only stop must not use closePosition");
  assert(Boolean(stopParams.get("signature")), "stop missing signature");

  const canceled = await client.cancelOrder("BTCUSDT", "v11-stop-old");
  assert(canceled.status === "CANCELED", "cancel response not parsed");
  const cancelCall = calls.at(-1)!; const cancelParams = paramsFrom(cancelCall);
  assert(cancelCall.method === "DELETE", "cancel must be DELETE");
  assert(new URL(cancelCall.url).pathname === "/fapi/v3/order", "cancel endpoint mismatch");
  assert(cancelParams.get("symbol") === "BTCUSDT", "cancel symbol mismatch");
  assert(cancelParams.get("origClientOrderId") === "v11-stop-old", "cancel must use origClientOrderId");
  assert(Boolean(cancelParams.get("signature")), "cancel missing signature");

  responseMode = "503";
  let stopUnknown = false;
  try {
    await client.placeReduceOnlyStopMarket({ symbol: "BTCUSDT", side: "SELL", quantity: "0.01", stopPrice: "94000", newClientOrderId: "v11-stop-503" });
  } catch (error) {
    stopUnknown = error instanceof V11AsterProtectiveApiError && error.status === 503 && error.executionUnknown;
  }
  assert(stopUnknown, "STOP_MARKET 503 must be executionUnknown");

  let cancelUnknown = false;
  try { await client.cancelOrder("BTCUSDT", "v11-stop-old"); }
  catch (error) { cancelUnknown = error instanceof V11AsterProtectiveApiError && error.status === 503 && error.executionUnknown; }
  assert(cancelUnknown, "cancel 503 must be executionUnknown");

  let getUnknown = true;
  try { await client.getPositionMode(); }
  catch (error) { getUnknown = !(error instanceof V11AsterProtectiveApiError) || error.executionUnknown; }
  assert(getUnknown === false, "read-only 503 must not be marked executionUnknown");

  const result = {
    researchLine: "V26_V11_ASTER_PROTECTIVE_HTTP_CONTRACT",
    researchOnly: true,
    productionDeployed: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    pass: true,
    verified: {
      signedPositionModeGet: true,
      stopMarketPost: true,
      oneWayPositionSideBoth: true,
      reduceOnlyTrue: true,
      stopPriceForwarded: true,
      closePositionAbsent: true,
      cancelByOrigClientOrderId: true,
      mutation503ExecutionUnknown: true,
      read503NotExecutionUnknown: true,
    },
    callCount: calls.length,
  };
  const dir = process.env.RESEARCH_STATE_DIR || ".research-state"; await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "v26-v11-aster-contract.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
