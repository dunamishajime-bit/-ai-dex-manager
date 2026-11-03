import { mkdir, lstat, chmod, readFile, appendFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { V4ExecutionStore } from "../lib/v12-v4-execution-store";
import { migrateFlatV4State } from "../lib/v12-v4-flat-lineage-migration";
import {publishV4MigratedState} from "../lib/v12-v4-state-publication";
import {createV4MigrationReadOnlyFetch} from "../lib/v12-v4-migration-readonly";

const ACK = "I_ACK_V12_V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION";
const SHA = /^[a-f0-9]{40}$/;

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`V4_FLAT_LINEAGE_MIGRATION_MISSING_ENV:${name}`);
    return value;
}

export function parseMigrationArgs(argv: readonly string[] = process.argv) {
    const values=new Map<string,string>();
    for(let index=2;index<argv.length;index++){
        const flag=argv[index];
        if(!['--apply','--ack','--old-sha','--new-sha'].includes(flag))throw Error('V4_FLAT_LINEAGE_MIGRATION_UNKNOWN_ARGUMENT');
        if(values.has(flag))throw Error('V4_FLAT_LINEAGE_MIGRATION_DUPLICATE_ARGUMENT');
        if(flag==='--apply'){values.set(flag,'true');continue;}
        const argument=argv[++index];
        if(!argument||argument.startsWith('--'))throw Error('V4_FLAT_LINEAGE_MIGRATION_ARGUMENT_VALUE_REQUIRED');
        values.set(flag,argument.trim());
    }
    const value=(name:string)=>values.get(name)||'';
    if (!argv.includes("--apply")) throw new Error("V4_FLAT_LINEAGE_MIGRATION_REQUIRES_APPLY");
    if (value("--ack") !== ACK) throw new Error("V4_FLAT_LINEAGE_MIGRATION_ACK_REQUIRED");
    const expectedOldSha = value("--old-sha").toLowerCase();
    const newSha = value("--new-sha").toLowerCase();
    if (!SHA.test(expectedOldSha) || !SHA.test(newSha) || expectedOldSha === newSha)
        throw new Error("V4_FLAT_LINEAGE_MIGRATION_SHA_INVALID");
    return { expectedOldSha, newSha };
}

async function regular(path: string) {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`V4_FLAT_LINEAGE_MIGRATION_UNSAFE_FILE:${path}`);
}

function numberValue(value: unknown, label: string) {
    if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim()))throw new Error(`V4_FLAT_LINEAGE_MIGRATION_INVALID_${label}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`V4_FLAT_LINEAGE_MIGRATION_INVALID_${label}`);
    return parsed;
}

async function main() {
    const { expectedOldSha, newSha } = parseMigrationArgs();
    if(process.getuid?.()!==0)throw Error("V4_FLAT_LINEAGE_MIGRATION_ROOT_REQUIRED");

    const statePath = required("V12_V4_EXECUTION_STORE_PATH");
    const pendingPath = required("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH");
    const accountLockPath = required("DISDEX_ACCOUNT_LOCK_PATH");
    const ownerUid = Number(required("V12_V4_STATE_OWNER_UID"));
    const ownerGid = Number(required("V12_V4_STATE_OWNER_GID"));
    if (!Number.isInteger(ownerUid) || ownerUid < 0 || !Number.isInteger(ownerGid) || ownerGid < 0)
        throw new Error("V4_FLAT_LINEAGE_MIGRATION_STATE_OWNER_INVALID");

    await regular(statePath);
    const lock = new FileAccountOrderLock(accountLockPath, 120000, pendingPath);
    const lease = await lock.acquire("V12_V4_FLAT_LINEAGE_MIGRATION");
    if (!lease) throw new Error("V4_FLAT_LINEAGE_MIGRATION_ACCOUNT_LOCK_BUSY");
    try {
        const originalBytes=await readFile(statePath);
        const observed = new V4ExecutionStore(statePath, expectedOldSha).read();
        const metadata=await lstat(statePath);
        if(metadata.uid!==ownerUid||metadata.gid!==ownerGid)throw Error('V4_FLAT_LINEAGE_MIGRATION_OWNER_MISMATCH');
        if(JSON.stringify(JSON.parse(originalBytes.toString('utf8')))!==JSON.stringify(observed))throw Error('V4_FLAT_LINEAGE_MIGRATION_STATE_CHANGED');
        const pending = await readPendingExposureRegistry(pendingPath);
        const client = new AsterV3Client({
            baseUrl: process.env.ASTER_FUTURES_BASE_URL,
            userAddress: process.env.ASTER_USER_ADDRESS,
            privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
            requestTimeoutMs: 15000,
            readOnlyRateLimitMaxRetries: 0,
            fetchImpl:createV4MigrationReadOnlyFetch(),
            userAgent: `DisDex-V4-Flat-Lineage-Migration/${newSha.slice(0, 12)}`,
        });
        const signedReadStartedAt=Date.now();
        const [positions, openOrders, balances] = await Promise.all([
            client.getPositions(),
            client.getOpenOrders(),
            client.getBalances(),
        ]);
        if(Date.now()-signedReadStartedAt>30000)throw Error('V4_FLAT_LINEAGE_MIGRATION_SIGNED_EVIDENCE_STALE');
        const activePositions = positions.filter((row) => Math.abs(numberValue(row.positionAmt, "POSITION")) > 1e-8);
        const prices = Object.fromEntries(activePositions.map((row) => [
            String(row.symbol).toUpperCase(), numberValue(row.markPrice || row.entryPrice, "PRICE"),
        ]));
        const usdt = balances.find((row) => row.asset === "USDT");
        const observedAt = Date.now();
        const migrated = migrateFlatV4State({
            observed,
            expectedOldSha,
            newSha,
            evidence: {
                observedAt,
                accountEquityUsd: numberValue(usdt?.balance, "EQUITY"),
                availableBalanceUsd: numberValue(usdt?.availableBalance, "AVAILABLE_BALANCE"),
                prices,
                positions: activePositions.map((row) => ({ symbol: String(row.symbol), positionAmt: String(row.positionAmt) })),
                openOrders: openOrders.map((row) => ({
                    symbol: String(row.symbol),
                    origQty: String(row.origQty),
                    executedQty: String(row.executedQty),
                    reduceOnly: row.reduceOnly === true || String(row.reduceOnly).toLowerCase() === "true",
                    status: String(row.status || ""),
                })),
                pendingEntries: pending.entries,
            },
        });

        const auditPath = "/var/lib/disdex/v12-v4/flat-lineage-migration.jsonl";
        await mkdir(dirname(auditPath), { recursive: true, mode: 0o700 });
        try { await regular(auditPath); } catch (error: any) {
            if (error?.code !== "ENOENT") throw error;
            await writeFile(auditPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
        }
        await appendFile(auditPath, `${JSON.stringify({
            schema: "disdex-v12-v4-flat-lineage-migration/v1",
            status: "EVIDENCE_CAPTURED",
            expectedOldSha,
            newSha,
            observedAt,
            positionCount: activePositions.length,
            openOrderCount: openOrders.length,
            accountEquityUsd: numberValue(usdt?.balance, "EQUITY"),
            pendingV12V4: pending.entries.filter((row) => row.strategyId === "V12_V4" && row.status !== "RELEASED").length,
            mutationCalls: 0,
        })}\n`, { encoding: "utf8" });

        const publication=await publishV4MigratedState({statePath,expectedOldBytes:originalBytes,candidate:migrated});
        const backupPath=publication.backupPath;
        await appendFile(auditPath, `${JSON.stringify({
            schema: "disdex-v12-v4-flat-lineage-migration/v1",
            status: "APPLIED",
            expectedOldSha,
            newSha,
            backupPath,
            statePath,
            mutationCalls: 0,
        })}\n`, { encoding: "utf8" });
        await chmod(auditPath, 0o600);
        console.log(JSON.stringify({
            status: "V4_FLAT_LINEAGE_MIGRATION_APPLY_PASS",
            expectedOldSha,
            newSha,
            backupPath,
            statePath,
            beforeStateSha256:publication.beforeSha256,
            afterStateSha256:publication.afterSha256,
            stateOwner: `${ownerUid}:${ownerGid}`,
            stateMode: "600",
            foreignCount: migrated.state.foreign.length,
            historicalV4Legs: Object.values(migrated.state.legs).length,
            activeV4Legs: Object.values(migrated.state.legs).filter(leg=>!["CLOSED","CANCELLED"].includes(leg.status)).length,
            intents: Object.keys(migrated.intents).length,
            protections: Object.keys(migrated.protections).length,
            activeIntents: Object.values(migrated.intents).filter(intent=>intent.stage!=="TERMINAL").length,
            activeProtections: Object.values(migrated.protections).filter(protection=>protection.phase!=="CLOSED").length,
            orderMutationCalls: 0,
        }));
    } finally {
        await lease.release();
    }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/v12-v4-flat-lineage-migration.ts")) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
    });
}
