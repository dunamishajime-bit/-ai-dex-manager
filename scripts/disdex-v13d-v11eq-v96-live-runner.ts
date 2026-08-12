import "dotenv/config";

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
    DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
} from "../config/disdexStockRouterV13DV11EqRuntime";
import { sendEmail } from "../lib/mail-service";

const LIVE_ACKNOWLEDGEMENT = "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY" as const;
const SHARED_KILL_SWITCH_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96" as const;
const PENGU_SELFTEST_SCRIPT = "scripts/pengu-dual-ls-v1-selftest.ts" as const;
const PENGU_PREFLIGHT_SCRIPT = "scripts/pengu-dual-ls-v1-live-preflight.ts" as const;
const DEFAULT_ORDER_FILL_EMAIL = "dunamis.hajime@gmail.com";

type RunnerMode = "paper" | "live";
type ManagedChildName = "pengu-dual-ls-v1" | "stock-v52-aster-only";
type ManagedChild = { name: ManagedChildName; process: ChildProcess };

function boolEnv(name: string, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

function mode(): RunnerMode {
    return String(process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

function combinedPaths() {
    const stateRoot = resolve(process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || DISDEX_V13D_V11EQ_V96_RUNTIME.stateDirectory);
    return {
        stateRoot,
        legacyCryptoStateRoot: resolve(stateRoot, "crypto-v96"),
        penguStateRoot: resolve(stateRoot, "pengu-dual-ls-v1"),
        stockStateRoot: resolve(stateRoot, "stock"),
        killSwitchPath: resolve(process.env.DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE || resolve(stateRoot, "kill-switch.json")),
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
        // Defense in depth: this supervisor must never authorize the legacy V96 crypto order path.
        DISDEX_ENABLE_LEGACY_V96_LIVE: "false",
        PENGU_LEGACY_CORE_ENABLED: "false",
        PENGU_DUAL_LS_V1_ENABLED: "true",
        PENGU_DUAL_LS_V1_MODE: runnerMode === "live" ? "LIVE" : "PAPER",
        PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V1_STATE_DIR: paths.penguStateRoot,
        PENGU_DUAL_LS_V1_LOCK_PATH: resolve(paths.penguStateRoot, `runner-${runnerMode}.lock`),
        PENGU_DUAL_LS_V1_KILL_SWITCH_FILE: paths.killSwitchPath,
        // Legacy portfolio state is read-only risk evidence only; it is never a PENGU order-state store.
        PENGU_DUAL_LS_V1_PORTFOLIO_DAILY_LOSS_STATE_FILE: resolve(paths.legacyCryptoStateRoot, `runner-${runnerMode}.json`),
        PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap),
        PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT: "5",
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
    return [PENGU_SELFTEST_SCRIPT, PENGU_PREFLIGHT_SCRIPT] as const;
}

export function managedChildScripts() {
    return [
        { name: "pengu-dual-ls-v1" as const, command: "tsx", script: "scripts/disdex-pengu-dual-ls-v1-live-runner.ts" },
        { name: "stock-v52-aster-only" as const, command: "python", script: "scripts/disdex_v52_aster_only_live_engine.py" },
    ] as const;
}

export function shouldHoldFailClosed(runnerMode: RunnerMode, daemon: boolean) {
    return runnerMode === "live" && daemon;
}

async function holdFailClosed(reason: string) {
    console.error(JSON.stringify({
        level: "error",
        event: "disdex-pengu-v52-supervisor-fail-closed-hold",
        reason,
        childrenStarted: false,
        ordersSent: false,
        stateChangedBySupervisor: false,
        legacyV96Started: false,
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
        strategyId: SHARED_KILL_SWITCH_STRATEGY_ID,
        action: "FLATTEN_MANAGED",
        reason,
        operator: "disdex-pengu-v52-supervisor",
        activatedAt: new Date().toISOString(),
        combinedStrategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(command, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function maybeNotifyV52Fill(line: string, runnerMode: RunnerMode) {
    if (runnerMode !== "live") return;
    const isOpen = line.includes("v52-position-open");
    const isClose = line.includes("v52-position-closed");
    if (!isOpen && !isClose) return;
    const to = (process.env.DISDEX_ORDER_FILL_EMAIL || process.env.PENGU_ORDER_FILL_EMAIL || DEFAULT_ORDER_FILL_EMAIL).trim();
    if (!to) return;
    const timestamp = new Date().toISOString();
    const action = isOpen ? "OPEN" : "CLOSE";
    const subject = `[DisDex][FILLED] V52 ${action} 注文約定`;
    const text = [
        "DisDex V52で注文が約定しました。",
        "",
        "Status: FILLED",
        `Strategy: V52`,
        `Action: ${action}`,
        `Mode: LIVE`,
        `Timestamp: ${timestamp}`,
        `RunnerLog: ${line}`,
    ].join("\n");
    void sendEmail(to, subject, text).then((mailResult) => {
        if (mailResult.success && !mailResult.simulated) {
            console.log(JSON.stringify({ level: "info", event: "V52_ORDER_FILL_EMAIL_SENT", to, action }));
        } else {
            console.error(JSON.stringify({ level: "error", event: "V52_ORDER_FILL_EMAIL_FAILED", to, action, simulated: mailResult.simulated, error: mailResult.error instanceof Error ? mailResult.error.message : String(mailResult.error || "mail provider not configured") }));
        }
    }).catch((error) => {
        // Notification failure must never stop or restart a LIVE trading child.
        console.error(JSON.stringify({ level: "error", event: "V52_ORDER_FILL_EMAIL_FAILED", to, action, error: error instanceof Error ? error.message : String(error) }));
    });
}

function attachV52Output(child: ChildProcess, runnerMode: RunnerMode) {
    const stdout = child.stdout;
    if (!stdout) return;
    let buffer = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
        process.stdout.write(chunk);
        buffer += chunk;
        while (true) {
            const newline = buffer.indexOf("\n");
            if (newline < 0) break;
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) maybeNotifyV52Fill(line, runnerMode);
        }
    });
    stdout.on("end", () => {
        const line = buffer.trim();
        if (line) maybeNotifyV52Fill(line, runnerMode);
        buffer = "";
    });
}

function spawnManagedChildren(runnerMode: RunnerMode, daemon: boolean): ManagedChild[] {
    const env = buildCombinedChildEnvironment(runnerMode);
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const runFlag = daemon ? "--daemon" : "--once";
    const pengu = spawn(tsx, ["scripts/disdex-pengu-dual-ls-v1-live-runner.ts", runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    const stock = spawn(python, ["scripts/disdex_v52_aster_only_live_engine.py", "--mode", runnerMode, runFlag], { cwd: process.cwd(), env, stdio: ["inherit", "pipe", "inherit"] });
    attachV52Output(stock, runnerMode);
    return [{ name: "pengu-dual-ls-v1", process: pengu }, { name: "stock-v52-aster-only", process: stock }];
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

function waitForExit(child: ManagedChild) {
    return new Promise<{ child: ManagedChild; code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        child.process.once("error", reject);
        child.process.once("exit", (code, signal) => resolveExit({ child, code, signal }));
    });
}

async function stopChildren(children: ManagedChild[], signal: NodeJS.Signals = "SIGTERM") {
    for (const child of children) {
        if (child.process.exitCode === null && !child.process.killed) child.process.kill(signal);
    }
    await Promise.allSettled(children.map((child) => waitForExit(child)));
}

async function runSupervisor(runnerMode: RunnerMode, daemon: boolean) {
    assertCombinedLiveActivation(runnerMode);
    const paths = combinedPaths();
    if (runnerMode === "live") {
        const runtimeCommitSha = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
        if (!runtimeCommitSha) throw new Error("Combined LIVE activation requires DISDEX_RUNTIME_COMMIT_SHA or DISDEX_V96_RUNTIME_COMMIT_SHA.");
        const env = buildCombinedChildEnvironment(runnerMode);
        const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
        try {
            for (const script of livePreflightScripts()) await runCommand(tsx, [script], env);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!shouldHoldFailClosed(runnerMode, daemon)) throw error;
            await holdFailClosed(reason);
            return;
        }
    }
    await Promise.all([
        mkdir(paths.legacyCryptoStateRoot, { recursive: true }),
        mkdir(paths.penguStateRoot, { recursive: true }),
        mkdir(paths.stockStateRoot, { recursive: true }),
    ]);
    const children = spawnManagedChildren(runnerMode, daemon);
    let intentionalStop = false;
    const stop = async () => {
        if (intentionalStop) return;
        intentionalStop = true;
        await stopChildren(children);
    };
    process.once("SIGINT", () => { void stop(); });
    process.once("SIGTERM", () => { void stop(); });
    console.log(JSON.stringify({
        event: "disdex-pengu-v52-supervisor-start",
        strategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
        runnerMode,
        daemon,
        authenticatedPreflightPassed: runnerMode === "live",
        legacyV96Started: false,
        cryptoRunner: "PENGU_DUAL_LS_V1_ONLY",
        cryptoGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap,
        stockGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
        totalGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap,
        penguStateRoot: paths.penguStateRoot,
        legacyCryptoStateRoot: paths.legacyCryptoStateRoot,
        killSwitchPath: paths.killSwitchPath,
    }));
    if (!daemon) {
        const exits = await Promise.all(children.map(waitForExit));
        const failed = exits.find((row) => row.code !== 0);
        if (failed) throw new Error(`${failed.child.name} exited with code ${failed.code} signal ${failed.signal || "none"}.`);
        return;
    }
    const first = await Promise.race(children.map(waitForExit));
    if (!intentionalStop) {
        const reason = `${first.child.name} exited unexpectedly (code=${first.code}, signal=${first.signal || "none"}).`;
        if (runnerMode === "live") {
            await activateSharedKillSwitch(paths.killSwitchPath, reason);
            await new Promise<void>((resolveWait) => setTimeout(resolveWait, 35_000));
        }
        intentionalStop = true;
        await stopChildren(children.filter((child) => child !== first.child));
        throw new Error(reason);
    }
}

function selfTest() {
    const previousMode = process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE;
    const previousState = process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR;
    process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE = "paper";
    process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = ".runtime-state/selftest-pengu-v52";
    const env = buildCombinedChildEnvironment("paper");
    assert.equal(env.DISDEX_ENABLE_LEGACY_V96_LIVE, "false");
    assert.equal(env.PENGU_LEGACY_CORE_ENABLED, "false");
    assert.equal(env.PENGU_DUAL_LS_V1_ENABLED, "true");
    assert.equal(env.PENGU_DUAL_LS_V1_MODE, "PAPER");
    assert.equal(env.PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP, "2.5");
    assert.equal(env.DISDEX_V52_CRYPTO_GROSS_CAP, "2.5");
    assert.equal(env.DISDEX_V52_STOCK_GROSS_CAP, "1.5");
    assert.equal(env.DISDEX_V52_PORTFOLIO_GROSS_CAP, "2.5");
    assert.deepEqual(livePreflightScripts(), [PENGU_SELFTEST_SCRIPT, PENGU_PREFLIGHT_SCRIPT]);
    const children = managedChildScripts();
    assert.deepEqual(children.map((child) => child.name), ["pengu-dual-ls-v1", "stock-v52-aster-only"]);
    assert.equal(children.some((child) => child.script.includes("v96-live-runner")), false);
    assert.equal(shouldHoldFailClosed("live", true), true);
    assert.equal(shouldHoldFailClosed("live", false), false);
    assert.equal(shouldHoldFailClosed("paper", true), false);
    assert.doesNotThrow(() => assertCombinedLiveActivation("paper"));
    if (previousMode === undefined) delete process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE;
    else process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE = previousMode;
    if (previousState === undefined) delete process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR;
    else process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = previousState;
    console.log("PENGU + V52 supervisor self-test: PASS");
}

async function main() {
    if (process.argv.includes("--self-test")) { selfTest(); return; }
    await runSupervisor(mode(), process.argv.includes("--daemon"));
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "disdex-pengu-v52-supervisor-failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});