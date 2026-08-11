import "dotenv/config";

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
    DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
} from "../config/disdexStockRouterV13DV11EqRuntime";
import { markCombinedV96MigrationActivated } from "../lib/disdex-v96-combined-state-migration";
import { resolveDisDexV96V52SharedRuntimePaths } from "../lib/disdex-v96-v52-shared-runtime-paths";
import { isUsRegularEquitySession } from "./disdex-v13d-v11eq-v96-strategy-preflight";

const LIVE_ACKNOWLEDGEMENT = "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY" as const;
const V96_KILL_SWITCH_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96" as const;

const READ_ONLY_PREFLIGHT_SCRIPT = "scripts/disdex-v96-v52-readonly-preflight.ts" as const;
const VERIFIED_PREFLIGHT_SCRIPT = "scripts/disdex-v13d-v11eq-v96-strategy-preflight.ts" as const;
const MARGIN_AWARE_V52_ENGINE = "scripts/disdex_v52_margin_aware_live_engine.py" as const;
const V52_MARKET_RECHECK_INTERVAL_MS = 30_000;
const V52_DATA_RECHECK_INTERVAL_MS = 60_000;

type RunnerMode = "paper" | "live";
type ManagedChild = { name: "crypto-v96" | "pengu-dual-ls-v2-final" | "stock-v52-aster-only"; process: ChildProcess };
type V52PreflightStatus = "ACTIVE" | "WAITING_MARKET_CLOSED" | "BLOCKED_DATA_UNAVAILABLE";

function boolEnv(name: string, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

function mode(): RunnerMode {
    return String(process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

function combinedPaths() {
    const shared = resolveDisDexV96V52SharedRuntimePaths();
    return {
        stateRoot: shared.combinedRoot,
        cryptoStateRoot: shared.cryptoStateRoot,
        penguStateRoot: shared.penguStateRoot,
        stockStateRoot: shared.stockStateRoot,
        killSwitchPath: shared.killSwitchPath,
    };
}

export function buildCombinedChildEnvironment(runnerMode: RunnerMode) {
    const paths = combinedPaths();
    return {
        ...process.env,
        DISDEX_V13D_V11EQ_V96_RUNNER_MODE: runnerMode,
        DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: paths.stateRoot,
        DISDEX_V13D_V11EQ_V96_STATE_DIR: paths.stateRoot,
        DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE: paths.killSwitchPath,
        DISDEX_V52_ASTER_ONLY_RUNNER_MODE: runnerMode,
        DISDEX_V52_ASTER_ONLY_STATE_DIR: paths.stockStateRoot,
        DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: paths.killSwitchPath,
        DISDEX_V52_CRYPTO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        DISDEX_V52_STOCK_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap),
        DISDEX_V52_PORTFOLIO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap),
        DISDEX_V52_V11_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v11MaximumGross),
        DISDEX_V52_V50_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v50MaximumGross),
        DISDEX_V52_RESERVED_FIRST_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.reservedFirstStockGross),
        DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumFirstStockGross),
        DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumSecondStockGross),
        DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumConcurrentStockPositions),
        DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoInitialLeverage),
        DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumInitialMarginFraction),
        DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumAvailableBalanceFractionAfterOrder),
        DISDEX_V96_RUNNER_MODE: runnerMode,
        DISDEX_V96_STATE_DIR: paths.cryptoStateRoot,
        DISDEX_V96_KILL_SWITCH_FILE: paths.killSwitchPath,
        DISDEX_V96_MAX_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        DISDEX_V96_PAPER_MAX_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap + 0.05),
        DISDEX_V96_RUNNER_INTERVAL_MS: process.env.DISDEX_V96_RUNNER_INTERVAL_MS || "30000",
        DISDEX_V96_CONFIG_MIGRATION_MODE: runnerMode === "live" ? "true" : "false",
        PENGU_LEGACY_CORE_ENABLED: "false",
        PENGU_DUAL_LS_V1_ENABLED: "false",
        PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED: "false",
        PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED: "false",
        PENGU_DUAL_LS_V2_ENABLED: "true",
        PENGU_DUAL_LS_V2_MODE: runnerMode === "live" ? "LIVE" : "PAPER",
        PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V2_STATE_DIR: paths.penguStateRoot,
        // PENGU is an independent runner. Its lock must not collide with the
        // V96 portfolio runner lock in cryptoStateRoot.
        PENGU_DUAL_LS_V2_LOCK_PATH: resolve(paths.penguStateRoot, `runner-${runnerMode}.lock`),
        PENGU_DUAL_LS_V2_KILL_SWITCH_FILE: paths.killSwitchPath,
        PENGU_DUAL_LS_V2_PORTFOLIO_DAILY_LOSS_STATE_FILE: resolve(paths.cryptoStateRoot, `runner-${runnerMode}.json`),
        PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT: "5",
    } as NodeJS.ProcessEnv;
}

export function assertCombinedLiveActivation(runnerMode: RunnerMode) {
    if (runnerMode !== "live") return;
    if (!DISDEX_V13D_V11EQ_V96_RUNTIME.liveTradingEnabled || !DISDEX_V13D_V11EQ_V96_RUNTIME.orderSubmissionAllowed) {
        throw new Error("Repository combined runtime is not LIVE-enabled.");
    }
    if (!boolEnv("DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED", false)) {
        throw new Error("LIVE requires DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true.");
    }
    if (process.env.DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT !== LIVE_ACKNOWLEDGEMENT) {
        throw new Error(`LIVE requires acknowledgement ${LIVE_ACKNOWLEDGEMENT}.`);
    }
}

export function livePreflightScripts() {
    return [READ_ONLY_PREFLIGHT_SCRIPT, VERIFIED_PREFLIGHT_SCRIPT] as const;
}

export function shouldHoldFailClosed(runnerMode: RunnerMode, daemon: boolean) {
    return runnerMode === "live" && daemon;
}

function shouldStartV52Worker(status: V52PreflightStatus) {
    return status === "ACTIVE";
}

export type V52WorkerAction = "START" | "STOP" | "HOLD";

export function v52WorkerAction(status: V52PreflightStatus, hasWorker: boolean): V52WorkerAction {
    if (status === "ACTIVE" && !hasWorker) return "START";
    if (status !== "ACTIVE" && hasWorker) return "STOP";
    return "HOLD";
}

async function holdFailClosed(reason: string) {
    console.error(JSON.stringify({
        level: "error",
        event: "disdex-v96-v52-supervisor-fail-closed-hold",
        reason,
        childrenStarted: false,
        ordersSent: false,
        stateChangedBySupervisor: false,
        restartRequiredAfterApproval: true,
    }));
    await new Promise<void>((resolveStop) => {
        let stopped = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            resolveStop();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
}

async function activateSharedKillSwitch(path: string, reason: string) {
    const command = {
        active: true,
        strategyId: V96_KILL_SWITCH_STRATEGY_ID,
        action: "FLATTEN_MANAGED",
        reason,
        operator: "disdex-v96-v52-supervisor",
        activatedAt: new Date().toISOString(),
        combinedStrategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(command, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function spawnV52Worker(runnerMode: RunnerMode, daemon: boolean): ManagedChild {
    const env = buildCombinedChildEnvironment(runnerMode);
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const runFlag = daemon ? "--daemon" : "--once";
    const stock = spawn(python, [MARGIN_AWARE_V52_ENGINE, "--mode", runnerMode, runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    return { name: "stock-v52-aster-only", process: stock };
}

function spawnManagedChildren(runnerMode: RunnerMode, daemon: boolean, v52PreflightStatus: V52PreflightStatus = "ACTIVE"): ManagedChild[] {
    const env = buildCombinedChildEnvironment(runnerMode);
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const runFlag = daemon ? "--daemon" : "--once";
    const crypto = spawn(tsx, ["scripts/disdex-v96-live-runner.ts", runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    const pengu = spawn(tsx, ["scripts/disdex-pengu-dual-ls-v2-live-runner.ts", runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    const children: ManagedChild[] = [{ name: "crypto-v96", process: crypto }, { name: "pengu-dual-ls-v2-final", process: pengu }];
    if (shouldStartV52Worker(v52PreflightStatus)) children.push(spawnV52Worker(runnerMode, daemon));
    return children;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<void>((resolveRun, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (code === 0) resolveRun();
            else reject(new Error(`${command} ${args.join(" ")} failed: code=${code}, signal=${signal || "none"}`));
        });
    });
}

function runCapture(command: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
    });
}

function parsePreflightSummary(output: string): { v52Preflight?: { status?: V52PreflightStatus } } {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
        try {
            const parsed = JSON.parse(line) as { v52Preflight?: { status?: V52PreflightStatus } };
            if (parsed && typeof parsed === "object") return parsed;
        } catch {
            // Ignore non-JSON diagnostics. The final structured result is authoritative.
        }
    }
    throw new Error("Strategy-specific preflight returned no structured result.");
}

function validateV52PreflightStatus(value: unknown): V52PreflightStatus {
    if (value === "ACTIVE" || value === "WAITING_MARKET_CLOSED" || value === "BLOCKED_DATA_UNAVAILABLE") return value;
    throw new Error("Strategy-specific preflight did not return a valid V52 status.");
}

async function runVerifiedStrategyPreflight(tsx: string, env: NodeJS.ProcessEnv) {
    const result = await runCapture(tsx, [VERIFIED_PREFLIGHT_SCRIPT], env);
    if (result.code !== 0) throw new Error(`Strategy-specific live preflight failed; fail-closed. ${result.stderr.trim()}`);
    const summary = parsePreflightSummary(result.stdout);
    const status = validateV52PreflightStatus(summary.v52Preflight?.status);
    return { status, output: result.stdout.trim() };
}

function waitForExit(child: ManagedChild) {
    return new Promise<{ child: ManagedChild; code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        child.process.once("error", reject);
        child.process.once("exit", (code, signal) => resolveExit({ child, code, signal }));
    });
}

async function waitForChildShutdown(child: ManagedChild) {
    if (child.process.exitCode !== null) return;
    await waitForExit(child);
}

async function stopChildren(children: ManagedChild[], signal: NodeJS.Signals = "SIGTERM") {
    for (const child of children) {
        if (child.process.exitCode === null && !child.process.killed) child.process.kill(signal);
    }
    await Promise.allSettled(children.map((child) => waitForChildShutdown(child)));
}

async function v52HasOpenPosition(stateRoot: string): Promise<boolean> {
    try {
        const raw = await readFile(resolve(stateRoot, "runner-live.json"), "utf8");
        const state = JSON.parse(raw) as { positions?: unknown; pendingOrder?: unknown };
        const positions = state.positions && typeof state.positions === "object" ? Object.keys(state.positions).length : 0;
        return positions > 0 || Boolean(state.pendingOrder);
    } catch {
        // An unreadable state must keep the worker alive rather than abandon an
        // unknown position during a market transition.
        return true;
    }
}

async function runSupervisor(runnerMode: RunnerMode, daemon: boolean) {
    assertCombinedLiveActivation(runnerMode);
    const paths = combinedPaths();
    const env = buildCombinedChildEnvironment(runnerMode);
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    let migrationId: string | undefined;
    let v52PreflightStatus: V52PreflightStatus = "ACTIVE";
    if (runnerMode === "live") {
        const runtimeCommitSha = String(process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
        if (!runtimeCommitSha) throw new Error("Combined LIVE activation requires DISDEX_V96_RUNTIME_COMMIT_SHA.");
        try {
            for (const script of livePreflightScripts()) {
                if (script === VERIFIED_PREFLIGHT_SCRIPT) {
                    const result = await runVerifiedStrategyPreflight(tsx, env);
                    v52PreflightStatus = result.status;
                    console.log(result.output);
                } else {
                    await runCommand(tsx, [script], env);
                }
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!shouldHoldFailClosed(runnerMode, daemon)) throw error;
            await holdFailClosed(reason);
            return;
        }
        const activation = await markCombinedV96MigrationActivated({ combinedRoot: paths.stateRoot, runtimeCommitSha });
        migrationId = activation.migrationId;
    }
    await Promise.all([mkdir(paths.cryptoStateRoot, { recursive: true }), mkdir(paths.penguStateRoot, { recursive: true }), mkdir(paths.stockStateRoot, { recursive: true })]);
    let children = spawnManagedChildren(runnerMode, daemon, v52PreflightStatus);
    let stockChild = children.find((child) => child.name === "stock-v52-aster-only");
    let intentionalStop = false;
    const expectedStops = new Set<ManagedChild>();
    let resolveMonitorStop!: () => void;
    const monitorStop = new Promise<void>((resolveStop) => { resolveMonitorStop = resolveStop; });
    let resolveUnexpectedChild!: (value: { kind: "child-exit"; child: ManagedChild; code: number | null; signal: NodeJS.Signals | null }) => void;
    const unexpectedChild = new Promise<{ kind: "child-exit"; child: ManagedChild; code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
        resolveUnexpectedChild = resolveExit;
    });
    for (const child of children) {
        child.process.once("exit", (code, signal) => {
            if (!intentionalStop && !expectedStops.has(child)) {
                resolveUnexpectedChild({ kind: "child-exit", child, code, signal });
            }
        });
    }
    const stopV52Worker = async () => {
        const child = stockChild;
        if (!child) return;
        expectedStops.add(child);
        stockChild = undefined;
        children = children.filter((candidate) => candidate !== child);
        if (child.process.exitCode === null && !child.process.killed) child.process.kill("SIGTERM");
        await waitForChildShutdown(child);
        console.log(JSON.stringify({
            event: "v52-worker-transition",
            action: "STOP",
            reason: "US_EQUITY_MARKET_CLOSED",
            workerStarted: false,
            ordersSent: false,
        }));
    };
    const startV52Worker = () => {
        if (stockChild) return;
        const child = spawnV52Worker(runnerMode, daemon);
        children.push(child);
        stockChild = child;
        child.process.once("exit", (code, signal) => {
            if (!intentionalStop && !expectedStops.has(child)) {
                resolveUnexpectedChild({ kind: "child-exit", child, code, signal });
            }
        });
        console.log(JSON.stringify({
            event: "v52-worker-transition",
            action: "START",
            reason: "V52_PREFLIGHT_ACTIVE",
            workerStarted: true,
            ordersSent: false,
        }));
    };
    const stop = async () => {
        if (intentionalStop) return;
        intentionalStop = true;
        resolveMonitorStop();
        await stopChildren(children);
    };
    process.once("SIGINT", () => { void stop(); });
    process.once("SIGTERM", () => { void stop(); });
    console.log(JSON.stringify({
        event: "disdex-v96-v52-supervisor-start",
        strategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
        runnerMode,
        daemon,
        migrationId,
        authenticatedPreflightPassed: runnerMode === "live",
        cryptoGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap,
        stockGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
        totalGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap,
        reservedFirstStockGross: DISDEX_V13D_V11EQ_V96_ALLOCATION.reservedFirstStockGross,
        minimumSecondStockGross: DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumSecondStockGross,
        requiredInitialLeverage: DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoInitialLeverage,
        maximumInitialMarginFraction: DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumInitialMarginFraction,
        minimumAvailableBalanceFractionAfterOrder: DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumAvailableBalanceFractionAfterOrder,
        v52Engine: MARGIN_AWARE_V52_ENGINE,
        v52PreflightStatus,
        v52WorkerStarted: shouldStartV52Worker(v52PreflightStatus),
        killSwitchPath: paths.killSwitchPath,
    }));
    if (!daemon) {
        const exits = await Promise.all(children.map(waitForExit));
        const failed = exits.find((row) => row.code !== 0);
        if (failed) throw new Error(`${failed.child.name} exited with code ${failed.code} signal ${failed.signal || "none"}.`);
        return;
    }

    const monitor = (async () => {
        const waitForMonitor = async (milliseconds: number) => {
            await Promise.race([
                new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)),
                monitorStop,
            ]);
        };
        while (!intentionalStop) {
            const marketOpen = isUsRegularEquitySession();
            if (!marketOpen) {
                if (stockChild && !(await v52HasOpenPosition(paths.stockStateRoot))) await stopV52Worker();
                await waitForMonitor(V52_MARKET_RECHECK_INTERVAL_MS);
                continue;
            }
            const previousStatus = v52PreflightStatus;
            const hadWorker = Boolean(stockChild);
            const checked = await runVerifiedStrategyPreflight(tsx, env);
            v52PreflightStatus = checked.status;
            const action = v52WorkerAction(checked.status, hadWorker);
            console.log(JSON.stringify({
                event: "v52-preflight-recheck",
                previousStatus,
                status: checked.status,
                ordersAllowed: shouldStartV52Worker(checked.status),
                workerStarted: hadWorker,
                action,
                output: checked.output,
            }));
            if (action === "START") startV52Worker();
            if (action === "STOP") await stopV52Worker();
            await waitForMonitor(V52_DATA_RECHECK_INTERVAL_MS);
        }
        return { kind: "monitor-stopped" as const };
    })().catch((error) => ({
        kind: "monitor-error" as const,
        error: error instanceof Error ? error : new Error(String(error)),
    }));

    const first = await Promise.race([unexpectedChild, monitor]);
    if (!intentionalStop) {
        const reason = first.kind === "child-exit"
            ? `${first.child.name} exited unexpectedly (code=${first.code}, signal=${first.signal || "none"}).`
            : first.kind === "monitor-error"
                ? `V52 lifecycle monitor failed; fail-closed. ${first.error.message}`
                : "Combined supervisor monitor stopped unexpectedly.";
        intentionalStop = true;
        resolveMonitorStop();
        if (runnerMode === "live") {
            await activateSharedKillSwitch(paths.killSwitchPath, reason);
            await new Promise<void>((resolveWait) => setTimeout(resolveWait, 35_000));
        }
        await stopChildren(first.kind === "child-exit" ? children.filter((child) => child !== first.child) : children);
        throw new Error(reason);
    }
}

function selfTest() {
    const selfTestState = resolve(".runtime-state/selftest-v96-v52");
    const selfTestKillSwitch = resolve(selfTestState, "kill-switch.json");
    const selfTestEnvironment: Record<string, string> = {
        DISDEX_V13D_V11EQ_V96_RUNNER_MODE: "paper",
        DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT: selfTestState,
        DISDEX_V13D_V11EQ_V96_STATE_DIR: selfTestState,
        DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE: selfTestKillSwitch,
        DISDEX_V52_ASTER_ONLY_STATE_DIR: resolve(selfTestState, "stock"),
        DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: selfTestKillSwitch,
        DISDEX_V96_STATE_DIR: resolve(selfTestState, "crypto-v96"),
        DISDEX_V96_KILL_SWITCH_FILE: selfTestKillSwitch,
        PENGU_DUAL_LS_V2_STATE_DIR: resolve(selfTestState, "crypto-v96", "pengu-dual-ls-v2-final"),
        PENGU_DUAL_LS_V2_KILL_SWITCH_FILE: selfTestKillSwitch,
    };
    const previousEnvironment = Object.fromEntries(
        Object.keys(selfTestEnvironment).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, selfTestEnvironment);
    const env = buildCombinedChildEnvironment("paper");
    assert.equal(env.DISDEX_V96_MAX_GROSS, "1.5");
    assert.equal(env.DISDEX_V52_CRYPTO_GROSS_CAP, "1.5");
    assert.equal(env.DISDEX_V52_STOCK_GROSS_CAP, "1.5");
    assert.equal(env.DISDEX_V52_PORTFOLIO_GROSS_CAP, "2.5");
    assert.equal(env.DISDEX_V52_V11_GROSS_CAP, "1");
    assert.equal(env.DISDEX_V52_V50_GROSS_CAP, "1");
    assert.equal(env.DISDEX_V52_RESERVED_FIRST_STOCK_GROSS, "1");
    assert.equal(env.DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS, "0.25");
    assert.equal(env.DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS, "2");
    assert.equal(env.DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE, "5");
    assert.equal(env.DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION, "0.7");
    assert.equal(env.DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION, "0.2");
    assert.equal(env.DISDEX_V96_RUNNER_MODE, "paper");
    assert.equal(env.DISDEX_V96_CONFIG_MIGRATION_MODE, "false");
    assert.equal(env.PENGU_LEGACY_CORE_ENABLED, "false");
    assert.equal(env.PENGU_DUAL_LS_V1_ENABLED, "false");
    assert.equal(env.PENGU_DUAL_LS_V2_ENABLED, "true");
    assert.equal(env.PENGU_DUAL_LS_V2_MODE, "PAPER");
    assert.equal(env.PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP, "1.5");
    assert.equal(
        env.PENGU_DUAL_LS_V2_LOCK_PATH,
        resolve(".runtime-state/selftest-v96-v52", "crypto-v96", "pengu-dual-ls-v2-final", "runner-paper.lock"),
    );
    assert.notEqual(env.PENGU_DUAL_LS_V2_LOCK_PATH, resolve(".runtime-state/selftest-v96-v52", "crypto-v96", "runner-paper.lock"));
    assert.match(String(env.DISDEX_V96_KILL_SWITCH_FILE), /kill-switch\.json$/);
    assert.deepEqual(livePreflightScripts(), [READ_ONLY_PREFLIGHT_SCRIPT, VERIFIED_PREFLIGHT_SCRIPT]);
    assert.equal(shouldStartV52Worker("ACTIVE"), true);
    assert.equal(shouldStartV52Worker("WAITING_MARKET_CLOSED"), false);
    assert.equal(shouldStartV52Worker("BLOCKED_DATA_UNAVAILABLE"), false);
    assert.equal(v52WorkerAction("ACTIVE", false), "START");
    assert.equal(v52WorkerAction("ACTIVE", true), "HOLD");
    assert.equal(v52WorkerAction("WAITING_MARKET_CLOSED", false), "HOLD");
    assert.equal(v52WorkerAction("WAITING_MARKET_CLOSED", true), "STOP");
    assert.equal(v52WorkerAction("BLOCKED_DATA_UNAVAILABLE", false), "HOLD");
    assert.equal(v52WorkerAction("BLOCKED_DATA_UNAVAILABLE", true), "STOP");
    assert.equal(shouldHoldFailClosed("live", true), true);
    assert.equal(shouldHoldFailClosed("live", false), false);
    assert.equal(shouldHoldFailClosed("paper", true), false);
    assert.doesNotThrow(() => assertCombinedLiveActivation("paper"));
    assert.equal(MARGIN_AWARE_V52_ENGINE, DISDEX_V13D_V11EQ_V96_RUNTIME.pythonStockEngine);
    for (const [name, previous] of Object.entries(previousEnvironment)) {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    }
    console.log("V96 + V52 margin-aware supervisor self-test: PASS");
}

async function main() {
    if (process.argv.includes("--self-test")) { selfTest(); return; }
    await runSupervisor(mode(), process.argv.includes("--daemon"));
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "disdex-v96-v52-supervisor-failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
