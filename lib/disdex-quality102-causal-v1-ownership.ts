import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
    FileQuality102CausalV1StateStore,
    type Quality102CausalV1State,
} from "@/lib/disdex-quality102-causal-v1-state";
import type { DirectOpenOrder, DirectPosition } from "@/lib/direct-trade-executor";

const RUNTIME_SHA = /^[0-9a-f]{40}$/i;

export interface Quality102CausalV1OwnershipSnapshot {
    state: Quality102CausalV1State;
    position?: NonNullable<Quality102CausalV1State["position"]>;
    pending?: Quality102CausalV1State["pending"];
}

function configuredPath(pathValue?: string): string | undefined {
    const value = String(pathValue || process.env.QUALITY102_CAUSAL_V1_STATE_PATH || process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH || "").trim();
    return value ? resolve(value) : undefined;
}

function isMissing(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT");
}

/**
 * Read the live causal-v1 state only for ownership/reconciliation. An absent
 * path means that unknown exchange positions remain unknown; a malformed or
 * mismatched file is an error and must fail the caller closed.
 */
export async function readQuality102CausalV1Ownership(options: {
    path?: string;
    expectedRuntimeSha?: string;
} = {}): Promise<Quality102CausalV1OwnershipSnapshot | undefined> {
    const pathValue = configuredPath(options.path);
    if (!pathValue) return undefined;
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(await readFile(pathValue, "utf8")) as Record<string, unknown>;
    } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("QUALITY102_OWNERSHIP_STATE_MALFORMED");
    const stateSha = String(raw.runtimeCommitSha || "").trim();
    if (!RUNTIME_SHA.test(stateSha)) throw new Error("QUALITY102_OWNERSHIP_RUNTIME_SHA_INVALID");
    const expectedSha = String(options.expectedRuntimeSha || "").trim();
    if (expectedSha && (!RUNTIME_SHA.test(expectedSha) || expectedSha.toLowerCase() !== stateSha.toLowerCase())) {
        throw new Error("QUALITY102_OWNERSHIP_RUNTIME_SHA_MISMATCH");
    }
    const store = new FileQuality102CausalV1StateStore(pathValue, "LIVE", expectedSha || stateSha);
    const state = await store.load();
    return { state, position: state.position, pending: state.pending };
}

export function quality102OwnsPosition(
    ownership: Quality102CausalV1OwnershipSnapshot | undefined,
    position: DirectPosition,
): boolean {
    const statePosition = ownership?.position;
    if (!statePosition || Math.abs(position.quantity) <= 1e-12) return false;
    return position.symbol.toUpperCase() === statePosition.symbol.toUpperCase()
        && (position.positionSide === "SHORT" || (position.positionSide !== "LONG" && position.quantity < 0) ? -1 : 1) === statePosition.side
        && Math.abs(Math.abs(position.quantity) - statePosition.quantity) <= Math.max(1e-8, statePosition.quantity * 0.01);
}

export function quality102OwnsOrder(
    ownership: Quality102CausalV1OwnershipSnapshot | undefined,
    order: DirectOpenOrder,
): boolean {
    const pending = ownership?.pending;
    return Boolean(pending
        && order.symbol.toUpperCase() === pending.symbol.toUpperCase()
        && order.clientOrderId === pending.clientOrderId);
}

