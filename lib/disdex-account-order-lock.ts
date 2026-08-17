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

export interface AccountLockRecoveryOptions {
    /** Only locks created by this strategy-specific owner prefix are eligible. */
    ownerPrefix: string;
    strategyId: string;
    /** Durable state saved before any exposure-increasing order is sent. */
    pendingStatePath: string;
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

function ownerPid(ownerId: string, prefix: string) {
    if (!ownerId.startsWith(prefix)) return undefined;
    const value = Number(ownerId.slice(prefix.length).split(":", 1)[0]);
    return Number.isSafeInteger(value) && value > 1 ? value : undefined;
}

function processAlive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        return code !== "ESRCH";
    }
}

export class FileAccountOrderLock {
    private readonly path: string;
    private readonly recovery?: AccountLockRecoveryOptions;

    constructor(
        path = process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock",
        private readonly leaseMs = 120_000,
        recovery?: AccountLockRecoveryOptions,
    ) {
        this.path = resolve(path);
        this.recovery = recovery ? { ...recovery, pendingStatePath: resolve(recovery.pendingStatePath) } : undefined;
    }

    private async read(): Promise<AccountLockDocument> { return normalize(JSON.parse(await readFile(this.path, "utf8"))); }

    private createHandle(ownerId: string, leaseId: string, acquiredAt: number): AccountLockHandle {
        let released = false;
        const assertOwner = async () => {
            const current = await this.read();
            if (current.ownerId !== ownerId || current.leaseId !== leaseId || current.expiresAt <= Date.now()) throw new Error("ACCOUNT_LOCK_NOT_OWNER");
            return current;
        };
        return {
            ownerId,
            leaseId,
            acquiredAt,
            document: assertOwner,
            reserve: async (input) => {
                if (!(validNumber(input.gross) && Number(input.gross) >= 0 && validNumber(input.notionalUsd) && Number(input.notionalUsd) >= 0)) throw new Error("ACCOUNT_RESERVATION_INVALID");
                const current = await assertOwner();
                const reservation: AccountReservation = { ...input, reservationId: createHash("sha256").update(`${leaseId}|${input.strategyId}|${input.symbol}|${input.side}|${input.gross}|${input.notionalUsd}`).digest("hex").slice(0, 24), createdAt: Date.now(), status: "RESERVED" };
                await atomicWrite(this.path, { ...current, expiresAt: Date.now() + this.leaseMs, reservations: [...current.reservations.filter((row) => row.reservationId !== reservation.reservationId), reservation] });
                return reservation;
            },
            releaseReservation: async (reservationId) => {
                const current = await assertOwner();
                await atomicWrite(this.path, { ...current, expiresAt: Date.now() + this.leaseMs, reservations: current.reservations.map((row) => row.reservationId === reservationId ? { ...row, status: "RELEASED" } : row) });
            },
            release: async () => {
                if (released) return;
                released = true;
                try {
                    const current = await this.read();
                    if (current.ownerId === ownerId && current.leaseId === leaseId) await unlink(this.path);
                } catch { /* already released */ }
            },
        };
    }

    /**
     * A hard-killed V12 process can leave the account lock behind after its
     * durable pending record was written.  We only take over that expired lock
     * when the original V12 PID is definitely gone and the reservation matches
     * the durable pending transaction.  The lock is replaced atomically, so
     * another sleeve never sees an unlocked gap during recovery.
     */
    private async takeoverExpiredStrategyLock(ownerId: string, accountScope: string): Promise<AccountLockHandle | null> {
        if (!this.recovery) return null;
        let current: AccountLockDocument;
        try { current = await this.read(); }
        catch { return null; }
        const now = Date.now();
        if (current.expiresAt > now || current.accountScope !== accountScope || !current.ownerId.startsWith(this.recovery.ownerPrefix)) return null;
        const pid = ownerPid(current.ownerId, this.recovery.ownerPrefix);
        if (!pid || processAlive(pid)) return null;

        let state: { strategyId?: unknown; pending?: { symbol?: unknown; side?: unknown } };
        try { state = JSON.parse(await readFile(this.recovery.pendingStatePath, "utf8")) as typeof state; }
        catch { return null; }
        if (state.strategyId !== this.recovery.strategyId) return null;

        const active = current.reservations.filter((row) => row.status === "RESERVED");
        if (active.length) {
            const pending = state.pending;
            if (!pending) {
                // V12 cannot have sent an exposure-increasing order without a
                // durable pending record. An orphan reservation with no pending
                // state is therefore safe to release during takeover.
                current = { ...current, reservations: current.reservations.map((row) => row.status === "RESERVED" ? { ...row, status: "RELEASED" as const } : row) };
            } else if (!active.every((row) => row.strategyId === this.recovery!.strategyId && row.symbol === String(pending.symbol || "").toUpperCase() && row.side === String(pending.side || "").toUpperCase())) {
                return null;
            }
        }

        // Re-read immediately before the atomic replacement. A changed lease
        // means another owner touched the file and recovery must abort.
        let latest: AccountLockDocument;
        try { latest = await this.read(); }
        catch { return null; }
        if (latest.leaseId !== current.leaseId || latest.ownerId !== current.ownerId || latest.expiresAt !== current.expiresAt) return null;

        const leaseId = randomUUID();
        const document: AccountLockDocument = {
            ...current,
            ownerId,
            leaseId,
            acquiredAt: now,
            expiresAt: now + this.leaseMs,
        };
        await atomicWrite(this.path, document);
        return this.createHandle(ownerId, leaseId, now);
    }

    async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        const leaseId = randomUUID();
        await mkdir(dirname(this.path), { recursive: true });
        const acquiredAt = Date.now();
        const document: AccountLockDocument = { schema: ACCOUNT_LOCK_SCHEMA, accountScope, ownerId, leaseId, acquiredAt, expiresAt: acquiredAt + this.leaseMs, reservations: [] };
        try {
            const fd = await open(this.path, "wx", 0o600);
            await fd.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
            await fd.close();
            return this.createHandle(ownerId, leaseId, acquiredAt);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code !== "EEXIST") throw error;
            return this.takeoverExpiredStrategyLock(ownerId, accountScope);
        }
    }
}

export function activeReservedGross(document: AccountLockDocument) { return document.reservations.filter((row) => row.status === "RESERVED").reduce((sum, row) => sum + Number(row.gross || 0), 0); }
