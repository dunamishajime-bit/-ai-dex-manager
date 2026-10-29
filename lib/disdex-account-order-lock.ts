import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pendingExposurePath, releasePendingExposure, upsertPendingExposure } from "./disdex-pending-exposure-registry";

export const ACCOUNT_LOCK_SCHEMA = "disdex-account-lock/v1" as const;
export const DEFAULT_ACCOUNT_SCOPE = "ASTER_FUTURES" as const;
export const ACCOUNT_LOCK_EVENT_SCHEMA = "disdex-account-lock-event/v1" as const;

export type AccountLockDiagnostic = {
    schema: typeof ACCOUNT_LOCK_EVENT_SCHEMA;
    event: "CONTENDED" | "ACQUIRED" | "RENEWED" | "RELEASED" | "RELEASE_SKIPPED_OWNER_MISMATCH";
    at: number;
    path: string;
    ownerId?: string;
    contenderId?: string;
    waitMs?: number;
    leaseRemainingMs?: number;
    reason?: string;
};

export type AccountLockDiagnosticSink = (event: AccountLockDiagnostic) => void;

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
    /** The interval used by long-running protected work to renew this lease. */
    renewalIntervalMs: number;
    document(): Promise<AccountLockDocument>;
    /** Extend the lease only after re-validating the exact owner and lease ID. */
    renew(): Promise<AccountLockDocument>;
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

function emitAccountLockDiagnostic(
    sink: AccountLockDiagnosticSink | undefined,
    event: Omit<AccountLockDiagnostic, "schema" | "at">,
) {
    const record: AccountLockDiagnostic = {
        schema: ACCOUNT_LOCK_EVENT_SCHEMA,
        at: Date.now(),
        ...event,
    };
    try {
        (sink || ((value: AccountLockDiagnostic) => console.info(`[DISDEX_ACCOUNT_LOCK] ${JSON.stringify(value)}`)))(record);
    } catch {
        // Observability cannot change lease ownership or release behavior.
    }
}

async function atomicWrite(path: string, document: AccountLockDocument) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temp, path);
    } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}

function errorCode(error: unknown) {
    return error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
}

export class FileAccountOrderLock {
    private readonly path: string;

    constructor(
        path = process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock",
        private readonly leaseMs = 120_000,
        pendingPath = process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH,
        private readonly onDiagnostic?: AccountLockDiagnosticSink,
    ) {
        this.path = resolve(path);
        this.pendingPath = pendingExposurePath(pendingPath || resolve(dirname(this.path), "pending-exposure.json"));
    }

    private readonly pendingPath: string;

    private async read(): Promise<AccountLockDocument> {
        return normalize(JSON.parse(await readFile(this.path, "utf8")));
    }

    async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        const leaseId = randomUUID();
        const startedAt = Date.now();
        await mkdir(dirname(this.path), { recursive: true });

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const acquiredAt = Date.now();
            const document: AccountLockDocument = {
                schema: ACCOUNT_LOCK_SCHEMA,
                accountScope,
                ownerId,
                leaseId,
                acquiredAt,
                expiresAt: acquiredAt + this.leaseMs,
                reservations: [],
            };

            try {
                const fd = await open(this.path, "wx", 0o600);
                try {
                    await fd.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
                } finally {
                    await fd.close();
                }
                emitAccountLockDiagnostic(this.onDiagnostic, {
                    event: "ACQUIRED",
                    path: this.path,
                    ownerId,
                    waitMs: Math.max(0, Date.now() - startedAt),
                    leaseRemainingMs: this.leaseMs,
                });

                let released = false;
                let operationTail: Promise<void> = Promise.resolve();

                const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
                    const run = operationTail.then(task, task);
                    operationTail = run.then(() => undefined, () => undefined);
                    return run;
                };

                const assertOwner = async () => {
                    if (released) throw new Error("ACCOUNT_LOCK_RELEASED");
                    const current = await this.read();
                    if (
                        current.ownerId !== ownerId
                        || current.leaseId !== leaseId
                        || current.expiresAt <= Date.now()
                    ) {
                        throw new Error("ACCOUNT_LOCK_NOT_OWNER");
                    }
                    return current;
                };

                return {
                    ownerId,
                    leaseId,
                    acquiredAt,
                    renewalIntervalMs: Math.max(1_000, Math.floor(this.leaseMs / 3)),
                    document: () => enqueue(assertOwner),
                    renew: () => enqueue(async () => {
                        const current = await assertOwner();
                        const renewed = { ...current, expiresAt: Date.now() + this.leaseMs };
                        await atomicWrite(this.path, renewed);
                        emitAccountLockDiagnostic(this.onDiagnostic, {
                            event: "RENEWED",
                            path: this.path,
                            ownerId,
                            leaseRemainingMs: Math.max(0, renewed.expiresAt - Date.now()),
                        });
                        return renewed;
                    }),
                    reserve: (input) => enqueue(async () => {
                        if (!(validNumber(input.gross) && Number(input.gross) >= 0 && validNumber(input.notionalUsd) && Number(input.notionalUsd) >= 0)) {
                            throw new Error("ACCOUNT_RESERVATION_INVALID");
                        }
                        const current = await assertOwner();
                        const reservation: AccountReservation = {
                            ...input,
                            reservationId: createHash("sha256")
                                .update(`${leaseId}|${input.strategyId}|${input.symbol}|${input.side}|${input.gross}|${input.notionalUsd}`)
                                .digest("hex")
                                .slice(0, 24),
                            createdAt: Date.now(),
                            status: "RESERVED",
                        };
                        await atomicWrite(this.path, {
                            ...current,
                            expiresAt: Date.now() + this.leaseMs,
                            reservations: [
                                ...current.reservations.filter((row) => row.reservationId !== reservation.reservationId),
                                reservation,
                            ],
                        });
                        try {
                            await upsertPendingExposure({
                                reservationId: reservation.reservationId,
                                strategyId: reservation.strategyId,
                                sleeve: "CRYPTO",
                                symbol: reservation.symbol,
                                side: reservation.side,
                                gross: reservation.gross,
                                notionalUsd: reservation.notionalUsd,
                                createdAt: reservation.createdAt,
                                runtimeSha: process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA,
                            }, this.pendingPath);
                        } catch (error) {
                            await atomicWrite(this.path, {
                                ...current,
                                expiresAt: Date.now() + this.leaseMs,
                                reservations: current.reservations,
                            }).catch(() => undefined);
                            throw error;
                        }
                        return reservation;
                    }),
                    releaseReservation: (reservationId) => enqueue(async () => {
                        const current = await assertOwner();
                        await atomicWrite(this.path, {
                            ...current,
                            expiresAt: Date.now() + this.leaseMs,
                            reservations: current.reservations.map((row) => (
                                row.reservationId === reservationId
                                    ? { ...row, status: "RELEASED" as const }
                                : row
                            )),
                        });
                        await releasePendingExposure(reservationId, this.pendingPath);
                    }),
                    release: () => enqueue(async () => {
                        if (released) return;
                        try {
                            const current = await this.read();
                            if (current.ownerId !== ownerId || current.leaseId !== leaseId) {
                                emitAccountLockDiagnostic(this.onDiagnostic, {
                                    event: "RELEASE_SKIPPED_OWNER_MISMATCH",
                                    path: this.path,
                                    ownerId: current.ownerId,
                                    contenderId: ownerId,
                                    reason: "LEASE_OWNER_CHANGED",
                                });
                                released = true;
                                return;
                            }
                            await unlink(this.path);
                            emitAccountLockDiagnostic(this.onDiagnostic, {
                                event: "RELEASED",
                                path: this.path,
                                ownerId,
                            });
                            released = true;
                        } catch (error) {
                            if (errorCode(error) === "ENOENT") {
                                released = true;
                                return;
                            }
                            throw error;
                        }
                    }),
                };
            } catch (error) {
                if (errorCode(error) !== "EEXIST") throw error;

                let currentOwner: AccountLockDocument | undefined;
                try {
                    currentOwner = await this.read();
                } catch {
                    // Malformed or partially written state remains fail-closed;
                    // the diagnostic records the reason without exposing bytes.
                }
                emitAccountLockDiagnostic(this.onDiagnostic, {
                    event: "CONTENDED",
                    path: this.path,
                    ownerId: currentOwner?.ownerId,
                    contenderId: ownerId,
                    waitMs: Math.max(0, Date.now() - startedAt),
                    leaseRemainingMs: currentOwner ? Math.max(0, currentOwner.expiresAt - Date.now()) : undefined,
                    reason: currentOwner ? "LOCK_HELD" : "LOCK_UNREADABLE_OR_MALFORMED",
                });

                // The previous owner may have released after our exclusive-open
                // attempt failed but before we inspect the file. Retry exactly
                // once only when the path disappeared. Stale/malformed leases
                // remain fail-closed for reconciliation/manual review.
                try {
                    await this.read();
                    return null;
                } catch (readError) {
                    if (errorCode(readError) === "ENOENT" && attempt === 0) continue;
                    return null;
                }
            }
        }

        return null;
    }
}

export function activeReservedGross(document: AccountLockDocument) {
    return document.reservations
        .filter((row) => row.status === "RESERVED")
        .reduce((sum, row) => sum + Number(row.gross || 0), 0);
}
