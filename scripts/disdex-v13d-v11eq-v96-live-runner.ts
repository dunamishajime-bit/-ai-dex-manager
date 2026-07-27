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
import { markCombinedV96MigrationActivated } from "../lib/disdex-v96-combined-state-migration";

const LIVE_ACKNOWLEDGEMENT = "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY" as const;
const V96_KILL_SWITCH_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96" as const;
const STOCK_RUNNER_PATH = "scripts/disdex_v52_safe_runner.py" as const;

type RunnerMode = "paper" | "live";
type ManagedChild = { name: "crypto-v96" | "stock-v52-aster-only"; process: ChildProcess };

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
        cryptoStateRoot: resolve(stateRoot, "crypto-v96"),
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
        DISDEX_V96_RUNNER_MODE: runnerMode,
        DISDEX_V96_STATE_DIR: paths.cryptoStateRoot,
        DISDEX_V96_KILL_SWITCH_FILE: paths.killSwitchPath,
        DISDEX_V96_MAX_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap),
        DISDEX_V96_PAPER_MAX_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap + 0.05),
        DISDEX_V96_RUNNER_INTERVAL_MS: process.env.DISDEX_V96_RUNNER_INTERVAL_MS || "30000",
        DISDEX_V96_CONFIG_MIGRATION_MODE: runnerMode === "live" ? "true" : "false",
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

function spawnManagedChildren(runnerMode: RunnerMode, daemon: boolean): ManagedChild[] {
    const env = buildCombinedChildEnvironment(runnerMode);
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const runFlag = daemon ? "--daemon" : "--once";
    const crypto = spawn(tsx, ["scripts/disdex-v96-live-runner.ts", runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    const stock = spawn(python, [STOCK_RUNNER_PATH, "--mode", runnerMode, runFlag], { cwd: process.cwd(), env, stdio: "inherit" });
    return [{ name: "crypto-v96", process: crypto }, { name: "stock-v52-aster-only", process: stock }];
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
    let migrationId: string | undefined;
    if (runnerMode === "live") {
        const runtimeCommitSha = String(process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
        if (!runtimeCommitSha) throw new Error("Combined LIVE activation requires DISDEX_V96_RUNTIME_COMMIT_SHA.");
        const env = buildCombinedChildEnvironment(runnerMode);
        const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
        await runCommand(tsx, ["scripts/disdex-v13d-v11eq-v96-live-preflight.ts"], env);
        const activation = await markCombinedV96MigrationActivated({ combinedRoot: paths.stateRoot, runtimeCommitSha });
        migrationId = activation.migrationId;
    }
    await Promise.all([mkdir(paths.cryptoStateRoot, { recursive: true }), mkdir(paths.stockStateRoot, { recursive: true })]);
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
        event: "disdex-v96-v52-supervisor-start",
        strategyId: DISDEX_V13D_V11EQ_V96_STRATEGY_ID,
        runnerMode,
        daemon,
        migrationId,
        authenticatedPreflightPassed: runnerMode === "live",
        stockRunnerPath: STOCK_RUNNER_PATH,
        cryptoGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap,
        stockGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap,
        totalGrossCap: DISDEX_V13D_V11EQ_V96_ALLOCATION.portfolioGrossCap,
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
    process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = ".runtime-state/selftest-v96-v52";
    const env = buildCombinedChildEnvironment("paper");
    assert.equal(env.DISDEX_V96_MAX_GROSS, "1");
    assert.equal(env.DISDEX_V52_STOCK_GROSS_CAP, "1.5");
    assert.equal(env.DISDEX_V52_PORTFOLIO_GROSS_CAP, "2.5");
    assert.equal(env.DISDEX_V52_V11_GROSS_CAP, "1");
    assert.equal(env.DISDEX_V52_V50_GROSS_CAP, "1");
    assert.equal(env.DISDEX_V96_RUNNER_MODE, "paper");
    assert.equal(env.DISDEX_V96_CONFIG_MIGRATION_MODE, "false");
    assert.match(String(env.DISDEX_V96_KILL_SWITCH_FILE), /kill-switch\.json$/);
    assert.equal(STOCK_RUNNER_PATH, "scripts/disdex_v52_safe_runner.py");
    assert.doesNotThrow(() => assertCombinedLiveActivation("paper"));
    if (previousMode === undefined) delete process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE;
    else process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE = previousMode;
    if (previousState === undefined) delete process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR;
    else process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = previousState;
    console.log("V96 + V52 supervisor self-test: PASS");
}

async function main() {
    if (process.argv.includes("--self-test")) { selfTest(); return; }
    await runSupervisor(mode(), process.argv.includes("--daemon"));
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "disdex-v96-v52-supervisor-failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
