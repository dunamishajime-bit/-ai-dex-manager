import { STRATEGY_CONFIG } from "@/config/strategyConfig";

export const AI_IMPROVEMENTS_APPLIED_KEY = "ai:improvements:applied";
export const AI_IMPROVEMENTS_PENDING_KEY = "ai:improvements:pending";
export const AI_IMPROVEMENTS_RUNTIME_CONFIG_KEY = "ai:improvements:runtime-config";
export const AI_IMPROVEMENTS_LATEST_AUDIT_KEY = "ai:improvements:latest-audit";

export type SafeConfigKey =
    | "AUTO_TRADE_REVIEW_MAX_ACTIVE_SYMBOLS"
    | "AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_USD"
    | "AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_PCT"
    | "AUTO_TRADE_REVIEW_MIN_EDGE_RISK_RATIO"
    | "AUTO_TRADE_MIN_PROFIT_EXIT_PCT"
    | "AUTO_TRADE_MIN_PROFIT_EXIT_USD"
    | "AUTO_TRADE_TREND_MIN_HOLD_MINUTES"
    | "AUTO_TRADE_RANGE_MIN_HOLD_MINUTES"
    | "AUTO_TRADE_PROBATION_MIN_HOLD_MINUTES"
    | "AUTO_TRADE_TREND_TRAILING_STOP_PCT"
    | "AUTO_TRADE_RANGE_TRAILING_STOP_PCT"
    | "AUTO_TRADE_PROBATION_TRAILING_STOP_PCT"
    | "OPENAI_TRADE_REVIEW_MAX_ENTRY_CANDIDATES";

export type RuntimeStrategyConfigOverrides = Partial<Record<SafeConfigKey, number>>;

export type AuditSeverity = "low" | "medium" | "high";
export type AuditPriority = "low" | "medium" | "high";
export type AuditRisk = "low" | "medium" | "high";

export interface StrategyAuditObservation {
    key: string;
    severity: AuditSeverity;
    message: string;
}

export interface StrategyAuditSafeConfigChange {
    key: SafeConfigKey;
    current: number;
    proposed: number;
    reason: string;
    expectedImpact: string;
    risk: AuditRisk;
}

export interface StrategyAuditManualProposal {
    title: string;
    reason: string;
    expectedImpact: string;
    risk: AuditRisk;
    filesLikelyAffected?: string[];
}

export interface StrategyAuditResult {
    summary: string;
    observations: StrategyAuditObservation[];
    safeConfigChanges: StrategyAuditSafeConfigChange[];
    manualProposals: StrategyAuditManualProposal[];
    priority: AuditPriority;
    nextReviewInMinutes: number;
}

export interface AppliedImprovementEntry extends StrategyAuditSafeConfigChange {
    id: string;
    auditId: string;
    createdAt: number;
    previousValue: number;
    nextValue: number;
    source: "openai" | "heuristic";
}

export interface PendingImprovementEntry extends StrategyAuditManualProposal {
    id: string;
    auditId: string;
    createdAt: number;
    source: "openai" | "heuristic";
}

export interface StoredStrategyAudit {
    id: string;
    createdAt: number;
    source: "openai" | "heuristic";
    result: StrategyAuditResult;
    applied: AppliedImprovementEntry[];
    pending: PendingImprovementEntry[];
}

type SafeConfigBound = {
    min: number;
    max: number;
    step?: number;
    label: string;
};

const SAFE_CONFIG_BOUNDS: Record<SafeConfigKey, SafeConfigBound> = {
    AUTO_TRADE_REVIEW_MAX_ACTIVE_SYMBOLS: { min: 1, max: 8, step: 1, label: "同時保有上限" },
    AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_USD: { min: 0.2, max: 3, step: 0.05, label: "最低期待利益 USD" },
    AUTO_TRADE_REVIEW_MIN_EXPECTED_PROFIT_PCT: { min: 0.2, max: 3.5, step: 0.05, label: "最低期待利益 %" },
    AUTO_TRADE_REVIEW_MIN_EDGE_RISK_RATIO: { min: 0.8, max: 2, step: 0.02, label: "最低 RR" },
    AUTO_TRADE_MIN_PROFIT_EXIT_PCT: { min: 0.1, max: 2.5, step: 0.05, label: "最低利確率 %" },
    AUTO_TRADE_MIN_PROFIT_EXIT_USD: { min: 0.05, max: 2, step: 0.05, label: "最低利確額 USD" },
    AUTO_TRADE_TREND_MIN_HOLD_MINUTES: { min: 15, max: 180, step: 5, label: "Trend 最低保有分" },
    AUTO_TRADE_RANGE_MIN_HOLD_MINUTES: { min: 10, max: 120, step: 5, label: "Range 最低保有分" },
    AUTO_TRADE_PROBATION_MIN_HOLD_MINUTES: { min: 5, max: 90, step: 5, label: "0.2x 最低保有分" },
    AUTO_TRADE_TREND_TRAILING_STOP_PCT: { min: 0.4, max: 4, step: 0.05, label: "Trend トレーリング %" },
    AUTO_TRADE_RANGE_TRAILING_STOP_PCT: { min: 0.3, max: 3, step: 0.05, label: "Range トレーリング %" },
    AUTO_TRADE_PROBATION_TRAILING_STOP_PCT: { min: 0.2, max: 2.5, step: 0.05, label: "0.2x トレーリング %" },
    OPENAI_TRADE_REVIEW_MAX_ENTRY_CANDIDATES: { min: 2, max: 8, step: 1, label: "AI審査候補数" },
};

let runtimeOverrides: RuntimeStrategyConfigOverrides = {};

export function setRuntimeStrategyConfigOverrides(next: RuntimeStrategyConfigOverrides) {
    runtimeOverrides = { ...next };
}

export function getRuntimeStrategyConfigOverrides() {
    return { ...runtimeOverrides };
}

export function getRuntimeStrategyConfigValue<K extends SafeConfigKey>(key: K): number {
    const override = runtimeOverrides[key];
    if (typeof override === "number" && Number.isFinite(override)) {
        return override;
    }
    return Number(STRATEGY_CONFIG[key]);
}

export function getSafeConfigLabel(key: SafeConfigKey) {
    return SAFE_CONFIG_BOUNDS[key].label;
}

export function getSafeConfigKeys() {
    return Object.keys(SAFE_CONFIG_BOUNDS) as SafeConfigKey[];
}

export function getBaseSafeConfigValue(key: SafeConfigKey) {
    return Number(STRATEGY_CONFIG[key]);
}

export function coerceSafeConfigValue(key: SafeConfigKey, value: number) {
    const bound = SAFE_CONFIG_BOUNDS[key];
    const raw = Number(value);
    const step = bound.step || 0;
    const clamped = Math.max(bound.min, Math.min(bound.max, raw));
    if (!step) return Number(clamped.toFixed(4));
    const rounded = Math.round(clamped / step) * step;
    const decimals = step >= 1 ? 0 : Math.max(0, String(step).split(".")[1]?.length || 0);
    return Number(rounded.toFixed(decimals));
}

function normalizeFingerprintValue(value: unknown): unknown {
    if (typeof value === "string") {
        return value.trim().replace(/\s+/g, " ").toLowerCase();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeFingerprintValue(entry));
    }
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .reduce<Record<string, unknown>>((acc, [key, entry]) => {
                acc[key] = normalizeFingerprintValue(entry);
                return acc;
            }, {});
    }
    return value;
}

export function fingerprintImprovement(value: unknown) {
    const input = JSON.stringify(normalizeFingerprintValue(value));
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
}

export function trimAppliedEntries(entries: AppliedImprovementEntry[], limit: number = 80) {
    return entries.slice(0, limit);
}

export function trimPendingEntries(entries: PendingImprovementEntry[], limit: number = 80) {
    return entries.slice(0, limit);
}

export function buildSafeConfigSnapshot(overrides: RuntimeStrategyConfigOverrides = {}) {
    return getSafeConfigKeys().reduce<Record<string, number>>((acc, key) => {
        acc[key] = typeof overrides[key] === "number" ? Number(overrides[key]) : getBaseSafeConfigValue(key);
        return acc;
    }, {});
}
