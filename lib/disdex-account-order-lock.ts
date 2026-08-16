import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const ACCOUNT_LOCK_SCHEMA = "disdex-account-lock/v1" as const;
export const DEFAULT_ACCOUNT_SCOPE = "ASTER_FUTURES" as const;

export interface AccountReservation {
    reservationId: string;
    strategyId: string;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    gross: number;
    notionalUsd: number;
    createdAt: number;
    status: "RESERVED" | "RELEASED";
}

export interface AccountLockDocument {
    schema: typeof ACCOUNT_LOCK_SCHEMA;
    accountScope: string;
    ownerId: string;
    leaseId: string;
    acquiredAt: number;
    expiresAt: number;
    reservations: AccountReservation[];
}

export interface AccountLockHandle {
    ownerId: string;
    leaseId: string;
    acquiredAt: number;
    document(): Promise<AccountLockDocument>;
    reserve(input: Omit<AccountReservation, "reservationId" | "createdAt" | "status">): Promise<AccountReservation>;
    releaseReservation(reservationId: string): Promise<void>;
    release(): Promise<void>;
}

function validNumber(value: unknown) { return Number.isFinite(Number(value)); }

function normalize(raw: unknown): AccountLockDocument {
    if (!raw || typeof raw !== "object") throw new Error("ACCOUNT_LOCK_MALFORMED");
    const value = raw as Partial<AccountLockDocument>;
    if (value.schema !== ACCOUNT_LOCK_SCHEMA || typeof value.ownerId !== "string" || typeof value.leaseId !== "string") throw new Error("ACCOUNT_LOCK_MALFORMED");
    const reservations = Array.isArray(value.reservations) ? value.reservations.filter((row): row is AccountReservation => Boolean(row && typeof row === "object" && typeof (row as AccountReservation).reservationId === "string")) : [];
    return { schema: ACCOUNT_LOCK_SCHEMA, accountScope: String(value.accountScope || DEFAULT_ACCOUNT_SCOPE), ownerId: value.ownerId, leaseId: value.leaseId, acquiredAt: Number(value.acquiredAt), expiresAt: Number(value.expiresAt), reservations };
}

async function atomicWrite(path: string, document: AccountLockDocument) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
}

export class FileAccountOrderLock {
    private readonly path: string;
    constructor(path = process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock", private readonly leaseMs = 120_000) { this.path = resolve(path); }

    private async read(): Promise<AccountLockDocument> { return normalize(JSON.parse(await readFile(this.path, "utf8"))); }
    private async removeStale() {
        try { const doc = await this.read(); if (doc.expiresAt > Date.now()) return false; await unlink(this.path); return true; }
        catch (error) { const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; if (code === "ENOENT") return true; try { await unlink(this.path); return true; } catch { return false; } }
    }

    async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        const leaseId = randomUUID();
        await mkdir(dirname(this.path), { recursive: true });
        let acquiredAt = Date.now();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            acquiredAt = Date.now();
            const document: AccountLockDocument = { schema: ACCOUNT_LOCK_SCHEMA, accountScope, ownerId, leaseId, acquiredAt, expiresAt: acquiredAt + this.leaseMs, reservations: [] };
            try {
                const fd = await open(this.path, "wx", 0o600);
                await fd.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8"); await fd.close();
                let released = false;
                const assertOwner = async () => { const current = await this.read(); if (current.ownerId !== ownerId || current.leaseId !== leaseId || current.expiresAt <= Date.now()) throw new Error("ACCOUNT_LOCK_NOT_OWNER"); return current; };
                return {
                    ownerId, leaseId, acquiredAt,
                    document: assertOwner,
                    reserve: async (input) => {
                        if (!(validNumber(input.gross) && Number(input.gross) >= 0 && validNumber(input.notionalUsd) && Number(input.notionalUsd) >= 0)) throw new Error("ACCOUNT_RESERVATION_INVALID");
                        const current = await assertOwner();
                        const reservation: AccountReservation = { ...input, reservationId: createHash("sha256").update(`${leaseId}|${input.strategyId}|${input.symbol}|${input.side}|${input.gross}|${input.notionalUsd}`).digest("hex").slice(0, 24), createdAt: Date.now(), status: "RESERVED" };
                        await atomicWrite(this.path, { ...current, expiresAt: Date.now() + this.leaseMs, reservations: [...current.reservations.filter((row) => row.reservationId !== reservation.reservationId), reservation] });
                        return reservation;
                    },
                    releaseReservation: async (reservationId) => { const current = await assertOwner(); await atomicWrite(this.path, { ...current, expiresAt: Date.now() + this.leaseMs, reservations: current.reservations.map((row) => row.reservationId === reservationId ? { ...row, status: "RELEASED" } : row) }); },
                    release: async () => { if (released) return; released = true; try { const current = await this.read(); if (current.ownerId === ownerId && current.leaseId === leaseId) await unlink(this.path); } catch { /* already released */ } },
                };
            } catch (error) {
                const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
                if (code !== "EEXIST") throw error;
                if (attempt === 0 && await this.removeStale()) continue;
                return null;
            }
        }
        return null;
    }
}

export function activeReservedGross(document: AccountLockDocument) { return document.reservations.filter((row) => row.status === "RESERVED").reduce((sum, row) => sum + Number(row.gross || 0), 0); }
