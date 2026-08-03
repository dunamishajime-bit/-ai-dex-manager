import "dotenv/config";

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { resolvePenguDualLsV1Runtime } from "../config/penguDualLsV1Runtime";

export type V52PreflightStatus =
    | "ACTIVE"
    | "WAITING_MARKET_CLOSED"
    | "BLOCKED_DATA_UNAVAILABLE";

type ChildResult = { code: number | null; stdout: string; stderr: string };

const DATA_FAILURE_PATTERNS = [
    /iex_quote_unavailable/i,
    /cross_source_divergence/i,
    /reference quote (?:stale|unavailable|failed)/i,
    /reference (?:health|source).*?(?:failed|unavailable|not connected|did not become ready)/i,
    /free reference/i,
    /pyth.*iex/i,
];

function isUsRegularEquitySession(now = new Date()): boolean {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
    if (["Sat", "Sun"].includes(parts.weekday)) return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 570 && minutes <= 960;
}

export function containsDataFailure(output: string): boolean {
    return DATA_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

export function classifyV52PreflightFailure(output: string, now = new Date()): V52PreflightStatus | undefined {
    if (!containsDataFailure(output)) return undefined;
    return isUsRegularEquitySession(now) ? "BLOCKED_DATA_UNAVAILABLE" : "WAITING_MARKET_CLOSED";
}

export function shouldStartV52Worker(status: V52PreflightStatus): boolean {
    return status === "ACTIVE";
}

function spawnCaptured(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<ChildResult> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => resolveResult({ code, stdout, stderr }));
    });
}

function parseLastJson(output: string): Record<string, unknown> {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
        try {
            const parsed = JSON.parse(line) as unknown;
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {
            // Ignore child diagnostics; the structured JSON result is authoritative.
        }
    }
    throw new Error("Strategy preflight returned no structured result.");
}

function assertPenguPreflight() {
    const runtime = resolvePenguDualLsV1Runtime();
    if (runtime.mode !== "LIVE") throw new Error(`PENGU preflight requires LIVE mode, got ${runtime.mode}.`);
    if (!runtime.enabled || !runtime.liveExecutionEnabled || !runtime.liveTradingEnabled) {
        throw new Error("PENGU preflight LIVE gates are not all enabled.");
    }
    if (runtime.maximumGross <= 0 || runtime.maximumGross > runtime.portfolioGrossCap) {
        throw new Error("PENGU preflight gross cap is invalid.");
    }
    return {
        status: "PASS",
        strategyId: runtime.strategyId,
        maximumGross: runtime.maximumGross,
        longGross: runtime.longGross,
        shortGross: runtime.shortGross,
    } as const;
}

async function main() {
    const env = { ...process.env };
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    const v52 = await spawnCaptured(python, ["scripts/disdex_v52_aster_only_live_engine.py", "--mode", "live", "--preflight"], env);
    const v52Output = `${v52.stdout}\n${v52.stderr}`;
    let v52Status: V52PreflightStatus;
    let v52Detail: Record<string, unknown> | undefined;
    if (v52.code === 0) {
        v52Status = "ACTIVE";
        v52Detail = parseLastJson(v52.stdout);
    } else {
        const classified = classifyV52PreflightFailure(v52Output);
        if (!classified) throw new Error("V52 preflight failed for a non-data safety reason; fail-closed.");
        v52Status = classified;
    }

    const crypto = await spawnCaptured(tsx, ["scripts/disdex-v96-live-preflight.ts"], env);
    if (crypto.code !== 0) throw new Error("V96 crypto preflight failed; fail-closed.");
    const cryptoDetail = parseLastJson(crypto.stdout);
    const pengu = assertPenguPreflight();
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_STRATEGY_PREFLIGHT_PASS",
        portfolioSafety: "PASS_SHARED_CRYPTO_PREFLIGHT",
        cryptoV96Preflight: "PASS",
        cryptoV96Detail: cryptoDetail,
        penguDualPreflight: pengu,
        v52Preflight: { status: v52Status, ordersAllowed: shouldStartV52Worker(v52Status), detail: v52Detail, dataFailureDoesNotBypassSafety: true },
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(JSON.stringify({ status: "DISDEX_V96_V52_STRATEGY_PREFLIGHT_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: false, cancelSent: false, positionChangesSent: false }));
        process.exitCode = 1;
    });
}
