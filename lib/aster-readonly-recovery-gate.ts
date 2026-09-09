export interface AsterReadOnlyRecoveryClient {
    ping(): Promise<unknown>;
    getBalances(): Promise<unknown>;
    getPositions(): Promise<unknown>;
    getOpenOrders(): Promise<unknown>;
}

export type AsterReadOnlyRecoveryGateOptions = {
    requiredConsecutiveSuccesses?: number;
    requestSpacingMs?: number;
    roundSpacingMs?: number;
    requireFlat?: boolean;
    sleep?: (ms: number) => Promise<void>;
};

export type AsterReadOnlyRecoveryGateResult = {
    status: "ASTER_READONLY_RECOVERY_STREAK_PASS";
    consecutiveSuccesses: number;
    openPositionCount: number;
    openOrderCount: number;
    balancesRead: true;
    ordersSent: false;
    cancelSent: false;
    positionChangesSent: false;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(value as number)));
}

function asRows(value: unknown, label: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new Error(`ASTER_READONLY_RECOVERY_INVALID_${label}`);
    return value as Record<string, unknown>[];
}

function openPositionCount(rows: Record<string, unknown>[]) {
    return rows.filter((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12).length;
}

export async function runAsterReadOnlyRecoveryGate(
    client: AsterReadOnlyRecoveryClient,
    options: AsterReadOnlyRecoveryGateOptions = {},
): Promise<AsterReadOnlyRecoveryGateResult> {
    const required = boundedInteger(options.requiredConsecutiveSuccesses, 3, 2, 10);
    const requestSpacingMs = boundedInteger(options.requestSpacingMs, 750, 0, 30_000);
    const roundSpacingMs = boundedInteger(options.roundSpacingMs, 5_000, 0, 120_000);
    const requireFlat = options.requireFlat !== false;
    const sleep = options.sleep || defaultSleep;
    let latestOpenPositions = 0;
    let latestOpenOrders = 0;

    for (let round = 1; round <= required; round += 1) {
        try {
            await client.ping();
            await sleep(requestSpacingMs);
            const balances = asRows(await client.getBalances(), "BALANCES");
            await sleep(requestSpacingMs);
            const positions = asRows(await client.getPositions(), "POSITIONS");
            await sleep(requestSpacingMs);
            const openOrders = asRows(await client.getOpenOrders(), "OPEN_ORDERS");
            latestOpenPositions = openPositionCount(positions);
            latestOpenOrders = openOrders.length;
            void balances;
            if (requireFlat && (latestOpenPositions !== 0 || latestOpenOrders !== 0)) {
                throw new Error(`ASTER_READONLY_RECOVERY_NOT_FLAT:round=${round}:positions=${latestOpenPositions}:orders=${latestOpenOrders}`);
            }
            if (round < required) await sleep(roundSpacingMs);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith("ASTER_READONLY_RECOVERY_NOT_FLAT:")) throw error;
            throw new Error(`ASTER_READONLY_RECOVERY_ROUND_FAILED:round=${round}:${message}`);
        }
    }

    return {
        status: "ASTER_READONLY_RECOVERY_STREAK_PASS",
        consecutiveSuccesses: required,
        openPositionCount: latestOpenPositions,
        openOrderCount: latestOpenOrders,
        balancesRead: true,
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    };
}
