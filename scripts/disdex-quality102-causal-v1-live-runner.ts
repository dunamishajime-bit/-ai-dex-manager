import "dotenv/config";

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
    QUALITY102_CAUSAL_V1,
    resolveQuality102CausalV1Runtime,
    type Quality102CausalV1Mode,
} from "../config/disdexQuality102CausalV1Runtime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectPosition } from "../lib/direct-trade-executor";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { readQuality102CausalV1Ownership } from "../lib/disdex-quality102-causal-v1-ownership";
import {
    FileQuality102CausalV1StateStore,
    type Quality102CausalV1State,
} from "../lib/disdex-quality102-causal-v1-state";
import { Quality102CausalV1AsterMarketDataProvider } from "../lib/disdex-quality102-causal-v1-market-data";
import { Quality102CausalV1Runner } from "../lib/disdex-quality102-causal-v1-runner";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { classifyRunnerSafetyState, writeRunnerHeartbeat, type RunnerHeartbeat } from "../lib/disdex-runner-health";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_STATE_ROOT = "/var/lib/disdex/quality102-causal-v1";
const DEFAULT_SHARED_ROOT = "/var/lib/disdex/shared";
const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;
const DEFAULT_HISTORY_HOURS = 225 * 24;
const DEFAULT_MAX_ENTRY_DELAY_MS = 2 * 60 * 60_000;
const HOUR_MS = 3_600_000;
const ZERO_SHA = "0".repeat(40);

function q102Safety(status: string, message: string, liveEnabled: boolean): RunnerHeartbeat["safetyState"] {
    return classifyRunnerSafetyState(status, message, liveEnabled);
}

function q102HeartbeatPath(env: NodeJS.ProcessEnv = process.env) { return env.DISDEX_RUNNER_HEARTBEAT_PATH || `${env.DISDEX_RUNNER_HEALTH_ROOT || "/var/lib/disdex/runner-health"}/quality102-causal-v1.json`; }

export function buildQuality102RunnerHeartbeat(result: { status: string; message: string; signal?: { symbol?: string; reason: string } }, config: Pick<Quality102CausalV1LiveResolvedConfig, "mode" | "enabled" | "liveTradingEnabled" | "liveExecutionEnabled" | "runtimeCommitSha" | "expectedRuntimeCommitSha" | "symbols">, now = Date.now(), state?: Pick<Quality102CausalV1State, "lastReconciledAt"> | null): RunnerHeartbeat {
    const liveEnabled = config.mode === "LIVE" && config.enabled && config.liveTradingEnabled && config.liveExecutionEnabled;
    const sha = /^[0-9a-f]{40}$/i.test(config.runtimeCommitSha) ? config.runtimeCommitSha.toLowerCase() : ZERO_SHA;
    const expectedSha = /^[0-9a-f]{40}$/i.test(config.expectedRuntimeCommitSha) ? config.expectedRuntimeCommitSha.toLowerCase() : ZERO_SHA;
    const shaAvailable = sha !== ZERO_SHA && expectedSha !== ZERO_SHA;
    return {
        schema: "disdex-runner-heartbeat/v1", runnerId: "QUALITY102_CAUSAL_V1", serviceUnit: process.env.DISDEX_RUNNER_SERVICE_UNIT || "disdex-quality102-causal-v1.service",
        runtimeSha: sha, expectedSha, workingDirectory: process.cwd(), mode: config.mode, liveEnabled, safetyState: shaAvailable ? q102Safety(result.status, result.message, liveEnabled) : "UNKNOWN", heartbeatAt: now, lastTickAt: now,
        lastReconciliationAt: state?.lastReconciledAt ?? null, lastDecision: result.status, reason: shaAvailable ? (result.message || result.status) : "runtime or expected SHA unavailable",
        symbols: config.symbols.map((symbol) => ({ symbol, eligible: result.signal?.symbol === symbol, reason: result.signal?.symbol === symbol ? result.signal.reason : result.message || "not-selected" })),
        caps: { strategy: 0.5, crypto: 2, total: 2.5 }, restartAttempts: Math.max(0, Number.parseInt(process.env.DISDEX_RUNNER_RESTART_ATTEMPTS || "0", 10) || 0), updatedAt: now,
        quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
    };
}

export async function publishQuality102Heartbeat(result: { status: string; message: string; signal?: { symbol?: string; reason: string } }, config: Quality102CausalV1LiveResolvedConfig, now = Date.now(), env: NodeJS.ProcessEnv = process.env) {
    try {
        let state: Quality102CausalV1State | undefined;
        let stateUnavailable = false;
        try {
            state = await new FileQuality102CausalV1StateStore(config.statePath, config.mode, config.runtimeCommitSha).load();
        } catch {
            stateUnavailable = true;
        }
        const heartbeatResult = stateUnavailable
            ? { ...result, message: `${result.message || result.status}; Q102 persisted state unavailable` }
            : result;
        await writeRunnerHeartbeat(q102HeartbeatPath(env), buildQuality102RunnerHeartbeat(heartbeatResult, config, now, state));
    } catch (error) { console.error(JSON.stringify({ level: "warn", event: "runner-heartbeat-write-failed", runnerId: "QUALITY102_CAUSAL_V1", reason: error instanceof Error ? error.message : String(error) })); }
}

export interface Quality102CausalV1LiveResolvedConfig {
    mode: Quality102CausalV1Mode;
    enabled: boolean;
    liveTradingEnabled: boolean;
    liveExecutionEnabled: boolean;
    operatorArmed: boolean;
    runtimeCommitSha: string;
    expectedRuntimeCommitSha: string;
    selectorMode: string;
    symbols: string[];
    statePath: string;
    killSwitchPath: string;
    sharedDailyRiskPath: string;
    accountLockPath: string;
    maximumGross: number;
    cryptoGrossCap: number;
    totalGrossCap: number;
    maximumPositions: number;
    maxSlippageBps: number;
    minimumOrderNotionalUsd: number;
    maximumEntryDelayMs: number;
    maximumDailyLossPct: number;
    maxDataAgeMs: number;
    historyHours: number;
    historyPageLimit: number;
    stateRoot: string;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback = false): boolean {
    const raw = env[name];
    return raw === undefined ? fallback : /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
    const parsed = Number(env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredSha(env: NodeJS.ProcessEnv): string {
    const value = String(env.DISDEX_RUNTIME_COMMIT_SHA || env.DISDEX_RELEASE_SHA || env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
    return value;
}

function expectedSha(env: NodeJS.ProcessEnv): string {
    return String(env.DISDEX_EXPECTED_RUNTIME_SHA || env.DISDEX_EXPECTED_SHA || "").trim().toLowerCase();
}

export function parseQuality102CausalV1Symbols(value: string | undefined): string[] {
    const symbols = String(value || "")
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
    const unique = [...new Set(symbols)].sort();
    if (!unique.length) throw new Error("QUALITY102_CAUSAL_V1_SYMBOLS_REQUIRED");
    if (unique.some((symbol) => symbol === "BTCUSDT" || classifyAsterSymbol(symbol).tradable)) {
        throw new Error("QUALITY102_CAUSAL_V1_SYMBOL_UNSAFE_BASE_OVERLAP");
    }
    return unique;
}

function positiveConfig(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}_MUST_BE_POSITIVE`);
    return value;
}

export function resolveQuality102CausalV1LiveConfig(env: NodeJS.ProcessEnv = process.env): Quality102CausalV1LiveResolvedConfig {
    const runtime = resolveQuality102CausalV1Runtime(env);
    const stateRoot = resolve(env.QUALITY102_CAUSAL_V1_STATE_DIR || DEFAULT_STATE_ROOT);
    const sharedRoot = resolve(env.DISDEX_SHARED_RUNTIME_ROOT || DEFAULT_SHARED_ROOT);
    const symbols = parseQuality102CausalV1Symbols(env.QUALITY102_CAUSAL_V1_SYMBOLS);
    const runtimeSha = requiredSha(env);
    const statePath = resolve(env.QUALITY102_CAUSAL_V1_STATE_PATH || resolve(stateRoot, "state.json"));
    const killSwitchPath = resolve(
        env.QUALITY102_CAUSAL_V1_KILL_SWITCH_FILE
        || env.DISDEX_SHARED_KILL_SWITCH_FILE
        || env.DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE
        || env.DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE
        || resolve(sharedRoot, "kill-switch.json"),
    );
    const sharedDailyRiskPath = resolve(
        env.QUALITY102_CAUSAL_V1_DAILY_RISK_FILE
        || env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH
        || resolve(sharedRoot, "crypto-daily-risk.json"),
    );
    const accountLockPath = resolve(
        env.QUALITY102_CAUSAL_V1_ACCOUNT_LOCK_PATH
        || env.DISDEX_ACCOUNT_LOCK_PATH
        || resolve(sharedRoot, "account-order.lock"),
    );
    const maxDataAgeMs = positiveConfig(numberEnv(env, "QUALITY102_CAUSAL_V1_MAX_DATA_AGE_MS", DEFAULT_MAX_DATA_AGE_MS), "QUALITY102_CAUSAL_V1_MAX_DATA_AGE_MS");
    const maximumEntryDelayMs = positiveConfig(numberEnv(env, "QUALITY102_CAUSAL_V1_MAX_ENTRY_DELAY_MS", DEFAULT_MAX_ENTRY_DELAY_MS), "QUALITY102_CAUSAL_V1_MAX_ENTRY_DELAY_MS");
    if (maximumEntryDelayMs > 6 * HOUR_MS) throw new Error("QUALITY102_CAUSAL_V1_MAX_ENTRY_DELAY_MS_TOO_LARGE");
    const historyHours = Math.floor(numberEnv(env, "QUALITY102_CAUSAL_V1_HISTORY_HOURS", DEFAULT_HISTORY_HOURS));
    const historyPageLimit = Math.floor(numberEnv(env, "QUALITY102_CAUSAL_V1_HISTORY_PAGE_LIMIT", 500));
    if (historyHours < 181 * 24 || historyPageLimit < 1 || historyPageLimit > 500) throw new Error("QUALITY102_CAUSAL_V1_HISTORY_CONFIG_INVALID");
    const config: Quality102CausalV1LiveResolvedConfig = {
        mode: runtime.mode,
        enabled: runtime.enabled,
        liveTradingEnabled: runtime.liveTradingEnabled,
        liveExecutionEnabled: runtime.liveExecutionEnabled,
        operatorArmed: runtime.operatorArmed,
        runtimeCommitSha: runtimeSha,
        expectedRuntimeCommitSha: expectedSha(env),
        selectorMode: String(env.QUALITY102_CAUSAL_V1_SELECTOR_MODE || "").trim().toUpperCase(),
        symbols,
        statePath,
        killSwitchPath,
        sharedDailyRiskPath,
        accountLockPath,
        maximumGross: runtime.maximumGross,
        cryptoGrossCap: runtime.cryptoGrossCap,
        totalGrossCap: runtime.totalGrossCap,
        maximumPositions: runtime.maximumPositions,
        maxSlippageBps: positiveConfig(numberEnv(env, "QUALITY102_CAUSAL_V1_MAX_SLIPPAGE_BPS", 35), "QUALITY102_CAUSAL_V1_MAX_SLIPPAGE_BPS"),
        minimumOrderNotionalUsd: Math.max(5, numberEnv(env, "QUALITY102_CAUSAL_V1_MIN_ORDER_NOTIONAL_USD", 5)),
        maximumEntryDelayMs,
        maximumDailyLossPct: positiveConfig(numberEnv(env, "QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT", 5), "QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT"),
        maxDataAgeMs,
        historyHours,
        historyPageLimit,
        stateRoot,
    };
    if (Math.abs(config.maximumGross - QUALITY102_CAUSAL_V1.maximumGross) > 1e-12
        || Math.abs(config.cryptoGrossCap - QUALITY102_CAUSAL_V1.cryptoGrossCap) > 1e-12
        || Math.abs(config.totalGrossCap - QUALITY102_CAUSAL_V1.totalGrossCap) > 1e-12
        || config.maximumPositions !== QUALITY102_CAUSAL_V1.maximumPositions) {
        throw new Error("QUALITY102_CAUSAL_V1_GROSS_CONTRACT_MISMATCH");
    }
    return config;
}

function safeHeartbeatSha(value: string): string {
    return SHA_PATTERN.test(value) ? value.toLowerCase() : ZERO_SHA;
}

function safeHeartbeatMode(env: NodeJS.ProcessEnv): string {
    const mode = String(env.QUALITY102_CAUSAL_V1_MODE || "").trim().toUpperCase();
    return mode === "LIVE" || mode === "PAPER" || mode === "SHADOW" ? mode : "UNKNOWN";
}

export function buildQuality102FatalHeartbeat(now = Date.now(), env: NodeJS.ProcessEnv = process.env): RunnerHeartbeat {
    return {
        schema: "disdex-runner-heartbeat/v1",
        runnerId: "QUALITY102_CAUSAL_V1",
        serviceUnit: String(env.DISDEX_RUNNER_SERVICE_UNIT || "disdex-quality102-causal-v1.service").trim() || "disdex-quality102-causal-v1.service",
        runtimeSha: safeHeartbeatSha(requiredSha(env)),
        expectedSha: safeHeartbeatSha(expectedSha(env)),
        workingDirectory: (() => {
            try { return process.cwd(); } catch { return "."; }
        })(),
        mode: safeHeartbeatMode(env),
        liveEnabled: false,
        safetyState: "UNKNOWN",
        heartbeatAt: now,
        lastTickAt: null,
        lastReconciliationAt: null,
        lastDecision: "fatal",
        reason: "QUALITY102_CAUSAL_V1_FATAL_FAIL_CLOSED",
        symbols: [],
        caps: { strategy: 0.5, crypto: 2, total: 2.5 },
        restartAttempts: Math.max(0, Number.parseInt(env.DISDEX_RUNNER_RESTART_ATTEMPTS || "0", 10) || 0),
        updatedAt: now,
        quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false },
    };
}

export async function publishQuality102FatalHeartbeat(error: unknown, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<void> {
    void error;
    const fatalResult = { status: "fatal", message: "QUALITY102_CAUSAL_V1_FATAL_FAIL_CLOSED" };
    try {
        let config: Quality102CausalV1LiveResolvedConfig | undefined;
        try {
            config = resolveQuality102CausalV1LiveConfig(env);
        } catch {
            config = undefined;
        }
        if (config) {
            await publishQuality102Heartbeat(fatalResult, config, now, env);
            return;
        }
        await writeRunnerHeartbeat(q102HeartbeatPath(env), buildQuality102FatalHeartbeat(now, env));
    } catch {
        console.error(JSON.stringify({
            level: "warn",
            event: "runner-heartbeat-write-failed",
            runnerId: "QUALITY102_CAUSAL_V1",
            reason: "fatal heartbeat unavailable",
        }));
    }
}

export function assertQuality102CausalV1LiveActivation(
    config: Quality102CausalV1LiveResolvedConfig,
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (config.mode !== "LIVE") return;
    if (!config.enabled || !config.liveTradingEnabled || !config.liveExecutionEnabled || !config.operatorArmed) {
        throw new Error("QUALITY102_CAUSAL_V1_LIVE_GATES_NOT_ALL_ENABLED");
    }
    if (!SHA_PATTERN.test(config.runtimeCommitSha)) throw new Error("QUALITY102_CAUSAL_V1_RUNTIME_COMMIT_SHA_REQUIRED");
    if (!SHA_PATTERN.test(config.expectedRuntimeCommitSha)) throw new Error("QUALITY102_CAUSAL_V1_EXPECTED_RUNTIME_COMMIT_SHA_REQUIRED");
    if (config.expectedRuntimeCommitSha.toLowerCase() !== config.runtimeCommitSha.toLowerCase()) throw new Error("QUALITY102_CAUSAL_V1_RUNTIME_SHA_MISMATCH");
    if (config.selectorMode !== "DERIVED_HIGH_VOL_ONLY") throw new Error("QUALITY102_CAUSAL_V1_SELECTOR_MODE_ACK_REQUIRED");
    const ack = String(env.QUALITY102_CAUSAL_V1_LIVE_ACK || "").trim().toLowerCase();
    if (ack !== config.runtimeCommitSha.toLowerCase()) throw new Error("QUALITY102_CAUSAL_V1_LIVE_ACK_MUST_MATCH_RUNTIME_SHA");
    if (boolEnv(env, "QUALITY102_LIVE_SELECTOR_PARITY") || boolEnv(env, "QUALITY102_LIVE_ENABLED")) {
        throw new Error("QUALITY102_HISTORICAL_SELECTOR_FLAG_MUST_REMAIN_FAIL_CLOSED");
    }
    if (!config.killSwitchPath || !config.sharedDailyRiskPath || !config.accountLockPath) {
        throw new Error("QUALITY102_CAUSAL_V1_SHARED_SAFETY_PATHS_REQUIRED");
    }
}

function createClient(env: NodeJS.ProcessEnv, releaseSha: string): AsterV3Client {
    return new AsterV3Client({
        baseUrl: env.ASTER_FUTURES_BASE_URL,
        userAddress: env.ASTER_USER_ADDRESS,
        privateKey: env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv(env, "ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv(env, "ASTER_RECV_WINDOW_MS", 5000),
        userAgent: `DisDex-Quality102-CausalV1/${releaseSha ? releaseSha.slice(0, 12) : "non-live"}`,
    });
}

function actualSide(position: DirectPosition): -1 | 1 {
    if (position.positionSide === "SHORT") return -1;
    if (position.positionSide === "LONG") return 1;
    return position.quantity < 0 ? -1 : 1;
}

function assertFreshPosition(position: DirectPosition, now: number, maxAgeMs: number): void {
    if (!Number.isFinite(position.updatedAt) || position.updatedAt <= 0 || position.updatedAt > now || now - position.updatedAt > maxAgeMs) {
        throw new Error(`QUALITY102_PREFLIGHT_POSITION_STALE:${position.symbol}`);
    }
    if (!Number.isFinite(position.quantity) || !Number.isFinite(position.entryPrice) || !Number.isFinite(position.markPrice) || !Number.isFinite(position.notionalUsd)) {
        throw new Error(`QUALITY102_PREFLIGHT_POSITION_INVALID:${position.symbol}`);
    }
}

async function stateFileExists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

async function stateFileSnapshot(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

export async function runQuality102CausalV1ReadOnlyPreflight(
    env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
    const config = resolveQuality102CausalV1LiveConfig(env);
    assertQuality102CausalV1LiveActivation(config);
    if (config.mode !== "LIVE") {
        return {
            status: "QUALITY102_CAUSAL_V1_NON_LIVE_PREFLIGHT_PASS",
            mode: config.mode,
            selectorMode: config.selectorMode,
            symbols: config.symbols,
            networkReads: 0,
            ordersSent: 0,
            cancelSent: 0,
            positionChangesSent: 0,
            stateChanged: false,
            syntheticOrders: 0,
            testOrders: 0,
        };
    }
    const client = createClient(env, config.runtimeCommitSha);
    if (!client.hasTradingCredentials()) throw new Error("QUALITY102_PREFLIGHT_ASTER_CREDENTIALS_MISSING");
    const executor = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv(env, "ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv(env, "ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv(env, "ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const stateStore = new FileQuality102CausalV1StateStore(config.statePath, config.mode, config.expectedRuntimeCommitSha);
    const beforeStateFile = await stateFileSnapshot(config.statePath);
    const beforeState = await stateStore.load();
    if (beforeState.pending) throw new Error("QUALITY102_PREFLIGHT_PENDING_ORDER_REQUIRES_RECONCILIATION");
    if (config.mode === "LIVE" && beforeState.runtimeCommitSha.toLowerCase() !== config.runtimeCommitSha.toLowerCase()) {
        throw new Error("QUALITY102_PREFLIGHT_STATE_SHA_MISMATCH");
    }
    const marketData = new Quality102CausalV1AsterMarketDataProvider(client, {
        symbols: config.symbols,
        historyHours: config.historyHours,
        pageLimit: config.historyPageLimit,
        cacheTtlMs: 0,
    });
    const [ping, exchangeInfo, account, positions, openOrders] = await Promise.all([
        client.ping(),
        client.getExchangeInfo(),
        executor.getAccountSnapshot(),
        executor.getPositions(),
        executor.getOpenOrders(),
    ]);
    // Establish the local freshness boundary only after the read batch has
    // completed. Account freshness uses the venue clock, so capturing `now`
    // before the network round-trip can incorrectly classify a healthy
    // snapshot as being a few milliseconds in the future.
    const now = Date.now();
    void ping;
    const exchangeRows = new Map(exchangeInfo.symbols.map((row) => [row.symbol.toUpperCase(), row]));
    for (const symbol of config.symbols) {
        const row = exchangeRows.get(symbol);
        if (!row || row.status !== "TRADING") throw new Error(`QUALITY102_PREFLIGHT_SYMBOL_NOT_TRADING:${symbol}`);
    }
    if (!(account.walletBalance > 0) || !Number.isFinite(account.availableBalance) || account.availableBalance < 0 || !Number.isFinite(account.updatedAt) || account.updatedAt <= 0 || account.updatedAt > now || now - account.updatedAt > config.maxDataAgeMs) {
        throw new Error("QUALITY102_PREFLIGHT_ACCOUNT_STALE_OR_INVALID");
    }
    const configured = new Set(config.symbols);
    for (const position of positions) {
        assertFreshPosition(position, now, config.maxDataAgeMs);
        const symbol = position.symbol.toUpperCase();
        if (Math.abs(position.quantity) <= 1e-12) continue;
        if (configured.has(symbol)) {
            const owned = beforeState.position;
            if (!owned || owned.symbol.toUpperCase() !== symbol || owned.side !== actualSide(position) || Math.abs(owned.quantity - Math.abs(position.quantity)) > Math.max(1e-8, owned.quantity * 0.01)) {
                throw new Error(`QUALITY102_PREFLIGHT_UNMANAGED_Q102_POSITION:${symbol}`);
            }
        } else if (!classifyAsterSymbol(symbol).tradable) {
            throw new Error(`QUALITY102_PREFLIGHT_UNKNOWN_POSITION_OWNERSHIP:${symbol}`);
        }
    }
    if (beforeState.position && !positions.some((position) => configured.has(position.symbol.toUpperCase()) && Math.abs(position.quantity) > 1e-12 && beforeState.position && beforeState.position.symbol.toUpperCase() === position.symbol.toUpperCase() && beforeState.position.side === actualSide(position))) {
        throw new Error("QUALITY102_PREFLIGHT_STATE_POSITION_NOT_ON_EXCHANGE");
    }
    if (openOrders.length > 0) throw new Error("QUALITY102_PREFLIGHT_OPEN_ORDER_CONFLICT");
    const quotes = await Promise.all(config.symbols.map(async (symbol) => {
        const quote = await executor.getMarketQuote(symbol);
        return { symbol, quote };
    }));
    const quotesNow = Date.now();
    for (const { symbol, quote } of quotes) {
        if (quote.symbol.toUpperCase() !== symbol || !(quote.bidPrice > 0) || !(quote.askPrice > 0) || quote.askPrice < quote.bidPrice || !(quote.midPrice > 0) || !Number.isFinite(quote.updatedAt) || quote.updatedAt <= 0 || quote.updatedAt > quotesNow || quotesNow - quote.updatedAt > config.maxDataAgeMs) {
            throw new Error(`QUALITY102_PREFLIGHT_QUOTE_INVALID:${symbol}`);
        }
    }
    const history = await marketData.load();
    const afterStateFile = await stateFileSnapshot(config.statePath);
    if (beforeStateFile !== afterStateFile) throw new Error("QUALITY102_PREFLIGHT_STATE_CHANGED");
    return {
        status: "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_PASS",
        mode: config.mode,
        selectorMode: config.selectorMode,
        symbols: config.symbols,
        historySymbols: Object.keys(history.candlesBySymbol).sort(),
        statePath: config.statePath,
        stateExists: await stateFileExists(config.statePath),
        accountAsset: account.asset,
        positionCount: positions.length,
        openOrderCount: openOrders.length,
        quality102Position: beforeState.position?.symbol,
        quality102Pending: Boolean(beforeState.pending),
        gross: {
            quality102: config.maximumGross,
            crypto: config.cryptoGrossCap,
            total: config.totalGrossCap,
        },
        ordersSent: 0,
        cancelSent: 0,
        positionChangesSent: 0,
        stateChanged: false,
        syntheticOrders: 0,
        testOrders: 0,
    };
}

export function buildQuality102CausalV1Runner(env: NodeJS.ProcessEnv = process.env) {
    const config = resolveQuality102CausalV1LiveConfig(env);
    assertQuality102CausalV1LiveActivation(config);
    const client = createClient(env, config.runtimeCommitSha);
    if (config.mode === "LIVE" && !client.hasTradingCredentials()) throw new Error("QUALITY102_CAUSAL_V1_LIVE_CREDENTIALS_REQUIRED");
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv(env, "ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv(env, "ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv(env, "ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor = config.mode === "PAPER"
        ? new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(config.stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv(env, "QUALITY102_CAUSAL_V1_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv(env, "QUALITY102_CAUSAL_V1_PAPER_FEE_BPS_PER_SIDE", 6),
            maxGross: config.totalGrossCap,
        })
        : aster;
    const runner = new Quality102CausalV1Runner({
        marketData: new Quality102CausalV1AsterMarketDataProvider(client, {
            symbols: config.symbols,
            historyHours: config.historyHours,
            pageLimit: config.historyPageLimit,
            cacheTtlMs: numberEnv(env, "QUALITY102_CAUSAL_V1_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        }),
        executor,
        stateStore: new FileQuality102CausalV1StateStore(config.statePath, config.mode, config.expectedRuntimeCommitSha),
        lock: new FileAccountOrderLock(config.accountLockPath, numberEnv(env, "DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000)),
        config: {
            mode: config.mode,
            enabled: config.enabled,
            liveTradingEnabled: config.liveTradingEnabled,
            liveExecutionEnabled: config.liveExecutionEnabled,
            operatorArmed: config.operatorArmed,
            runtimeCommitSha: config.runtimeCommitSha,
            expectedRuntimeCommitSha: config.expectedRuntimeCommitSha,
            symbols: config.symbols,
            maximumGross: config.maximumGross,
            cryptoGrossCap: config.cryptoGrossCap,
            totalGrossCap: config.totalGrossCap,
            maximumPositions: config.maximumPositions,
            maxSlippageBps: config.maxSlippageBps,
            minimumOrderNotionalUsd: config.minimumOrderNotionalUsd,
            maximumEntryDelayMs: config.maximumEntryDelayMs,
            maximumDailyLossPct: config.maximumDailyLossPct,
            maxDataAgeMs: config.maxDataAgeMs,
            killSwitchPath: config.killSwitchPath,
            sharedDailyRiskPath: config.sharedDailyRiskPath,
            accountScope: "ASTER_FUTURES",
        },
    });
    return { config, runner };
}

async function main(): Promise<void> {
    if (process.argv.includes("--preflight")) {
        const result = await runQuality102CausalV1ReadOnlyPreflight();
        console.log(JSON.stringify(result));
        return;
    }
    const built = buildQuality102CausalV1Runner();
    console.log(JSON.stringify({
        event: "quality102-causal-v1-runner-start",
        strategyId: QUALITY102_CAUSAL_V1.strategyId,
        mode: built.config.mode,
        enabled: built.config.enabled,
        selectorMode: built.config.selectorMode,
        symbols: built.config.symbols,
        runtimeCommitSha: built.config.runtimeCommitSha,
        quality102GrossCap: built.config.maximumGross,
        cryptoGrossCap: built.config.cryptoGrossCap,
        totalGrossCap: built.config.totalGrossCap,
        historicalSelectorParity: false,
        brkLiveEnabled: false,
        ordersSent: 0,
    }));
    const daemon = process.argv.includes("--daemon");
    const delay = createInterruptibleDelay();
    let stopping = false;
    const stop = () => { stopping = true; delay.interrupt(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await built.runner.tick();
        await publishQuality102Heartbeat(result, built.config);
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...result }));
        if (!daemon || stopping || result.status === "manual-review") {
            if (result.status === "manual-review") process.exitCode = 2;
            break;
        }
        const now = Date.now();
        const waitMs = HOUR_MS - (now % HOUR_MS) + Math.min(30_000, Math.max(1_000, numberEnv(process.env, "QUALITY102_CAUSAL_V1_BOUNDARY_DELAY_MS", 5_000)));
        await delay.wait(waitMs);
    } while (!stopping);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        void publishQuality102FatalHeartbeat(error);
        console.error(JSON.stringify({
            level: "fatal",
            strategyId: QUALITY102_CAUSAL_V1.strategyId,
            status: "QUALITY102_CAUSAL_V1_FAIL_CLOSED",
            message: error instanceof Error ? error.message : String(error),
            ordersSent: 0,
            syntheticOrders: 0,
            testOrders: 0,
        }));
        process.exitCode = 1;
    });
}
