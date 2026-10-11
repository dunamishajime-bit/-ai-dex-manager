/**
 * Read-only venue evidence recorder for the exact-SHA V12 V4 controlled canary.
 * No trading, cancellation, position mutation or certification authority.
 * A pristine canary journal causes ZERO additional Aster API calls.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, lstat, mkdir, rename, open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = "447205ee22ab64d2d0013922eeccfd4a1e14a72f";
const ROOT = "/home/deploy/disdex-trading/releases/" + SHA;
const LEDGER = "/var/lib/disdex/v12-v4/orders.json";
const OUT_DIR = "/var/lib/disdex/v12-v4/venue-evidence";
const sha256 = value => createHash("sha256").update(value).digest("hex");

function required(condition, code) { if (!condition) throw Error(code); }
function safeOrder(order) {
  return {
    symbol: String(order.symbol || ""), orderId: String(order.orderId ?? ""),
    clientOrderId: String(order.clientOrderId ?? order.origClientOrderId ?? ""),
    side: String(order.side ?? ""), type: String(order.type ?? ""),
    status: String(order.status ?? ""), reduceOnly: order.reduceOnly === true,
    origQty: Number(order.origQty ?? 0), executedQty: Number(order.executedQty ?? 0),
    avgPrice: Number(order.avgPrice ?? 0), stopPrice: Number(order.stopPrice ?? 0),
    updateTime: Number(order.updateTime ?? 0),
  };
}
function safePosition(position) {
  return { symbol: String(position.symbol), qty: Number(position.positionAmt),
    entryPrice: Number(position.entryPrice), markPrice: Number(position.markPrice),
    unrealizedPnl: Number(position.unRealizedProfit ?? position.unrealizedProfit ?? 0) };
}
async function regularJson(path) {
  const st = await lstat(path);
  required(st.isFile() && !st.isSymbolicLink(), "EVIDENCE_UNSAFE_INPUT_PATH");
  return JSON.parse(await readFile(path, "utf8"));
}
async function main() {
  if (process.argv.includes("--self-test")) {
    required(SHA.length === 40 && /^\/var\/lib\/disdex\/v12-v4\//.test(OUT_DIR),
      "EVIDENCE_SELFTEST_PATH_OR_SHA");
    required(!/placeMarketOrder|placeConditionalOrder|cancelOrder|flattenReduceOnly|setMarginType|setLeverage/.test(
      main.toString()), "EVIDENCE_MUTATION_API_FORBIDDEN");
    console.log("V4_CANARY_EVIDENCE_READONLY_SELFTEST_PASS"); return;
  }
  required(process.env.DISDEX_V4_EVIDENCE_SHA === SHA, "EVIDENCE_RELEASE_PIN_MISMATCH");
  const doc = await regularJson(LEDGER);
  required(doc.schema === 2 && doc.releaseSha === SHA && Number.isInteger(doc.revision),
    "EVIDENCE_LEDGER_IDENTITY_INVALID");
  const intents = Object.values(doc.intents || {});
  required(intents.length <= 30, "EVIDENCE_CANARY_INTENT_COUNT_EXCEEDED");
  if (!intents.length) {
    console.log(JSON.stringify({ status: "NO_V4_ORDER_INTENTS_YET", releaseSha: SHA,
      revision: doc.revision, venueGetCalls: 0, mutations: 0 }));
    return;
  }
  const symbols = [...new Set(intents.map(x => String(x.command?.symbol || x.legId?.split(":")[0] || "").toUpperCase()))];
  required(symbols.length === 1 && /^[A-Z0-9]+USDT$/.test(symbols[0]),
    "EVIDENCE_CANARY_SYMBOL_UNCERTAIN");
  const moduleUrl = pathToFileURL(join(ROOT, "lib/aster-v3-client.ts")).href;
  const { AsterV3Client } = await import(moduleUrl);
  const baseUrl = String(process.env.ASTER_FUTURES_BASE_URL || "").trim().replace(/\/+$/, "");
  required(baseUrl === "https://fapi.asterdex.com", "EVIDENCE_PRODUCTION_HOST_REQUIRED");
  const client = new AsterV3Client({
    baseUrl,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY,
    requestTimeoutMs: 10000,
    userAgent: "DisDex-V12-V4-Canary-Evidence-GET-Only/1",
  });
  required(client.hasTradingCredentials(), "EVIDENCE_SIGNED_READ_AUTH_REQUIRED");
  const symbol = symbols[0];
  const [positions, openOrders, trades] = await Promise.all([
    client.getPositions(symbol), client.getOpenOrders(symbol),
    client.getUserTrades(symbol, { limit: 200 }),
  ]);
  const observedOrders = [];
  for (const intent of intents) {
    const id = String(intent.clientOrderId || "");
    required(/^v12-v4-[a-f0-9]{28}$/.test(id), "EVIDENCE_CANARY_CLIENT_ID_INVALID");
    try {
      const observed = await client.getOrder(symbol, id);
      observedOrders.push({ action: intent.action, stage: intent.stage, ...safeOrder(observed) });
    } catch (error) {
      observedOrders.push({ action: intent.action, stage: intent.stage, clientOrderId: id,
        queryError: String(error instanceof Error ? error.message : error).slice(0,160) });
    }
  }
  const rows = trades.map(x => ({
    id: String(x.id ?? ""), orderId: String(x.orderId ?? ""), time: Number(x.time ?? 0),
    symbol: String(x.symbol ?? ""), side: String(x.side ?? ""), qty: Number(x.qty ?? 0),
    price: Number(x.price ?? 0), realizedPnl: Number(x.realizedPnl ?? 0),
  }));
  const snapshot = {
    schema: "disdex-v12-v4-canary-get-only-evidence/v1",
    observedAt: new Date().toISOString(), candidateSha: SHA, canaryRevision: doc.revision,
    localJournalSha256: sha256(JSON.stringify(doc)),
    signedGetEndpoints: ["positionRisk", "openOrders", "userTrades", "order"],
    responseIsCryptographicallySigned: false, // signed request != signed venue response
    venueGetCalls: 3 + intents.length, mutationCalls: 0,
    symbol, positions: positions.map(safePosition).filter(x => Math.abs(x.qty) > 1e-10),
    openOrders: openOrders.map(safeOrder), ordersByClientId: observedOrders,
    trades: rows,
  };
  const payload = JSON.stringify(snapshot);
  const evidence = { ...snapshot, evidenceSha256: sha256(payload) };
  await mkdir(OUT_DIR, { recursive: true, mode: 0o700 });
  const target = join(OUT_DIR, new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID() + ".json");
  const tmp = target + ".tmp";
  const fd = await open(tmp, "wx", 0o600);
  try { await fd.writeFile(JSON.stringify(evidence) + "\n"); await fd.sync(); }
  finally { await fd.close(); }
  await rename(tmp, target);
  console.log(JSON.stringify({
    status: "V4_CANARY_SIGNED_GET_EVIDENCE_CAPTURED", sha: SHA,
    revision: doc.revision, intents: intents.length, trades: rows.length,
    openOrders: snapshot.openOrders.length, evidenceSha256: evidence.evidenceSha256,
    evidenceFile: target, mutationCalls: 0,
  }));
}
main().catch(error => {
  console.error(JSON.stringify({ status: "V4_CANARY_EVIDENCE_BLOCKED",
    reason: String(error instanceof Error ? error.message : error).slice(0,250),
    mutationCalls: 0 }));
  process.exitCode = 2;
});
