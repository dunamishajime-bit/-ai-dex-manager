import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { IdleBaselineAdmission } from "./idle-priority-short-live";
import { IDLE_BASELINE_ADMISSION_SCHEMA, normalizeIdleBaselineAdmission } from "./idle-priority-short-live";

type JsonRecord = Record<string, unknown>;

export type BaselineAdmissionEvidenceInput = {
    runtimeSha: string;
    decisionTs: number;
    now?: number;
    baselineOpenPositions: number;
    baselinePendingExposure: number;
    decisionPath: string;
    v12Path: string;
    q102Path: string;
    penguPath: string;
    fetPath: string;
    v52Path: string;
};

function record(value: unknown, code: string): JsonRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
    return value as JsonRecord;
}

async function readJson(path: string): Promise<JsonRecord> {
    try {
        return record(JSON.parse(await readFile(path, "utf8")), "BASELINE_ADMISSION_SOURCE_MALFORMED");
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
        if (error instanceof Error && error.message.startsWith("BASELINE_ADMISSION_SOURCE_MALFORMED")) throw error;
        throw new Error(`BASELINE_ADMISSION_SOURCE_INCOMPLETE:${path}`);
    }
}

function finite(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function assertCurrentTimestamp(value: unknown, decisionTs: number) {
    if (finite(value) !== decisionTs) throw new Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");
}

function acceptedByV12(snapshot: JsonRecord, decisionTs: number) {
    if (snapshot.schema !== "v12-decision-observation/v1" || snapshot.strategyId !== "V12_X1.00_ALL") throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
    assertCurrentTimestamp(snapshot.referenceTs, decisionTs);
    return snapshot.reason === "SIGNAL_AVAILABLE";
}

function acceptedByQ102(snapshot: JsonRecord, decisionTs: number) {
    if (snapshot.strategyId !== "QUALITY102_CAUSAL_V1" || snapshot.selectorMode !== "CAUSAL_V4") throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
    assertCurrentTimestamp(snapshot.referenceTs, decisionTs);
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    return items.some((item) => {
        const row = record(item, "BASELINE_ADMISSION_SOURCE_MALFORMED");
        return row.selected === true && row.eligible === true && row.side !== "WAIT";
    });
}

function acceptedByPengu(snapshot: JsonRecord, decisionTs: number) {
    if (snapshot.strategyId !== "PENGU_DUAL_LS_V2_FINAL") throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
    if ((finite(snapshot.lastRunAt) ?? 0) < decisionTs || (finite(snapshot.updatedAt) ?? 0) < decisionTs) {
        throw new Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");
    }
    if (snapshot.latestSignal == null) return false;
    const signal = record(snapshot.latestSignal, "BASELINE_ADMISSION_SOURCE_MALFORMED");
    if (signal.referenceTs === undefined || finite(signal.referenceTs) !== decisionTs) return false;
    return Number(signal.targetGross) > 0 && Number(signal.side) !== 0;
}

function acceptedByFet(snapshot: JsonRecord, decisionTs: number) {
    if (snapshot.schema !== "fet-brk48-residual-state/v1") throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
    if (finite(snapshot.lastEvaluationDecisionTs) !== decisionTs || (finite(snapshot.updatedAt) ?? 0) < decisionTs) {
        throw new Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");
    }
    if (snapshot.lastEvaluationCandidate === true) return true;
    if (snapshot.lastEvaluationCandidate !== false) throw new Error("BASELINE_ADMISSION_SOURCE_INCOMPLETE");
    return false;
}

function acceptedByV52(snapshot: JsonRecord, decisionTs: number) {
    if (snapshot.strategyId !== "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96") throw new Error("BASELINE_ADMISSION_SOURCE_MALFORMED");
    if (finite(snapshot.idleAdmissionDecisionTs) !== decisionTs || (finite(snapshot.updatedAt) ?? 0) < decisionTs) {
        throw new Error("BASELINE_ADMISSION_SOURCE_STALE_OR_TS_MISMATCH");
    }
    const diagnostics = snapshot.v52GateDiagnostics;
    if (diagnostics && typeof diagnostics === "object") {
        const lastDecision = (diagnostics as JsonRecord).lastDecision;
        if (lastDecision && typeof lastDecision === "object") {
            const row = record(lastDecision, "BASELINE_ADMISSION_SOURCE_MALFORMED");
            const timestamp = row.decisionTs ?? row.timestamp ?? row.ts;
            if (timestamp !== undefined && finite(timestamp) === decisionTs) return row.accepted === true;
        }
    }
    return false;
}

async function writeAtomic(path: string, value: IdleBaselineAdmission) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
        await chmod(path, 0o600);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

export async function buildBaselineAdmissionEvidence(input: BaselineAdmissionEvidenceInput): Promise<IdleBaselineAdmission> {
    const now = input.now ?? Date.now();
    const [v12, q102, pengu, fet, v52] = await Promise.all([
        readJson(input.v12Path),
        readJson(input.q102Path),
        readJson(input.penguPath),
        readJson(input.fetPath),
        readJson(input.v52Path),
    ]);
    const baselineAcceptedThisTimestamp = [
        acceptedByV12(v12, input.decisionTs),
        acceptedByQ102(q102, input.decisionTs),
        acceptedByPengu(pengu, input.decisionTs),
        acceptedByFet(fet, input.decisionTs),
        acceptedByV52(v52, input.decisionTs),
    ].some(Boolean) ? 1 : 0;
    if (!Number.isFinite(input.baselineOpenPositions) || input.baselineOpenPositions < 0 || !Number.isFinite(input.baselinePendingExposure) || input.baselinePendingExposure < 0) {
        throw new Error("BASELINE_ADMISSION_NUMERIC_INVALID");
    }
    const evidence: IdleBaselineAdmission = {
        schema: IDLE_BASELINE_ADMISSION_SCHEMA,
        runtimeSha: input.runtimeSha.toLowerCase(),
        decisionTs: input.decisionTs,
        updatedAt: now,
        sourceComplete: true,
        baselineOpenPositions: input.baselineOpenPositions,
        baselinePendingExposure: input.baselinePendingExposure,
        baselineAcceptedThisTimestamp,
    };
    const normalized = normalizeIdleBaselineAdmission(evidence, input.runtimeSha, input.decisionTs, now, 90_000);
    await writeAtomic(input.decisionPath, normalized);
    return normalized;
}

