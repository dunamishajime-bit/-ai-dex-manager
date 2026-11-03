import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { AsterV3Client } from "../../../lib/aster-v3-client";
import { FileAccountOrderLock } from "../../../lib/disdex-account-order-lock";
import { normalizePendingExposureRegistry } from "../../../lib/disdex-pending-exposure-registry";
import { assertV4SharedRateBudget, createV4EvidenceFetch } from "../../../lib/v12-v4-monitor-only";

type JsonRecord = Record<string, any>;

const DEFAULT_PENDING = "/var/lib/disdex/shared/pending-exposure.json";
const DEFAULT_LOCK = "/var/lib/disdex/shared/account-order.lock";

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function validatePendingReadonlyReconcile(input: {
  registry: unknown;
  positions: JsonRecord[];
  openOrders: JsonRecord[];
}) {
  if (!input.registry || typeof input.registry !== "object" || Array.isArray(input.registry)
      || (input.registry as JsonRecord).accountScope !== "ASTER_FUTURES") {
    throw new Error("PENDING_RECONCILE_ACCOUNT_SCOPE_INVALID");
  }
  const rawEntries = (input.registry as JsonRecord).entries;
  if (!Array.isArray(rawEntries)) throw new Error("PENDING_RECONCILE_REGISTRY_INVALID");
  for (const entry of rawEntries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("PENDING_RECONCILE_REGISTRY_INVALID");
    for (const value of [entry.gross, entry.notionalUsd]) {
      if ((typeof value !== "number" && typeof value !== "string")
          || (typeof value === "string" && !value.trim())
          || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error("PENDING_RECONCILE_REGISTRY_AMOUNT_INVALID");
      }
    }
  }
  const registry = normalizePendingExposureRegistry(input.registry);
  const active = registry.entries.filter((row) => row.status !== "RELEASED");
  if (active.length) throw new Error("PENDING_RECONCILE_ACTIVE_REGISTRY_ENTRIES:" + active.length);
  if (!Array.isArray(input.positions) || !Array.isArray(input.openOrders)) {
    throw new Error("PENDING_RECONCILE_VENUE_SNAPSHOT_INVALID");
  }
  const positions = input.positions.filter((row) => {
    const raw = row?.positionAmt;
    if ((typeof raw !== "number" && typeof raw !== "string")
        || (typeof raw === "string" && !raw.trim())) {
      throw new Error("PENDING_RECONCILE_POSITION_AMOUNT_INVALID");
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount)) throw new Error("PENDING_RECONCILE_POSITION_AMOUNT_INVALID");
    return Math.abs(amount) > 1e-12;
  });
  if (positions.length || input.openOrders.length) {
    throw new Error(
      "PENDING_RECONCILE_NONFLAT_REQUIRES_OWNERSHIP_PROOF:"
      + positions.length + ":" + input.openOrders.length,
    );
  }
  return { registry, positionCount: positions.length, openOrderCount: input.openOrders.length };
}

export function buildPendingReconciledRegistry(raw: unknown, verifiedAt: number): JsonRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PENDING_RECONCILE_REGISTRY_INVALID");
  const registry = normalizePendingExposureRegistry(raw);
  if (registry.accountScope !== "ASTER_FUTURES") throw new Error("PENDING_RECONCILE_ACCOUNT_SCOPE_INVALID");
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt <= registry.updatedAt) {
    throw new Error("PENDING_RECONCILE_VERIFIED_AT_INVALID");
  }
  return { ...(raw as JsonRecord), updatedAt: verifiedAt };
}

export function validatePendingRegistryMetadata(input: {
  fileIsRegular: boolean; fileIsSymlink: boolean; fileUid: number; fileGid: number; fileMode: number;
  parentIsDirectory: boolean; parentIsSymlink: boolean; parentUid: number; parentGid: number; parentMode: number;
  deployUid: number; deployGid: number;
}): void {
  if (!input.fileIsRegular || input.fileIsSymlink || !input.parentIsDirectory || input.parentIsSymlink
      || input.fileUid !== input.deployUid || input.fileGid !== input.deployGid
      || input.parentUid !== input.deployUid || input.parentGid !== input.deployGid
      || ![0o600, 0o660].includes(input.fileMode & 0o777)
      || (input.parentMode & 0o007) !== 0) {
    throw new Error("PENDING_RECONCILE_REGISTRY_UNTRUSTED");
  }
}

export function assertPendingReconcileUser(uid: number, gid: number, deployUid: number, deployGid: number): void {
  if (!Number.isSafeInteger(deployUid) || !Number.isSafeInteger(deployGid)
      || deployUid <= 0 || deployGid <= 0 || uid !== deployUid || gid !== deployGid) {
    throw new Error("PENDING_RECONCILE_EXECUTION_USER_INVALID");
  }
}

async function readDeployIds(): Promise<{uid: number; gid: number}> {
  const records = (await readFile("/etc/passwd", "utf8")).split("\n").filter((line) => line.startsWith("deploy:"));
  const fields = records.length === 1 ? records[0].split(":") : [];
  if (!/^\d+$/.test(fields[2] || "") || !/^\d+$/.test(fields[3] || "")) {
    throw new Error("PENDING_RECONCILE_EXECUTION_USER_INVALID");
  }
  const uid = Number(fields[2]), gid = Number(fields[3]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid <= 0 || gid <= 0) {
    throw new Error("PENDING_RECONCILE_EXECUTION_USER_INVALID");
  }
  return {uid, gid};
}

async function trustedRegistry(path: string) {
  if (path !== DEFAULT_PENDING) throw new Error("PENDING_RECONCILE_PATH_NOT_ALLOWED");
  const {uid:deployUid, gid:deployGid} = await readDeployIds();
  const parent = await lstat(dirname(path));
  const target = await lstat(path);
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await fd.stat();
    validatePendingRegistryMetadata({ fileIsRegular: stat.isFile(), fileIsSymlink: target.isSymbolicLink(),
      fileUid: stat.uid, fileGid: stat.gid, fileMode: stat.mode,
      parentIsDirectory: parent.isDirectory(), parentIsSymlink: parent.isSymbolicLink(),
      parentUid: parent.uid, parentGid: parent.gid, parentMode: parent.mode, deployUid, deployGid });
    const raw = await fd.readFile("utf8");
    return { stat, raw, parsed: JSON.parse(raw) };
  } finally { await fd.close(); }
}

async function atomicPreserveMetadata(path: string, raw: string, uid: number, gid: number, mode: number) {
  const temporary = path + "." + process.pid + "." + Date.now() + "." + randomUUID() + ".tmp";
  try {
    const fd = await open(temporary, "wx", mode & 0o777);
    try {
      const tempStat = await fd.stat();
      if (tempStat.uid !== uid || tempStat.gid !== gid) throw new Error("PENDING_RECONCILE_TEMP_OWNER_INVALID");
      await fd.writeFile(raw, "utf8");
      await fd.sync();
      await fd.chmod(mode & 0o777);
    } finally {
      await fd.close();
    }
    await rename(temporary, path);
    const directory=await open(dirname(path),constants.O_RDONLY);
    try {await directory.sync();} finally {await directory.close();}
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function parsePendingReconcileArgs(argv: readonly string[]) {
  if (argv.length !== 1 || !["--verify-only", "--apply-refresh"].includes(argv[0])) {
    throw new Error("PENDING_RECONCILE_MODE_REQUIRED_OR_CONFLICT");
  }
  return { apply: argv[0] === "--apply-refresh" };
}

type PendingGrantContext = {now:number;sha:string;registryHash:string;parentPid:number};

export function validatePendingRefreshGrant(value: unknown, context: PendingGrantContext): void {
  const g=value as JsonRecord;
  const fields=['schema','scope','repository','target','route','authorizationMethod','ordersEnabled',
    'sourceSha','registryHash','parentPid','nonce','issuedAt','expiresAt'];
  if (!g || typeof g!=='object' || Array.isArray(g)
    || Object.keys(g).sort().join('|')!==fields.sort().join('|')
    || g.schema!=='disdex-pending-refresh-root-grant/v1' || g.scope!=='PENDING_RECONCILE_ONLY'
    || g.repository!=='dunamishajime-bit/-ai-dex-manager' || g.target!=='DD1296_FINAL_ALLIN_10BPS'
    || g.route!=='CODEX_SSH' || g.authorizationMethod!=='ROOT_SSH_SESSION' || g.ordersEnabled!==false
    || !/^[a-f0-9]{40}$/.test(g.sourceSha) || g.sourceSha!==context.sha
    || !/^[a-f0-9]{64}$/.test(g.registryHash) || g.registryHash!==context.registryHash
    || typeof g.nonce!=='string' || !/^[a-f0-9]{32}$/.test(g.nonce) || !Number.isSafeInteger(g.parentPid) || g.parentPid<=0
    || g.parentPid!==context.parentPid || !Number.isSafeInteger(context.now)
    || !Number.isSafeInteger(g.issuedAt) || !Number.isSafeInteger(g.expiresAt)
    || g.issuedAt>context.now || g.expiresAt<=context.now || g.expiresAt-g.issuedAt>60_000) {
    throw new Error('PENDING_REFRESH_GRANT_INVALID');
  }
}

async function rootRefreshGrant(): Promise<JsonRecord> {
  const path=String(process.env.DISDEX_PENDING_REFRESH_GRANT_PATH||'');
  if (!/^\/run\/disdex-pending-refresh\/[a-f0-9]{32}\.json$/.test(path)) {
    throw new Error('PENDING_RECONCILE_APPLY_NOT_CERTIFIED');
  }
  const parent=await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid!==0 || (parent.mode&0o027)!==0) {
    throw new Error('PENDING_REFRESH_GRANT_UNTRUSTED');
  }
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const st=await fd.stat();
    if (!st.isFile() || st.uid!==0 || (st.mode&0o777)!==0o640 || st.size>8192) {
      throw new Error('PENDING_REFRESH_GRANT_UNTRUSTED');
    }
    const g=JSON.parse(await fd.readFile('utf8'));
    if (path!==`/run/disdex-pending-refresh/${g.nonce}.json`) throw new Error('PENDING_REFRESH_GRANT_INVALID');
    return g;
  } finally {await fd.close();}
}

export function assertPendingApplyCertified(apply: boolean, grant?:unknown, context?:PendingGrantContext): void {
  if (!apply) return;
  if (!grant || !context) throw new Error("PENDING_RECONCILE_APPLY_NOT_CERTIFIED");
  validatePendingRefreshGrant(grant,context);
}

async function main() {
  const { apply } = parsePendingReconcileArgs(process.argv.slice(2));
  const grant=apply?await rootRefreshGrant():undefined;
  assertV4SharedRateBudget(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH);
  const deploy = await readDeployIds();
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error("PENDING_RECONCILE_EXECUTION_USER_INVALID");
  }
  assertPendingReconcileUser(process.getuid(), process.getgid(), deploy.uid, deploy.gid);
  const pendingPath = process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH || DEFAULT_PENDING;
  const lockPath = process.env.DISDEX_ACCOUNT_LOCK_PATH || DEFAULT_LOCK;
  if (pendingPath !== DEFAULT_PENDING || lockPath !== DEFAULT_LOCK) {
    throw new Error("PENDING_RECONCILE_PRODUCTION_PATH_MISMATCH");
  }
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: 10_000,
    readOnlyRateLimitMaxRetries: 0,
    fetchImpl: createV4EvidenceFetch(fetch),
    userAgent: "DisDex-Pending-Reconcile/1",
  });
  if (!client.hasTradingCredentials()) throw new Error("PENDING_RECONCILE_SIGNED_CREDENTIALS_REQUIRED");

  const lock = new FileAccountOrderLock(lockPath, 120_000, pendingPath);
  const handle = await lock.acquire("PENDING_READONLY_RECONCILE:" + process.pid + ":" + Date.now());
  if (!handle) throw new Error("PENDING_RECONCILE_ACCOUNT_LOCK_BUSY");
  try {
    await handle.renew();
    const before = await trustedRegistry(pendingPath);
    const grantContext=()=>({now:Date.now(),sha:String(process.env.DISDEX_RELEASE_SHA||''),
      registryHash:sha256(before.raw),parentPid:process.ppid});
    assertPendingApplyCertified(apply,grant,grantContext());
    // Sequential signed reads avoid self-saturating the shared priority queue.
    const positions=await client.getPositions();
    const openOrders=await client.getOpenOrders();
    const balances=await client.getBalances();
    if (!Array.isArray(balances)) throw new Error("PENDING_RECONCILE_BALANCE_SNAPSHOT_INVALID");
    const checked = validatePendingReadonlyReconcile({
      registry: before.parsed,
      positions: positions as unknown as JsonRecord[],
      openOrders: openOrders as unknown as JsonRecord[],
    });
    await handle.renew();
    const second = await trustedRegistry(pendingPath);
    if (sha256(second.raw) !== sha256(before.raw)) {
      throw new Error("PENDING_RECONCILE_REGISTRY_CHANGED_DURING_PROOF");
    }

    const verifiedAt = Date.now();
    let afterHash = sha256(before.raw);
    if (apply) {
      await handle.renew();
      assertPendingApplyCertified(true,grant,grantContext());
      const next = buildPendingReconciledRegistry(before.parsed, verifiedAt);
      const raw = JSON.stringify(next, null, 2) + "\n";
      await atomicPreserveMetadata(
        pendingPath, raw, before.stat.uid, before.stat.gid, before.stat.mode,
      );
      const after = await trustedRegistry(pendingPath);
      const parsedAfter = normalizePendingExposureRegistry(after.parsed);
      if (parsedAfter.updatedAt !== verifiedAt
          || parsedAfter.entries.length !== checked.registry.entries.length
          || JSON.stringify(after.parsed.entries) !== JSON.stringify(before.parsed.entries)) {
        throw new Error("PENDING_RECONCILE_POSTWRITE_VERIFY_FAILED");
      }
      afterHash = sha256(after.raw);
    }

    console.log(JSON.stringify({
      status: apply ? "PENDING_READONLY_RECONCILE_APPLIED" : "PENDING_READONLY_RECONCILE_VERIFIED",
      verifiedAt,
      priorUpdatedAt: checked.registry.updatedAt,
      currentUpdatedAt: apply ? verifiedAt : checked.registry.updatedAt,
      registryEntries: checked.registry.entries.length,
      positionCount: checked.positionCount,
      openOrderCount: checked.openOrderCount,
      balanceRows: balances.length,
      beforeHash: sha256(before.raw),
      afterHash,
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
  } finally {
    await handle.release();
  }
}

if (process.argv[1]?.includes("disdex-pending-exposure-readonly-reconcile")) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "PENDING_READONLY_RECONCILE_FAIL_CLOSED",
      error: error instanceof Error ? error.message : String(error),
      ordersSent: 0, cancelsSent: 0, positionChangesSent: 0,
    }));
    process.exitCode = 2;
  });
}
