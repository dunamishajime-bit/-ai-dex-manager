import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

/**
 * Event-driven, fail-closed recovery coordinator for the V12 composition.
 *
 * The coordinator intentionally does not guess how to repair an unknown
 * failure.  Only existing, audited recovery programs may clear a Kill
 * Switch; all other reasons remain halted for operator review.
 */
const SUPERVISOR_EXIT_REASON = "V96/V52 trading supervisor exited unexpectedly with status 1";
const MARGIN_FLATTEN_REASON_PREFIX = "V52 margin-aware fatal tick error:";
const OPERATOR = "V12_KILL_SWITCH_AUTO_REPAIR_V1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CODEX_REPAIR_THREAD_ID = "01a0261e-6073-7381-bfb5-3807db374e2a";
const DEFAULT_CODEX_REPAIR_REQUEST_PATH = "/var/lib/disdex/v12-x1-all/codex-repair-request.json";
const HISTORICAL_LOCAL_REASON_PREFIXES = [
    "V12 universe alignment mismatch:",
    "Fresh V96/V52 pre-order Margin Guard blocked exposure increase:",
] as const;
const HISTORICAL_LOCAL_EXACT_REASONS = new Set([
    "V12 hourly history insufficient for BTC: 0",
    "TRAILING_STOP_UPDATE_FAILED:Order would immediately trigger.",
]);
const HISTORICAL_MINIMUM_ENTRY_QUANTITY_REASON = /^Quantity 0 is below Aster minQty [0-9]+(?:\.[0-9]+)? for [A-Z0-9]+USDT\.$/;

type RepairAction = "STALE_SHARED_KILL" | "MARGIN_FLATTEN" | "LOCAL_STATE" | "NONE" | "BLOCKED";
type AutoRepairMode = "CODEX_THREAD_HANDOFF" | "DETERMINISTIC";

function boolEnv(name: string) {
    return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function autoRepairMode(value = process.env.V12_AUTO_REPAIR_MODE): AutoRepairMode {
    return String(value || "").trim().toUpperCase() === "DETERMINISTIC" ? "DETERMINISTIC" : "CODEX_THREAD_HANDOFF";
}

function resolveCodexRepairThreadId(value = process.env.V12_CODEX_REPAIR_THREAD_ID) {
    const threadId = String(value || DEFAULT_CODEX_REPAIR_THREAD_ID).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
        throw new Error("V12_CODEX_REPAIR_THREAD_ID_INVALID");
    }
    return threadId;
}

function codexRepairRequestPath(value = process.env.V12_CODEX_REPAIR_REQUEST_PATH) {
    return resolve(String(value || DEFAULT_CODEX_REPAIR_REQUEST_PATH).trim());
}

function isHistoricalLocalRepairReason(reason: string | undefined) {
    const value = String(reason || "").trim();
    return HISTORICAL_LOCAL_EXACT_REASONS.has(value)
        || HISTORICAL_LOCAL_REASON_PREFIXES.some((prefix) => value.startsWith(prefix))
        || HISTORICAL_MINIMUM_ENTRY_QUANTITY_REASON.test(value);
}

function lastOutput(output: string) {
    return output.trim().split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(-2_000);
}

function requestToken() {
    return `auto-${new Date().toISOString().replace(/[^0-9A-Za-z]/g, "")}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

function classifyRepair(killActive: boolean, reason: string | undefined, localStateActive: boolean, localManualReview: boolean, localReason?: string): RepairAction {
    if (killActive && reason === SUPERVISOR_EXIT_REASON) return "STALE_SHARED_KILL";
    if (killActive && reason?.startsWith(MARGIN_FLATTEN_REASON_PREFIX)) return "MARGIN_FLATTEN";
    if (!killActive && (localStateActive || localManualReview) && isHistoricalLocalRepairReason(localReason || reason)) return "LOCAL_STATE";
    if (killActive) return "BLOCKED";
    return "NONE";
}

function runNodeScript(script: string, args: string[] = [], timeout = DEFAULT_TIMEOUT_MS) {
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const result = spawnSync(tsx, [script, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: process.env.HOME || "/home/deploy", NODE_ENV: "production" },
        encoding: "utf8",
        timeout,
        maxBuffer: 2_000_000,
    });
    const output = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script}:exit=${String(result.status)}:${lastOutput(output)}`);
    return output;
}

function runPythonScript(script: string, args: string[] = [], timeout = DEFAULT_TIMEOUT_MS) {
    const result = spawnSync(process.env.DISDEX_PYTHON_BIN || "/usr/bin/python3", [script, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: process.env.HOME || "/home/deploy", NODE_ENV: "production", PYTHONPATH: process.env.PYTHONPATH || resolve(process.cwd(), "scripts") },
        encoding: "utf8",
        timeout,
        maxBuffer: 2_000_000,
    });
    const output = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script}:exit=${String(result.status)}:${lastOutput(output)}`);
    return output;
}

async function writeActiveKillSwitch(path: string, reason: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.auto-repair.${process.pid}.${randomUUID()}.tmp`;
    const payload = {
        active: true,
        strategyId: "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
        action: "FLATTEN_MANAGED",
        reason,
        operator: OPERATOR,
        activatedAt: new Date().toISOString(),
        automaticRepair: "FAIL_CLOSED",
    };
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
}

function buildCodexThreadHandoff(input: {
    sha: string;
    action: RepairAction;
    killActive: boolean;
    reason?: string;
    sourcePath?: string;
    localStateActive: boolean;
    localManualReview: boolean;
}) {
    const createdAt = new Date().toISOString();
    return {
        schemaVersion: 1,
        status: "PENDING_CODEX_THREAD_REPAIR",
        mode: "CODEX_THREAD_HANDOFF",
        targetThreadId: resolveCodexRepairThreadId(),
        createdAt,
        releaseSha: input.sha,
        trigger: {
            action: input.action,
            sharedKillSwitchActive: input.killActive,
            reason: input.reason || null,
            sourcePath: input.sourcePath || null,
            localStateActive: input.localStateActive,
            localManualReview: input.localManualReview,
        },
        instruction: "このCodexスレッドを修正プログラムとして使用する。kill switchの停止理由とログ・状態を確認し、原因を修正し、read-only readinessを通過させる。標準のlive gateとkill switch解除条件を確認するまで、kill switch解除・サービス再開・注文送信を行わない。確認完了後のみlive状態へ復帰し、復帰後の稼働状態を記録する。外部AI APIは使用しない。",
        requiredOutcome: "CODEX_THREAD_MUST_CONFIRM_READINESS_BEFORE_LIVE_RESUME",
        ordersSent: false,
        positionChangesSent: false,
    };
}

async function writeCodexThreadHandoff(input: Parameters<typeof buildCodexThreadHandoff>[0]) {
    const path = codexRepairRequestPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.pending.${process.pid}.${randomUUID()}.tmp`;
    const payload = buildCodexThreadHandoff(input);
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    console.log(JSON.stringify({ status: "V12_CODEX_THREAD_HANDOFF_PENDING", requestPath: path, targetThreadId: payload.targetThreadId, action: input.action, releaseSha: input.sha, ordersSent: false, positionChangesSent: false }));
    return payload;
}

async function runReadOnlyReadiness() {
    // These checks authenticate read-only account/market state and never
    // evaluate a signal or submit/cancel an order.
    runNodeScript("scripts/disdex-v12-runtime-status.ts");
    runNodeScript("scripts/disdex-v12-live-readiness.ts");
    runNodeScript("scripts/disdex-pengu-v2-live-readiness.ts");
    runPythonScript("scripts/disdex_v12_v52_live_engine.py", ["--mode", "live", "--preflight-readonly"]);
}

async function selfTest() {
    assert.equal(classifyRepair(true, SUPERVISOR_EXIT_REASON, false, false), "STALE_SHARED_KILL");
    assert.equal(classifyRepair(true, `${MARGIN_FLATTEN_REASON_PREFIX} test`, false, false), "MARGIN_FLATTEN");
    assert.equal(classifyRepair(true, "daily loss latch", false, false), "BLOCKED");
    assert.equal(classifyRepair(false, undefined, true, false, "V12 hourly history insufficient for BTC: 0"), "LOCAL_STATE");
    assert.equal(classifyRepair(false, undefined, true, false, "V12 universe alignment mismatch: LINK"), "LOCAL_STATE");
    assert.equal(classifyRepair(false, undefined, true, false, "Quantity 0 is below Aster minQty 1 for AVAXUSDT."), "LOCAL_STATE");
    assert.equal(classifyRepair(false, undefined, true, false, "unknown manual review"), "NONE");
    assert.equal(classifyRepair(false, undefined, false, false), "NONE");
    assert.equal(boolEnv("V12_AUTO_REPAIR_TEST_FALSE"), false);
    assert.equal(autoRepairMode(""), "CODEX_THREAD_HANDOFF");
    assert.equal(autoRepairMode("DETERMINISTIC"), "DETERMINISTIC");
    const handoff = buildCodexThreadHandoff({ sha: "0123456789abcdef0123456789abcdef01234567", action: "BLOCKED", killActive: true, reason: "daily loss latch", sourcePath: "/tmp/kill-switch.json", localStateActive: false, localManualReview: false });
    assert.equal(handoff.status, "PENDING_CODEX_THREAD_REPAIR");
    assert.equal(handoff.mode, "CODEX_THREAD_HANDOFF");
    assert.equal(handoff.targetThreadId, DEFAULT_CODEX_REPAIR_THREAD_ID);
    assert.match(handoff.instruction, /外部AI APIは使用しない/);
    console.log("V12 Kill Switch auto-repair self-test: PASS");
}

async function main() {
    if (process.argv.includes("--self-test")) {
        await selfTest();
        return;
    }

    const runtime = resolveV12X1AllRuntime();
    const failClosedIndex = process.argv.indexOf("--fail-closed");
    if (failClosedIndex >= 0) {
        const path = String(process.env.DISDEX_SHARED_KILL_SWITCH_FILE || "").trim();
        const reason = String(process.argv[failClosedIndex + 1] || "V12_AUTO_REPAIR_LIVE_START_FAILED").trim();
        if (!path) throw new Error("V12_AUTO_REPAIR_FAIL_CLOSED_KILL_SWITCH_PATH_MISSING");
        await writeActiveKillSwitch(resolve(path), reason);
        const after = await readSharedKillSwitch();
        if (!after.active) throw new Error("V12_AUTO_REPAIR_FAIL_CLOSED_VERIFY_FAILED");
        console.log(JSON.stringify({ status: "V12_AUTO_REPAIR_FAIL_CLOSED", reason, ordersSent: false, positionChangesSent: false }));
        return;
    }

    const sha = String(process.argv[2] || "").trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("V12_AUTO_REPAIR_EXACT_SHA_REQUIRED");
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_AUTO_REPAIR_LIVE_GATES_NOT_ALL_ENABLED");
    }

    const kill = await readSharedKillSwitch();
    const state = await new FileV12X1AllRunnerStateStore(runtime.statePath, "LIVE").load();
    const action = classifyRepair(Boolean(kill.active), kill.reason, Boolean(state.killSwitch?.active), Boolean(state.manualReview), state.manualReview || state.killSwitch?.reason);
    if (action === "NONE") {
        console.log(JSON.stringify({ status: "V12_AUTO_REPAIR_NOT_REQUIRED", sha, ordersSent: false, positionChangesSent: false }));
        return;
    }
    if (autoRepairMode() === "CODEX_THREAD_HANDOFF") {
        await writeCodexThreadHandoff({
            sha,
            action,
            killActive: Boolean(kill.active),
            reason: kill.reason,
            sourcePath: kill.sourcePath,
            localStateActive: Boolean(state.killSwitch?.active),
            localManualReview: Boolean(state.manualReview),
        });
        return;
    }
    if (action === "BLOCKED") {
        console.log(JSON.stringify({ status: "V12_AUTO_REPAIR_BLOCKED_OPERATOR_REVIEW_REQUIRED", sha, reason: kill.reason || "UNSPECIFIED", sharedKillSwitchActive: true, ordersSent: false, positionChangesSent: false }));
        return;
    }

    const token = requestToken();
    try {
        if (action === "STALE_SHARED_KILL") {
            runNodeScript("scripts/disdex-v12-stale-kill-switch-recovery.ts", [sha]);
        } else if (action === "MARGIN_FLATTEN") {
            runNodeScript("scripts/disdex-v12-margin-flatten-recovery.ts", [sha, `v12-margin-flatten-${token}`]);
        } else {
            runNodeScript("scripts/disdex-v12-stale-local-state-recovery.ts", [sha, `v12-h2-recovery-${token}`]);
        }

        const afterRepair = await readSharedKillSwitch();
        if (afterRepair.active) throw new Error(`V12_AUTO_REPAIR_SHARED_KILL_SWITCH_REMAINS_ACTIVE:${afterRepair.reason || "UNSPECIFIED"}`);
        await runReadOnlyReadiness();
        const afterReadiness = await readSharedKillSwitch();
        if (afterReadiness.active) throw new Error(`V12_AUTO_REPAIR_KILL_SWITCH_RETRIPPED:${afterReadiness.reason || "UNSPECIFIED"}`);
        console.log(JSON.stringify({ status: "V12_AUTO_REPAIR_READY", sha, action, sharedKillSwitchActive: false, readiness: "PASS", liveResumeAllowed: true, ordersSent: false, positionChangesSent: false }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = await readSharedKillSwitch().catch(() => ({ active: true, sourcePath: kill.sourcePath }));
        if (!current.active && current.sourcePath) {
            await writeActiveKillSwitch(resolve(current.sourcePath), `V12_AUTO_REPAIR_FAILED:${message.slice(0, 500)}`);
        }
        throw error;
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_AUTO_REPAIR_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false, positionChangesSent: false }));
    process.exitCode = 1;
});
