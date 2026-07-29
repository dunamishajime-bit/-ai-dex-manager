import "dotenv/config";

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { DISDEX_V13D_V11EQ_V96_RUNTIME } from "../config/disdexStockRouterV13DV11EqRuntime";
import { DISDEX_V96_LIVE_PROMOTION } from "../config/disdexV96Runtime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { assertDisDexV96LiveGates, type DisDexV96ExecutionParityApproval, type DisDexV96ForwardEvidenceApproval } from "../lib/disdex-v96-live-gates";
import { readDisDexV96KillSwitch, type DisDexV96OperatorOverrideApproval } from "../lib/disdex-v96-live-risk-controls";

const MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"] as const;

export type ReadOnlyStateSummary = {
    path: string;
    exists: boolean;
    utcDay: string | undefined;
    tripped: boolean;
    manualReview: boolean;
    pending: boolean;
};

function boolEnv(name: string, fallback = false) {
    const value = process.env[name];
    return value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function statePaths(env: NodeJS.ProcessEnv = process.env) {
    const combinedRoot = resolve(env.DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT || env.DISDEX_V13D_V11EQ_V96_STATE_DIR || DISDEX_V13D_V11EQ_V96_RUNTIME.stateDirectory);
    const cryptoRoot = resolve(env.DISDEX_V96_STATE_DIR || `${combinedRoot}/crypto-v96`);
    const stockRoot = resolve(env.DISDEX_V52_ASTER_ONLY_STATE_DIR || `${combinedRoot}/stock`);
    const killSwitch = resolve(env.DISDEX_V96_KILL_SWITCH_FILE || `${combinedRoot}/kill-switch.json`);
    return {
        combinedRoot,
        cryptoState: resolve(cryptoRoot, "runner-live.json"),
        stockState: resolve(stockRoot, "runner-live.json"),
        killSwitch,
    };
}

async function readJson<T>(path: string, label: string): Promise<T> {
    const metadata = await stat(path).catch(() => undefined);
    if (!metadata?.isFile()) throw new Error(`READ_ONLY_PREFLIGHT_STATE_MISSING:${label}`);
    return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readStateSummary(path: string, label: string): Promise<ReadOnlyStateSummary> {
    const state = await readJson<Record<string, unknown>>(path, label);
    const dailyRisk = state.dailyRisk && typeof state.dailyRisk === "object" ? state.dailyRisk as Record<string, unknown> : {};
    const portfolioLatch = state.portfolioDailyLossLatch && typeof state.portfolioDailyLossLatch === "object" ? state.portfolioDailyLossLatch as Record<string, unknown> : {};
    const v52Latch = state.v52StrategyDailyLossLatch && typeof state.v52StrategyDailyLossLatch === "object" ? state.v52StrategyDailyLossLatch as Record<string, unknown> : {};
    return {
        path,
        exists: true,
        utcDay: typeof state.utcDay === "string" ? state.utcDay : typeof dailyRisk.utcDay === "string" ? dailyRisk.utcDay : undefined,
        tripped: dailyRisk.tripped === true || portfolioLatch.tripped === true || v52Latch.tripped === true || state.dailyLossTripped === true,
        manualReview: typeof state.manualReviewReason === "string" && state.manualReviewReason.length > 0,
        pending: Boolean(state.pending),
    };
}

async function readApproval<T>(path: string | undefined, label: string) {
    if (!path) throw new Error(`READ_ONLY_PREFLIGHT_APPROVAL_MISSING:${label}`);
    return readJson<T>(resolve(path), label);
}

async function readOptionalApproval<T>(path: string | undefined) {
    if (!path) return undefined;
    try {
        return await readJson<T>(resolve(path), "optional-forward-evidence");
    } catch (error) {
        if (error instanceof Error && error.message === "READ_ONLY_PREFLIGHT_STATE_MISSING:optional-forward-evidence") return undefined;
        throw error;
    }
}

function approvalPath(path: string | undefined) {
    return path ? resolve(path) : undefined;
}

export async function runReadOnlyPreflight() {
    const paths = statePaths();
    const runtimeCommitSha = String(process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
    const before = {
        crypto: await readStateSummary(paths.cryptoState, "crypto"),
        stock: await readStateSummary(paths.stockState, "stock"),
    };
    const [forwardEvidence, executionParity, operatorOverride] = await Promise.all([
        readOptionalApproval<DisDexV96ForwardEvidenceApproval>(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
        readApproval<DisDexV96ExecutionParityApproval>(process.env.DISDEX_V96_EXECUTION_PARITY_FILE, "execution-parity"),
        readApproval<DisDexV96OperatorOverrideApproval>(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE, "operator-override"),
    ]);
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_READONLY_APPROVAL_SUMMARY",
        runtimeCommitSha,
        approvalPaths: {
            forwardEvidence: approvalPath(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
            executionParity: approvalPath(process.env.DISDEX_V96_EXECUTION_PARITY_FILE),
            operatorOverride: approvalPath(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE),
        },
        executionParity: {
            status: executionParity.status,
            productionCommitSha: executionParity.productionCommitSha,
            researchCommitSha: executionParity.researchCommitSha,
            configFingerprint: executionParity.configFingerprint,
            allocationParityPassed: executionParity.allocationParityPassed,
            signalChronologyParityPassed: executionParity.signalChronologyParityPassed,
            orderQuantityParityPassed: executionParity.orderQuantityParityPassed,
            restartRecoveryPassed: executionParity.restartRecoveryPassed,
            reviewer: executionParity.reviewer,
            reviewedAt: executionParity.reviewedAt,
        },
        operatorOverride: {
            status: operatorOverride.status,
            approvedCommitSha: operatorOverride.approvedCommitSha,
            configFingerprint: operatorOverride.configFingerprint,
            approvedAt: operatorOverride.approvedAt,
            expiresAt: operatorOverride.expiresAt,
            initialPenguGrossCap: operatorOverride.initialPenguGrossCap,
            maximumPortfolioGross: operatorOverride.maximumPortfolioGross,
            maximumDailyLossPct: operatorOverride.maximumDailyLossPct,
        },
        forwardEvidencePresent: Boolean(forwardEvidence),
        secretsPrinted: false,
    }));
    const gate = assertDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: boolEnv("DISDEX_V96_LIVE_EXECUTION_ENABLED"),
        activationAcknowledgement: process.env.DISDEX_V96_LIVE_ACKNOWLEDGEMENT,
        forwardEvidence,
        executionParity,
        operatorOverride,
        runtimeCommitSha,
    });
    const killSwitch = await readDisDexV96KillSwitch(paths.killSwitch);
    if (killSwitch?.active) throw new Error(`READ_ONLY_PREFLIGHT_KILL_SWITCH_ACTIVE:${killSwitch.reason}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-ReadOnly-LIVE-Preflight/1.2",
    });
    if (!client.hasTradingCredentials()) throw new Error("READ_ONLY_PREFLIGHT_ASTER_CREDENTIALS_MISSING");
    const [ping, balances, positions, openOrders] = await Promise.all([client.ping(), client.getBalances(), client.getPositions(), client.getOpenOrders()]);
    void ping;
    if (!Array.isArray(positions) || positions.length === 0) throw new Error("READ_ONLY_PREFLIGHT_ONE_WAY_UNVERIFIED");
    if (positions.some((row) => String(row.positionSide || "").toUpperCase() !== "BOTH")) throw new Error("READ_ONLY_PREFLIGHT_HEDGE_MODE");
    const managedPositions = positions.filter((row) => MANAGED_SYMBOLS.includes(String(row.symbol).toUpperCase() as typeof MANAGED_SYMBOLS[number]) && Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    if (!Array.isArray(openOrders)) throw new Error("READ_ONLY_PREFLIGHT_OPEN_ORDERS_UNAVAILABLE");
    if (!Array.isArray(balances)) throw new Error("READ_ONLY_PREFLIGHT_BALANCE_UNAVAILABLE");

    const currentUtcDay = new Date().toISOString().slice(0, 10);
    const savedUtcDay = before.stock.utcDay || before.crypto.utcDay;
    const rolloverRequired = Boolean((before.crypto.utcDay && before.crypto.utcDay !== currentUtcDay) || (before.stock.utcDay && before.stock.utcDay !== currentUtcDay));
    const rolloverWouldTrip = rolloverRequired ? false : before.stock.tripped || before.crypto.tripped;
    const after = {
        crypto: await readStateSummary(paths.cryptoState, "crypto-after"),
        stock: await readStateSummary(paths.stockState, "stock-after"),
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("READ_ONLY_PREFLIGHT_STATE_CHANGED");
    return {
        status: "DISDEX_V96_V52_READONLY_PREFLIGHT_PASS",
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
        executor: "AsterDirectTradeExecutor",
        asterAuthenticated: true,
        managedPositionCount: managedPositions.length,
        openOrderCount: openOrders.length,
        balancesRead: true,
        killSwitchActive: false,
        executionParityApproved: true,
        operatorOverrideApproved: gate.operatorOverrideApproved,
        forwardEvidenceApplicable: Boolean(forwardEvidence),
        forwardEvidenceApproved: gate.forwardEvidenceApproved,
        v96DailyLossLimitPct: DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct,
        v52DailyLossLimitPct: 3.5,
        statePaths: { combinedRoot: paths.combinedRoot, crypto: paths.cryptoState, stock: paths.stockState },
        currentUtcDay,
        savedUtcDay,
        savedUtcDays: { crypto: before.crypto.utcDay, stock: before.stock.utcDay },
        rolloverRequired,
        rolloverWouldTrip,
        resetReasonPlanned: rolloverRequired ? "UTC_DAY_ROLLOVER" : undefined,
        stateChanged: false,
        approvalChanged: false,
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runReadOnlyPreflight().then((result) => console.log(JSON.stringify(result))).catch((error) => {
        console.error(JSON.stringify({ status: "DISDEX_V96_V52_READONLY_PREFLIGHT_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: false, stateChanged: false, approvalChanged: false }));
        process.exitCode = 1;
    });
}
