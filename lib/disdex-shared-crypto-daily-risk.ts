import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const SHARED_CRYPTO_DAILY_RISK_SCHEMA = "disdex-shared-crypto-daily-risk/v1" as const;
export const SHARED_CRYPTO_STRATEGIES = ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL"] as const;

export interface SharedCryptoDailyRiskState {
    schema: typeof SHARED_CRYPTO_DAILY_RISK_SCHEMA;
    accountScope: "ASTER_FUTURES";
    utcDay: string;
    strategyIds: string[];
    lossPct: number;
    maximumLossPct: number;
    tripped: boolean;
    updatedAt: number;
    stateHash?: string;
}

export interface DailyRiskValidation { ok: boolean; reason?: string; state?: SharedCryptoDailyRiskState }

export function validateSharedCryptoDailyRisk(value: unknown, now = Date.now(), maxAgeMs = 90_000): DailyRiskValidation {
    if (!value || typeof value !== "object") return { ok: false, reason: "MISSING_OR_MALFORMED" };
    const state = value as Partial<SharedCryptoDailyRiskState>;
    if (state.schema !== SHARED_CRYPTO_DAILY_RISK_SCHEMA || state.accountScope !== "ASTER_FUTURES") return { ok: false, reason: "SCHEMA_OR_SCOPE_MISMATCH" };
    if (!Array.isArray(state.strategyIds) || SHARED_CRYPTO_STRATEGIES.some((id) => !state.strategyIds?.includes(id))) return { ok: false, reason: "STRATEGY_SET_MISMATCH" };
    if (typeof state.utcDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(state.utcDay)) return { ok: false, reason: "UTC_DAY_INVALID" };
    if (![state.lossPct, state.maximumLossPct, state.updatedAt].every((n) => Number.isFinite(Number(n)))) return { ok: false, reason: "NON_FINITE" };
    if (Math.abs(now - Number(state.updatedAt)) > maxAgeMs) return { ok: false, reason: "STALE" };
    const normalized = { ...state, strategyIds: [...state.strategyIds] } as SharedCryptoDailyRiskState;
    const expectedDay = new Date(now).toISOString().slice(0, 10);
    if (normalized.utcDay !== expectedDay) return { ok: false, reason: "DAY_MISMATCH" };
    if (normalized.tripped) return { ok: false, reason: "DAILY_LOSS_TRIPPED", state: normalized };
    return { ok: true, state: normalized };
}

export async function readSharedCryptoDailyRisk(path: string, now = Date.now(), maxAgeMs = 90_000): Promise<DailyRiskValidation> {
    try { return validateSharedCryptoDailyRisk(JSON.parse(await readFile(path, "utf8")), now, maxAgeMs); }
    catch (error) { const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; return { ok: false, reason: code === "ENOENT" ? "MISSING" : "MALFORMED" }; }
}

export function buildSharedCryptoDailyRiskState(input: Omit<SharedCryptoDailyRiskState, "schema" | "stateHash">): SharedCryptoDailyRiskState {
    const state = { schema: SHARED_CRYPTO_DAILY_RISK_SCHEMA, ...input };
    const stateHash = createHash("sha256").update(JSON.stringify(state)).digest("hex");
    return { ...state, stateHash };
}
