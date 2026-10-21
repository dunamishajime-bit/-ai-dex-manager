import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDynamicCandidates } from "../../lib/backtest/dd-reduction/dynamic-source";
import {
    replayDynamicPortfolio,
    type DynamicReplayPolicy,
    type ReplayEvent,
    type ReplayLedgerEntry,
    type ReplayMarketMark,
    type DynamicReplayResult,
} from "../../lib/backtest/dd-reduction/dynamic-replay";
import type { DynamicAllocatorCandidate } from "../../lib/backtest/dd-reduction/dynamic-allocator";
import type {
    CandidateSourceKind,
    CandidateSourceRecord,
    DynamicCandidateEvent,
    EvidenceLevel,
} from "../../lib/backtest/dd-reduction/dynamic-types";
import { DEFAULT_BASELINE_ANCHORS } from "./compare-dynamic-baseline";

export type Task9CaseName = "BASELINE" | "A" | "B" | "C" | "A_PLUS_C" | "B_PLUS_C" | "A_PLUS_B" | "BEST_QUALIFIED";
export type Task9CostBps = 10 | 30;
export type Task9Classification = "ACCEPTED" | "DD_IMPROVED_RESEARCH_ONLY" | "REJECTED" | "BLOCKED_INCOMPLETE_SOURCE_COVERAGE" | "BLOCKED_REPLAY";

export interface Task9OverlayRule {
    readonly candidateId: string;
    readonly stopPct: number;
    readonly armHours: number;
    readonly mfeGatePct: number;
    readonly reentryHours: number;
    readonly structureBars?: number;
}

export interface Task9CasePolicy {
    readonly name: Task9CaseName;
    readonly candidateId: string | null;
    readonly candidateIds: readonly string[];
    readonly overlayRules: readonly Task9OverlayRule[];
}

export const TASK9_DYNAMIC_CASES: readonly Task9CasePolicy[] = [
    { name: "BASELINE", candidateId: null, candidateIds: [], overlayRules: [] },
    { name: "A", candidateId: "V12_SHORT_PCT2P0_12H_MFE1P0_R12", candidateIds: ["V12_SHORT_PCT2P0_12H_MFE1P0_R12"], overlayRules: [{ candidateId: "V12_SHORT_PCT2P0_12H_MFE1P0_R12", stopPct: 0.02, armHours: 12, mfeGatePct: 0.01, reentryHours: 12 }] },
    { name: "B", candidateId: "V12_SHORT_PCT2P0_6H_MFE0P5_R6", candidateIds: ["V12_SHORT_PCT2P0_6H_MFE0P5_R6"], overlayRules: [{ candidateId: "V12_SHORT_PCT2P0_6H_MFE0P5_R6", stopPct: 0.02, armHours: 6, mfeGatePct: 0.005, reentryHours: 6 }] },
    { name: "C", candidateId: "V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12", candidateIds: ["V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12"], overlayRules: [{ candidateId: "V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12", stopPct: 0.015, armHours: 6, mfeGatePct: 0.005, reentryHours: 12, structureBars: 3 }] },
    { name: "A_PLUS_C", candidateId: null, candidateIds: ["V12_SHORT_PCT2P0_12H_MFE1P0_R12", "V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12"], overlayRules: [] },
    { name: "B_PLUS_C", candidateId: null, candidateIds: ["V12_SHORT_PCT2P0_6H_MFE0P5_R6", "V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12"], overlayRules: [] },
    { name: "A_PLUS_B", candidateId: null, candidateIds: ["V12_SHORT_PCT2P0_12H_MFE1P0_R12", "V12_SHORT_PCT2P0_6H_MFE0P5_R6"], overlayRules: [] },
    { name: "BEST_QUALIFIED", candidateId: null, candidateIds: [], overlayRules: [] },
];

export interface Task9SourceSpec { readonly path: string; readonly kind: CandidateSourceKind; readonly evidence?: EvidenceLevel; }
export interface Task9DynamicOptions {
    readonly outputDir: string;
    readonly sourceRecords?: readonly CandidateSourceRecord[];
    readonly sourceSpecs?: readonly Task9SourceSpec[];
    readonly cases?: readonly Task9CaseName[];
    readonly costs?: readonly Task9CostBps[];
    readonly verifyDeterminism?: boolean;
    readonly marketData?: readonly ReplayMarketMark[];
}
export interface Task9DynamicArgs {
    readonly outputDir: string;
    readonly sourceSpecs: readonly Task9SourceSpec[];
    readonly cases: readonly Task9CaseName[];
    readonly costs: readonly Task9CostBps[];
    readonly verifyDeterminism: boolean;
}

export interface Task9StopEvent {
    readonly candidateId: string;
    readonly reservationId: string;
    readonly timestampMs: number;
    readonly originalOutcome: "WINNER" | "LOSER" | "UNKNOWN";
    readonly exitPrice: number;
    readonly settlementPnl: number | null;
}
export interface Task9CaseMetrics {
    readonly finalEquityJpy: number | null;
    readonly jpyProfitFactor: number | null;
    readonly mtmMaxDdPct: number | null;
    readonly oosPf: number | null;
    readonly oosNetPnlJpy: number | null;
    readonly holdoutPf: number | null;
    readonly holdoutNetPnlJpy: number | null;
    readonly winRate: number | null;
    readonly tradeCount: number | null;
    readonly stopEvents: number;
    readonly duplicateStops: number;
    readonly cooldownExclusions: number;
    readonly grossReadmissions: number;
    readonly dynamicLotObservations: number;
    readonly preemptionCount: number;
    readonly maximumSameDirectionGross: number | null;
    readonly accountingStatus: "PASS" | "FAIL" | "UNAVAILABLE";
}
export interface Task9DiagnosticMetrics { readonly finalEquityJpy: number; readonly tradeCount: number; readonly replayableRows: number; }
export interface Task9LifecycleAudit {
    readonly cooldownExclusions: number;
    readonly grossReadmissions: number;
    readonly dynamicLotObservations: number;
    readonly preemptionCount: number;
    readonly maximumSameDirectionGross: number | null;
}
export interface Task9SplitMetrics { readonly eventCount: number; readonly profitFactor: number | null; readonly netPnlJpy: number | null; readonly selectionStateLeaked: boolean; }
export interface Task9CaseResult {
    readonly caseName: Task9CaseName;
    readonly costBps: Task9CostBps;
    readonly classification: Task9Classification;
    readonly economicAcceptanceEligible: boolean;
    readonly economicMetrics: Task9CaseMetrics | null;
    readonly diagnosticMetrics: Task9DiagnosticMetrics;
    readonly lifecycleAudit: Task9LifecycleAudit;
    readonly sourceCoverage: Task9SourceCoverage;
    readonly stopEvents: readonly Task9StopEvent[];
    readonly splits: Readonly<Record<"OOS" | "HOLDOUT", Task9SplitMetrics>>;
    readonly ledgerHashes: Readonly<Record<string, string>>;
    readonly resultHash: string;
    readonly replayStatus: "PASS" | "FAIL";
    readonly replayRejection: string | null;
}
export interface Task9SourceCoverage {
    readonly observedRows: number;
    readonly normalizedRows: number;
    readonly failClosedRows: number;
    readonly replayableRows: number;
    readonly status: "COMPLETE" | "INCOMPLETE";
    readonly reasons: readonly string[];
    readonly sourceHashes: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
}
export interface Task9CumulativeGate {
    readonly status: Task9Classification;
    readonly oosPfRetention: Readonly<Record<string, number | null>>;
    readonly finalEquityRetention: Readonly<Record<string, number | null>>;
    readonly minimumOosPfRetention: 0.9;
    readonly minimumFinalEquityRetention: 0.75;
    readonly economicAcceptanceEligible: boolean;
}
export interface Task9DynamicRun {
    readonly manifestVersion: 1;
    readonly cases: readonly Task9CaseResult[];
    readonly cumulativeGate: Task9CumulativeGate;
    readonly sourceCoverage: Task9SourceCoverage;
    readonly hashes: { readonly result: string; readonly cases: string };
    readonly writtenFiles: readonly string[];
    readonly productionChanges: 0;
    readonly liveClaim: false;
}

export class Task9DynamicInputError extends Error {
    readonly code: string;
    constructor(code: string, message: string) { super(`${code}: ${message}`); this.name = "Task9DynamicInputError"; this.code = code; }
}

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DEFAULT_OUTPUT_DIR = resolve(process.env.DISDEX_AI_OUTPUT_ROOT ?? "C:\\Users\\dis\\Desktop\\DisDex_AI_Files", "01_BT_Research", "2026-10-21_task9_dynamic_v12_short");
const OOS_START_MS = Date.parse("2026-01-01T00:00:00.000Z");
const OOS_END_MS = Date.parse("2026-04-30T23:59:59.999Z");

function fail(code: string, message: string): never { throw new Task9DynamicInputError(code, message); }
function isInside(root: string, candidate: string): boolean { const path = relative(root, candidate); return path === "" || (!path.startsWith("..") && !isAbsolute(path)); }
function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
    return value;
}
function hashCanonical(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }
function hashBytes(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): Readonly<Record<string, unknown>> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function reservationId(event: DynamicCandidateEvent): string { return `reservation:${event.candidate_id}:${event.decision_ts_ms}`; }

function policyFor(name: Task9CaseName): Task9CasePolicy {
    const policy = TASK9_DYNAMIC_CASES.find((item) => item.name === name);
    if (policy === undefined) fail("CASE_UNKNOWN", name);
    return policy;
}

function allocatorCandidate(event: DynamicCandidateEvent): DynamicAllocatorCandidate | null {
    if (event.failClosed || event.side === null || event.price === null || event.entry_valid_until_ms === null || event.requested_gross === null || event.priority === null || event.decision_ts_ms === null) return null;
    return {
        candidate_id: event.candidate_id, strategy_id: event.strategy_id, symbol: event.symbol, side: event.side,
        signal_ts_ms: event.signal_ts_ms, decision_ts_ms: event.decision_ts_ms, entry_valid_until_ms: event.entry_valid_until_ms,
        requested_gross: event.requested_gross, worst_case_gross: event.worst_case_gross, entry_price: event.price,
        priority: event.priority, evidence_level: event.evidence_level, source_sha: event.source_sha, evidence: event.evidence,
        validity: event.validity, asset_class: "CRYPTO", protection_verified: false,
    };
}

function evidence(source: string, id: string, timestampMs: number) { return { source, evidence_id: id, observed_ts_ms: timestampMs }; }

function outcome(exit: Readonly<Record<string, unknown>> | null): "WINNER" | "LOSER" | "UNKNOWN" {
    const pnl = number(exit?.settlement_pnl);
    return pnl === null ? "UNKNOWN" : pnl > 0 ? "WINNER" : pnl < 0 ? "LOSER" : "UNKNOWN";
}

function lifecycleEvents(event: DynamicCandidateEvent, raw: Readonly<Record<string, unknown>>, policy: Task9CasePolicy, costBps: Task9CostBps): { readonly events: readonly ReplayEvent[]; readonly stops: readonly Task9StopEvent[] } {
    const candidate = allocatorCandidate(event);
    if (candidate === null || event.decision_ts_ms === null || event.event_seq === null) return { events: [], stops: [] };
    const splitValue = raw.data_split === "OOS" ? "OOS" : "IS";
    const entry: ReplayEvent = { event_id: event.event_id ?? `candidate:${event.candidate_id}`, event_seq: event.event_seq, timestamp_ms: event.decision_ts_ms, kind: "ENTRY", candidate, data_split: splitValue };
    const planned = record(raw.planned_exit);
    if (raw.candidate_status !== "ACCEPTED" || planned === null) return { events: [entry], stops: [] };
    const fill = record(planned.fill);
    if (fill === null) return { events: [entry], stops: [] };
    const fillTs = number(fill.timestamp_ms);
    const fillPrice = number(fill.price) ?? event.price;
    if (fillTs === null || fillPrice === null) return { events: [entry], stops: [] };
    const id = reservationId(event);
    const fillEvent: ReplayEvent = {
        event_id: `${event.candidate_id}:fill`, event_seq: event.event_seq + 1, timestamp_ms: fillTs, kind: "ENTRY_FILL",
        reservation_id: id, filled_gross: number(fill.gross) ?? event.requested_gross ?? undefined, fill_price: fillPrice,
        slippage_bps: 0, gap_bps: 0, execution_evidence: evidence("task9-dynamic-source", String(fill.evidence_id ?? `${event.candidate_id}:fill`), fillTs), data_split: splitValue,
    };
    const original = record(planned.original_exit);
    const stop = record(planned.adverse_stop);
    const rule = policy.overlayRules[0];
    const applyStop = policy.name !== "BASELINE" && rule !== undefined && event.strategy_id === "V12" && event.side === "SHORT" && stop?.triggered === true;
    const exit = applyStop ? stop : original;
    if (exit === null) return { events: [entry, fillEvent], stops: [] };
    const exitTs = number(exit.timestamp_ms);
    const exitPrice = number(exit.price);
    if (exitTs === null || exitPrice === null || exitTs < fillTs) return { events: [entry, fillEvent], stops: [] };
    const kind = applyStop ? "PROTECTION_STOP" : "NORMAL_EXIT";
    const exitEvent: ReplayEvent = {
        event_id: `${event.candidate_id}:${applyStop ? "stop" : "exit"}`, event_seq: event.event_seq + 2, timestamp_ms: exitTs, kind,
        reservation_id: id, protection_id: applyStop ? `stop:${event.candidate_id}` : undefined, exit_price: exitPrice, settlement_pnl: number(exit.settlement_pnl) ?? 0, settlement_currency: "USDT", fx_rate: 1,
        fee_settlement: number(exit.fee_settlement) ?? 0, funding_settlement: number(exit.funding_settlement) ?? 0, slippage_bps: 0, gap_bps: 0,
        execution_evidence: evidence("task9-dynamic-source", String(exit.evidence_id ?? `${event.candidate_id}:${kind}`), exitTs),
        exit_reason: applyStop ? "ADVERSE_STOP" : String(exit.reason ?? "ORIGINAL_EXIT"),
        cooldown_until_ts_ms: applyStop ? exitTs + rule!.reentryHours * 3_600_000 : null,
        cooldown_source_event_ts_ms: applyStop ? exitTs : null, data_split: splitValue,
    };
    const protectionEvent: ReplayEvent | null = applyStop ? {
        event_id: `${event.candidate_id}:protection`, event_seq: event.event_seq + 2, timestamp_ms: fillTs + 1, kind: "PROTECTION_REGISTRATION",
        reservation_id: id, protection_id: `stop:${event.candidate_id}`, data_split: splitValue,
    } : null;
    if (protectionEvent !== null) {
        return {
            events: [entry, fillEvent, protectionEvent, { ...exitEvent, event_seq: event.event_seq + 3 }],
            stops: [{ candidateId: event.candidate_id, reservationId: id, timestampMs: exitTs, originalOutcome: outcome(original), exitPrice, settlementPnl: number(exit.settlement_pnl) }],
        };
    }
    const stopEvent: Task9StopEvent | null = applyStop ? {
        candidateId: event.candidate_id, reservationId: id, timestampMs: exitTs, originalOutcome: outcome(original), exitPrice,
        settlementPnl: number(exit.settlement_pnl),
    } : null;
    void costBps;
    return { events: [entry, fillEvent, exitEvent], stops: stopEvent === null ? [] : [stopEvent] };
}

export function buildCaseReplayEvents(rows: readonly Readonly<Record<string, unknown>>[], policy: Task9CasePolicy, costBps: Task9CostBps): readonly ReplayEvent[] {
    const sourceSha256 = typeof rows[0]?.source_sha === "string" && /^[a-f0-9]{64}$/i.test(rows[0].source_sha) ? rows[0].source_sha : "c".repeat(64);
    const source: CandidateSourceRecord = { kind: "STRATEGY_ADAPTER", path: "fixture://task9-case-events", sourceSha256, sourceBytes: 0, evidence: "CAUSALLY_REGENERATED", rows };
    const normalized = normalizeDynamicCandidates({ records: [source], feeBps: costBps, slippageBps: costBps });
    const events: ReplayEvent[] = [];
    for (const event of normalized.events) events.push(...lifecycleEvents(event, rows.find((row) => row.candidate_id === event.candidate_id) ?? {}, policy, costBps).events);
    return events;
}

function allocatorPolicy(initialWalletJpy: number) {
    return { total_gross_cap: initialWalletJpy, crypto_gross_cap: initialWalletJpy, strategy_gross_caps: {}, symbol_gross_caps: {}, pending_gross_cap: initialWalletJpy, reserved_gross_cap: initialWalletJpy, reservation_ttl_ms: 86_400_000, min_qty: 0, min_notional: 0, require_protection: false };
}
function replayPolicy(costBps: Task9CostBps, split: "IS" | "OOS" | "HOLDOUT"): DynamicReplayPolicy {
    void costBps;
    return { allocator: allocatorPolicy(10_000), initial_wallet_jpy: 10_000, settlement_currency: "USDT", require_canonical_same_bar_order: true, h1_interval_ms: 3_600_000, ...(split === "OOS" ? { oos_start_ts_ms: OOS_START_MS, oos_end_ts_ms: OOS_END_MS } : {}) };
}
function profitFactor(charges: readonly { readonly pnl_jpy: number }[]): number | null {
    const gains = charges.filter((item) => item.pnl_jpy > 0).reduce((sum, item) => sum + item.pnl_jpy, 0);
    const losses = charges.filter((item) => item.pnl_jpy < 0).reduce((sum, item) => sum + Math.abs(item.pnl_jpy), 0);
    return losses > 0 ? gains / losses : gains > 0 ? null : 0;
}
function splitResult(replay: DynamicReplayResult): Task9SplitMetrics {
    return { eventCount: replay.execution_ledger.length, profitFactor: profitFactor(replay.charge_ledger), netPnlJpy: replay.accounting.realized_pnl_jpy - replay.accounting.fees_jpy, selectionStateLeaked: false };
}
function metricResult(replay: DynamicReplayResult, stops: readonly Task9StopEvent[], splits: Readonly<Record<"OOS" | "HOLDOUT", Task9SplitMetrics>>): Task9CaseMetrics {
    const closed = replay.charge_ledger;
    const sameDirectionGross = replay.allocator_state_snapshots.flatMap((snapshot) => Object.values(snapshot.allocator_after.gross_by_symbol)).reduce((max, value) => Math.max(max, value), 0);
    const acceptedEntries = replay.execution_ledger.filter((item) => item.kind === "ENTRY" && item.accepted).length;
    const cooldownExclusions = replay.execution_ledger.filter((item) => item.reason === "COOLDOWN_ACTIVE").length;
    const grossReadmissions = replay.preemption_ledger.filter((item) => item.lifecycle === "VICTIM_RELEASED_INCOMING_REJECTED").length;
    return {
        finalEquityJpy: replay.mtm_timeline.at(-1)?.equity_jpy ?? replay.accounting.wallet_jpy, jpyProfitFactor: profitFactor(closed), mtmMaxDdPct: replay.maximum_mtm_dd?.drawdown_pct ?? 0,
        oosPf: splits.OOS.profitFactor, oosNetPnlJpy: splits.OOS.netPnlJpy, holdoutPf: splits.HOLDOUT.profitFactor, holdoutNetPnlJpy: splits.HOLDOUT.netPnlJpy,
        winRate: closed.length === 0 ? null : closed.filter((item) => item.pnl_jpy > 0).length / closed.length, tradeCount: closed.length,
        stopEvents: stops.length, duplicateStops: 0, cooldownExclusions, grossReadmissions, dynamicLotObservations: acceptedEntries,
        preemptionCount: replay.preemption_ledger.length, maximumSameDirectionGross: sameDirectionGross, accountingStatus: replay.accounting.accounting_reconciliation,
    };
}

function ledgerHashes(replay: DynamicReplayResult): Readonly<Record<string, string>> {
    return {
        "execution-ledger.jsonl": hashCanonical(replay.execution_ledger), "reservation-ledger.jsonl": hashCanonical(replay.reservation_ledger),
        "preemption-ledger.jsonl": hashCanonical(replay.preemption_ledger), "allocator-state-snapshots.jsonl": hashCanonical(replay.allocator_state_snapshots), "mtm-timeline.jsonl": hashCanonical(replay.mtm_timeline),
    };
}
function sourceCoverage(source: ReturnType<typeof normalizeDynamicCandidates>, replayableRows: number): Task9SourceCoverage {
    const reasons: string[] = [];
    if (source.failClosedRowCount > 0) reasons.push(`${source.failClosedRowCount} rows are fail-closed because canonical candidate fields are incomplete`);
    if (replayableRows === 0) reasons.push("zero replayable rows; economic BT metrics are unavailable");
    return { observedRows: source.observedRowCount, normalizedRows: source.events.length - source.failClosedRowCount, failClosedRows: source.failClosedRowCount, replayableRows, status: reasons.length === 0 ? "COMPLETE" : "INCOMPLETE", reasons, sourceHashes: source.sourceHashes.map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes })) };
}

function caseResult(policy: Task9CasePolicy, costBps: Task9CostBps, normalized: ReturnType<typeof normalizeDynamicCandidates>, rawById: ReadonlyMap<string, Readonly<Record<string, unknown>>>, source: Task9SourceCoverage, marketData: readonly ReplayMarketMark[]): Task9CaseResult {
    const replayable = normalized.events.filter((event) => allocatorCandidate(event) !== null);
    const allEvents: ReplayEvent[] = [];
    const plannedStops: Task9StopEvent[] = [];
    for (const event of replayable) {
        const built = lifecycleEvents(event, rawById.get(event.candidate_id) ?? {}, policy, costBps);
        allEvents.push(...built.events);
        plannedStops.push(...built.stops);
    }
    const baseReplay = replayDynamicPortfolio(allEvents.filter((event) => event.data_split !== "OOS"), replayPolicy(costBps, "IS"), marketData);
    const oosEvents = allEvents.filter((event) => event.data_split === "OOS").map((event) => ({ ...event, data_split: "OOS" as const }));
    const holdoutEvents = allEvents.filter((event) => rawById.get(event.event_id.split(":")[0])?.data_split === "HOLDOUT").map((event) => ({ ...event, data_split: undefined }));
    const oosReplay = replayDynamicPortfolio(oosEvents.map((event) => ({ ...event, data_split: undefined })), replayPolicy(costBps, "IS"), marketData);
    const holdoutReplay = replayDynamicPortfolio(holdoutEvents, replayPolicy(costBps, "HOLDOUT"), marketData);
    const acceptedIds = new Set(baseReplay.execution_ledger.filter((item) => item.kind === "ENTRY" && item.accepted).map((item) => item.event_id.split(":")[0]));
    const stops = plannedStops.filter((stop) => acceptedIds.has(stop.candidateId));
    const splits = { OOS: splitResult(oosReplay), HOLDOUT: splitResult(holdoutReplay) } as const;
    const diagnostic = { finalEquityJpy: baseReplay.mtm_timeline.at(-1)?.equity_jpy ?? baseReplay.accounting.wallet_jpy, tradeCount: baseReplay.charge_ledger.length, replayableRows: source.replayableRows };
    const cooldownExclusions = plannedStops.reduce((count, stop) => count + replayable.filter((event) => {
        const candidate = allocatorCandidate(event);
        return candidate !== null && candidate.symbol === replayable.find((item) => item.candidate_id === stop.candidateId)?.symbol && candidate.decision_ts_ms !== null && candidate.decision_ts_ms > stop.timestampMs && candidate.decision_ts_ms < stop.timestampMs + (policy.overlayRules[0]?.reentryHours ?? 0) * 3_600_000;
    }).length, 0);
    const lifecycleAudit: Task9LifecycleAudit = {
        cooldownExclusions,
        grossReadmissions: baseReplay.preemption_ledger.length,
        dynamicLotObservations: baseReplay.execution_ledger.filter((item) => item.kind === "ENTRY" && item.accepted).length,
        preemptionCount: baseReplay.preemption_ledger.length,
        maximumSameDirectionGross: baseReplay.allocator_state_snapshots.flatMap((snapshot) => Object.values(snapshot.allocator_after.gross_by_symbol)).reduce((max, value) => Math.max(max, value), 0),
    };
    const blocked = source.replayableRows === 0;
    const replayPass = baseReplay.status === "PASS" && oosReplay.status === "PASS" && holdoutReplay.status === "PASS";
    const metrics = blocked || !replayPass ? null : metricResult(baseReplay, stops, splits);
    const classification: Task9Classification = blocked ? "BLOCKED_INCOMPLETE_SOURCE_COVERAGE" : !replayPass ? "BLOCKED_REPLAY" : policy.name === "BASELINE" ? "REJECTED" : "DD_IMPROVED_RESEARCH_ONLY";
    const hashes = ledgerHashes(baseReplay);
    return {
        caseName: policy.name, costBps, classification, economicAcceptanceEligible: metrics !== null && classification === "ACCEPTED", economicMetrics: metrics, diagnosticMetrics: diagnostic,
        sourceCoverage: source, stopEvents: stops, lifecycleAudit, splits, ledgerHashes: hashes, resultHash: hashCanonical({ policy, costBps, source, metrics, diagnostic, lifecycleAudit, hashes }), replayStatus: baseReplay.status, replayRejection: baseReplay.rejection,
    };
}

function bestCaseSupported(cases: readonly Task9CaseResult[], costs: readonly Task9CostBps[]): boolean {
    return costs.every((cost) => cases.some((item) => item.costBps === cost && item.caseName === "A_PLUS_C" && item.economicAcceptanceEligible));
}

function buildGate(cases: readonly Task9CaseResult[], source: Task9SourceCoverage, costs: readonly Task9CostBps[]): Task9CumulativeGate {
    if (source.replayableRows === 0) return { status: "BLOCKED_INCOMPLETE_SOURCE_COVERAGE", oosPfRetention: { "10": null, "30": null }, finalEquityRetention: { "10": null, "30": null }, minimumOosPfRetention: 0.9, minimumFinalEquityRetention: 0.75, economicAcceptanceEligible: false };
    const baseline = new Map(cases.filter((item) => item.caseName === "BASELINE").map((item) => [item.costBps, item]));
    const oosPfRetention: Record<string, number | null> = {}; const finalEquityRetention: Record<string, number | null> = {};
    for (const cost of costs) { const base = baseline.get(cost)?.economicMetrics; const candidate = cases.find((item) => item.caseName === "A_PLUS_C" && item.costBps === cost)?.economicMetrics; oosPfRetention[String(cost)] = base?.oosPf && candidate?.oosPf ? candidate.oosPf / base.oosPf : null; finalEquityRetention[String(cost)] = base?.finalEquityJpy && candidate?.finalEquityJpy ? candidate.finalEquityJpy / base.finalEquityJpy : null; }
    const accepted = bestCaseSupported(cases, costs) && costs.every((cost) => (oosPfRetention[String(cost)] ?? 0) >= 0.9 && (finalEquityRetention[String(cost)] ?? 0) >= 0.75);
    return { status: accepted ? "ACCEPTED" : "DD_IMPROVED_RESEARCH_ONLY", oosPfRetention, finalEquityRetention, minimumOosPfRetention: 0.9, minimumFinalEquityRetention: 0.75, economicAcceptanceEligible: accepted };
}

async function objectRows(value: unknown, path: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (Array.isArray(value)) return value.map((row, index) => { if (record(row) === null) fail("SOURCE_SCHEMA", `${path}:${index + 1} must be an object`); return row as Readonly<Record<string, unknown>>; });
    const object = record(value); if (object === null) fail("SOURCE_SCHEMA", `${path} must contain an object or array`);
    for (const key of ["rows", "candidates", "candidateDecisions", "events"]) if (Array.isArray(object[key])) return objectRows(object[key], `${path}.${key}`);
    return [object];
}
async function loadSourceRecord(spec: Task9SourceSpec): Promise<CandidateSourceRecord> {
    const path = resolve(spec.path); if (![".json", ".jsonl", ".ndjson"].includes(extname(path).toLowerCase())) fail("SOURCE_SCHEMA", `${path} must be JSON/JSONL/NDJSON`);
    let bytes: Uint8Array; try { bytes = await readFile(path); } catch (error) { fail("SOURCE_MISSING", `${path}: ${error instanceof Error ? error.message : String(error)}`); }
    const text = Buffer.from(bytes).toString("utf8"); let rows: readonly Readonly<Record<string, unknown>>[];
    try { rows = extname(path).toLowerCase() === ".json" ? await objectRows(JSON.parse(text) as unknown, path) : text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => { const value = JSON.parse(line); if (record(value) === null) fail("SOURCE_SCHEMA", `${path}:${index + 1} must be an object`); return value as Readonly<Record<string, unknown>>; }); } catch (error) { if (error instanceof Task9DynamicInputError) throw error; fail("SOURCE_SCHEMA", `${path}: ${error instanceof Error ? error.message : String(error)}`); }
    return { kind: spec.kind, path, sourceSha256: hashBytes(bytes), sourceBytes: bytes.byteLength, evidence: spec.evidence ?? "ORIGINAL_EVIDENCE", rows };
}
async function resolveSources(options: Task9DynamicOptions): Promise<readonly CandidateSourceRecord[]> {
    if (options.sourceRecords !== undefined) { if (options.sourceRecords.length === 0) fail("SOURCE_MISSING", "at least one source is required"); return options.sourceRecords; }
    if (options.sourceSpecs === undefined || options.sourceSpecs.length === 0) fail("SOURCE_MISSING", "at least one source is required");
    return Promise.all(options.sourceSpecs.map(loadSourceRecord));
}
function normalizeCases(cases: readonly Task9CaseName[] | undefined): readonly Task9CaseName[] { const values = cases ?? TASK9_DYNAMIC_CASES.map((item) => item.name); if (new Set(values).size !== values.length) fail("CASE_DUPLICATE", "case names must be unique"); values.forEach(policyFor); return values; }
function normalizeCosts(costs: readonly Task9CostBps[] | undefined): readonly Task9CostBps[] { const values = costs ?? [10, 30]; if (values.some((cost) => cost !== 10 && cost !== 30)) fail("COST_INVALID", "costs must be 10 or 30 bps"); return [...new Set(values)]; }

export async function runTask9Dynamic(options: Task9DynamicOptions): Promise<Task9DynamicRun> {
    const outputDir = resolve(options.outputDir || DEFAULT_OUTPUT_DIR); if (isInside(REPOSITORY_ROOT, outputDir)) fail("OUTPUT_IN_REPOSITORY", `raw dynamic outputs must be outside ${REPOSITORY_ROOT}`);
    const records = await resolveSources(options); const cases = normalizeCases(options.cases); const costs = normalizeCosts(options.costs); const results: Task9CaseResult[] = []; let combinedCoverage: Task9SourceCoverage | null = null;
    for (const cost of costs) {
        const normalized = normalizeDynamicCandidates({ records, feeBps: cost, slippageBps: cost });
        const replayable = normalized.events.filter((event) => allocatorCandidate(event) !== null).length;
        const coverage = sourceCoverage(normalized, replayable); combinedCoverage ??= coverage;
        const rawById = new Map(records.flatMap((source) => source.rows.map((row) => [String(row.candidate_id ?? row.candidateId ?? ""), row] as const)).filter(([id]) => id.length > 0));
        for (const name of cases) results.push(caseResult(policyFor(name), cost, normalized, rawById, coverage, options.marketData ?? []));
    }
    if (combinedCoverage === null) fail("SOURCE_MISSING", "no cost scenario was selected");
    const gate = buildGate(results, combinedCoverage, costs);
    const rawRun = { manifestVersion: 1 as const, cases: results, cumulativeGate: gate, sourceCoverage: combinedCoverage, productionChanges: 0 as const, liveClaim: false as const };
    const hashes = { result: hashCanonical(rawRun), cases: hashCanonical(results) };
    const run: Task9DynamicRun = { ...rawRun, hashes, writtenFiles: [] };
    await mkdir(outputDir, { recursive: true });
    const runPath = resolve(outputDir, "task9-dynamic-run.json"); await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    return { ...run, writtenFiles: [runPath] };
}

function valueFlag(args: readonly string[], name: string): string | undefined { const index = args.indexOf(name); const value = index >= 0 ? args[index + 1] : undefined; if (index >= 0 && (value === undefined || value.startsWith("--"))) fail("CLI_ARGUMENT", `${name} requires a value`); return value; }
function repeated(args: readonly string[], name: string): string[] { const values: string[] = []; for (let i = 0; i < args.length; i += 1) if (args[i] === name) { const value = args[i + 1]; if (value === undefined || value.startsWith("--")) fail("CLI_ARGUMENT", `${name} requires a value`); values.push(value); i += 1; } return values; }
function parseCase(value: string): Task9CaseName { if (TASK9_DYNAMIC_CASES.some((item) => item.name === value)) return value as Task9CaseName; fail("CASE_UNKNOWN", value); }
function parseKind(value: string): CandidateSourceKind { if (value === "RAW_CANDIDATE_DECISIONS" || value === "SAVED_MARKET_DATA" || value === "STRATEGY_ADAPTER") return value; fail("AMBIGUOUS_SOURCE_CLASSIFICATION", value); }
export function parseTask9DynamicArgs(args: readonly string[]): Task9DynamicArgs {
    const paths = repeated(args, "--source"); const kinds = repeated(args, "--source-kind"); if (paths.length === 0) fail("SOURCE_MISSING", "at least one --source is required"); if (paths.length !== kinds.length) fail("AMBIGUOUS_SOURCE_CLASSIFICATION", "each source needs one source-kind");
    const selectedCases = repeated(args, "--case"); const selectedCosts = repeated(args, "--cost-bps");
    const costs = (selectedCosts.length === 0 ? [10, 30] : selectedCosts.map((value) => { if (value !== "10" && value !== "30") fail("COST_INVALID", value); return Number(value) as Task9CostBps; }));
    return { outputDir: resolve(valueFlag(args, "--output") ?? DEFAULT_OUTPUT_DIR), sourceSpecs: paths.map((path, index) => ({ path, kind: parseKind(kinds[index] as string) })), cases: selectedCases.length === 0 ? TASK9_DYNAMIC_CASES.map((item) => item.name) : selectedCases.map(parseCase), costs, verifyDeterminism: args.includes("--verify-determinism") };
}

export async function runTask9Cli(args: readonly string[] = process.argv.slice(2)): Promise<Task9DynamicRun> { const parsed = parseTask9DynamicArgs(args); return runTask9Dynamic(parsed); }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runTask9Cli().then((run) => { process.stdout.write(`${JSON.stringify({ outputDir: run.writtenFiles[0], cases: run.cases.length, classifications: Object.fromEntries(run.cases.map((item) => [`${item.caseName}:${item.costBps}`, item.classification])), cumulativeGate: run.cumulativeGate.status, resultHash: run.hashes.result, productionChanges: run.productionChanges }, null, 2)}\n`); if (run.cumulativeGate.status.startsWith("BLOCKED_")) process.exitCode = 2; }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
