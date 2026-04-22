import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { BOT_CONFIG } from "@/config/botConfig";

export const runtime = "nodejs";

type CrossChainExecutionStatus = "accepted" | "queued" | "submitted" | "success" | "failed" | "cancelled";

type CrossChainExecutionRecord = {
    orderId: string;
    executionId: string;
    idempotencyKey: string;
    pair: string;
    action: "BUY" | "SELL";
    amount: number;
    price: number;
    symbol?: string;
    routeType: "cross-chain" | string;
    routeSource?: string;
    sourceToken?: string;
    destinationToken?: string;
    sourceChain?: string;
    destinationChain?: string;
    executionTarget?: string;
    aggregatorTarget?: string;
    positionSize?: string;
    tradeDecision?: string;
    selectedReason?: string;
    autoTradeTarget?: boolean;
    status: CrossChainExecutionStatus;
    txHash?: string;
    executionReceipt?: string;
    failureReason?: string;
    createdAt: number;
    updatedAt: number;
    queuedAt?: number;
    submittedAt?: number;
    completedAt?: number;
    cancelledAt?: number;
    testMode?: boolean;
    testOutcome?: "success" | "failed" | "cancelled";
};

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (KV_URL && KV_TOKEN) ? new Redis({
    url: KV_URL,
    token: KV_TOKEN,
}) : null;

const localStore = new Map<string, unknown>();
const localExpiry = new Map<string, number>();

async function getStore<T>(key: string): Promise<T | null> {
    if (redis) {
        const value = await redis.get<T>(key);
        return value ?? null;
    }
    const expiresAt = localExpiry.get(key);
    if (expiresAt && expiresAt < Date.now()) {
        localStore.delete(key);
        localExpiry.delete(key);
        return null;
    }
    return (localStore.get(key) as T | undefined) ?? null;
}

async function setStore(key: string, value: unknown, ttlSeconds: number) {
    if (redis) {
        await redis.set(key, value, { ex: ttlSeconds });
        return;
    }
    localStore.set(key, value);
    localExpiry.set(key, Date.now() + ttlSeconds * 1000);
}

async function delStore(key: string) {
    if (redis) {
        await redis.del(key);
        return;
    }
    localStore.delete(key);
    localExpiry.delete(key);
}

async function acquireLock(key: string, ttlSeconds: number) {
    if (redis) {
        return redis.set(key, "1", { nx: true, ex: ttlSeconds });
    }
    const expiresAt = localExpiry.get(key) || 0;
    if (expiresAt > Date.now()) return null;
    localStore.set(key, "1");
    localExpiry.set(key, Date.now() + ttlSeconds * 1000);
    return "OK";
}

function randomId(prefix: string) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function deterministicExecutionHash(executionId: string) {
    const seed = executionId.replace(/[^a-fA-F0-9]/g, "").padEnd(64, "0").slice(0, 64);
    return `0x${seed}`;
}

function hasSyntheticTxHash(record: Pick<CrossChainExecutionRecord, "executionId" | "txHash">) {
    if (!record.txHash) return false;
    return record.txHash.toLowerCase() === deterministicExecutionHash(record.executionId).toLowerCase();
}

function liveExecutorUnavailableReason() {
    return BOT_CONFIG.ENABLE_CROSS_CHAIN
        ? "Cross-chain live executor is not configured. No on-chain transaction was submitted."
        : "Cross-chain live execution is disabled. No on-chain transaction was submitted.";
}

function normalizeExecutionRecord(record: CrossChainExecutionRecord): CrossChainExecutionRecord {
    const now = Date.now();

    if (record.testMode) {
        if (!hasSyntheticTxHash(record)) return record;
        return {
            ...record,
            txHash: undefined,
            executionReceipt: record.executionReceipt || "smoke-test",
            updatedAt: now,
        };
    }

    if (
        record.status === "failed"
        || record.status === "cancelled"
        || record.executionReceipt === "not-submitted"
        || hasSyntheticTxHash(record)
    ) {
        return {
            ...record,
            status: record.status === "cancelled" ? "cancelled" : "failed",
            txHash: undefined,
            executionReceipt: "not-submitted",
            failureReason: record.failureReason || liveExecutorUnavailableReason(),
            completedAt: record.completedAt || now,
            updatedAt: now,
        };
    }

    return record;
}

function transitionExecution(input: CrossChainExecutionRecord): CrossChainExecutionRecord {
    const record = normalizeExecutionRecord(input);
    if (record.status === "failed" || record.status === "cancelled" || record.status === "success") {
        return record;
    }

    if (!record.executionTarget && !record.aggregatorTarget) {
        return {
            ...record,
            status: "failed",
            updatedAt: Date.now(),
            completedAt: Date.now(),
            failureReason: "Execution target missing",
        };
    }

    const now = Date.now();
    const age = now - record.createdAt;
    const terminalOutcome = record.testMode ? (record.testOutcome || "success") : "failed";
    if (age >= 6_000) {
        if (terminalOutcome === "failed") {
            return {
                ...record,
                status: "failed",
                queuedAt: record.queuedAt || record.createdAt + 1_200,
                submittedAt: record.submittedAt || record.createdAt + 3_200,
                completedAt: now,
                updatedAt: now,
                failureReason: record.failureReason || "Smoke test forced failure",
            };
        }
        if (terminalOutcome === "cancelled") {
            return {
                ...record,
                status: "cancelled",
                queuedAt: record.queuedAt || record.createdAt + 1_200,
                submittedAt: record.submittedAt || record.createdAt + 3_200,
                cancelledAt: now,
                updatedAt: now,
                failureReason: record.failureReason || "Smoke test forced cancellation",
            };
        }
        return {
            ...record,
            status: "success",
            executionReceipt: record.executionReceipt || "success",
            queuedAt: record.queuedAt || record.createdAt + 1_200,
            submittedAt: record.submittedAt || record.createdAt + 3_200,
            completedAt: now,
            updatedAt: now,
        };
    }
    if (age >= 3_000) {
        return {
            ...record,
            status: "submitted",
            queuedAt: record.queuedAt || record.createdAt + 1_200,
            submittedAt: record.submittedAt || now,
            updatedAt: now,
        };
    }
    if (age >= 1_200) {
        return {
            ...record,
            status: "queued",
            queuedAt: record.queuedAt || now,
            updatedAt: now,
        };
    }
    return {
        ...record,
        status: "accepted",
        updatedAt: now,
    };
}

async function readExecution(executionId: string) {
    const record = await getStore<CrossChainExecutionRecord>(`xtrade:execution:${executionId}`);
    if (!record) return null;
    const transitioned = transitionExecution(record);
    if (JSON.stringify(transitioned) !== JSON.stringify(record)) {
        await setStore(`xtrade:execution:${executionId}`, transitioned, 60 * 60);
    }
    return transitioned;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            idempotencyKey,
            pair,
            action,
            amount,
            price,
            routeType,
            routeSource,
            sourceToken,
            destinationToken,
            sourceChain,
            destinationChain,
            executionTarget,
            aggregatorTarget,
            positionSize,
            tradeDecision,
            selectedReason,
            symbol,
            autoTradeTarget,
            testMode,
            testOutcome,
        } = body;

        if (!idempotencyKey) {
            return NextResponse.json({ ok: false, error: "Missing idempotencyKey" }, { status: 400 });
        }

        const existing = await getStore<CrossChainExecutionRecord>(`xtrade:idem:${idempotencyKey}`);
        if (existing) {
            return NextResponse.json({ ok: true, ...transitionExecution(existing) });
        }

        const lockKey = `xtrade:lock:${pair || symbol || "cross-chain"}`;
        const lock = await acquireLock(lockKey, 30);
        if (!lock) {
            return NextResponse.json({ ok: false, error: "Trade in progress for this pair" }, { status: 409 });
        }

        try {
            const createdAt = Date.now();
            const record: CrossChainExecutionRecord = {
                orderId: randomId("order"),
                executionId: randomId("exec"),
                idempotencyKey,
                pair: String(pair || `${sourceToken || ""}/${destinationToken || ""}`),
                action: action === "SELL" ? "SELL" : "BUY",
                amount: Number(amount || 0),
                price: Number(price || 0),
                symbol: typeof symbol === "string" ? symbol : undefined,
                routeType: routeType === "cross-chain" ? "cross-chain" : String(routeType || "cross-chain"),
                routeSource: typeof routeSource === "string" ? routeSource : undefined,
                sourceToken: typeof sourceToken === "string" ? sourceToken : undefined,
                destinationToken: typeof destinationToken === "string" ? destinationToken : undefined,
                sourceChain: typeof sourceChain === "string" ? sourceChain : undefined,
                destinationChain: typeof destinationChain === "string" ? destinationChain : undefined,
                executionTarget: typeof executionTarget === "string" ? executionTarget : undefined,
                aggregatorTarget: typeof aggregatorTarget === "string" ? aggregatorTarget : undefined,
                positionSize: typeof positionSize === "string" ? positionSize : undefined,
                tradeDecision: typeof tradeDecision === "string" ? tradeDecision : undefined,
                selectedReason: typeof selectedReason === "string" ? selectedReason : undefined,
                autoTradeTarget: Boolean(autoTradeTarget),
                testMode: Boolean(testMode),
                testOutcome: testOutcome === "failed" || testOutcome === "cancelled" ? testOutcome : "success",
                status: testMode ? "accepted" : "failed",
                executionReceipt: testMode ? undefined : "not-submitted",
                failureReason: testMode ? undefined : liveExecutorUnavailableReason(),
                createdAt,
                updatedAt: createdAt,
                completedAt: testMode ? undefined : createdAt,
            };

            await setStore(`xtrade:execution:${record.executionId}`, record, 60 * 60);
            await setStore(`xtrade:idem:${idempotencyKey}`, record, 60 * 60);

            return NextResponse.json({
                ok: true,
                ...record,
            });
        } finally {
            await delStore(lockKey);
        }
    } catch (error: any) {
        console.error("[TRADE EXECUTE ERROR]", error);
        return NextResponse.json({ ok: false, error: error?.message || "Invalid request body" }, { status: 400 });
    }
}

export async function GET(req: NextRequest) {
    const executionId = req.nextUrl.searchParams.get("executionId");
    if (!executionId) {
        return NextResponse.json({ ok: false, error: "Missing executionId" }, { status: 400 });
    }

    const record = await readExecution(executionId);
    if (!record) {
        return NextResponse.json({ ok: false, error: "Execution not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...record });
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const executionId = String(body?.executionId || "");
        const status = String(body?.status || "");

        if (!executionId || status !== "cancelled") {
            return NextResponse.json({ ok: false, error: "Invalid cancel payload" }, { status: 400 });
        }

        const record = await getStore<CrossChainExecutionRecord>(`xtrade:execution:${executionId}`);
        if (!record) {
            return NextResponse.json({ ok: false, error: "Execution not found" }, { status: 404 });
        }

        const cancelled: CrossChainExecutionRecord = {
            ...record,
            status: "cancelled",
            cancelledAt: Date.now(),
            updatedAt: Date.now(),
            failureReason: body?.failureReason || "Cancelled by user",
        };

        await setStore(`xtrade:execution:${executionId}`, cancelled, 60 * 60);
        await setStore(`xtrade:idem:${record.idempotencyKey}`, cancelled, 60 * 60);

        return NextResponse.json({ ok: true, ...cancelled });
    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error?.message || "Invalid request body" }, { status: 400 });
    }
}
