import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AsterOrderSide } from "@/lib/aster-v3-client";
import type { DirectPosition, DirectTradeCommand, DirectTradeExecutor, DirectTradeResult } from "@/lib/direct-trade-executor";
import type { LiveRunnerLock } from "@/lib/live-runner-state";
import { readDisDexV96KillSwitch } from "@/lib/disdex-v96-live-risk-controls";
import type { DisDexV97Mode } from "@/config/disdexV97Runtime";
import { DISDEX_V97_CORE, DISDEX_V97_STRATEGY_ID } from "@/config/disdexV97Runtime";
import { buildDisDexV97Signal, type DisDexV97History, type DisDexV97Position, type DisDexV97Signal, type DisDexV97Symbol } from "@/lib/disdex-v97-signal-engine";
import type { DisDexV97PendingOrder, DisDexV97RunnerState, DisDexV97RunnerStateStore } from "@/lib/disdex-v97-runner-state";

const MANAGED = new Set<string>(DISDEX_V97_CORE.symbols);
const ENTRY_MAX_DELAY_MS = 10 * 60_000;

export interface DisDexV97PortfolioRunnerConfig {
    mode: DisDexV97Mode;
    enabled: boolean;
    liveExecutionEnabled: boolean;
    productionConfigLiveEnabled: boolean;
    maximumGross: number;
    baseGross: number;
    portfolioGrossCap: number;
    maximumDailyLossPct: number;
    maxSlippageBps: number;
    minimumOrderNotionalUsd: number;
    cashReservePct: number;
    maxTransactionRetries: number;
    killSwitchPath?: string;
    portfolioDailyLossStatePath?: string;
    targetGrossResolver?: (history: DisDexV97History, entryTs: number) => number;
}

export interface DisDexV97TickResult {
    status: "disabled" | "locked" | "shadow" | "held" | "no-change" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    signal?: DisDexV97Signal;
    idempotencyKey?: string;
}

function finite(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function filled(result: DirectTradeResult) { return result.status === "FILLED" && result.executedQuantity > 0; }
function sideOf(position: DirectPosition): -1 | 1 { if (position.positionSide === "SHORT") return -1; if (position.positionSide === "LONG") return 1; return position.quantity < 0 ? -1 : 1; }
function managedPositions(positions: DirectPosition[]) { return positions.filter((position) => MANAGED.has(position.symbol.toUpperCase()) && Math.abs(position.quantity) > 1e-12); }
function clientOrderId(key: string) { return `v97-${key}`.slice(0, 36); }
function idempotency(signal: DisDexV97Signal, symbol: string, side: AsterOrderSide, reduceOnly: boolean, quantity: number) {
    return createHash("sha256").update([DISDEX_V97_STRATEGY_ID, signal.referenceTs, signal.entryTs || 0, symbol, side, reduceOnly ? "reduce" : "entry", quantity.toFixed(12)].join("|")).digest("hex");
}

async function readDailyLoss(pathValue?: string) {
    if (!pathValue) return false;
    try {
        const raw = JSON.parse(await readFile(pathValue, "utf8")) as Record<string, unknown>;
        const candidate = raw.portfolioDailyLossLatch && typeof raw.portfolioDailyLossLatch === "object"
            ? raw.portfolioDailyLossLatch
            : raw.dailyRisk && typeof raw.dailyRisk === "object" ? raw.dailyRisk : raw;
        return Boolean(candidate && typeof candidate === "object" && (candidate as { tripped?: unknown }).tripped === true);
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return false;
        throw error;
    }
}

function stateFromActual(actual: DirectPosition, previous: DisDexV97Position): DisDexV97Position {
    return {
        symbol: actual.symbol.toUpperCase() as DisDexV97Symbol,
        side: -1,
        entryTs: previous.entryTs,
        entryPrice: actual.entryPrice,
        quantity: Math.abs(actual.quantity),
        gross: previous.gross,
    };
}

export class DisDexV97PortfolioRunner {
    private readonly now: () => number;
    constructor(private readonly dependencies: {
        marketData: { load(force?: boolean): Promise<DisDexV97History> };
        executor: DirectTradeExecutor;
        stateStore: DisDexV97RunnerStateStore;
        lock: LiveRunnerLock;
        config: DisDexV97PortfolioRunnerConfig;
        now?: () => number;
    }) { this.now = dependencies.now ?? Date.now; }

    private ensureLiveGate() {
        const c = this.dependencies.config;
        if (c.mode !== "LIVE") return;
        if (!c.enabled || !c.liveExecutionEnabled || !c.productionConfigLiveEnabled) throw new Error("V97 LIVE is locked: enabled, live execution and repository production gates are all required.");
        if (!c.killSwitchPath || !c.portfolioDailyLossStatePath) throw new Error("V97 LIVE requires shared Kill Switch and portfolio Daily Loss state paths.");
        if (c.maximumDailyLossPct > 2) throw new Error("V97 LIVE maximumDailyLossPct must not exceed 2%.");
        if (c.portfolioGrossCap > 2.5 || c.maximumGross > 1.25) throw new Error("V97 LIVE Gross contract exceeds validated limits.");
    }

    private async sharedRiskReason() {
        const c = this.dependencies.config;
        if (c.mode === "SHADOW") return undefined;
        const killSwitch = await readDisDexV96KillSwitch(c.killSwitchPath);
        if (killSwitch) return `Shared Kill Switch: ${killSwitch.reason}`;
        if (await readDailyLoss(c.portfolioDailyLossStatePath)) return `Shared portfolio Daily Loss latch is active at ${c.maximumDailyLossPct}%.`;
        return undefined;
    }

    private recordFailure(state: DisDexV97RunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, { occurredAt: this.now(), message, idempotencyKey: state.pending?.idempotencyKey }].slice(-100);
        return message;
    }

    private async applyResult(state: DisDexV97RunnerState, pending: DisDexV97PendingOrder, result: DirectTradeResult): Promise<DisDexV97TickResult> {
        if (result.status === "UNKNOWN") {
            pending.phase = "manual_review"; pending.lastError = result.error || "V97 order status is UNKNOWN."; pending.updatedAt = this.now(); await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        if (!filled(result)) {
            pending.phase = "manual_review"; pending.lastError = `V97 order ended with ${result.status}; blind retry is forbidden.`; pending.updatedAt = this.now(); await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        if (pending.reduceOnly) state.position = undefined;
        else state.position = { symbol: pending.symbol, side: -1, entryTs: pending.entryTs || pending.referenceTs + 4 * 60 * 60_000, entryPrice: result.averagePrice || pending.expectedPrice, quantity: result.executedQuantity, gross: pending.targetGross };
        state.lastCompletedIdempotencyKey = pending.idempotencyKey; state.pending = undefined; await this.dependencies.stateStore.save(state);
        return { status: "completed", message: `V97 ${pending.reduceOnly ? "exit" : "entry"} completed for ${pending.symbol}.`, idempotencyKey: pending.idempotencyKey };
    }

    private async reconcilePending(state: DisDexV97RunnerState) {
        const pending = state.pending!;
        if (pending.phase === "manual_review") return { status: "manual-review", message: pending.lastError || "V97 pending order requires manual review.", idempotencyKey: pending.idempotencyKey } as DisDexV97TickResult;
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        return this.applyResult(state, pending, result);
    }

    private async executePending(state: DisDexV97RunnerState): Promise<DisDexV97TickResult> {
        const pending = state.pending!;
        try {
            const quote = await this.dependencies.executor.getMarketQuote(pending.symbol);
            const expectedPrice = pending.side === "BUY" ? quote.askPrice : quote.bidPrice;
            const normalized = await this.dependencies.executor.normalizeMarketQuantity(pending.symbol, pending.quantity, expectedPrice, { allowBelowMinNotional: pending.reduceOnly });
            pending.quantity = normalized.quantity; pending.expectedPrice = expectedPrice; pending.phase = "submitted"; pending.updatedAt = this.now(); await this.dependencies.stateStore.save(state);
            const command: DirectTradeCommand = { requestId: pending.idempotencyKey, clientOrderId: pending.clientOrderId, symbol: pending.symbol, side: pending.side, quantity: normalized.quantity, positionSide: "BOTH", reduceOnly: pending.reduceOnly, expectedPrice, maxSlippageBps: this.dependencies.config.maxSlippageBps, reason: pending.reason };
            return this.applyResult(state, pending, await this.dependencies.executor.executeMarket(command));
        } catch (error) {
            pending.retryCount += 1; pending.lastError = this.recordFailure(state, error); pending.updatedAt = this.now(); pending.phase = pending.retryCount >= this.dependencies.config.maxTransactionRetries ? "manual_review" : "planned"; await this.dependencies.stateStore.save(state);
            return { status: pending.phase === "manual_review" ? "manual-review" : "failed", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
    }

    async tick(): Promise<DisDexV97TickResult> {
        const c = this.dependencies.config;
        if (!c.enabled) return { status: "disabled", message: "V97 is repository/runtime disabled." };
        this.ensureLiveGate();
        const lock = await this.dependencies.lock.acquire(randomUUID());
        if (!lock) return { status: "locked", message: "Another shared crypto tick owns the account lock." };
        try {
            const state = await this.dependencies.stateStore.load(); state.lastRunAt = this.now();
            if (state.pending) return await this.reconcilePending(state);
            const history = await this.dependencies.marketData.load();
            const referenceTs = history.bars4h.BTCUSDT.at(-1)?.openTime;
            if (!referenceTs) throw new Error("V97 latest BTC reference is unavailable.");
            const entryTs = referenceTs + 4 * 60 * 60_000;
            const controllerGross = Math.max(0, Math.min(c.maximumGross, c.targetGrossResolver ? finite(c.targetGrossResolver(history, entryTs), 0) : c.baseGross));
            if (c.mode === "SHADOW") {
                const signal = buildDisDexV97Signal(history, state.position, controllerGross, this.now()); state.lastSignalReferenceTs = signal.referenceTs; await this.dependencies.stateStore.save(state);
                return { status: "shadow", message: signal.reason, signal };
            }
            const [account, positions, openOrders] = await Promise.all([this.dependencies.executor.getAccountSnapshot(), this.dependencies.executor.getPositions(), this.dependencies.executor.getOpenOrders()]);
            const managed = managedPositions(positions);
            if (!state.position && managed.length > 0) return { status: "manual-review", message: `V97 found ${managed.length} unmanaged V97-universe position(s); takeover is forbidden.` };
            if (state.position && managed.length !== 1) return { status: "manual-review", message: `V97 durable state expects exactly one managed position; Aster returned ${managed.length}.` };
            if (state.position) {
                const actual = managed[0];
                if (actual.symbol.toUpperCase() !== state.position.symbol || sideOf(actual) !== -1 || Math.abs(Math.abs(actual.quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.01)) return { status: "manual-review", message: "V97 durable state and Aster position disagree." };
                state.position = stateFromActual(actual, state.position);
            }
            if (openOrders.some((order) => MANAGED.has(order.symbol.toUpperCase()))) { await this.dependencies.stateStore.save(state); return { status: "held", message: "V97 will not act while a V97-universe open order exists." }; }
            const sharedRisk = await this.sharedRiskReason();
            let signal = buildDisDexV97Signal(history, state.position, controllerGross, this.now());
            if (sharedRisk && state.position) signal = { ...signal, side: 0, targetGross: 0, reason: sharedRisk, exit: { symbol: state.position.symbol, side: -1, reason: "SHARED_RISK_FLATTEN" } };
            state.lastSignalReferenceTs = signal.referenceTs;
            if (sharedRisk && !state.position) { await this.dependencies.stateStore.save(state); return { status: "held", message: `${sharedRisk} New V97 entries are blocked.`, signal }; }
            const reduceOnly = Boolean(signal.exit && state.position);
            const symbol = (reduceOnly ? state.position!.symbol : signal.symbol) as DisDexV97Symbol | undefined;
            const side: AsterOrderSide | undefined = reduceOnly ? "BUY" : signal.side < 0 ? "SELL" : undefined;
            if (!side || !symbol) { await this.dependencies.stateStore.save(state); return { status: "no-change", message: signal.reason, signal }; }
            if (!reduceOnly && signal.entryTs && (this.now() < signal.entryTs - 60_000 || this.now() > signal.entryTs + ENTRY_MAX_DELAY_MS)) { await this.dependencies.stateStore.save(state); return { status: "held", message: `V97 entry window missed for ${new Date(signal.entryTs).toISOString()}; stale entry is forbidden.`, signal }; }
            const actual = reduceOnly ? managed[0] : undefined;
            let targetGross = reduceOnly ? state.position!.gross : Math.min(signal.targetGross, c.maximumGross);
            let quantity: number;
            if (reduceOnly) quantity = Math.abs(actual!.quantity);
            else {
                const wallet = Math.max(0, account.walletBalance); if (!(wallet > 0)) return { status: "manual-review", message: "V97 account wallet balance is not positive." };
                const currentGross = positions.reduce((sum, position) => sum + Math.abs(finite(position.notionalUsd)), 0) / wallet;
                const residualGross = Math.max(0, c.portfolioGrossCap - currentGross);
                targetGross = Math.min(targetGross, residualGross);
                if (targetGross <= 0) { await this.dependencies.stateStore.save(state); return { status: "held", message: "V97 valid signal has no shared portfolio Gross headroom.", signal }; }
                const quote = await this.dependencies.executor.getMarketQuote(symbol); const expected = quote.bidPrice;
                const targetNotional = wallet * targetGross;
                if (targetNotional < c.minimumOrderNotionalUsd) { await this.dependencies.stateStore.save(state); return { status: "held", message: `V97 scaled target notional ${targetNotional.toFixed(2)} is below minimum.`, signal }; }
                quantity = targetNotional / expected;
            }
            const key = idempotency(signal, symbol, side, reduceOnly, quantity);
            state.pending = { idempotencyKey: key, clientOrderId: clientOrderId(key), phase: "planned", symbol, side, quantity, reduceOnly, expectedPrice: 0, targetGross, referenceTs: signal.referenceTs, entryTs: signal.entryTs, reason: signal.reason, createdAt: this.now(), updatedAt: this.now(), retryCount: 0 };
            await this.dependencies.stateStore.save(state);
            return await this.executePending(state);
        } finally { await lock.release(); }
    }
}
