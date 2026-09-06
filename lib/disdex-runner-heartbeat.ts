import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DISDEX_RUNNER_HEARTBEAT_SCHEMA = "disdex-runner-heartbeat/v1" as const;

export type RunnerHeartbeatSafetyState = "HEALTHY" | "BLOCKED" | "MANUAL_REVIEW" | "UNKNOWN";

export interface RunnerHeartbeatGrossCaps {
    strategy: number;
    crypto: number;
    total: number;
}

export interface RunnerHeartbeatInput {
    runnerId: string;
    serviceUnit: string;
    runtimeSha: string;
    expectedSha: string;
    workingDirectory: string;
    mode: string;
    liveEnabled: boolean;
    safetyState: RunnerHeartbeatSafetyState;
    heartbeatAt: number;
    lastTickAt: number;
    lastReconciliationAt?: number;
    status: string;
    reason?: string;
    symbols?: readonly string[];
    grossCaps?: RunnerHeartbeatGrossCaps;
    quality102?: {
        selectorMode?: string;
        historicalSelectorParity?: boolean;
        brkLiveEnabled?: boolean;
    };
}

export interface RunnerHeartbeatDocument extends RunnerHeartbeatInput {
    schema: typeof DISDEX_RUNNER_HEARTBEAT_SCHEMA;
    symbols?: string[];
    /** Compatibility aliases consumed by the existing HP/alert reader. */
    lastDecision: string;
    updatedAt: number;
    caps?: RunnerHeartbeatGrossCaps;
}

function finiteTimestamp(value: number, field: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`RUNNER_HEARTBEAT_${field.toUpperCase()}_INVALID`);
    return value;
}

function validate(input: RunnerHeartbeatInput): RunnerHeartbeatDocument {
    for (const [field, value] of Object.entries({
        runnerId: input.runnerId,
        serviceUnit: input.serviceUnit,
        runtimeSha: input.runtimeSha,
        expectedSha: input.expectedSha,
        workingDirectory: input.workingDirectory,
        mode: input.mode,
        status: input.status,
    })) {
        if (typeof value !== "string" || !value.trim()) throw new Error(`RUNNER_HEARTBEAT_${field.toUpperCase()}_INVALID`);
    }
    finiteTimestamp(input.heartbeatAt, "heartbeat_at");
    finiteTimestamp(input.lastTickAt, "last_tick_at");
    if (input.lastReconciliationAt !== undefined) finiteTimestamp(input.lastReconciliationAt, "last_reconciliation_at");
    if (input.grossCaps) {
        if (![input.grossCaps.strategy, input.grossCaps.crypto, input.grossCaps.total].every((value) => Number.isFinite(value) && value >= 0)) {
            throw new Error("RUNNER_HEARTBEAT_GROSS_CAPS_INVALID");
        }
    }
    return {
        schema: DISDEX_RUNNER_HEARTBEAT_SCHEMA,
        ...input,
        symbols: input.symbols ? [...new Set(input.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))].sort() : undefined,
        lastDecision: input.status,
        updatedAt: input.heartbeatAt,
        caps: input.grossCaps,
    };
}

/** Atomically replace a heartbeat document; never include credentials or secrets. */
export async function writeRunnerHeartbeat(path: string, input: RunnerHeartbeatInput): Promise<void> {
    if (!path || !path.trim()) throw new Error("RUNNER_HEARTBEAT_PATH_REQUIRED");
    const document = validate(input);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
        await rename(temporaryPath, path);
    } catch (error) {
        try { await unlink(temporaryPath); } catch { /* best effort cleanup */ }
        throw error;
    }
}
