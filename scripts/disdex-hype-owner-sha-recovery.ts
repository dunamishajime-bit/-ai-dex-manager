/**
 * HYPE-only reviewed SHA migration after a known V4 journal-parser incident.
 * Requires GitHub owner-signed plan verification by the restricted operator.
 * No venue order, cancel, STOP, Kill Switch, or other runner mutation.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, chmod, copyFile, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { replayProductionJournal } from "../lib/v12-v4-production-lifecycle";

const OLD_SHA = "d6bcc94512a6416189cd92d7203b9ac3b2c98e70";
const REVIEW = "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT";
const STATE = "/var/lib/disdex/hype-zec-long/runner.json";
const V4 = "/var/lib/disdex/v12-v4/orders.json";
const ACCOUNT_LOCK = "/var/lib/disdex/shared/account-order.lock";
const PENDING = "/var/lib/disdex/shared/pending-exposure.json";
const EXPECTED_XRP_STOP = "v12-v4-231ed20b6835c4148b5314d8da7e";
const HASH = /^[0-9a-f]{40}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;

function requireCheck(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function digest(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function requiredRecoveryState(value: unknown, sha = OLD_SHA): Record<string, unknown> {
  requireCheck(!!value && typeof value === "object" && !Array.isArray(value), "HYPE_REVIEW_STATE_MALFORMED");
  const data = value as Record<string, unknown>;
  requireCheck(data.schema === "disdex-hype-zec-long/v1" &&
    data.runtimeCommitSha === sha && data.mode === "LIVE", "HYPE_REVIEW_STATE_LINEAGE_MISMATCH");
  requireCheck(data.manualReview === REVIEW, "HYPE_REVIEW_NOT_EXACT_KNOWN_INCIDENT");
  requireCheck(data.pending == null && (data.positions == null ||
    (Array.isArray(data.positions) && data.positions.length === 0)), "HYPE_REVIEW_STATE_NOT_FLAT");
  requireCheck(Array.isArray(data.failures), "HYPE_REVIEW_FAILURE_LEDGER_MALFORMED");
  requireCheck(typeof data.updatedAt === "number" &&
    Number.isSafeInteger(data.updatedAt) && data.updatedAt > 0 &&
    data.updatedAt <= Date.now() + 60_000, "HYPE_REVIEW_STATE_TIMESTAMP_INVALID");
  return data;
}

type NormalizedVenue = {
  serverTime: number;
  positions: Array<{ symbol: string; quantity: number }>;
  orders: Array<{ symbol: string; clientOrderId: string; side: string; type: string;
    quantity: number; status: string; reduceOnly: boolean }>;
};
/** Strict incident-bound venue proof. If XRP/STOP changed since certification, stop. */
export function assertKnownVenueSnapshot(value: NormalizedVenue): string {
  requireCheck(Number.isSafeInteger(value.serverTime) &&
    Math.abs(Date.now() - value.serverTime) < 45_000, "HYPE_VENUE_TIME_INVALID");
  requireCheck(value.positions.length === 1, "HYPE_VENUE_UNEXPECTED_POSITIONS");
  const xrp = value.positions[0];
  requireCheck(xrp.symbol === "XRPUSDT" && xrp.quantity === -13.3, "HYPE_VENUE_XRP_POSITION_CHANGED");
  requireCheck(value.orders.length === 1, "HYPE_VENUE_UNEXPECTED_ORDERS");
  const stop = value.orders[0];
  requireCheck(stop.symbol === "XRPUSDT" && stop.clientOrderId === EXPECTED_XRP_STOP &&
    stop.side === "BUY" && stop.type === "STOP_MARKET" &&
    stop.status === "NEW" && stop.reduceOnly === true && stop.quantity === 13.3,
    "HYPE_VENUE_XRP_STOP_CHANGED");
  return digest(JSON.stringify({ positions: value.positions, orders: value.orders }));
}

export function assertRecoveredV4Ledger(doc: unknown) {
  requireCheck(!!doc && typeof doc === "object" && !Array.isArray(doc), "HYPE_V4_JOURNAL_MALFORMED");
  const state = (doc as { state?: any }).state;
  requireCheck(state && Array.isArray(state.journal) && state.journal.length >= 10_000,
    "HYPE_V4_JOURNAL_INCOMPLETE");
  const resolutions = state.journal.filter((e: any) => e?.type === "EXECUTION_REVIEW_RESOLVED");
  requireCheck(resolutions.length === 1, "HYPE_V4_RESOLUTION_COUNT_INVALID");
  const replay = replayProductionJournal(state.initial, state.journal);
  requireCheck(replay.executionReview == null && state.executionReview == null,
    "HYPE_V4_EXECUTION_REVIEW_UNRESOLVED");
  requireCheck(replay.journal.length === state.journal.length &&
    replay.equityUsd === state.equityUsd &&
    Object.keys(replay.legs).length === Object.keys(state.legs).length,
    "HYPE_V4_REPLAY_DIVERGED");
  const live = Object.values(replay.legs).filter((leg: any) => leg.qty > 0) as any[];
  requireCheck(live.length === 1 && live[0].candidate?.symbol === "XRPUSDT" &&
    live[0].candidate?.effectiveSide === "SHORT" && live[0].qty === 13.3,
    "HYPE_V4_CURRENT_OWNERSHIP_CHANGED");
  return { journalCount: replay.journal.length, reviewResolvedEventId: resolutions[0].eventId };
}

function normalizedVenue(positions: any[], orders: any[], serverTime: number): NormalizedVenue {
  requireCheck(Array.isArray(positions) && Array.isArray(orders), "HYPE_VENUE_READ_MALFORMED");
  const ps = positions.map((p) => {
    const quantity = Number(p.positionAmt);
    requireCheck(typeof p.symbol === "string" && Number.isFinite(quantity), "HYPE_VENUE_POSITION_ROW_INVALID");
    return { symbol: p.symbol.toUpperCase(), quantity };
  }).filter((p) => Math.abs(p.quantity) > 1e-10);
  const os = orders.map((o) => {
    const quantity = Number(o.origQty);
    requireCheck(typeof o.symbol === "string" && typeof o.clientOrderId === "string" &&
      Number.isFinite(quantity) && quantity > 0 && typeof o.status === "string",
      "HYPE_VENUE_ORDER_ROW_INVALID");
    return { symbol: o.symbol.toUpperCase(), clientOrderId: o.clientOrderId,
      side: String(o.side), type: String(o.type), quantity,
      status: o.status, reduceOnly: o.reduceOnly === true || o.reduceOnly === "true" };
  });
  return { serverTime, positions: ps.sort((a,b) => a.symbol.localeCompare(b.symbol)),
    orders: os.sort((a,b) => a.clientOrderId.localeCompare(b.clientOrderId)) };
}

function plannedSha(): string {
  const target = String(process.env.DISDEX_HYPE_TARGET_SHA || "").trim();
  const plan = String(process.env.DISDEX_HYPE_APPROVAL_PLAN_SHA256 || "").trim();
  requireCheck(HASH.test(target) && PLAN_HASH.test(plan), "HYPE_APPROVAL_IDENTITY_MISSING");
  requireCheck(process.env.DISDEX_HYPE_APPROVAL_OPERATION === "HYPE_TREND_LONG_SHA_RESTORE" &&
    process.env.DISDEX_HYPE_SIGNED_GRANT_VERIFIED === "TRUE" &&
    process.env.DISDEX_HYPE_APPROVAL_ORDERS_ENABLED === "true",
    "HYPE_SIGNED_OWNER_APPROVAL_NOT_VERIFIED");
  const exactPlan = digest("HYPE_SHA_RESTORE_V1\n" + OLD_SHA + "\n" + target +
    "\nXRPUSDT_SHORT_13.3_STOP_" + EXPECTED_XRP_STOP + "\n");
  requireCheck(plan === exactPlan, "HYPE_APPROVAL_PLAN_MISMATCH");
  return target;
}

async function recover(): Promise<void> {
  const target = plannedSha();
  const requestId = String(process.env.DISDEX_CONTROL_REQUEST_ID || "");
  requireCheck(/^[0-9]{1,20}$/.test(requestId), "HYPE_GITHUB_ACTIONS_RUN_ID_REQUIRED");
  const releaseRoot = resolve(process.cwd());
  requireCheck(releaseRoot === "/home/deploy/disdex-trading/releases/" + target,
    "HYPE_RELEASE_NOT_EXACT_TARGET");
  requireCheck((await readFile(releaseRoot + "/.disdex-release-sha","utf8")).trim() === target,
    "HYPE_RELEASE_MARKER_MISMATCH");

  const beforeMeta = await lstat(STATE);
  requireCheck(beforeMeta.isFile() && !beforeMeta.isSymbolicLink(),
    "HYPE_STATE_NOT_REGULAR_FILE");
  const beforeBytes = await readFile(STATE);
  const before = requiredRecoveryState(JSON.parse(beforeBytes.toString("utf8")));
  const gate = new FileAccountOrderLock(ACCOUNT_LOCK, 120_000, PENDING);
  const handle = await gate.acquire("HYPE_SHA_OWNER_RESTORE:" + requestId);
  requireCheck(handle, "HYPE_ACCOUNT_LOCK_BUSY");
  try {
    await handle.document();
    const review = assertRecoveredV4Ledger(JSON.parse(await readFile(V4,"utf8")));
    const client = new AsterV3Client({
      baseUrl: process.env.ASTER_FUTURES_BASE_URL,
      userAddress: process.env.ASTER_USER_ADDRESS,
      privateKey: process.env.ASTER_API_PRIVATE_KEY as "0x" | undefined,
      readOnlyRateLimitMaxRetries: 0,
      requestTimeoutMs: 12_000,
      recvWindowMs: 5_000,
      userAgent: "DisDex-HYPE-Owner-Reviewed-ExactSHA-Restore/1.0",
    });
    requireCheck(client.hasTradingCredentials(), "HYPE_SIGNED_GET_CREDENTIALS_MISSING");
    let snapshotHash = "";
    for (let i = 0; i < 3; i += 1) {
      await handle.document();
      const [clock, positions, orders] = await Promise.all([
        client.getServerTime(), client.getPositions(), client.getOpenOrders(),
      ]);
      const thisHash = assertKnownVenueSnapshot(normalizedVenue(positions, orders, Number(clock.serverTime)));
      if (snapshotHash && snapshotHash !== thisHash) throw new Error("HYPE_VENUE_SNAPSHOTS_DIVERGED");
      snapshotHash = thisHash;
      if (i < 2) await new Promise((res) => setTimeout(res, 750));
    }

    requireCheck((await readFile(STATE)).equals(beforeBytes), "HYPE_STATE_CHANGED_DURING_PREFLIGHT");
    await handle.document();
    const now = Date.now();
    const backup = STATE + ".before-owner-sha-restore-" + requestId;
    await copyFile(STATE, backup, fsConstants.COPYFILE_EXCL);
    requireCheck((await readFile(backup)).equals(beforeBytes), "HYPE_BACKUP_NOT_EXACT");
    await chmod(backup, beforeMeta.mode & 0o777);

    const after: Record<string,unknown> = {
      ...before,
      runtimeCommitSha: target,
      updatedAt: now,
      lastDecisionTs: now,
      lastDecision: { strategy: "HYPE_LONG", signalTs: null, accepted: false,
        reason: "HYPE_V4_JOURNAL_ROOTCAUSE_RESOLVED_OWNER_SIGNED_3X_FLAT" },
      failures: [...((before.failures as Array<{message:string;occurredAt:number}>).slice(-99)),
        { message: "HYPE_SHA_OWNER_RESTORE:" + OLD_SHA + ":" + target +
          ":V4_EVENTS_" + review.journalCount + ":SNAPSHOT_" + snapshotHash,
          occurredAt: now }],
    };
    delete after.manualReview;
    delete after.pending;
    delete after.positions;
    const temporary = STATE + "." + randomUUID() + ".sha-restore.tmp";
    const bytes = Buffer.from(JSON.stringify(after,null,2) + "\n");
    const fd = await open(temporary,"wx",beforeMeta.mode & 0o777);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    try {
      await chmod(temporary,beforeMeta.mode & 0o777);
      await handle.document();
      requireCheck((await readFile(STATE)).equals(beforeBytes), "HYPE_STATE_CAS_MISMATCH");
      await rename(temporary,STATE);
    } catch(error) {
      await unlink(temporary).catch(()=>undefined);
      throw error;
    }
    requireCheck((await readFile(STATE)).equals(bytes), "HYPE_STATE_SHA_RESTORE_POST_VERIFY_FAILED");
    console.log(JSON.stringify({status:"HYPE_SHA_OWNER_REVIEW_REPAIRED",oldSha:OLD_SHA,
      newSha:target,backup,reviewEvents:review.journalCount,
      signedVenueReads:3,xrpProtectionVerified:true,venueProofSha256:snapshotHash,
      ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  } finally {
    await handle.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  recover().catch(error=>{
    console.error(JSON.stringify({status:"HYPE_SHA_OWNER_RESTORE_FAIL_CLOSED",
      reason: error instanceof Error?error.message:String(error),
      ordersSent:0,cancelsSent:0,positionChangesSent:0}));
    process.exitCode=1;
  });
}
