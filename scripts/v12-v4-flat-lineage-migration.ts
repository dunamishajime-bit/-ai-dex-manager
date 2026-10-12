import { mkdir, rename, lstat, chmod, chown, appendFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { V4ExecutionStore } from "../lib/v12-v4-execution-store";
import { migrateFlatV4State } from "../lib/v12-v4-flat-lineage-migration";

const ACK = "I_ACK_V12_V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION";
const SHA = /^[a-f0-9]{40}$/;

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`V4_FLAT_LINEAGE_MIGRATION_MISSING_ENV:${name}`);
    return value;
}

export function parseMigrationArgs(argv: readonly string[] = process.argv) {
    const value = (name: string) => {
        const index = argv.indexOf(name);
        return index >= 0 ? String(argv[index + 1] || "").trim() : "";
    };
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
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`V4_FLAT_LINEAGE_MIGRATION_INVALID_${label}`);
    return parsed;
}

async function main() {
    const { expectedOldSha, newSha } = parseMigrationArgs();

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
        const observed = new V4ExecutionStore(statePath, expectedOldSha).read();
        const pending = await readPendingExposureRegistry(pendingPath);
        const client = new AsterV3Client({
            baseUrl: process.env.ASTER_FUTURES_BASE_URL,
            userAddress: process.env.ASTER_USER_ADDRESS,
            privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
            requestTimeoutMs: 15000,
            readOnlyRateLimitMaxRetries: 0,
            userAgent: `DisDex-V4-Flat-Lineage-Migration/${newSha.slice(0, 12)}`,
        });
        const [positions, openOrders, balances] = await Promise.all([
            client.getPositions(),
            client.getOpenOrders(),
            client.getBalances(),
        ]);
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

        const temporary = `${statePath}.${newSha}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(migrated)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await chown(temporary, ownerUid, ownerGid);
        await chmod(temporary, 0o600);
        new V4ExecutionStore(temporary, newSha).read();

        const backupDir = `${dirname(statePath)}/migrations`;
        await mkdir(backupDir, { recursive: true, mode: 0o700 });
        const backupPath = `${backupDir}/orders.${expectedOldSha}-to-${newSha}.${observedAt}.json`;
        try {
            await lstat(backupPath);
            throw new Error("V4_FLAT_LINEAGE_MIGRATION_BACKUP_EXISTS");
        } catch (error: any) {
            if (error?.code !== "ENOENT") throw error;
        }
        await rename(statePath, backupPath);
        try {
            await rename(temporary, statePath);
        } catch (error) {
            await rename(backupPath, statePath).catch(() => undefined);
            throw error;
        }
        await regular(statePath);
        new V4ExecutionStore(statePath, newSha).read();
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
            stateOwner: `${ownerUid}:${ownerGid}`,
            stateMode: "600",
            foreignCount: migrated.state.foreign.length,
            activeV4Legs: Object.values(migrated.state.legs).length,
            intents: Object.keys(migrated.intents).length,
            protections: Object.keys(migrated.protections).length,
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
