import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";

const LIVE_CHECK_LATEST_KEY = "strategy:live-check:latest";
const LIVE_CHECK_OWNER_PREFIX = "strategy:live-check:owner:";
const LIVE_CHECK_TTL_SECONDS = 60 * 60 * 24 * 2;
const LIVE_CHECK_STALE_SECONDS = 60 * 15;

type StrategyLiveCheckSnapshot = {
    syncedAt: number;
    ownerId: string;
    walletAddress?: string | null;
    chainId?: number | null;
    liveMonitor: {
        monitoredAt?: number;
        currentBlock?: string;
        selectedBasketCap?: number;
        prefilterMode?: string;
        prefilterPassCount?: number;
        selectionEligibleCount?: number;
        selectedCount?: number;
        orderArmedCount?: number;
        selectedOrderBlockedCount?: number;
        finalAlignmentWaitCount?: number;
        waitingForSlotCount?: number;
        probationaryCount?: number;
        triggeredCount?: number;
        readyCount?: number;
        armedCount?: number;
        ordersTodayCount?: number;
        selectedByChain?: { BNB: number; SOLANA: number };
        orderArmedByChain?: { BNB: number; SOLANA: number };
        probationByChain?: { BNB: number; SOLANA: number };
        selectedRows?: Array<{
            symbol: string;
            chain: "BNB" | "SOLANA";
            positionSizeLabel?: string;
            triggerState?: string;
            orderGateStatus?: string;
            reason?: string;
        }>;
        orderArmedRows?: Array<{
            symbol: string;
            chain: "BNB" | "SOLANA";
            positionSizeLabel?: string;
            triggerState?: string;
            reason?: string;
        }>;
        blockedRows?: Array<{
            symbol: string;
            chain: "BNB" | "SOLANA";
            positionSizeLabel?: string;
            triggerState?: string;
            reason?: string;
        }>;
        probationRows?: Array<{
            symbol: string;
            chain: "BNB" | "SOLANA";
            positionSizeLabel?: string;
            triggerState?: string;
            reason?: string;
        }>;
        topBlockers?: Array<{ reason: string; count: number }>;
    };
    newMuch: {
        latestFixedSlot?: string | null;
        latestFixedAt?: number | null;
        latestEvaluationSlot?: string | null;
        latestEvaluationAt?: number | null;
        latestIntradayPromotedCount?: number;
        latestIntradayPromotedSymbols?: string[];
    };
    runtime: {
        lastAutoPilotStatus?: string | null;
        isAutoPilotEnabled?: boolean;
        isSimulating?: boolean;
        isDemoMode?: boolean;
        walletConnected?: boolean;
    };
};

function ownerKey(ownerId: string) {
    return `${LIVE_CHECK_OWNER_PREFIX}${ownerId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
    const ownerId = request.nextUrl.searchParams.get("ownerId");
    const key = ownerId ? ownerKey(ownerId) : LIVE_CHECK_LATEST_KEY;
    const snapshot = await kvGet<StrategyLiveCheckSnapshot>(key);

    if (!snapshot) {
        return NextResponse.json({
            ok: true,
            snapshot: null,
            stale: true,
            ageSec: null,
            message: "No live snapshot synced yet. Open /strategy or /newmuch in the browser to push the current state.",
        });
    }

    const ageSec = Math.max(0, Math.round((Date.now() - Number(snapshot.syncedAt || 0)) / 1000));
    return NextResponse.json({
        ok: true,
        snapshot,
        stale: ageSec > LIVE_CHECK_STALE_SECONDS,
        ageSec,
    });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const ownerId = typeof body?.ownerId === "string" && body.ownerId.trim()
            ? body.ownerId.trim()
            : "public";
        const snapshot = body?.snapshot;

        if (!isObject(snapshot) || !isObject(snapshot.liveMonitor) || !isObject(snapshot.newMuch) || !isObject(snapshot.runtime)) {
            return NextResponse.json({ ok: false, error: "Invalid snapshot payload" }, { status: 400 });
        }

        const normalized: StrategyLiveCheckSnapshot = {
            syncedAt: Number(snapshot.syncedAt || Date.now()),
            ownerId,
            walletAddress: typeof body?.walletAddress === "string" ? body.walletAddress : null,
            chainId: Number.isFinite(Number(body?.chainId)) ? Number(body.chainId) : null,
            liveMonitor: snapshot.liveMonitor as StrategyLiveCheckSnapshot["liveMonitor"],
            newMuch: snapshot.newMuch as StrategyLiveCheckSnapshot["newMuch"],
            runtime: snapshot.runtime as StrategyLiveCheckSnapshot["runtime"],
        };

        await kvSet(ownerKey(ownerId), normalized, LIVE_CHECK_TTL_SECONDS);
        await kvSet(LIVE_CHECK_LATEST_KEY, normalized, LIVE_CHECK_TTL_SECONDS);

        return NextResponse.json({ ok: true, ownerId, syncedAt: normalized.syncedAt });
    } catch (error) {
        console.error("[strategy/live-check] Failed to sync snapshot:", error);
        return NextResponse.json({ ok: false, error: "Failed to sync live snapshot" }, { status: 500 });
    }
}
