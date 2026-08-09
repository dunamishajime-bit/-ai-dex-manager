import "dotenv/config";

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "../config/disdexStockRouterV13DV11EqRuntime";
import { PENGU_DUAL_LS_V1 } from "../config/penguDualLsV1Runtime";

type RunnerMode = "paper" | "live";
type V52Status = "ACTIVE" | "WAITING_MARKET_CLOSED" | "BLOCKED_DATA_UNAVAILABLE";
type ManagedChild = { name: "pengu-dual-ls-v1" | "stock-v52-aster-only"; process: ChildProcess };

const LIVE_ACKNOWLEDGEMENT = "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY" as const;
const PREFLIGHT_SCRIPT = "scripts/disdex-v52-pengu-preflight.ts" as const;
const V52_ENGINE = "scripts/disdex_v52_margin_aware_live_engine.py" as const;

function boolEnv(name: string, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

function mode(): RunnerMode {
    const raw = String(process.env.DISDEX_V52_PENGU_RUNNER_MODE || process.env.DISDEX_V13D_V11EQ_V96_RUNNER_MODE || "paper").toLowerCase();
    return raw === "live" ? "live" : "paper";
}

function paths() {
    const stateRoot = resolve(process.env.DISDEX_V52_PENGU_STATE_DIR || process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || ".runtime-state/disdex-v52-pengu");
    return {
        stateRoot,
        penguStateRoot: resolve(stateRoot, "pengu-dual-ls-v1"),
        stockStateRoot: resolve(stateRoot, "stock-v52"),
        killSwitchPath: resolve(process.env.DISDEX_V52_PENGU_KILL_SWITCH_FILE || resolve(stateRoot, "kill-switch.json")),
    };
}

export function buildV52PenguEnvironment(runnerMode: RunnerMode): NodeJS.ProcessEnv {
    const p = paths();
    return {
        ...process.env,
        DISDEX_V52_PENGU_RUNNER_MODE: runnerMode,
        DISDEX_V13D_V11EQ_V96_RUNNER_MODE: runnerMode,
        DISDEX_V52_ASTER_ONLY_RUNNER_MODE: runnerMode,
        DISDEX_V52_ASTER_ONLY_STATE_DIR: p.stockStateRoot,
        DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE: p.killSwitchPath,
        DISDEX_V52_CRYPTO_GROSS_CAP: "0",
        DISDEX_V52_STOCK_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap),
        DISDEX_V52_PORTFOLIO_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.stockSleeveGrossCap + PENGU_DUAL_LS_V1.maximumGross),
        DISDEX_V52_V11_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v11MaximumGross),
        DISDEX_V52_V50_GROSS_CAP: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.v50MaximumGross),
        DISDEX_V52_RESERVED_FIRST_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.reservedFirstStockGross),
        DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumFirstStockGross),
        DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.minimumSecondStockGross),
        DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS: String(DISDEX_V13D_V11EQ_V96_ALLOCATION.maximumConcurrentStockPositions),
        PENGU_LEGACY_CORE_ENABLED: "false",
        PENGU_DUAL_LS_V1_ENABLED: "true",
        PENGU_DUAL_LS_V1_MODE: runnerMode === "live" ? "LIVE" : "PAPER",
        PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED: runnerMode === "live" ? "true" : "false",
        PENGU_DUAL_LS_V1_MAX_GROSS: "0.75",
        PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP: "0.75",
        PENGU_DUAL_LS_V1_STATE_DIR: p.penguStateRoot,
        PENGU_DUAL_LS_V1_LOCK_PATH: resolve(p.penguStateRoot, `runner-${runnerMode}.lock`),
        PENGU_DUAL_LS_V1_KILL_SWITCH_FILE: p.killSwitchPath,
        PENGU_DUAL_LS_V1_PORTFOLIO_DAILY_LOSS_STATE_FILE: resolve(p.stateRoot, `daily-loss-${runnerMode}.json`),
        PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT: process.env.PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT || "5",
        DISDEX_V96_ENABLED: "false",
        DISDEX_V97_ENABLED: "false",
    };
}

function assertLiveActivation(runnerMode: RunnerMode) {
    if (runnerMode !== "live") return;
    if (!boolEnv("DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED", false)) {
        throw new Error("LIVE requires DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true.");
    }
    if (process.env.DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT !== LIVE_ACKNOWLEDGEMENT) {
        throw new Error(`LIVE requires acknowledgement ${LIVE_ACKNOWLEDGEMENT}.`);
    }
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

function parseV52Status(output: string): V52Status {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
        try {
            const parsed = JSON.parse(line) as { v52Preflight?: { status?: V52Status } };
            const status = parsed.v52Preflight?.status;
            if (status === "ACTIVE" || status === "WAITING_MARKET_CLOSED" || status === "BLOCKED_DATA_UNAVAILABLE") return status;
        } catch {
            // Continue to the previous line.
        }
    }
    throw new Error("V52+PENGU preflight returned no valid V52 status.");
}

function spawnChildren(runnerMode: RunnerMode, daemon: boolean, v52Status: V52Status): ManagedChild[] {
    const env = buildV52PenguEnvironment(runnerMode);
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const runFlag = daemon ? "--daemon" : "--once";
    const children: ManagedChild[] = [{
        name: "pengu-dual-ls-v1",
        process: spawn(tsx, ["scripts/disdex-pengu-dual-ls-v1-live-runner.ts", runFlag], { cwd: process.cwd(), env, stdio: "inherit" }),
    }];
    if (v52Status === "ACTIVE") {
        children.push({
            name: "stock-v52-aster-only",
            process: spawn(python, [V52_ENGINE, "--mode", runnerMode, runFlag], { cwd: process.cwd(), env, stdio: "inherit" }),
        });
    }
    return children;
}

function waitForExit(child: ManagedChild) {
    return new Promise<{ child: ManagedChild; code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        child.process.once("error", reject);
        child.process.once("exit", (code, signal) => resolveExit({ child, code, signal }));
    });
}

async function stopChildren(children: ManagedChild[]) {
    for (const child of children) {
        if (child.process.exitCode === null && !child.process.killed) child.process.kill("SIGTERM");
    }
    await Promise.allSettled(children.map((child) => waitForExit(child)));
}

async function runSupervisor(runnerMode: RunnerMode, daemon: boolean) {
    assertLiveActivation(runnerMode);
    const p = paths();
    await Promise.all([mkdir(p.penguStateRoot, { recursive: true }), mkdir(p.stockStateRoot, { recursive: true })]);
    const env = buildV52PenguEnvironment(runnerMode);
    let v52Status: V52Status = "ACTIVE";
    if (runnerMode === "live") {
        const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
        const preflight = await runCapture(tsx, [PREFLIGHT_SCRIPT], env);
        if (preflight.code !== 0) throw new Error(`V52+PENGU preflight failed; fail-closed. ${preflight.stderr.trim()}`);
        v52Status = parseV52Status(preflight.stdout);
        console.log(preflight.stdout.trim());
    }

    const children = spawnChildren(runnerMode, daemon, v52Status);
    console.log(JSON.stringify({
        event: "disdex-v52-pengu-supervisor-started",
        mode: runnerMode,
        v96Enabled: false,
        v97Enabled: false,
        penguGross: 0.75,
        v52Status,
        children: children.map((child) => child.name),
    }));

    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        await stopChildren(children);
    };
    process.once("SIGINT", () => { void stop(); });
    process.once("SIGTERM", () => { void stop(); });

    if (!daemon) {
        const results = await Promise.all(children.map((child) => waitForExit(child)));
        const failed = results.find((result) => result.code !== 0);
        if (failed) throw new Error(`${failed.child.name} exited with code ${failed.code}.`);
        return;
    }

    const first = await Promise.race(children.map((child) => waitForExit(child)));
    if (!stopping) {
        await stopChildren(children.filter((child) => child !== first.child));
        throw new Error(`${first.child.name} exited unexpectedly: code=${first.code}, signal=${first.signal || "none"}.`);
    }
}

async function main() {
    const runnerMode = mode();
    const daemon = process.argv.includes("--daemon");
    await runSupervisor(runnerMode, daemon);
}

main().catch((error) => {
    console.error(JSON.stringify({
        level: "fatal",
        supervisor: "DISDEX_V52_PENGU_ONLY",
        v96Enabled: false,
        v97Enabled: false,
        message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});
