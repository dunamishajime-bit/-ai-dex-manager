import {
  V4ExecutionStore,
  v4OrderIdentity,
  advanceV4Intent,
  advanceV4Protection,
  type V4ExecutionDocument,
  type V4OrderIntent,
} from "/home/deploy/disdex-trading/releases/53a0be396719f0284af4e11b35c66a4ac7d58f79/lib/v12-v4-execution-store.ts";
import {
  applyProductionEvent,
} from "/home/deploy/disdex-trading/releases/53a0be396719f0284af4e11b35c66a4ac7d58f79/lib/v12-v4-production-lifecycle.ts";
import {
  AsterV3Client,
} from "/home/deploy/disdex-trading/releases/53a0be396719f0284af4e11b35c66a4ac7d58f79/lib/aster-v3-client.ts";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";

const SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79";
const STORE = "/var/lib/disdex/v12-v4/orders.json";
const BACKUP = "/var/lib/disdex/v12-v4/orders.json.pre-doge-manual-reconcile-1793564640150.bak";

const LEG = "DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000";
const STOP = "v12-v4-98ded39746ed3502a4d7b0e26ef9";
const ENTRY_TRADE_ID = "23841003";
const ENTRY_ORDER_ID = "3161651820";
const ENTRY_TRADE_TS = 1793181670700;
const ENTRY_PRICE = 0.08052;
const ENTRY_QTY = 226;
const ENTRY_FEE = 0.007279;

const CLOSE_TRADE_ID = "23900268";
const CLOSE_ORDER_ID = "3169513690";
const CLOSE_TRADE_TS = 1793564640150;
const CLOSE_PRICE = 0.07497;
const CLOSE_QTY = 226;
const CLOSE_REALIZED = 1.2543;
const CLOSE_FEE = 0.00677728;

const PLANNED_EXIT_TS = 1793440800000;
const PLANNED_EXIT_PRICE = 0.07505;
const EXIT_CLIENT_ID = v4OrderIdentity(SHA, LEG, "EXIT", 0);

function fail(reason: string): never {
  throw new Error("V4_DOGE_MANUAL_RECONCILE_" + reason);
}
function near(a: unknown, b: number) {
  return Number.isFinite(Number(a))
    && Math.abs(Number(a) - b) <= Math.max(1e-8, Math.abs(b) * 1e-7);
}
function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function assertRegular(path: string) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink()) fail("UNSAFE_FILE:" + path);
}
function envNumber(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}
function exactTrade(row: any, expected: {
  id: string; orderId: string; side: "BUY" | "SELL"; qty: number; price: number;
  commission: number; realizedPnl: number; time: number;
}) {
  return String(row?.id) === expected.id
    && String(row?.orderId) === expected.orderId
    && String(row?.symbol).toUpperCase() === "DOGEUSDT"
    && String(row?.side).toUpperCase() === expected.side
    && near(row?.qty, expected.qty)
    && near(row?.price, expected.price)
    && String(row?.commissionAsset).toUpperCase() === "USDT"
    && near(row?.commission, expected.commission)
    && near(row?.realizedPnl, expected.realizedPnl)
    && Number(row?.time) === expected.time;
}
function assertOpenState(doc: V4ExecutionDocument) {
  if (doc.releaseSha !== SHA) fail("SHA_MISMATCH");
  const leg: any = doc.state.legs[LEG];
  if (!leg || leg.status !== "OPEN" || !near(leg.qty, ENTRY_QTY)
      || leg.candidate?.symbol !== "DOGEUSDT"
      || leg.candidate?.route !== "REC_Y06_REV_D0_T72"
      || leg.candidate?.effectiveSide !== "SHORT") {
    fail("LEG_MISMATCH");
  }
  const planned = leg.plannedExit;
  if (planned?.reason !== "TIME" || planned?.priceModelOnly !== true
      || Number(planned?.exitTs) !== PLANNED_EXIT_TS
      || !near(planned?.price, PLANNED_EXIT_PRICE)) {
    fail("PLANNED_EXIT_MISMATCH");
  }
  const protection: any = doc.protections[LEG];
  if (!protection || protection.phase !== "STOP_CONFIRMED"
      || !near(protection.protectedQty, ENTRY_QTY)
      || protection.stopClientOrderId !== STOP) {
    fail("PROTECTION_MISMATCH");
  }
  const stop: any = doc.intents[STOP];
  if (!stop || stop.legId !== LEG || stop.action !== "STOP"
      || stop.stage !== "ACKNOWLEDGED") {
    fail("STOP_INTENT_MISMATCH");
  }
  const exits = Object.values(doc.intents).filter((x: any) =>
    x?.legId === LEG && x?.action === "EXIT");
  if (exits.length !== 0) fail("UNEXPECTED_EXISTING_EXIT");
}
function assertPreparedResume(doc: V4ExecutionDocument) {
  if (doc.releaseSha !== SHA) fail("SHA_MISMATCH");
  const leg: any = doc.state.legs[LEG];
  const exit: any = doc.intents[EXIT_CLIENT_ID];
  const protection: any = doc.protections[LEG];
  if (!leg || leg.status !== "PENDING_EXIT" || !near(leg.qty, ENTRY_QTY)
      || !near(leg.exitRemainingQty, ENTRY_QTY)
      || !exit || exit.action !== "EXIT" || exit.stage !== "PREPARED"
      || exit.legId !== LEG
      || exit.command?.settlementSource !== "MANUAL_ASTER_CLOSE"
      || exit.command?.settlementReason !== "PLANNED_TIME_EXIT_MANUAL_SETTLEMENT"
      || protection?.phase !== "EXIT_PENDING") {
    fail("PREPARED_RESUME_MISMATCH");
  }
}
function assertClosedState(doc: V4ExecutionDocument) {
  const leg: any = doc.state.legs[LEG];
  const exit: any = doc.intents[EXIT_CLIENT_ID];
  const stop: any = doc.intents[STOP];
  const protection: any = doc.protections[LEG];
  if (!leg || leg.status !== "CLOSED" || !near(leg.qty, 0)
      || !near(leg.realizedUsd, CLOSE_REALIZED)
      || !near(leg.feesUsd, ENTRY_FEE + CLOSE_FEE)
      || exit?.stage !== "TERMINAL"
      || exit?.venueOrderId !== CLOSE_ORDER_ID
      || exit?.command?.venueTradeId !== CLOSE_TRADE_ID
      || exit?.command?.settlementSource !== "MANUAL_ASTER_CLOSE"
      || exit?.command?.settlementReason !== "PLANNED_TIME_EXIT_MANUAL_SETTLEMENT"
      || stop?.stage !== "TERMINAL"
      || protection?.phase !== "CLOSED"
      || !near(protection?.protectedQty, 0)) {
    fail("CLOSED_STATE_MISMATCH");
  }
}

async function signedVenueProof() {
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: envNumber("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: envNumber("ASTER_RECV_WINDOW_MS", 5_000),
    readOnlyRateLimitMaxRetries: 0,
    userAgent: "DisDex-DOGE-Manual-Reconcile/1.0",
  });
  if (!client.hasTradingCredentials()) fail("ASTER_CREDENTIALS_MISSING");

  const [positions, openOrders, trades] = await Promise.all([
    client.getPositions("DOGEUSDT"),
    client.getOpenOrders("DOGEUSDT"),
    client.getUserTrades("DOGEUSDT", {
      startTime: ENTRY_TRADE_TS - 1,
      endTime: Date.now(),
      limit: 1000,
    }),
  ]);
  if (trades.length === 1000) fail("USER_TRADES_MAY_BE_TRUNCATED");
  const net = positions
    .filter((x: any) => String(x.symbol).toUpperCase() === "DOGEUSDT")
    .reduce((n: number, x: any) => n + Number(x.positionAmt), 0);
  if (!Number.isFinite(net) || Math.abs(net) > 1e-8) fail("VENUE_NOT_FLAT");
  if (openOrders.some((x: any) => String(x.symbol).toUpperCase() === "DOGEUSDT")) {
    fail("DOGE_OPEN_ORDER_REMAINS");
  }

  const relevant = trades
    .filter((x: any) => Number(x.time) >= ENTRY_TRADE_TS)
    .sort((a: any, b: any) => Number(a.time) - Number(b.time));
  if (relevant.length !== 2) fail("DOGE_TRADE_SEQUENCE_CHANGED");
  if (!exactTrade(relevant[0], {
    id: ENTRY_TRADE_ID, orderId: ENTRY_ORDER_ID, side: "SELL",
    qty: ENTRY_QTY, price: ENTRY_PRICE, commission: ENTRY_FEE,
    realizedPnl: 0, time: ENTRY_TRADE_TS,
  })) fail("ENTRY_TRADE_MISMATCH");
  if (!exactTrade(relevant[1], {
    id: CLOSE_TRADE_ID, orderId: CLOSE_ORDER_ID, side: "BUY",
    qty: CLOSE_QTY, price: CLOSE_PRICE, commission: CLOSE_FEE,
    realizedPnl: CLOSE_REALIZED, time: CLOSE_TRADE_TS,
  })) fail("CLOSE_TRADE_MISMATCH");

  return {
    client,
    venueNetQty: net,
    dogeOpenOrders: openOrders.length,
    closeTrade: relevant[1],
  };
}

function ensureBackup() {
  assertRegular(STORE);
  if (!existsSync(BACKUP)) {
    copyFileSync(STORE, BACKUP);
    chmodSync(BACKUP, 0o600);
  } else {
    assertRegular(BACKUP);
  }
  return {
    storeSha256Before: sha256(STORE),
    backupSha256: sha256(BACKUP),
  };
}

async function main() {
  const proof = await signedVenueProof();
  const store = new V4ExecutionStore(STORE, SHA);
  let doc = store.read();

  if (doc.state.legs[LEG]?.status === "CLOSED") {
    assertClosedState(doc);
    console.log(JSON.stringify({
      status: "V4_DOGE_MANUAL_RECONCILE_ALREADY_COMPLETE",
      revision: doc.revision,
      legId: LEG,
      venueNetQty: proof.venueNetQty,
      dogeOpenOrders: proof.dogeOpenOrders,
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
    return;
  }

  const backup = ensureBackup();
  const existingExit: any = doc.intents[EXIT_CLIENT_ID];

  if (!existingExit) {
    assertOpenState(doc);
    const lastTs = doc.state.journal.at(-1)?.ts ?? 0;
    const requestTs = Math.max(CLOSE_TRADE_TS, lastTs + 1);
    const intent: V4OrderIntent = {
      clientOrderId: EXIT_CLIENT_ID,
      legId: LEG,
      action: "EXIT",
      sequence: 0,
      stage: "PREPARED",
      createdAt: requestTs,
      updatedAt: requestTs,
      command: {
        legId: LEG,
        action: "EXIT",
        sequence: 0,
        symbol: "DOGEUSDT",
        positionSide: "SHORT",
        quantity: CLOSE_QTY,
        price: CLOSE_PRICE,
        signalTs: 1793181600000,
        externalSettlement: true,
        settlementSource: "MANUAL_ASTER_CLOSE",
        settlementReason: "PLANNED_TIME_EXIT_MANUAL_SETTLEMENT",
        plannedExitReason: "TIME",
        plannedExitTs: PLANNED_EXIT_TS,
        plannedExitPriceModel: PLANNED_EXIT_PRICE,
        venueTradeId: CLOSE_TRADE_ID,
        noAmbiguousRetry: true,
      },
    };
    let next: V4ExecutionDocument = structuredClone(doc);
    next.intents[EXIT_CLIENT_ID] = intent;
    next.state = applyProductionEvent(next.state, {
      type: "EXIT_REQUEST",
      eventId: "manual-settlement-request:" + LEG + ":" + CLOSE_ORDER_ID,
      ts: requestTs,
      id: LEG,
      qty: CLOSE_QTY,
    });
    next = advanceV4Protection(next, LEG, "EXIT_PENDING", requestTs, CLOSE_QTY, STOP);
    doc = store.commit(doc.revision, next);
  }

  assertPreparedResume(doc);
  const lastTs = doc.state.journal.at(-1)?.ts ?? 0;
  const fillRecordTs = Math.max(CLOSE_TRADE_TS, lastTs + 1);
  let next: V4ExecutionDocument = structuredClone(doc);
  next.state = applyProductionEvent(next.state, {
    type: "EXIT_FILL",
    eventId: "manual-settlement-venue:DOGEUSDT:" + CLOSE_TRADE_ID,
    ts: fillRecordTs,
    id: LEG,
    qty: CLOSE_QTY,
    price: CLOSE_PRICE,
    feeUsd: CLOSE_FEE,
    cooldownUntil: fillRecordTs,
    actualFillTs: CLOSE_TRADE_TS,
  });
  next = advanceV4Intent(next, EXIT_CLIENT_ID, "TERMINAL", fillRecordTs);
  next.intents[EXIT_CLIENT_ID].venueOrderId = CLOSE_ORDER_ID;
  next = advanceV4Intent(next, STOP, "TERMINAL", fillRecordTs);
  next = advanceV4Protection(next, LEG, "CLOSED", fillRecordTs, 0);
  doc = store.commit(doc.revision, next);
  assertClosedState(doc);

  // Signed venue proof again after the local durable-state commit.
  const [positionsAfter, ordersAfter] = await Promise.all([
    proof.client.getPositions("DOGEUSDT"),
    proof.client.getOpenOrders("DOGEUSDT"),
  ]);
  const netAfter = positionsAfter
    .filter((x: any) => String(x.symbol).toUpperCase() === "DOGEUSDT")
    .reduce((n: number, x: any) => n + Number(x.positionAmt), 0);
  if (!Number.isFinite(netAfter) || Math.abs(netAfter) > 1e-8 || ordersAfter.length !== 0) {
    fail("POST_COMMIT_VENUE_CHANGED");
  }

  const leg: any = doc.state.legs[LEG];
  console.log(JSON.stringify({
    status: "V4_DOGE_MANUAL_RECONCILE_PASS",
    revision: doc.revision,
    legId: LEG,
    durableStatus: leg.status,
    durableQty: leg.qty,
    plannedExitReason: leg.plannedExit?.reason,
    settlementSource: (doc.intents[EXIT_CLIENT_ID].command as any)?.settlementSource,
    settlementReason: (doc.intents[EXIT_CLIENT_ID].command as any)?.settlementReason,
    exitClientOrderId: EXIT_CLIENT_ID,
    venueOrderId: CLOSE_ORDER_ID,
    venueTradeId: CLOSE_TRADE_ID,
    fillPrice: CLOSE_PRICE,
    fillQty: CLOSE_QTY,
    realizedUsd: leg.realizedUsd,
    feesUsd: leg.feesUsd,
    fundingUsd: leg.fundingUsd,
    protectionPhase: doc.protections[LEG].phase,
    stopIntentStage: doc.intents[STOP].stage,
    venueNetQty: netAfter,
    dogeOpenOrders: ordersAfter.length,
    storeSha256Before: backup.storeSha256Before,
    backupSha256: backup.backupSha256,
    storeSha256After: sha256(STORE),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "V4_DOGE_MANUAL_RECONCILE_FAILED_CLOSED",
    error: error instanceof Error ? error.message : String(error),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  process.exitCode = 2;
});
