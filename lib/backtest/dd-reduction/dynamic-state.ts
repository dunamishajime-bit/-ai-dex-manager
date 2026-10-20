import { createHash } from "node:crypto";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { readonly [key: string]: CanonicalValue };

function canonicalize(value: unknown, inArray = false): CanonicalValue | undefined {
    if (value === undefined) return inArray ? null : undefined;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, true) ?? null);
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const result: Record<string, CanonicalValue> = {};
        for (const key of Object.keys(record).sort()) {
            const normalized = canonicalize(record[key]);
            if (normalized !== undefined) result[key] = normalized;
        }
        return result;
    }
    return String(value);
}

export function canonicalAllocatorStateJson(state: unknown): string {
    return JSON.stringify(canonicalize(state) ?? null);
}

/** Hashes only the caller-supplied allocator state, never runtime files or secrets. */
export function hashAllocatorState(state: unknown): string {
    return createHash("sha256").update(canonicalAllocatorStateJson(state), "utf8").digest("hex");
}

export interface CooldownAtDecisionInput {
    readonly candidateDecisionTsMs: number;
    readonly cooldownUntilTsMs: number | null | undefined;
    readonly sourceEventTsMs?: number | null;
}

/**
 * A finite cooldown is causally visible only when it has a finite source
 * event timestamp that is not in the future relative to the replayed decision.
 */
export function isCooldownActiveAt(input: CooldownAtDecisionInput): boolean {
    if (!Number.isFinite(input.candidateDecisionTsMs)) {
        throw new RangeError("candidateDecisionTsMs must be finite");
    }
    if (input.cooldownUntilTsMs === null || input.cooldownUntilTsMs === undefined) return false;
    if (!Number.isFinite(input.cooldownUntilTsMs)) {
        throw new RangeError("cooldownUntilTsMs must be finite when provided");
    }
    const sourceEventTsMs = input.sourceEventTsMs;
    if (typeof sourceEventTsMs !== "number" || !Number.isFinite(sourceEventTsMs)) return false;
    if (sourceEventTsMs > input.candidateDecisionTsMs) return false;
    return input.cooldownUntilTsMs > input.candidateDecisionTsMs;
}
