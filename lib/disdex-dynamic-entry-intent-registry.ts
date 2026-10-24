import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { allocateDynamicEntryGross, type DynamicEntryAllocation, type DynamicEntryAllocationResult, type DynamicEntryCandidate } from "./disdex-dynamic-entry-allocation";
import type { AccountLockHandle } from "./disdex-account-order-lock";

export const DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA = "disdex-dynamic-entry-intents/v1" as const;
export type DynamicEntryIntent = DynamicEntryCandidate & { cycleId: string; submittedAt: number };
export type DynamicEntryAllocationDecision = DynamicEntryAllocationResult & { cycleId: string; decisionId: string; decidedAt: number };
type Document = { schema: typeof DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA; intents: DynamicEntryIntent[]; decisions: DynamicEntryAllocationDecision[] };

type AuthoritativeGrossCaps = {
    strategyGrossAvailable: Readonly<Record<string, number>>;
    positionGrossAvailable: Readonly<Record<string, number>>;
};

function assertCapMap(value: unknown, name: string): asserts value is Readonly<Record<string, number>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DYNAMIC_ENTRY_AUTHORITATIVE_CAPS_REQUIRED");
    for (const [key, cap] of Object.entries(value)) {
        if (!key.trim() || !Number.isFinite(cap) || cap < 0) throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_INVALID:${name}:${key}`);
    }
}

function positionCapKey(intent: Pick<DynamicEntryCandidate, "strategy" | "symbol" | "side">) {
    return `${intent.strategy}|${intent.symbol.toUpperCase()}|${intent.side}`;
}

function assertStrictReservationGates(candidates: readonly DynamicEntryIntent[], quality102CausalV1Ready: boolean) {
    if (candidates.some((intent) => intent.strategy === "QUALITY102")) throw new Error("QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");
    if (candidates.some((intent) => intent.strategy === "QUALITY102_CAUSAL_V1") && quality102CausalV1Ready !== true) {
        throw new Error("QUALITY102_CAUSAL_V1_NOT_READY");
    }
}

function assertCandidateCaps(candidates: readonly DynamicEntryIntent[], caps: AuthoritativeGrossCaps) {
    for (const intent of candidates) {
        if (!Object.prototype.hasOwnProperty.call(caps.strategyGrossAvailable, intent.strategy)) {
            throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING:strategy:${intent.strategy}`);
        }
        const key = positionCapKey(intent);
        if (!Object.prototype.hasOwnProperty.call(caps.positionGrossAvailable, key)) {
            throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING:position:${key}`);
        }
    }
}

function sanitizeIntent(input: DynamicEntryCandidate & { cycleId: string }, submittedAt: number): DynamicEntryIntent {
    const { id, strategy, symbol, side, assetClass, marketFitScore, targetGross, minGross, maxGross, minNotionalUsd, btPrior, correlationPenalty, concentrationPenalty, stalePenalty } = input;
    if (!id.trim() || !strategy.trim() || !symbol.trim() || !input.cycleId.trim() || (side !== "LONG" && side !== "SHORT") || (assetClass !== "CRYPTO" && assetClass !== "STOCK")
        || !Number.isFinite(marketFitScore) || !Number.isFinite(targetGross) || targetGross <= 0 || !Number.isFinite(minGross) || minGross <= 0
        || !Number.isFinite(maxGross) || maxGross < minGross || !Number.isFinite(submittedAt)
        || [minNotionalUsd, correlationPenalty, concentrationPenalty, stalePenalty].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) throw new Error("DYNAMIC_ENTRY_INTENT_INVALID");
    if (btPrior && Object.values(btPrior).some((n) => !Number.isFinite(n))) throw new Error("DYNAMIC_ENTRY_INTENT_BT_PRIOR_INVALID");
    return {
        cycleId: input.cycleId, submittedAt, id, strategy, symbol: symbol.toUpperCase(), side, assetClass,
        marketFitScore, targetGross, minGross, maxGross,
        ...(minNotionalUsd === undefined ? {} : { minNotionalUsd }),
        ...(btPrior === undefined ? {} : { btPrior: { returnPct: btPrior.returnPct, profitFactor: btPrior.profitFactor, winRatePct: btPrior.winRatePct, maxDrawdownPct: btPrior.maxDrawdownPct, tradeCount: btPrior.tradeCount, observationDays: btPrior.observationDays } }),
        ...(correlationPenalty === undefined ? {} : { correlationPenalty }),
        ...(concentrationPenalty === undefined ? {} : { concentrationPenalty }),
        ...(stalePenalty === undefined ? {} : { stalePenalty }),
    };
}

async function read(path: string): Promise<Document> {
    try {
        const value = JSON.parse(await readFile(path, "utf8")) as Document;
        if (value.schema !== DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA || !Array.isArray(value.intents) || !Array.isArray(value.decisions)) throw new Error("DYNAMIC_ENTRY_INTENT_REGISTRY_MALFORMED");
        return value;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA, intents: [], decisions: [] };
        throw error;
    }
}

async function write(path: string, doc: Document) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
    catch (error) { await unlink(temp).catch(() => undefined); throw error; }
}

export class FileDynamicEntryIntentRegistry {
    private readonly path: string;
    constructor(path: string, private readonly intentTtlMs = 30_000) {
        if (!Number.isFinite(intentTtlMs) || intentTtlMs <= 0) throw new Error("DYNAMIC_ENTRY_INTENT_TTL_INVALID");
        this.path = resolve(path);
    }

    private async synchronized<T>(work: () => Promise<T>): Promise<T> {
        const lockPath = `${this.path}.mutex`;
        await mkdir(dirname(this.path), { recursive: true });
        let fd;
        for (let tries = 0; tries < 500; tries += 1) {
            try { fd = await open(lockPath, "wx", 0o600); break; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 10)); }
        }
        if (!fd) throw new Error("DYNAMIC_ENTRY_INTENT_REGISTRY_BUSY");
        try { return await work(); } finally { await fd.close(); await unlink(lockPath).catch(() => undefined); }
    }

    async submit(intent: DynamicEntryCandidate & { cycleId: string }, submittedAt = Date.now()): Promise<DynamicEntryIntent> {
        const submitted = sanitizeIntent(intent, submittedAt);
        return this.synchronized(async () => {
            const doc = await read(this.path);
            if (doc.decisions.some((decision) => decision.cycleId === intent.cycleId)) throw new Error("DYNAMIC_ENTRY_CYCLE_ALREADY_DECIDED");
            doc.intents = [...doc.intents.filter((row) => !(row.cycleId === intent.cycleId && row.id === intent.id)), submitted];
            await write(this.path, doc);
            return submitted;
        });
    }

    async allocateCycle(input: {
        cycleId: string; now: number; cryptoGrossAvailable: number; stockGrossAvailable: number;
        totalGrossAvailable: number; equityUsd: number; lock: AccountLockHandle;
        quality102CausalV1Ready: boolean;
        strategyGrossAvailable: Readonly<Record<string, number>>;
        positionGrossAvailable: Readonly<Record<string, number>>;
    }): Promise<DynamicEntryAllocationDecision> {
        return this.synchronized(async () => {
            const doc = await read(this.path);
            const existing = doc.decisions.find((decision) => decision.cycleId === input.cycleId);
            if (existing) return existing;
            await input.lock.document(); // Revalidates owner, lease ID, and expiry before claiming the cycle.
            assertCapMap(input.strategyGrossAvailable, "strategy");
            assertCapMap(input.positionGrossAvailable, "position");
            const candidates = doc.intents.filter((intent) => intent.cycleId === input.cycleId && input.now >= intent.submittedAt && input.now - intent.submittedAt <= this.intentTtlMs).map((intent) => ({
                ...intent,
                maxGross: Math.min(intent.maxGross, input.strategyGrossAvailable[intent.strategy] ?? Number.POSITIVE_INFINITY, input.positionGrossAvailable[positionCapKey(intent)] ?? Number.POSITIVE_INFINITY),
            }));
            assertStrictReservationGates(candidates, input.quality102CausalV1Ready);
            assertCandidateCaps(candidates, input);
            const allocation = allocateDynamicEntryGross({ candidates, cryptoGrossAvailable: input.cryptoGrossAvailable, stockGrossAvailable: input.stockGrossAvailable, totalGrossAvailable: input.totalGrossAvailable, equityUsd: input.equityUsd });
            const strategyRemaining = { ...input.strategyGrossAvailable };
            const positionRemaining = { ...input.positionGrossAvailable };
            const bounded = allocation.allocations.flatMap((row) => {
                const positionKey = positionCapKey(row);
                const allocatedGross = Math.min(row.allocatedGross, strategyRemaining[row.strategy], positionRemaining[positionKey]);
                if (allocatedGross + 1e-12 < Math.max(row.minGross, row.minNotionalUsd ? row.minNotionalUsd / input.equityUsd : 0)) return [];
                if (strategyRemaining[row.strategy] !== undefined) strategyRemaining[row.strategy] = Math.max(0, strategyRemaining[row.strategy] - allocatedGross);
                if (positionRemaining[positionKey] !== undefined) positionRemaining[positionKey] = Math.max(0, positionRemaining[positionKey] - allocatedGross);
                return [{ ...row, allocatedGross }];
            });
            allocation.allocations = bounded;
            const cryptoAllocated = bounded.filter((row) => row.assetClass === "CRYPTO").reduce((sum, row) => sum + row.allocatedGross, 0);
            const stockAllocated = bounded.filter((row) => row.assetClass === "STOCK").reduce((sum, row) => sum + row.allocatedGross, 0);
            allocation.residual = { cryptoGross: Math.max(0, input.cryptoGrossAvailable - cryptoAllocated), stockGross: Math.max(0, input.stockGrossAvailable - stockAllocated), totalGross: Math.max(0, input.totalGrossAvailable - cryptoAllocated - stockAllocated) };
            const reservations: string[] = [];
            try {
                for (const row of allocation.allocations) {
                    const reservation = await input.lock.reserve({ strategyId: row.strategy, symbol: row.symbol, side: row.side, sleeve: row.assetClass, gross: row.allocatedGross, notionalUsd: row.allocatedGross * input.equityUsd });
                    reservations.push(reservation.reservationId);
                }
                await input.lock.document();
                const decisionId = createHash("sha256").update(`${input.cycleId}|${allocation.allocations.map((row) => `${row.id}:${row.allocatedGross}`).join("|")}`).digest("hex").slice(0, 24);
                const decision = { ...allocation, cycleId: input.cycleId, decisionId, decidedAt: input.now };
                doc.decisions.push(decision);
                await write(this.path, doc);
                return decision;
            } catch (error) {
                for (const id of reservations.reverse()) await input.lock.releaseReservation(id).catch(() => undefined);
                throw error;
            }
        });
    }
}

export type { DynamicEntryAllocation };
