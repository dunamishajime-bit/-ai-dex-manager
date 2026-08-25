import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const ACCOUNT_LOCK_SCHEMA = "disdex-account-lock/v1" as const;
export const ACCOUNT_LOCK_WAITER_SCHEMA = "disdex-account-lock-waiter/v1" as const;
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

interface AccountLockWaiter {
    schema: typeof ACCOUNT_LOCK_WAITER_SCHEMA;
    ownerId: string;
    waiterId: string;
    priority: number;
    createdAt: number;
    expiresAt: number;
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
    /** Fixed-symbol strategies such as PENGU do not repeat symbol in pending state. */
    fixedSymbol?: string;
}

function validNumber(value: unknown) { return Number.isFinite(Number(value)); }
function finiteEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))); }
function normalizedReservationSide(value: unknown): AccountReservation["side"] | undefined {
    const side = String(value || "").toUpperCase();
    if (side === "BUY") return "LONG";
    if (side === "SELL") return "SHORT";
    return side === "LONG" || side === "SHORT" || side === "FLAT" ? side : undefined;
}

/**
 * Cross-language account execution priority. Lower numbers win only among
 * concurrent waiters that arrive inside the arbitration window. A lock already
 * held by an in-flight critical section is never preempted.
 *
 * P1: reduce-only exit / protection work
 * P2: V52 stock exposure
 * P3: PENGU V2 exposure
 * P4: V12 exposure
 */
export function accountOrderPriority(ownerId: string) {
    const explicit = /(?:^|:)P([1-4])(?:[:]|$)/.exec(ownerId);
    if (explicit) return Number(explicit[1]);
    if (ownerId.startsWith("V52:")) return 2;
    if (ownerId.startsWith("PENGU_DUAL_LS_V2:")) return 3;
    if (ownerId.startsWith("V12_X1.00_ALL:")) return 4;
    return 5;
}

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
    const segments = ownerId.slice(prefix.length).split(":");
    for (const segment of segments) {
        const value = Number(segment);
        if (Number.isSafeInteger(value) && value > 1) return value;
    }
    return undefined;
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
    private readonly waiterDir: string;
    private readonly recovery?: AccountLockRecoveryOptions;
    private readonly arbitrationMs: number;
    private readonly waiterTtlMs: number;

    constructor(
        path = process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock",
        private readonly leaseMs = 120_000,
        recovery?: AccountLockRecoveryOptions,
    ) {
        this.path = resolve(path);
        this.waiterDir = `${this.path}.waiters`;
        this.recovery = recovery ? {
            ...recovery,
            pendingStatePath: resolve(recovery.pendingStatePath),
            fixedSymbol: recovery.fixedSymbol?.toUpperCase(),
        } : undefined;
        this.arbitrationMs = Math.min(1000, Math.max(0, finiteEnv("DISDEX_ACCOUNT_LOCK_ARBITRATION_MS", 200)));
        this.waiterTtlMs = Math.max(2000, finiteEnv("DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS", 10_000));
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
                const symbol = String(input.symbol || "").toUpperCase();
                const side = normalizedReservationSide(input.side);
                if (!symbol || !side) throw new Error("ACCOUNT_RESERVATION_INVALID");
                const current = await assertOwner();
                const reservation: AccountReservation = { ...input, symbol, side, reservationId: createHash("sha256").update(`${leaseId}|${input.strategyId}|${symbol}|${side}|${input.gross}|${input.notionalUsd}`).digest("hex").slice(0, 24), createdAt: Date.now(), status: "RESERVED" };
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

    private async registerWaiter(ownerId: string) {
        await mkdir(this.waiterDir, { recursive: true, mode: 0o700 });
        const waiterId = randomUUID();
        const createdAt = Date.now();
        const waiter: AccountLockWaiter = {
            schema: ACCOUNT_LOCK_WAITER_SCHEMA,
            ownerId,
            waiterId,
            priority: accountOrderPriority(ownerId),
            createdAt,
            expiresAt: createdAt + this.waiterTtlMs,
        };
        const digest = createHash("sha256").update(`${ownerId}|${waiterId}`).digest("hex").slice(0, 24);
        const path = resolve(this.waiterDir, `wait-${digest}.json`);
        await writeFile(path, `${JSON.stringify(waiter)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return { waiter, path };
    }

    private async activeWaiters(now = Date.now()) {
        const rows: Array<AccountLockWaiter & { path: string }> = [];
        let names: string[];
        try { names = await readdir(this.waiterDir); }
        catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return rows;
            throw error;
        }
        for (const name of names) {
            if (!/^wait-[0-9a-f]{24}\.json$/.test(name)) continue;
            const path = resolve(this.waiterDir, name);
            try {
                const raw = JSON.parse(await readFile(path, "utf8")) as Partial<AccountLockWaiter>;
                if (raw.schema !== ACCOUNT_LOCK_WAITER_SCHEMA || typeof raw.ownerId !== "string" || typeof raw.waiterId !== "string") {
                    await unlink(path).catch(() => undefined);
                    continue;
                }
                const expiresAt = Number(raw.expiresAt || 0);
                if (!(expiresAt > now)) {
                    await unlink(path).catch(() => undefined);
                    continue;
                }
                rows.push({
                    schema: ACCOUNT_LOCK_WAITER_SCHEMA,
                    ownerId: raw.ownerId,
                    waiterId: raw.waiterId,
                    priority: Number(raw.priority) || accountOrderPriority(raw.ownerId),
                    createdAt: Number(raw.createdAt) || now,
                    expiresAt,
                    path,
                });
            } catch {
                await unlink(path).catch(() => undefined);
            }
        }
        return rows.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt || a.ownerId.localeCompare(b.ownerId) || a.waiterId.localeCompare(b.waiterId));
    }

    private async arbitrationAllows(waiterId: string) {
        if (this.arbitrationMs > 0) await sleep(this.arbitrationMs);
        const waiters = await this.activeWaiters();
        return waiters.length > 0 && waiters[0].waiterId === waiterId;
    }

    /**
     * A hard-killed strategy process can leave the account lock behind after a
     * durable pending record was written. We only take over that expired lock
     * when the original owner PID is definitely gone and any active reservation
     * matches the durable pending transaction. The lock is replaced atomically,
     * so another sleeve never sees an unlocked gap during recovery.
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
                // Invariant: reserve -> durable pending -> send. If pending is
                // absent, the crashed process could not have sent a new-entry
                // order under this reservation (or already reconciled it).
                current = { ...current, reservations: current.reservations.map((row) => row.status === "RESERVED" ? { ...row, status: "RELEASED" as const } : row) };
            } else {
                const pendingSymbol = this.recovery.fixedSymbol || String(pending.symbol || "").toUpperCase();
                const pendingSide = normalizedReservationSide(pending.side);
                if (!pendingSymbol || !pendingSide || !active.every((row) => row.strategyId === this.recovery!.strategyId && row.symbol === pendingSymbol && row.side === pendingSide)) return null;
            }
        }

        let latest: AccountLockDocument;
        try { latest = await this.read(); }
        catch { return null; }
        if (latest.leaseId !== current.leaseId || latest.ownerId !== current.ownerId || latest.expiresAt !== current.expiresAt) return null;

        const leaseId = randomUUID();
        const document: AccountLockDocument = { ...current, ownerId, leaseId, acquiredAt: now, expiresAt: now + this.leaseMs };
        await atomicWrite(this.path, document);
        return this.createHandle(ownerId, leaseId, now);
    }

    async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        await mkdir(dirname(this.path), { recursive: true });
        const registered = await this.registerWaiter(ownerId);
        try {
            if (!await this.arbitrationAllows(registered.waiter.waiterId)) return null;
            const leaseId = randomUUID();
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
        } finally {
            await unlink(registered.path).catch(() => undefined);
        }
    }
}

export function activeReservedGross(document: AccountLockDocument) { return document.reservations.filter((row) => row.status === "RESERVED").reduce((sum, row) => sum + Number(row.gross || 0), 0); }
