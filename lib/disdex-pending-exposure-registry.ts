import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const PENDING_EXPOSURE_SCHEMA = "disdex-pending-exposure/v1" as const;
export type PendingExposureSleeve = "CRYPTO" | "STOCK";
export type PendingExposureStatus = "PENDING" | "SUBMITTED" | "UNKNOWN" | "RELEASED";

export interface PendingExposureEntry {
    reservationId: string;
    strategyId: string;
    sleeve: PendingExposureSleeve;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    gross: number;
    notionalUsd: number;
    status: PendingExposureStatus;
    createdAt: number;
    updatedAt: number;
    runtimeSha?: string;
    idempotencyKey?: string;
}

export interface PendingExposureRegistry {
    schema: typeof PENDING_EXPOSURE_SCHEMA;
    accountScope: string;
    updatedAt: number;
    entries: PendingExposureEntry[];
}

export interface PendingExposureAggregate {
    cryptoGross: number;
    stockGross: number;
    byStrategyGross: Record<string, number>;
}

const ACTIVE_STATUSES = new Set<PendingExposureStatus>(["PENDING", "SUBMITTED", "UNKNOWN"]);

function finiteNonNegative(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`PENDING_EXPOSURE_${name}_INVALID`);
    return number;
}

function finitePositive(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`PENDING_EXPOSURE_${name}_INVALID`);
    return number;
}

function expectedSleeve(strategyId: string): PendingExposureSleeve {
    const owner = String(strategyId || "").trim().toUpperCase();
    if (owner === "V11_EQ" || owner === "V50_POST_OPEN_BASIS" || owner === "V52" || owner.includes("V52")) return "STOCK";
    if (
        owner === "V12"
        || owner.includes("V12_")
        || owner.includes("PENGU")
        || owner.includes("FET_BRK48")
        || owner.includes("QUALITY102")
        || owner === "HYPE_LONG"
        || owner === "ZEC_LONG"
    ) return "CRYPTO";
    throw new Error(`PENDING_EXPOSURE_OWNER_UNKNOWN:${strategyId || "EMPTY"}`);
}

function normalizeEntry(raw: unknown): PendingExposureEntry {
    if (!raw || typeof raw !== "object") throw new Error("PENDING_EXPOSURE_ENTRY_INVALID");
    const row = raw as Partial<PendingExposureEntry>;
    const reservationId = String(row.reservationId || "").trim();
    const strategyId = String(row.strategyId || "").trim();
    const sleeve = String(row.sleeve || "").trim().toUpperCase() as PendingExposureSleeve;
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const side = String(row.side || "").trim().toUpperCase() as PendingExposureEntry["side"];
    const status = String(row.status || "").trim().toUpperCase() as PendingExposureStatus;
    if (!reservationId || !strategyId || !symbol) throw new Error("PENDING_EXPOSURE_ENTRY_IDENTITY_INVALID");
    if (sleeve !== "CRYPTO" && sleeve !== "STOCK") throw new Error("PENDING_EXPOSURE_SLEEVE_INVALID");
    if (side !== "LONG" && side !== "SHORT" && side !== "FLAT") throw new Error("PENDING_EXPOSURE_SIDE_INVALID");
    if (!ACTIVE_STATUSES.has(status) && status !== "RELEASED") throw new Error("PENDING_EXPOSURE_STATUS_INVALID");
    if (expectedSleeve(strategyId) !== sleeve) throw new Error(`PENDING_EXPOSURE_OWNER_SLEEVE_MISMATCH:${strategyId}`);
    return {
        reservationId,
        strategyId,
        sleeve,
        symbol,
        side,
        gross: finiteNonNegative(row.gross, "GROSS"),
        notionalUsd: finiteNonNegative(row.notionalUsd, "NOTIONAL"),
        status,
        createdAt: finitePositive(row.createdAt, "CREATED_AT"),
        updatedAt: finitePositive(row.updatedAt, "UPDATED_AT"),
        ...(row.runtimeSha ? { runtimeSha: String(row.runtimeSha).trim().toLowerCase() } : {}),
        ...(row.idempotencyKey ? { idempotencyKey: String(row.idempotencyKey).trim() } : {}),
    };
}

export function normalizePendingExposureRegistry(raw: unknown): PendingExposureRegistry {
    if (!raw || typeof raw !== "object") throw new Error("PENDING_EXPOSURE_REGISTRY_MALFORMED");
    const value = raw as Partial<PendingExposureRegistry>;
    if (value.schema !== PENDING_EXPOSURE_SCHEMA) throw new Error("PENDING_EXPOSURE_REGISTRY_MALFORMED");
    if (!Array.isArray(value.entries)) throw new Error("PENDING_EXPOSURE_REGISTRY_MALFORMED");
    const accountScope = String(value.accountScope || "").trim();
    if (!accountScope) throw new Error("PENDING_EXPOSURE_ACCOUNT_SCOPE_INVALID");
    const entries = value.entries.map(normalizeEntry);
    const ids = new Set<string>();
    for (const entry of entries) {
        if (ids.has(entry.reservationId)) throw new Error(`PENDING_EXPOSURE_DUPLICATE:${entry.reservationId}`);
        ids.add(entry.reservationId);
    }
    return {
        schema: PENDING_EXPOSURE_SCHEMA,
        accountScope,
        updatedAt: finitePositive(value.updatedAt, "REGISTRY_UPDATED_AT"),
        entries,
    };
}

export function emptyPendingExposureRegistry(now = Date.now(), accountScope = "ASTER_FUTURES"): PendingExposureRegistry {
    return { schema: PENDING_EXPOSURE_SCHEMA, accountScope, updatedAt: now, entries: [] };
}

export function aggregatePendingExposure(registry: PendingExposureRegistry, options?: { excludeStrategyIds?: string[] }): PendingExposureAggregate {
    const result: PendingExposureAggregate = { cryptoGross: 0, stockGross: 0, byStrategyGross: {} };
    const excluded = new Set((options?.excludeStrategyIds || []).map((value) => String(value).trim().toUpperCase()));
    for (const entry of registry.entries) {
        if (!ACTIVE_STATUSES.has(entry.status)) continue;
        if (excluded.has(entry.strategyId.toUpperCase())) continue;
        if (entry.sleeve === "CRYPTO") result.cryptoGross += entry.gross;
        else result.stockGross += entry.gross;
        result.byStrategyGross[entry.strategyId] = (result.byStrategyGross[entry.strategyId] || 0) + entry.gross;
    }
    return result;
}

export function pendingExposurePath(path = process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH): string {
    return resolve(path || "/var/lib/disdex/shared/pending-exposure.json");
}

async function assertSafePath(path: string, allowMissing = true) {
    try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) throw new Error("PENDING_EXPOSURE_PATH_SYMLINK");
        if (!stats.isFile()) throw new Error("PENDING_EXPOSURE_PATH_NOT_REGULAR_FILE");
    } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException)?.code === "ENOENT") return;
        throw error;
    }
}

export async function readPendingExposureRegistry(path = pendingExposurePath()): Promise<PendingExposureRegistry> {
    await assertSafePath(path);
    try {
        return normalizePendingExposureRegistry(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyPendingExposureRegistry();
        throw error;
    }
}

async function atomicWrite(path: string, registry: PendingExposureRegistry) {
    await assertSafePath(path);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

export async function upsertPendingExposure(
    entry: Omit<PendingExposureEntry, "status" | "updatedAt"> & { status?: PendingExposureStatus; updatedAt?: number },
    path = pendingExposurePath(),
) {
    const current = await readPendingExposureRegistry(path);
    const normalized = normalizeEntry({ ...entry, status: entry.status || "PENDING", updatedAt: entry.updatedAt || Date.now() });
    const next = normalizePendingExposureRegistry({
        ...current,
        updatedAt: Date.now(),
        entries: [...current.entries.filter((row) => row.reservationId !== normalized.reservationId), normalized],
    });
    await atomicWrite(path, next);
    return normalized;
}

export async function releasePendingExposure(reservationId: string, path = pendingExposurePath()) {
    const current = await readPendingExposureRegistry(path);
    const id = String(reservationId || "").trim();
    if (!id) throw new Error("PENDING_EXPOSURE_RESERVATION_ID_INVALID");
    const found = current.entries.some((row) => row.reservationId === id);
    if (!found) return false;
    const next = normalizePendingExposureRegistry({
        ...current,
        updatedAt: Date.now(),
        entries: current.entries.map((row) => row.reservationId === id ? { ...row, status: "RELEASED", updatedAt: Date.now() } : row),
    });
    await atomicWrite(path, next);
    return true;
}
