import "dotenv/config";

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import { DISDEX_V13D_V11EQ_V96_ALLOCATION } from "../config/disdexStockRouterV13DV11EqRuntime";

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

export function isUsRegularEquitySession(now = new Date()): boolean {
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

export function shouldFetchV52MarketData(now = new Date()): boolean {
    return isUsRegularEquitySession(now);
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
        // Wait for stdio to close, not merely for the process to exit: the
        // structured report is intentionally emitted as a large final line.
        child.once("close", (code) => resolveResult({ code, stdout, stderr }));
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
    const runtime = resolvePenguDualLsV2Runtime();
    if (runtime.mode !== "LIVE") throw new Error(`PENGU preflight requires LIVE mode, got ${runtime.mode}.`);
    if (!runtime.enabled || !runtime.liveExecutionEnabled || !runtime.liveTradingEnabled) {
        throw new Error("PENGU preflight LIVE gates are not all enabled.");
    }
    if (runtime.maximumGross <= 0 || runtime.maximumGross > runtime.portfolioGrossCap) {
        throw new Error("PENGU preflight gross cap is invalid.");
    }
    if (Math.abs(runtime.portfolioGrossCap - DISDEX_V13D_V11EQ_V96_ALLOCATION.cryptoSleeveGrossCap) > 1e-12) {
        throw new Error("PENGU preflight Crypto sleeve Gross does not match the combined allocation.");
    }
    return {
        status: "PASS",
        strategyId: runtime.strategyId,
        maximumGross: runtime.maximumGross,
        longGross: runtime.longGross,
        shortGross: runtime.shortGross,
        portfolioGrossCap: runtime.portfolioGrossCap,
    } as const;
}

async function main() {
    const env = { ...process.env };
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const tsx = resolve(process.env.DISDEX_TSX_BIN || "node_modules/.bin/tsx");
    let v52Status: V52PreflightStatus;
    let v52Detail: Record<string, unknown> | undefined;
    if (!shouldFetchV52MarketData()) {
        v52Status = "WAITING_MARKET_CLOSED";
        v52Detail = {
            marketSession: "CLOSED",
            reason: "US_EQUITY_MARKET_CLOSED",
            ordersAllowed: false,
            referenceFetchSkipped: true,
        };
    } else {
        const v52 = await spawnCaptured(
            python,
            ["scripts/disdex_v52_margin_aware_live_engine.py", "--mode", "live", "--preflight-readonly"],
            env,
        );
        const v52Output = `${v52.stdout}\n${v52.stderr}`;
        if (v52.code === 0) {
            v52Status = "ACTIVE";
            v52Detail = parseLastJson(v52.stdout);
        } else {
            const classified = classifyV52PreflightFailure(v52Output);
            if (!classified) throw new Error(`V52 preflight failed for a non-data safety reason; fail-closed. ${v52Output.trim()}`);
            v52Status = classified;
        }
    }

    const crypto = await spawnCaptured(tsx, ["scripts/disdex-v96-live-preflight.ts"], env);
    if (crypto.code !== 0) throw new Error(`V96 crypto preflight failed; fail-closed. ${crypto.stderr.trim()}`);
    const cryptoDetail = parseLastJson(crypto.stdout);
    const pengu = assertPenguPreflight();
    console.log(JSON.stringify({
        status: "DISDEX_V96_V52_STRATEGY_PREFLIGHT_PASS",
        portfolioSafety: "PASS_SHARED_CRYPTO_PREFLIGHT_AND_MARGIN_AWARE_V52",
        cryptoV96Preflight: "PASS",
        cryptoV96Detail: cryptoDetail,
        penguDualPreflight: pengu,
        combinedAllocation: DISDEX_V13D_V11EQ_V96_ALLOCATION,
        v52Preflight: {
            status: v52Status,
            mode: "READ_ONLY",
            ordersAllowed: shouldStartV52Worker(v52Status),
            detail: v52Detail,
            dataFailureDoesNotBypassSafety: true,
        },
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(JSON.stringify({
            status: "DISDEX_V96_V52_STRATEGY_PREFLIGHT_FAIL_CLOSED",
            message: error instanceof Error ? error.message : String(error),
            ordersSent: false,
            cancelSent: false,
            positionChangesSent: false,
        }));
        process.exitCode = 1;
    });
}
