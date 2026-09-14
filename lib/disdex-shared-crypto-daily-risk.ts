import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
    realizedPnl?: number;
    unrealizedPnl?: number;
    fees?: number;
    funding?: number;
    netDailyPnl?: number;
    referenceEquity?: number;
    sourceComplete?: boolean;
    stateHash?: string;
}

export interface DailyRiskValidation { ok: boolean; reason?: string; state?: SharedCryptoDailyRiskState }

function withoutHash(state: SharedCryptoDailyRiskState) {
    const { stateHash: _stateHash, ...body } = state;
    return body;
}
function hashState(state: SharedCryptoDailyRiskState) { return createHash("sha256").update(JSON.stringify(withoutHash(state))).digest("hex"); }

export function validateSharedCryptoDailyRisk(value: unknown, now = Date.now(), maxAgeMs = 90_000): DailyRiskValidation {
    if (!value || typeof value !== "object") return { ok: false, reason: "MISSING_OR_MALFORMED" };
    const state = value as Partial<SharedCryptoDailyRiskState>;
    if (state.schema !== SHARED_CRYPTO_DAILY_RISK_SCHEMA || state.accountScope !== "ASTER_FUTURES") return { ok: false, reason: "SCHEMA_OR_SCOPE_MISMATCH" };
    if (!Array.isArray(state.strategyIds) || SHARED_CRYPTO_STRATEGIES.some((id) => !state.strategyIds?.includes(id))) return { ok: false, reason: "STRATEGY_SET_MISMATCH" };
    if (typeof state.utcDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(state.utcDay)) return { ok: false, reason: "UTC_DAY_INVALID" };
    if (![state.lossPct, state.maximumLossPct, state.updatedAt].every((n) => Number.isFinite(Number(n)))) return { ok: false, reason: "NON_FINITE" };
    if (Math.abs(now - Number(state.updatedAt)) > maxAgeMs) return { ok: false, reason: "STALE" };
    const normalized = { ...state, strategyIds: [...state.strategyIds] } as SharedCryptoDailyRiskState;
    if (normalized.stateHash && normalized.stateHash !== hashState(normalized)) return { ok: false, reason: "HASH_MISMATCH" };
    const expectedDay = new Date(now).toISOString().slice(0, 10);
    if (normalized.utcDay !== expectedDay) return { ok: false, reason: "DAY_MISMATCH" };
    const breakdown = [normalized.realizedPnl, normalized.unrealizedPnl, normalized.fees, normalized.funding, normalized.netDailyPnl, normalized.referenceEquity];
    if (normalized.sourceComplete !== true || breakdown.some((n) => !Number.isFinite(Number(n))) || !(Number(normalized.referenceEquity) > 0)) return { ok: false, reason: "PNL_BREAKDOWN_INCOMPLETE" };
    if (Math.abs(Number(normalized.netDailyPnl) - (Number(normalized.realizedPnl) + Number(normalized.unrealizedPnl) + Number(normalized.fees) + Number(normalized.funding))) > 1e-6) return { ok: false, reason: "PNL_BREAKDOWN_INCONSISTENT" };
    if (normalized.tripped) return { ok: false, reason: "DAILY_LOSS_TRIPPED", state: normalized };
    return { ok: true, state: normalized };
}

export async function readSharedCryptoDailyRisk(path: string, now = Date.now(), maxAgeMs = 90_000): Promise<DailyRiskValidation> {
    try { return validateSharedCryptoDailyRisk(JSON.parse(await readFile(path, "utf8")), now, maxAgeMs); }
    catch (error) { const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; return { ok: false, reason: code === "ENOENT" ? "MISSING" : "MALFORMED" }; }
}

export function buildSharedCryptoDailyRiskState(input: Omit<SharedCryptoDailyRiskState, "schema" | "stateHash">): SharedCryptoDailyRiskState {
    const state: SharedCryptoDailyRiskState = { schema: SHARED_CRYPTO_DAILY_RISK_SCHEMA, ...input };
    return { ...state, stateHash: hashState(state) };
}

export async function writeSharedCryptoDailyRisk(path: string, state: SharedCryptoDailyRiskState) {
    const validation = validateSharedCryptoDailyRisk(state, state.updatedAt, Number.MAX_SAFE_INTEGER);
    if (!validation.state && validation.reason !== "DAILY_LOSS_TRIPPED") throw new Error(`SHARED_CRYPTO_RISK_WRITE_INVALID:${validation.reason}`);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, path);
}
