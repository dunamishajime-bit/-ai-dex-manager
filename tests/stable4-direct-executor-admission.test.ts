import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsterDirectTradeExecutor, type DirectTradeCommand } from "../lib/direct-trade-executor";
import type { AsterV3Client } from "../lib/aster-v3-client";
import { Stable4EntryGrossAdmissionError } from "../lib/stable4-entry-gross-guard";
import { emptyPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { ACCOUNT_LOCK_SCHEMA, type AccountLockDocument } from "../lib/disdex-account-order-lock";
import {v4OrderIdentity} from "../lib/v12-v4-execution-store";

async function fixture(run: (f: ReturnType<typeof setup>, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "stable4-admission-"));
  const path = join(root, "pending.json");
  const changes = { DISDEX_STABLE4_MODE: "LIVE", DISDEX_PENDING_EXPOSURE_REGISTRY_PATH: path, DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED: "false",DISDEX_RELEASE_SHA:"a".repeat(40) };
  const old = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  Object.assign(process.env, changes);
  try { await writeFile(path, JSON.stringify(emptyPendingExposureRegistry())); await run(setup(), path); }
  finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); }
}
function setup() {
  const calls = { orders: 0, positions: 0, balances: 0, lease: 0, reconciliations: 0 };
  const rows: Record<string, unknown>[] = [{ symbol: "BTCUSDT", positionAmt: "1", markPrice: "100", unRealizedProfit: "0" }];
  const client = {
    getBookTickers: async () => [{ symbol: "BTCUSDT", bidPrice: "100", askPrice: "100", bidQty: "10", askQty: "10", time: Date.now() }],
    getExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", status: "TRADING", quantityPrecision: 2, filters: [{ filterType: "MARKET_LOT_SIZE", minQty: "0.01", maxQty: "1000", stepSize: "0.01" }] }] }),
    getPositions: async () => { calls.positions++; return rows; },
    getBalances: async (): Promise<unknown> => { calls.balances++; return [{ asset: "USDT", balance: "100" }]; },
    getOrder: async () => { calls.reconciliations++; throw new Error("unexpected reconcile"); },
    placeMarketOrder: async () => { calls.orders++; return { symbol: "BTCUSDT", status: "NEW" }; },
  };
  const lease = { document: async (): Promise<AccountLockDocument> => { calls.lease++; return { schema: ACCOUNT_LOCK_SCHEMA, accountScope: "ASTER_FUTURES", ownerId: "test-owner", leaseId: "test-lease", acquiredAt: Date.now() - 10, expiresAt: Date.now() + 300_000, reservations: [] }; } };
  const command: DirectTradeCommand = { requestId: "r", clientOrderId: "test-order", symbol: "BTCUSDT", side: "BUY", quantity: 2, expectedPrice: 100, maxSlippageBps: 10, reason: "test", stable4Admission: { lease } };
  return { calls, rows, client, lease, command, executor: new AsterDirectTradeExecutor(client as unknown as AsterV3Client) };
}
async function blocked(f: ReturnType<typeof setup>, code?: string) {
  await assert.rejects(() => f.executor.executeMarket(f.command), (error: unknown) => error instanceof Stable4EntryGrossAdmissionError && (!code || error.code === code));
  assert.equal(f.calls.orders, 0); assert.equal(f.calls.reconciliations, 0);
}
test("LIVE rejects over-cap normalized order before send or reconciliation", async () => fixture(async f => { f.command.quantity = 2.01; await blocked(f, "CRYPTO_CAP_EXCEEDED"); }));
test("LIVE requires explicit owned lease capability", async () => fixture(async f => { delete f.command.stable4Admission; await blocked(f, "INVALID_INPUT"); }));
test("LIVE cannot exclude a foreign same-symbol reservation without current lease ownership", async () => fixture(async (f,path) => {
  const now=Date.now(),registry=emptyPendingExposureRegistry(now);
  registry.entries=[{reservationId:"foreign",strategyId:"V12",sleeve:"CRYPTO",symbol:"BTCUSDT",side:"LONG",gross:1,notionalUsd:100,status:"PENDING",createdAt:now,updatedAt:now}];
  await writeFile(path,JSON.stringify(registry));f.command.stable4Admission!.ownReservationId="foreign";
  await blocked(f,"OWN_RESERVATION_CONFLICT");
}));
test("LIVE own exclusion binds lease strategy, side and reservation dollars to registry",async()=>fixture(async(f,path)=>{
 const now=Date.now(),registry=emptyPendingExposureRegistry(now);
 registry.entries=[{reservationId:"own",strategyId:"V12",sleeve:"CRYPTO",symbol:"BTCUSDT",side:"LONG",gross:1,notionalUsd:100,status:"PENDING",createdAt:now,updatedAt:now}];
 await writeFile(path,JSON.stringify(registry));f.command.stable4Admission!.ownReservationId="own";
 const original=f.lease.document;
 f.lease.document=async()=>({...await original(),reservations:[{reservationId:"own",strategyId:"PENGU",symbol:"BTCUSDT",side:"LONG",gross:1,notionalUsd:100,status:"RESERVED",createdAt:now}]});
 await blocked(f,"OWN_RESERVATION_CONFLICT");
 f.lease.document=async()=>({...await original(),reservations:[{reservationId:"own",strategyId:"V12",symbol:"BTCUSDT",side:"LONG",gross:1,notionalUsd:100,status:"RESERVED",createdAt:now}]});
 await f.executor.executeMarket(f.command);assert.equal(f.calls.orders,1);
}));
test("LIVE retains raw registry numeric validation instead of coercing foreign reservations",async()=>fixture(async(f,path)=>{
 const now=Date.now(),registry:any=emptyPendingExposureRegistry(now);
 registry.entries=[{reservationId:"foreign",strategyId:"V12",sleeve:"CRYPTO",symbol:"BTCUSDT",side:"LONG",gross:1,notionalUsd:"0",status:"PENDING",createdAt:now,updatedAt:now}];
 await writeFile(path,JSON.stringify(registry));await blocked(f,"INVALID_REGISTRY");
}));
test("LIVE admits exact cap using numeric venue strings and validates lease around reads/send", async () => fixture(async f => {
  await f.executor.executeMarket(f.command); assert.equal(f.calls.orders, 1); assert.equal(f.calls.positions, 1); assert.equal(f.calls.balances, 1); assert.ok(f.calls.lease >= 3);
}));
test("LIVE signed equity includes all unrealized PnL rather than wallet alone", async () => fixture(async f => {
  f.rows[0].unRealizedProfit = "-25"; await blocked(f, "CRYPTO_CAP_EXCEEDED");
}));
test("LIVE rejects malformed or partial signed reads before send", async () => fixture(async f => {
  for (const invalid of [null, true, "", " ", "NaN"]) { f.rows[0].positionAmt = invalid; await blocked(f); }
  f.rows[0].positionAmt = "1"; delete f.rows[0].unRealizedProfit; await blocked(f);
  f.rows[0].unRealizedProfit = "0"; f.client.getBalances = async () => []; await blocked(f);
}));
test("LIVE rejects unknown nonzero positions and unavailable registry before send", async () => fixture(async (f, path) => {
  f.rows.push({ symbol: "UNRECOGNIZEDUSDT", positionAmt: "1", markPrice: "1", unRealizedProfit: "0" }); await blocked(f, "UNKNOWN_SYMBOL");
  f.rows.pop(); await rm(path); await blocked(f, "INVALID_REGISTRY");
}));
test("LIVE does not redate early position reads after a slow balance read", async () => fixture(async f => {
  const original = Date.now; let now = original(); Date.now = () => now;
  f.client.getBalances = async () => { now += 120_001; return [{ asset: "USDT", balance: "100" }]; };
  try { await blocked(f, "STALE_POSITION"); } finally { Date.now = original; }
}));
test("LIVE fails before send if lease ownership is lost at final check", async () => fixture(async f => {
  const previous = f.lease.document; f.lease.document = async () => { if (f.calls.lease >= 2) throw new Error("ACCOUNT_LOCK_NOT_OWNER"); return previous(); };
  await blocked(f, "INVALID_INPUT");
}));
test("OFF, SHADOW, and reduce-only avoid admission reads", async () => fixture(async f => {
  delete f.command.stable4Admission;
  for (const mode of ["OFF", "SHADOW"]) { process.env.DISDEX_STABLE4_MODE = mode; await f.executor.executeMarket(f.command); }
  process.env.DISDEX_STABLE4_MODE = "LIVE"; f.command.reduceOnly = true; await f.executor.executeMarket(f.command);
  assert.equal(f.calls.orders, 3); assert.equal(f.calls.positions, 0); assert.equal(f.calls.balances, 0); assert.equal(f.calls.lease, 0);
}));
test("LIVE rejects explicit null financial fields even if fallback fields exist", async () => fixture(async f => {
  f.rows[0].unRealizedProfit = null; f.rows[0].unrealizedProfit = "0"; await blocked(f);
  f.rows[0].unRealizedProfit = "0";
  f.client.getBalances = async () => [{ asset: "USDT", balance: null, crossWalletBalance: "100" }]; await blocked(f);
}));
test("LIVE excludes only strictly exact-zero foreign rows without requiring a mark", async () => fixture(async f => {
  f.rows.push({ symbol: "FOREIGNUSDC", positionAmt: "0.000", markPrice: "0" });
  await f.executor.executeMarket(f.command); assert.equal(f.calls.orders, 1);
}));
test("LIVE wraps signed read failures without initiating reconciliation", async () => fixture(async f => {
  f.client.getBalances = async () => { throw Object.assign(new Error("read unavailable"), { executionUnknown: true }); };
  await blocked(f, "INVALID_INPUT");
}));

test("LIVE V4 durable own reservation replaces its pending dollars exactly once",async()=>fixture(async(f,path)=>{
 const sha="a".repeat(40),entryTs=Date.now()-1000,id=`BTCUSDT:REC_X04_TIME_24H:LONG:${entryTs}`,cid=v4OrderIdentity(sha,id,"ENTRY",0),now=Date.now();
 const row={reservationId:cid,idempotencyKey:cid,strategyId:"V12_V4",sleeve:"CRYPTO" as const,symbol:"BTCUSDT",side:"LONG" as const,gross:2,notionalUsd:200,status:"PENDING" as const,createdAt:now,updatedAt:now,runtimeSha:sha};
 const document:any={schema:2,releaseSha:sha,state:{legs:{[id]:{id,status:"PENDING_ENTRY",qty:0,entryTs,requestedQty:2,reservationUsd:200,candidate:{symbol:"BTCUSDT",effectiveSide:"LONG"}}}},intents:{[cid]:{clientOrderId:cid,legId:id,action:"ENTRY",sequence:0,stage:"SUBMITTING",command:{legId:id,action:"ENTRY",sequence:0,symbol:"BTCUSDT",positionSide:"LONG",quantity:2,signalTs:entryTs}}}};
 const prior=f.lease.document;f.lease.document=async()=>({...await prior(),ownerId:"V12_V4_RUNNER"});
 f.command.clientOrderId=cid;f.command.stable4Admission={lease:f.lease,ownReservationId:cid,v4Reservation:{readDocument:()=>document}} as any;
 await writeFile(path,JSON.stringify({...emptyPendingExposureRegistry(now),entries:[row]}));
 await f.executor.executeMarket(f.command);assert.equal(f.calls.orders,1);
 f.calls.orders=0;document.intents[cid].venueOrderId="already-sent";await blocked(f,"OWN_RESERVATION_CONFLICT");
 delete document.intents[cid].venueOrderId;f.lease.document=prior;await blocked(f,"OWN_RESERVATION_CONFLICT");
}));
